const prisma = require('../../config/prisma');
const ApiError = require('../../utils/ApiError');
const sanitizeUser = require('../../utils/sanitizeUser');
const notifications = require('../notifications/notifications.service');
const otpStore = require('../auth/otp.store');
const { issueTokenPair } = require('../auth/token.util');
const addresses = require('../users/addresses.service');
const { relaxed, parseLooseDate, parseLooseEnum } = require('../../utils/onboardingValidation');

// Customer onboarding, as the customer app presents it:
//
//   1. Phone number     POST /otp/request
//   2. Verify OTP       POST /otp/verify   -> tokens + where the customer is
//   3. Name & gender    PUT  /profile
//   4. Address          PUT  /address      -> isOnboarded becomes true
//
// After that the account is managed through /users/me (profile, photo,
// phone number, addresses, delete).

const OTP_TTL_SECONDS = 300;

// One account has one role, so a number already registered as a vendor or
// staff member cannot also be used in the customer app.
const assertCanBeCustomer = (user) => {
  if (!user) return;
  if (!user.isActive) throw ApiError.forbidden('This account has been deactivated');
  if (user.role !== 'CUSTOMER') {
    throw ApiError.forbidden(
      user.role === 'PROFESSIONAL'
        ? 'This phone number is registered as a service professional. Use the partner app to sign in.'
        : 'This phone number belongs to an admin account and cannot be used in the customer app',
    );
  }
};

const loadCustomer = async (userId) => {
  const user = await prisma.user.findUnique({ where: { id: userId }, include: { city: { select: { id: true, name: true } } } });
  if (!user || user.deletedAt) throw ApiError.notFound('User not found');
  assertCanBeCustomer(user);
  return user;
};

// The four-step journey, ready to render as a progress tracker. Holding a
// token means steps 1 and 2 are done; choosing a gender marks step 3
// (a new account starts with a placeholder name, so the name alone can't).
const PLACEHOLDER_NAME = 'New User';

// Step 3 is done once a gender is chosen. With validation off gender is
// optional, so giving a real name counts too.
const isProfileDone = (user) => Boolean(user.gender) || (relaxed && user.name !== PLACEHOLDER_NAME);

const computeFlow = (user, hasAddress) => {
  const profileDone = isProfileDone(user);
  const stepStatus = (done, isNext) => (done ? 'COMPLETE' : isNext ? 'CURRENT' : 'PENDING');
  const steps = [
    { step: 1, key: 'PHONE_NUMBER', title: 'Phone number', status: 'COMPLETE' },
    { step: 2, key: 'VERIFY_OTP', title: 'Verify OTP', status: 'COMPLETE' },
    { step: 3, key: 'PROFILE', title: 'Name and gender', status: stepStatus(profileDone, true) },
    { step: 4, key: 'ADDRESS', title: 'Address', status: stepStatus(hasAddress, profileDone) },
  ];
  const isComplete = profileDone && hasAddress;
  return {
    currentStep: isComplete ? null : profileDone ? 4 : 3,
    isComplete,
    steps,
    // What the app should show next: 'profile', 'address', or null when onboarding is finished.
    nextStep: isComplete ? null : profileDone ? 'address' : 'profile',
  };
};

const buildView = async (user) => {
  const saved = await addresses.list(user.id);
  const { nextStep, ...flow } = computeFlow(user, saved.length > 0);
  return {
    user: sanitizeUser(user),
    flow,
    nextStep,
    defaultAddress: saved.find((address) => address.isDefault) ?? null,
  };
};

// Onboarding is finished the moment both steps are complete, whatever order
// they were saved in.
const refreshOnboarded = async (userId) => {
  const [user, addressCount] = await Promise.all([loadCustomer(userId), prisma.address.count({ where: { userId } })]);
  const isOnboarded = isProfileDone(user) && addressCount > 0;
  if (user.isOnboarded === isOnboarded) return user;
  return prisma.user.update({ where: { id: userId }, data: { isOnboarded }, include: { city: { select: { id: true, name: true } } } });
};

const requestOtp = async (phone) => {
  assertCanBeCustomer(await prisma.user.findUnique({ where: { phone } }));
  const otp = otpStore.setOtp(phone);
  await notifications.sendOtp(phone, otp);
  return { sent: true, expiresInSeconds: OTP_TTL_SECONDS };
};

// Signs the customer in, creating the account the first time this number is
// used, and reports where they are in onboarding so the app can route them.
const verifyOtp = async (phone, otp) => {
  const existing = await prisma.user.findUnique({ where: { phone } });
  assertCanBeCustomer(existing);
  if (!otpStore.verifyOtp(phone, otp)) throw ApiError.badRequest('Invalid or expired OTP');

  const account = existing ?? (await prisma.user.create({ data: { phone, name: PLACEHOLDER_NAME, role: 'CUSTOMER' } }));
  const user = await prisma.user.update({
    where: { id: account.id },
    data: { lastLoginAt: new Date() },
    include: { city: { select: { id: true, name: true } } },
  });

  return { isNewUser: !existing, ...issueTokenPair(user), ...(await buildView(user)) };
};

const getStatus = async (userId) => buildView(await loadCustomer(userId));

const saveProfile = async (userId, { name, gender, email, dateOfBirth }) => {
  const user = await loadCustomer(userId);
  const emailTaken = Boolean(email) && email !== user.email && Boolean(await prisma.user.findUnique({ where: { email } }));
  if (emailTaken && !relaxed) throw ApiError.conflict('This email is already linked to another account');

  // Validation off: anything may be left out, what is left out is kept as it
  // was, and a value that cannot be stored is dropped rather than refused.
  const looseGender = relaxed ? parseLooseEnum(gender, ['MALE', 'FEMALE', 'OTHER']) : null;
  const looseBirthday = relaxed ? parseLooseDate(dateOfBirth) : null;
  const data = relaxed
    ? {
        ...(name && { name }),
        ...(looseGender && { gender: looseGender }),
        ...(email && !emailTaken && { email }),
        ...(looseBirthday && { dateOfBirth: looseBirthday }),
      }
    : {
        name,
        gender,
        // Optional here: leaving them out keeps whatever is already saved.
        ...(email && { email }),
        ...(dateOfBirth && { dateOfBirth: new Date(`${dateOfBirth}T00:00:00.000Z`) }),
      };
  await prisma.user.update({ where: { id: userId }, data });
  return buildView(await refreshOnboarded(userId));
};

const saveAddress = async (userId, body) => {
  await loadCustomer(userId);

  if (relaxed) {
    // Every field is stored as sent (blank when missing). A city or zone id
    // that does not exist cannot be stored, so it is left empty.
    const existing = async (model, id) => (id && (await prisma[model].findUnique({ where: { id } })) ? id : null);
    const data = {
      ...body,
      cityId: await existing('city', body.cityId),
      zoneId: await existing('zone', body.zoneId),
      label: parseLooseEnum(body.label, ['HOME', 'WORK', 'OTHER']) ?? 'HOME',
      line1: body.line1 ?? '',
      state: body.state ?? '',
      pincode: body.pincode ?? '',
    };
    await addresses.saveDefault(userId, data, { unchecked: true });
    return buildView(await refreshOnboarded(userId));
  }

  await addresses.saveDefault(userId, body);
  return buildView(await refreshOnboarded(userId));
};

module.exports = { requestOtp, verifyOtp, getStatus, saveProfile, saveAddress };
