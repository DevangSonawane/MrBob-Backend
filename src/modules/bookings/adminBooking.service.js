const prisma = require('../../config/prisma');
const ApiError = require('../../utils/ApiError');
const addresses = require('../users/addresses.service');
const dispatch = require('../dispatch/dispatch.service');
const matching = require('../matching/matching.service');
const bookings = require('./bookings.service');

// A booking made by the team from the web dashboard, for a customer who
// called or walked in. The customer can be an existing one or a new one
// (looked up by phone first, so nobody gets two accounts), the address one of
// theirs or a new one (saved to their addresses), and a vendor can be assigned
// straight away. It is paid after the service; nobody is sent a payment link.

const { load, detail, event, notify } = bookings.internals;
const MAX_ADVANCE_DAYS = 60;

const findOrCreateCustomer = async ({ customerId, newCustomer }) => {
  if (customerId) {
    const user = await prisma.user.findUnique({ where: { id: customerId } });
    if (!user || user.deletedAt) throw ApiError.badRequest('Customer not found');
    if (user.role !== 'CUSTOMER') throw ApiError.badRequest('Bookings can only be made for a customer account');
    return { user, created: false };
  }

  const existing = await prisma.user.findUnique({ where: { phone: newCustomer.phone } });
  if (existing) {
    if (existing.deletedAt) throw ApiError.conflict('This phone number belongs to a deleted account');
    if (existing.role !== 'CUSTOMER') throw ApiError.conflict('This phone number belongs to a vendor or staff account');
    return { user: existing, created: false };
  }
  if (newCustomer.email && (await prisma.user.findUnique({ where: { email: newCustomer.email } }))) {
    throw ApiError.conflict('This email is already linked to another account');
  }
  // They sign in to the app later with this phone number and an OTP.
  const user = await prisma.user.create({ data: { name: newCustomer.name, phone: newCustomer.phone, email: newCustomer.email || null, role: 'CUSTOMER', isOnboarded: true } });
  return { user, created: true };
};

const create = async (actor, body) => {
  const when = new Date(body.scheduledAt);
  if (when.getTime() <= Date.now()) throw ApiError.badRequest('Choose a time in the future');
  if (when.getTime() > Date.now() + MAX_ADVANCE_DAYS * 24 * 60 * 60 * 1000) throw ApiError.badRequest(`Bookings can be made up to ${MAX_ADVANCE_DAYS} days ahead`);

  const category = await prisma.serviceCategory.findUnique({ where: { id: body.categoryId } });
  if (!category || !category.isActive) throw ApiError.badRequest('Unknown or inactive service');
  if (body.professionalId) {
    const vendor = await prisma.professional.findUnique({ where: { id: body.professionalId } });
    if (!vendor || vendor.kycStatus !== 'VERIFIED') throw ApiError.badRequest('That vendor is not approved');
    if (!vendor.categories.includes(body.categoryId)) throw ApiError.badRequest('That vendor does not offer this service');
  }

  const { user: customer } = await findOrCreateCustomer(body);

  let address;
  if (body.addressId) {
    address = await prisma.address.findFirst({ where: { id: body.addressId, userId: customer.id } });
    if (!address) throw ApiError.badRequest('That address does not belong to this customer');
  } else {
    // Saved to the customer's addresses, so it is there next time too.
    const saved = await addresses.create(customer.id, { ...body.address, label: body.address.label ?? 'HOME' });
    address = await prisma.address.findUnique({ where: { id: saved.id } });
  }
  const city = address.cityId ? await prisma.city.findUnique({ where: { id: address.cityId }, select: { name: true } }) : null;

  const price = body.price ?? category.basePrice;
  const created = await prisma.$transaction(async (tx) => {
    const booking = await tx.booking.create({
      data: {
        customerId: customer.id,
        categoryId: category.id,
        scheduledAt: when,
        description: body.description,
        paymentMode: 'PAY_AFTER_SERVICE',
        price,
        status: 'PENDING',
        address: [address.line1, address.line2, address.landmark, city?.name, `${address.state} ${address.pincode}`.trim()].filter(Boolean).join(', '),
        addressId: address.id,
        cityId: address.cityId,
        zoneId: address.zoneId,
        pincode: address.pincode,
        latitude: address.latitude,
        longitude: address.longitude,
        contactName: address.contactName,
        contactPhone: address.contactPhone,
      },
    });
    await event(tx, booking.id, actor, { type: 'CREATED', toStatus: 'PENDING', note: body.note ? `Booked by the team: ${body.note}` : 'Booked by the team' });
    return booking;
  });

  if (body.professionalId) await dispatch.assign(created.id, body.professionalId, actor);
  else matching.startSoon(created.id);
  const booking = await load(created.id);
  notify(customer.id, 'Booking confirmed', `Your ${category.name} booking ${bookings.bookingNumber(booking.sequence)} is confirmed.`, booking);
  return detail(created.id, actor);
};

module.exports = { create };
