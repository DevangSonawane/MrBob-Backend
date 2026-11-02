const prisma = require('../../config/prisma');
const ApiError = require('../../utils/ApiError');
const addresses = require('../users/addresses.service');
const dispatch = require('../dispatch/dispatch.service');
const matching = require('../matching/matching.service');
const bookings = require('./bookings.service');
const pincodes = require('../zones/serviceability.service');

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

  // A new address is checked first, so a refused booking leaves no new customer or address behind.
  if (!body.addressId) await pincodes.assertBookable(body.address.pincode);
  const { user: customer } = await findOrCreateCustomer(body);

  let address;
  if (body.addressId) {
    address = await prisma.address.findFirst({ where: { id: body.addressId, userId: customer.id } });
    if (!address) throw ApiError.badRequest('That address does not belong to this customer');
    await pincodes.assertBookable(address.pincode);
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

// ---------------------------------------------------------------------------
// Editing a booking (the team). The date and time are changed with
// reschedule, the status with the status / cancel actions; this covers the
// rest. Each change goes on the booking's timeline.
// ---------------------------------------------------------------------------

const CLOSED = ['COMPLETED', 'CANCELLED'];
const LOOKING_FOR_VENDOR = ['PENDING', 'MATCHING'];
const oneLine = (address, cityName) => [address.line1, address.line2, address.landmark, cityName, `${address.state} ${address.pincode}`.trim()].filter(Boolean).join(', ');
const money = (value) => `₹${Number(value).toLocaleString('en-IN')}`;

const update = async (id, actor, { addressId, address: newAddress, price, description, contactName, contactPhone, note }) => {
  const booking = await load(id);
  if (CLOSED.includes(booking.status)) throw ApiError.conflict(`A ${booking.status.toLowerCase()} booking can't be changed`);
  const moving = Boolean(addressId || newAddress);
  if (moving && booking.status === 'IN_PROGRESS') throw ApiError.conflict('Work has started — the address can no longer change');
  if (price !== undefined && booking.paymentMode === 'ONLINE') throw ApiError.conflict('This booking is paid online for a fixed amount — its price can\'t change');
  if (price !== undefined && booking.payment?.status === 'SUCCESS') throw ApiError.conflict('This booking has already been paid');

  const changes = {};
  const said = [];

  if (moving) {
    let address;
    if (addressId) {
      address = await prisma.address.findFirst({ where: { id: addressId, userId: booking.customerId } });
      if (!address) throw ApiError.badRequest('That address does not belong to this customer');
      await pincodes.assertBookable(address.pincode);
    } else {
      await pincodes.assertBookable(newAddress.pincode);
      // Saved to the customer's addresses, so it is there next time too.
      const saved = await addresses.create(booking.customerId, { ...newAddress, label: newAddress.label ?? 'OTHER' });
      address = await prisma.address.findUnique({ where: { id: saved.id } });
    }
    const city = address.cityId ? await prisma.city.findUnique({ where: { id: address.cityId }, select: { name: true } }) : null;
    Object.assign(changes, {
      address: oneLine(address, city?.name),
      addressId: address.id,
      cityId: address.cityId,
      zoneId: address.zoneId,
      pincode: address.pincode,
      latitude: address.latitude,
      longitude: address.longitude,
      contactName: address.contactName,
      contactPhone: address.contactPhone,
    });
    // Still looking for a vendor: start again from the new place.
    if (LOOKING_FOR_VENDOR.includes(booking.status)) Object.assign(changes, { status: 'PENDING', h3Cell: null, dispatchWave: 0, openToAllAt: null });
    said.push(`Address: ${changes.address}`);
  }
  // Given explicitly, the contact wins over the one that came with a new address.
  if (contactName !== undefined) changes.contactName = contactName;
  if (contactPhone !== undefined) changes.contactPhone = contactPhone;
  if (contactName !== undefined || contactPhone !== undefined) said.push(`Contact: ${[changes.contactName, changes.contactPhone].filter(Boolean).join(', ') || 'none'}`);
  if (price !== undefined) {
    changes.price = price;
    said.push(`Price: ${booking.price === null ? '—' : money(booking.price)} → ${money(price)}`);
  }
  if (description !== undefined) {
    changes.description = description;
    said.push('Problem description updated');
  }

  const restartDispatch = changes.status === 'PENDING';
  await prisma.$transaction(async (tx) => {
    const { count } = await tx.booking.updateMany({ where: { id, status: booking.status }, data: changes });
    if (count === 0) throw ApiError.conflict('This booking was just updated by someone else — reload and try again');
    if (restartDispatch) await matching.forgetOffers(id, tx);
    await event(tx, id, actor, {
      type: 'EDITED',
      ...(changes.status && changes.status !== booking.status && { fromStatus: booking.status, toStatus: changes.status }),
      note: [...said, note].filter(Boolean).join(' · '),
    });
  });
  if (restartDispatch) matching.startSoon(id);

  const number = bookings.bookingNumber(booking.sequence);
  const updated = await load(id);
  if (booking.professional && (moving || contactName !== undefined || contactPhone !== undefined || description !== undefined)) {
    notify(booking.professional.userId, 'Job details changed', `Booking ${number} has new details${moving ? `: the job is now at ${updated.address}` : ''}.`, updated);
  }
  if (moving || price !== undefined) {
    notify(booking.customerId, 'Booking updated', `Your booking ${number} was updated${price !== undefined ? ` — the price is now ${money(price)}` : ''}.`, updated);
  }
  return detail(id, actor);
};

module.exports = { create, update };
