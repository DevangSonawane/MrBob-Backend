const crypto = require('crypto');
const prisma = require('../../config/prisma');
const ApiError = require('../../utils/ApiError');
const storage = require('../storage/storage.service');
const wallet = require('../wallet/wallet.service');
const invoices = require('../invoices/invoices.service');
const { extensionFor } = require('../../middlewares/upload');
const { toSkipTake, paginatedResponse } = require('../../utils/pagination');
const bookings = require('../bookings/bookings.service');

// The vendor's side of a booking, start to finish:
//   see open jobs -> accept one -> start it with the customer's start code
//   -> enter the customer's completion code -> upload photos of the work
//   -> complete it, which credits the vendor's wallet.
// The codes are shown to the customer in their app, so a job can only be
// started and finished with the customer there.

const { load, detail, event, notify, assertCanSee } = bookings.internals;
const { bookingNumber, jobOtp } = bookings;

const MAX_OTP_ATTEMPTS = 5;
const MAX_IMAGES = 5;
const OPEN_FOR_VENDORS = ['PENDING', 'MATCHING'];

const sameCode = (expected, given) => {
  const a = Buffer.from(String(expected ?? ''));
  const b = Buffer.from(String(given ?? ''));
  return a.length > 0 && a.length === b.length && crypto.timingSafeEqual(a, b);
};

// Only an approved, active vendor is offered or can take jobs.
const approvedVendor = async (user) => {
  const vendor = await prisma.professional.findUnique({ where: { userId: user.id }, include: { user: { select: { cityId: true, isActive: true, name: true } } } });
  if (!vendor) throw ApiError.forbidden('Finish vendor onboarding first');
  if (vendor.onboardingStatus !== 'APPROVED' || vendor.kycStatus !== 'VERIFIED') throw ApiError.forbidden('Your vendor profile is not approved yet');
  return vendor;
};

// The caller's own job, in the status the step needs.
const myJob = async (id, user, status, hint) => {
  const booking = await load(id);
  if (booking.professional?.userId !== user.id) throw ApiError.forbidden('This job is not assigned to you');
  if (booking.status !== status) throw ApiError.conflict(`This job is ${booking.status}. ${hint}`);
  return booking;
};

// Jobs a vendor may take: every confirmed booking nobody has taken yet.
// For now there is no matching on the vendor's services or city — any
// approved vendor sees and can accept any open order.
const availableWhere = () => ({
  status: { in: OPEN_FOR_VENDORS },
  professionalId: null,
});

const availableInclude = { category: { select: { id: true, name: true, tier: true } }, city: { select: { id: true, name: true } }, zone: { select: { id: true, name: true } } };

// What a vendor sees before taking a job: enough to decide, not the
// customer's name, phone or exact address.
const availableView = (booking) => ({
  id: booking.id,
  bookingNumber: bookingNumber(booking.sequence),
  service: booking.category,
  scheduledAt: booking.scheduledAt,
  description: booking.description,
  price: booking.price === null ? null : Number(booking.price),
  paymentMode: booking.paymentMode,
  area: { city: booking.city, zone: booking.zone, pincode: booking.pincode },
  createdAt: booking.createdAt,
});

const listAvailable = async (user, { page, limit }) => {
  const vendor = await approvedVendor(user);
  const where = availableWhere(vendor);
  const [rows, total] = await Promise.all([
    prisma.booking.findMany({ where, ...toSkipTake({ page, limit }), orderBy: [{ scheduledAt: { sort: 'asc', nulls: 'last' } }, { createdAt: 'asc' }], include: availableInclude }),
    prisma.booking.count({ where }),
  ]);
  return paginatedResponse(rows.map(availableView), total, { page, limit });
};

const getAvailable = async (user, id) => {
  const vendor = await approvedVendor(user);
  const booking = await prisma.booking.findFirst({ where: { id, ...availableWhere(vendor) }, include: availableInclude });
  if (!booking) throw ApiError.notFound('This job is no longer available');
  return availableView(booking);
};

// First vendor to accept gets the job; the customer is given the start code.
const accept = async (user, id) => {
  const vendor = await approvedVendor(user);
  const booking = await prisma.booking.findFirst({ where: { id, ...availableWhere(vendor) } });
  if (!booking) throw ApiError.conflict('This job is no longer available');

  await prisma.$transaction(async (tx) => {
    const { count } = await tx.booking.updateMany({
      where: { id, status: { in: OPEN_FOR_VENDORS }, professionalId: null },
      data: { professionalId: vendor.id, status: 'ASSIGNED', assignedAt: new Date(), startOtp: jobOtp(), startOtpAttempts: 0 },
    });
    if (count === 0) throw ApiError.conflict('Another vendor just took this job');
    await event(tx, id, user, { type: 'ASSIGNED', fromStatus: booking.status, toStatus: 'ASSIGNED', note: 'Accepted by the vendor' });
  });

  notify(booking.customerId, 'Professional assigned', `${vendor.user.name} will do your job. Share the start code in the app when they arrive.`, { ...booking, status: 'ASSIGNED' });
  return detail(id, user);
};

// Checks a code the customer read out. After too many wrong tries the code is
// replaced, so it cannot be guessed; the customer sees the new one in their app.
const checkOtp = async (booking, given, field) => {
  const attemptsField = `${field}Attempts`;
  if (sameCode(booking[field], given)) return;

  const attempts = booking[attemptsField] + 1;
  const exhausted = attempts >= MAX_OTP_ATTEMPTS;
  await prisma.booking.update({ where: { id: booking.id }, data: exhausted ? { [field]: jobOtp(), [attemptsField]: 0 } : { [attemptsField]: attempts } });
  if (exhausted) {
    notify(booking.customerId, 'New code', 'Too many wrong tries. A new code is in your booking — share that one.', booking);
    throw ApiError.badRequest('Too many wrong tries. The customer has been given a new code — ask them for it.');
  }
  throw ApiError.badRequest(`Incorrect OTP. ${MAX_OTP_ATTEMPTS - attempts} ${MAX_OTP_ATTEMPTS - attempts === 1 ? 'try' : 'tries'} left.`);
};

const start = async (user, id, otp) => {
  const booking = await myJob(id, user, 'ASSIGNED', 'Only an assigned job can be started.');
  await checkOtp(booking, otp, 'startOtp');

  await prisma.$transaction(async (tx) => {
    const { count } = await tx.booking.updateMany({
      where: { id, status: 'ASSIGNED' },
      data: { status: 'IN_PROGRESS', startedAt: new Date(), startOtp: null, startOtpAttempts: 0, completionOtp: jobOtp(), completionOtpAttempts: 0, completionOtpVerifiedAt: null },
    });
    if (count === 0) throw ApiError.conflict('This booking was just updated by someone else — reload and try again');
    await event(tx, id, user, { type: 'STATUS_CHANGED', fromStatus: 'ASSIGNED', toStatus: 'IN_PROGRESS', note: 'Started with the customer\'s code' });
  });

  notify(booking.customerId, 'Work has started', `${booking.professional.user.name} has started the job. Share the completion code only when the work is done.`, { ...booking, status: 'IN_PROGRESS' });
  return detail(id, user);
};

const IN_PROGRESS_HINT = 'This step is for a job that has been started.';

const verifyCompletionOtp = async (user, id, otp) => {
  const booking = await myJob(id, user, 'IN_PROGRESS', IN_PROGRESS_HINT);
  if (booking.completionOtpVerifiedAt) return detail(id, user);
  await checkOtp(booking, otp, 'completionOtp');
  await prisma.booking.update({ where: { id }, data: { completionOtpVerifiedAt: new Date(), completionOtp: null, completionOtpAttempts: 0 } });
  return detail(id, user);
};

const addImages = async (user, id, files = []) => {
  const booking = await myJob(id, user, 'IN_PROGRESS', IN_PROGRESS_HINT);
  if (files.length === 0) throw ApiError.badRequest('Upload at least one image as "images"');
  if (booking.images.length + files.length > MAX_IMAGES) {
    throw ApiError.badRequest(`A job can have up to ${MAX_IMAGES} photos; this one already has ${booking.images.length}`);
  }

  for (const file of files) {
    const fileKey = `bookings/${id}/work-${crypto.randomUUID()}.${extensionFor(file.mimetype)}`;
    await storage.put(fileKey, file.buffer, file.mimetype);
    await prisma.bookingImage.create({ data: { bookingId: id, fileKey, mimeType: file.mimetype, uploadedById: user.id } });
  }
  return detail(id, user);
};

const removeImage = async (user, id, imageId) => {
  await myJob(id, user, 'IN_PROGRESS', 'Photos can only be changed before the job is completed.');
  const image = await prisma.bookingImage.findFirst({ where: { id: imageId, bookingId: id } });
  if (!image) throw ApiError.notFound('Photo not found');
  await prisma.bookingImage.delete({ where: { id: imageId } });
  await storage.remove(image.fileKey);
  return detail(id, user);
};

// The customer, the vendor on the job, and the team can see the photos.
const openImage = async (user, id, imageId) => {
  assertCanSee(await load(id), user);
  const image = await prisma.bookingImage.findFirst({ where: { id: imageId, bookingId: id } });
  if (!image) throw ApiError.notFound('Photo not found');
  return { stream: await storage.getStream(image.fileKey), mimeType: image.mimeType };
};

// Finishes the job and credits the vendor's wallet for it.
const complete = async (user, id) => {
  const booking = await myJob(id, user, 'IN_PROGRESS', 'Only a job in progress can be completed.');
  if (!booking.completionOtpVerifiedAt) throw ApiError.conflict('Enter the customer\'s completion code first');
  if (booking.images.length === 0) throw ApiError.conflict('Upload at least one photo of the finished work first');

  await prisma.$transaction(async (tx) => {
    const { count } = await tx.booking.updateMany({ where: { id, status: 'IN_PROGRESS' }, data: { status: 'COMPLETED', completedAt: new Date() } });
    if (count === 0) throw ApiError.conflict('This booking was just updated by someone else — reload and try again');
    await event(tx, id, user, { type: 'STATUS_CHANGED', fromStatus: 'IN_PROGRESS', toStatus: 'COMPLETED', note: 'Completed with the customer\'s code' });
    await wallet.creditForBooking(tx, booking);
    await invoices.issueForBooking(tx, booking);
  });

  notify(booking.customerId, 'Job completed', 'Your service is complete. Tell us how it went.', { ...booking, status: 'COMPLETED' });
  return detail(id, user);
};

module.exports = { MAX_IMAGES, listAvailable, getAvailable, accept, start, verifyCompletionOtp, addImages, removeImage, openImage, complete };
