const crypto = require('crypto');
const prisma = require('../../config/prisma');
const logger = require('../../config/logger');
const ApiError = require('../../utils/ApiError');
const { isAdmin } = require('../../utils/roles');
const { toSkipTake, paginatedResponse } = require('../../utils/pagination');
const { dateRange, personSearch } = require('../../utils/queryFilters');
const kycCrypto = require('../../utils/kycCrypto');
const { normalizeAadhaar, isValidAadhaar, normalizePan, isValidPan } = require('../../utils/indianIds');
const { extensionFor } = require('../../middlewares/upload');
const storage = require('../storage/storage.service');
const notifications = require('../notifications/notifications.service');
const kycVerification = require('./kycVerification.service');
const otpStore = require('../auth/otp.store');
const { issueTokenPair } = require('../auth/token.util');

// Vendor onboarding, as the vendor app presents it:
//
//   1. Phone number   POST /otp/request
//   2. Verify OTP     POST /otp/verify      -> tokens + a DRAFT application
//   3. Enter details  PUT  /personal-details, /profile-photo, /services,
//                          /documents/{aadhaar|pan}, /bank-details; POST /submit
//   4. Verify vendor  admins verify the documents, a super admin approves
//   5. Verified       the vendor is APPROVED and can be assigned jobs
//
// Underneath, the application moves through these statuses:
//
//   DRAFT ──submit──▶ SUBMITTED ──all documents verified──▶ PENDING_APPROVAL ──approve──▶ APPROVED
//     ▲                   │                                        │
//     │                   ├── a document is rejected ──┐           ├── reject ──▶ REJECTED
//     │                   ├── request changes ─────────┤           │
//     └── vendor edits ── CHANGES_REQUESTED ◀──────────┴───────────┘ (request changes)
//
// Stage 1 (Aadhaar, PAN and the payout bank account) is done by the KYC
// provider when one is configured and by any admin otherwise; stage 2
// (approve / reject) is super admin only. A super admin can also reopen a
// REJECTED application, which puts it back in CHANGES_REQUESTED.

const IDENTITY_DOCUMENTS = ['AADHAAR', 'PAN'];
// Everything that must be VERIFIED before an application reaches the super admin.
const REQUIRED_DOCUMENTS = [...IDENTITY_DOCUMENTS, 'BANK_ACCOUNT'];
const EDITABLE_STATUSES = ['DRAFT', 'CHANGES_REQUESTED'];
const REVIEWABLE_STATUSES = ['SUBMITTED', 'PENDING_APPROVAL'];
const MIN_AGE_YEARS = 18;

// Professional.kycStatus is what dispatch and the dashboard read; keep it in
// step with the onboarding status on every transition.
const KYC_STATUS_FOR = {
  DRAFT: 'PENDING',
  CHANGES_REQUESTED: 'PENDING',
  SUBMITTED: 'IN_REVIEW',
  PENDING_APPROVAL: 'IN_REVIEW',
  APPROVED: 'VERIFIED',
  REJECTED: 'REJECTED',
};

const DOCUMENT_LABEL = { AADHAAR: 'Aadhaar card', PAN: 'PAN card', BANK_ACCOUNT: 'bank account' };

const NOT_EDITABLE_MESSAGE = {
  SUBMITTED: 'Your application is under review and cannot be edited',
  PENDING_APPROVAL: 'Your application is under review and cannot be edited',
  APPROVED: 'Your application is already approved',
  REJECTED: 'Your application was rejected and cannot be edited',
};

const applicationInclude = {
  user: { select: { id: true, name: true, phone: true, email: true, cityId: true, isActive: true, city: { select: { id: true, name: true } } } },
  homeZone: { select: { id: true, name: true, cityId: true } },
  documents: { include: { verifiedBy: { select: { id: true, name: true } } } },
};

// ---------------------------------------------------------------------------
// Views
// ---------------------------------------------------------------------------

const toDateString = (date) => (date ? date.toISOString().slice(0, 10) : null);

// The five-step journey the app shows as a progress tracker. Having a token
// at all means steps 1 and 2 are done.
const computeFlow = (status) => {
  const detailsStatus = { NOT_STARTED: 'CURRENT', DRAFT: 'CURRENT', CHANGES_REQUESTED: 'ACTION_REQUIRED' }[status] ?? 'COMPLETE';
  const verificationStatus =
    { SUBMITTED: 'CURRENT', PENDING_APPROVAL: 'CURRENT', APPROVED: 'COMPLETE', REJECTED: 'REJECTED' }[status] ?? 'PENDING';

  const steps = [
    { step: 1, key: 'PHONE_NUMBER', title: 'Phone number', status: 'COMPLETE' },
    { step: 2, key: 'VERIFY_OTP', title: 'Verify OTP', status: 'COMPLETE' },
    { step: 3, key: 'ENTER_DETAILS', title: 'Enter details', status: detailsStatus },
    { step: 4, key: 'VERIFY_VENDOR', title: 'Verification', status: verificationStatus },
    { step: 5, key: 'VERIFIED', title: 'Verified', status: status === 'APPROVED' ? 'COMPLETE' : 'PENDING' },
  ];
  const currentStep = status === 'APPROVED' ? 5 : detailsStatus === 'COMPLETE' ? 4 : 3;
  return { currentStep, isVerified: status === 'APPROVED', steps };
};

const computeSteps = (application) => {
  const { user } = application;
  const document = (type) => application.documents.find((doc) => doc.type === type);
  // A rejected document counts as missing: it has to be uploaded again.
  const documentDone = (type) => Boolean(document(type)) && document(type).status !== 'REJECTED';

  return [
    {
      key: 'personalDetails',
      complete: Boolean(
        user.name && user.phone && user.cityId && application.dateOfBirth && application.gender &&
          application.addressLine1 && application.pincode && application.state,
      ),
    },
    { key: 'profilePhoto', complete: Boolean(application.profilePhotoKey) },
    { key: 'services', complete: application.categories.length > 0 && application.experienceYears !== null && application.experienceYears !== undefined },
    { key: 'aadhaar', complete: documentDone('AADHAAR') },
    { key: 'pan', complete: documentDone('PAN') },
    { key: 'bankDetails', complete: documentDone('BANK_ACCOUNT') },
  ];
};

const documentView = (application, type, { filesBasePath, revealNumber }) => {
  const doc = application.documents.find((item) => item.type === type);
  if (!doc) return { type, status: 'NOT_UPLOADED' };

  const filePath = (side) => `${filesBasePath}/${type.toLowerCase()}/files/${side}`;
  return {
    type,
    status: doc.status,
    maskedNumber: kycCrypto.maskNumber(type, doc.numberLast4),
    ...(revealNumber && { number: kycCrypto.decrypt(doc.numberEncrypted) }),
    nameOnDocument: doc.nameOnDocument,
    rejectionReason: doc.rejectionReason,
    verifiedAt: doc.verifiedAt,
    ...(revealNumber && { verificationSource: doc.verificationSource, verificationRef: doc.verificationRef, verifiedBy: doc.verifiedBy }),
    // Authenticated API paths (relative to the API base), not public URLs.
    files: { front: filePath('front'), back: doc.backFileKey ? filePath('back') : null },
    uploadedAt: doc.updatedAt,
  };
};

// The payout account is stored as a BANK_ACCOUNT document but presented as its own section.
const bankDetailsView = (application, { filesBasePath, revealNumber }) => {
  const doc = application.documents.find((item) => item.type === 'BANK_ACCOUNT');
  if (!doc) return { status: 'NOT_UPLOADED' };
  return {
    status: doc.status,
    accountHolderName: doc.nameOnDocument,
    maskedAccountNumber: kycCrypto.maskNumber('BANK_ACCOUNT', doc.numberLast4),
    ...(revealNumber && { accountNumber: kycCrypto.decrypt(doc.numberEncrypted) }),
    ifsc: doc.ifsc,
    bankName: doc.bankName,
    branchName: doc.branchName,
    accountType: doc.accountType,
    upiId: doc.upiId,
    rejectionReason: doc.rejectionReason,
    verifiedAt: doc.verifiedAt,
    ...(revealNumber && { verificationSource: doc.verificationSource, verificationRef: doc.verificationRef, verifiedBy: doc.verifiedBy }),
    proofFile: `${filesBasePath}/bank_account/files/front`,
    uploadedAt: doc.updatedAt,
  };
};

const buildView = async (application, { admin = false } = {}) => {
  const steps = computeSteps(application);
  const isEditable = application.onboardingStatus === 'NOT_STARTED' || EDITABLE_STATUSES.includes(application.onboardingStatus);
  const allComplete = steps.every((step) => step.complete);
  const categories = application.categories.length
    ? await prisma.serviceCategory.findMany({ where: { id: { in: application.categories } }, select: { id: true, name: true, tier: true } })
    : [];

  const basePath = admin ? `/vendor-onboarding/applications/${application.id}` : '/vendor-onboarding';
  const filesBasePath = `${basePath}/documents`;

  return {
    id: application.id ?? null,
    status: application.onboardingStatus,
    flow: computeFlow(application.onboardingStatus),
    isEditable,
    // The parts of step 3 ("Enter details") and whether each is filled in.
    detailSteps: steps,
    // What the app should show next within step 3: the first unfinished part, then "submit".
    nextStep: isEditable ? (steps.find((step) => !step.complete)?.key ?? 'submit') : null,
    canSubmit: isEditable && allComplete,
    reviewNote: application.reviewNote ?? null,
    submittedAt: application.submittedAt ?? null,
    reviewedAt: application.reviewedAt ?? null,
    // Authenticated API path for the photo, or null if none is uploaded yet.
    profilePhoto: application.profilePhotoKey ? `${basePath}/profile-photo` : null,
    personalDetails: {
      name: application.user.name,
      phone: application.user.phone,
      email: application.user.email,
      dateOfBirth: toDateString(application.dateOfBirth),
      gender: application.gender ?? null,
      alternatePhone: application.alternatePhone ?? null,
      city: application.user.city ?? null,
      addressLine1: application.addressLine1 ?? null,
      addressLine2: application.addressLine2 ?? null,
      landmark: application.landmark ?? null,
      pincode: application.pincode ?? null,
      state: application.state ?? null,
      emergencyContactName: application.emergencyContactName ?? null,
      emergencyContactPhone: application.emergencyContactPhone ?? null,
    },
    services: {
      categories,
      experienceYears: application.experienceYears ?? null,
      homeZone: application.homeZone ? { id: application.homeZone.id, name: application.homeZone.name } : null,
    },
    documents: IDENTITY_DOCUMENTS.map((type) => documentView(application, type, { filesBasePath, revealNumber: admin })),
    bankDetails: bankDetailsView(application, { filesBasePath, revealNumber: admin }),
  };
};

// ---------------------------------------------------------------------------
// Loading
// ---------------------------------------------------------------------------

const loadByUserId = (userId) => prisma.professional.findUnique({ where: { userId }, include: applicationInclude });

const loadById = async (id) => {
  const application = await prisma.professional.findUnique({ where: { id }, include: applicationInclude });
  if (!application) throw ApiError.notFound('Application not found');
  return application;
};

const assertEditable = (application) => {
  if (!EDITABLE_STATUSES.includes(application.onboardingStatus)) {
    throw ApiError.conflict(NOT_EDITABLE_MESSAGE[application.onboardingStatus]);
  }
};

// Every save step goes through here: the first one to arrive creates the
// draft application (and marks the account as a professional).
const getEditableDraft = async (userId) => {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw ApiError.notFound('User not found');
  if (isAdmin(user.role)) throw ApiError.forbidden('Admin accounts cannot onboard as a vendor');

  await prisma.professional.upsert({ where: { userId }, update: {}, create: { userId, categories: [] } });
  if (user.role !== 'PROFESSIONAL') {
    await prisma.user.update({ where: { id: userId }, data: { role: 'PROFESSIONAL' } });
  }

  const application = await loadByUserId(userId);
  assertEditable(application);
  return application;
};

// ---------------------------------------------------------------------------
// Vendor: steps 1 & 2 — phone number and OTP
// ---------------------------------------------------------------------------

const OTP_TTL_SECONDS = 300;

const assertCanBeVendor = (user) => {
  if (!user) return;
  if (isAdmin(user.role)) throw ApiError.forbidden('This phone number belongs to an admin account and cannot be used to register as a vendor');
  if (!user.isActive) throw ApiError.forbidden('This account has been deactivated');
};

const requestOtp = async (phone) => {
  assertCanBeVendor(await prisma.user.findUnique({ where: { phone } }));
  const otp = otpStore.setOtp(phone);
  await notifications.sendOtp(phone, otp);
  return { sent: true, expiresInSeconds: OTP_TTL_SECONDS };
};

// Logs the vendor in (creating the account on first use) and makes sure a
// draft application exists, so the app can go straight to "Enter details" —
// or to wherever a returning vendor left off.
const verifyOtp = async (phone, otp) => {
  const existing = await prisma.user.findUnique({ where: { phone } });
  assertCanBeVendor(existing);
  if (!otpStore.verifyOtp(phone, otp)) throw ApiError.badRequest('Invalid or expired OTP');

  let user = existing ?? (await prisma.user.create({ data: { phone, name: 'New Vendor', role: 'PROFESSIONAL' } }));
  if (user.role !== 'PROFESSIONAL') {
    user = await prisma.user.update({ where: { id: user.id }, data: { role: 'PROFESSIONAL' } });
  }
  await prisma.professional.upsert({ where: { userId: user.id }, update: {}, create: { userId: user.id, categories: [] } });

  return {
    isNewUser: !existing,
    user: { id: user.id, name: user.name, phone: user.phone, email: user.email, role: user.role, isOnboarded: user.isOnboarded },
    ...issueTokenPair(user),
    application: await buildView(await loadByUserId(user.id)),
  };
};

// ---------------------------------------------------------------------------
// Vendor: step 3 — enter details
// ---------------------------------------------------------------------------

const getMyApplication = async (userId) => {
  const application = await loadByUserId(userId);
  if (application) return buildView(application);

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, name: true, phone: true, email: true, cityId: true, city: { select: { id: true, name: true } } },
  });
  if (!user) throw ApiError.notFound('User not found');
  return buildView({ onboardingStatus: 'NOT_STARTED', categories: [], documents: [], user });
};

// Small payload for polling while the application is being verified (step 4).
const getMyStatus = async (userId) => {
  const application = await prisma.professional.findUnique({
    where: { userId },
    select: { id: true, onboardingStatus: true, reviewNote: true, submittedAt: true, reviewedAt: true },
  });
  const status = application?.onboardingStatus ?? 'NOT_STARTED';
  return {
    id: application?.id ?? null,
    status,
    flow: computeFlow(status),
    reviewNote: application?.reviewNote ?? null,
    submittedAt: application?.submittedAt ?? null,
    reviewedAt: application?.reviewedAt ?? null,
  };
};

const ageOn = (dateOfBirth, today) => {
  const age = today.getUTCFullYear() - dateOfBirth.getUTCFullYear();
  const hadBirthday =
    today.getUTCMonth() > dateOfBirth.getUTCMonth() ||
    (today.getUTCMonth() === dateOfBirth.getUTCMonth() && today.getUTCDate() >= dateOfBirth.getUTCDate());
  return hadBirthday ? age : age - 1;
};

const savePersonalDetails = async (userId, body) => {
  const application = await getEditableDraft(userId);
  const { user } = application;

  const dateOfBirth = new Date(`${body.dateOfBirth}T00:00:00.000Z`);
  if (ageOn(dateOfBirth, new Date()) < MIN_AGE_YEARS) {
    throw ApiError.badRequest(`You must be at least ${MIN_AGE_YEARS} years old to register`);
  }

  const city = await prisma.city.findUnique({ where: { id: body.cityId } });
  if (!city || !city.isActive) throw ApiError.badRequest('Unknown or inactive city');

  // The login phone is the vendor's verified identity; it can be set here
  // only if the account doesn't have one (email sign-ups).
  let phone;
  if (user.phone) {
    if (body.phone && body.phone !== user.phone) {
      throw ApiError.badRequest('Your phone number comes from your login and cannot be changed here');
    }
  } else {
    if (!body.phone) throw ApiError.badRequest('Phone number is required');
    const taken = await prisma.user.findUnique({ where: { phone: body.phone } });
    if (taken) throw ApiError.conflict('This phone number is already linked to another account');
    phone = body.phone;
  }

  if (body.email && body.email !== user.email) {
    const taken = await prisma.user.findUnique({ where: { email: body.email } });
    if (taken) throw ApiError.conflict('This email is already linked to another account');
  }

  // A home zone picked for the previous city no longer applies.
  const zoneStillValid = !application.homeZone || application.homeZone.cityId === body.cityId;

  await prisma.$transaction([
    prisma.user.update({
      where: { id: userId },
      data: { name: body.name, cityId: body.cityId, ...(phone && { phone }), ...(body.email && { email: body.email }) },
    }),
    prisma.professional.update({
      where: { id: application.id },
      data: {
        dateOfBirth,
        gender: body.gender,
        alternatePhone: body.alternatePhone,
        addressLine1: body.addressLine1,
        addressLine2: body.addressLine2,
        landmark: body.landmark,
        pincode: body.pincode,
        state: body.state,
        emergencyContactName: body.emergencyContactName,
        emergencyContactPhone: body.emergencyContactPhone,
        ...(!zoneStillValid && { homeZoneId: null }),
      },
    }),
  ]);

  return buildView(await loadByUserId(userId));
};

const assertZoneInCity = async (homeZoneId, cityId) => {
  const zone = await prisma.zone.findUnique({ where: { id: homeZoneId } });
  if (!zone || !zone.isActive) throw ApiError.badRequest('Unknown or inactive home zone');
  if (cityId && zone.cityId !== cityId) throw ApiError.badRequest('Home zone must be in your city');
};

const saveServices = async (userId, { categories, experienceYears, homeZoneId }) => {
  const application = await getEditableDraft(userId);

  const activeCount = await prisma.serviceCategory.count({ where: { id: { in: categories }, isActive: true } });
  if (activeCount !== categories.length) throw ApiError.badRequest('One or more selected services are unknown or inactive');

  if (homeZoneId) await assertZoneInCity(homeZoneId, application.user.cityId);

  await prisma.professional.update({ where: { id: application.id }, data: { categories, experienceYears, homeZoneId } });
  return buildView(await loadByUserId(userId));
};

const normalizeDocumentNumber = (type, rawNumber) => {
  if (type === 'AADHAAR') {
    if (!isValidAadhaar(rawNumber)) throw ApiError.badRequest('Enter a valid 12-digit Aadhaar number');
    return normalizeAadhaar(rawNumber);
  }
  if (!isValidPan(rawNumber)) throw ApiError.badRequest('Enter a valid PAN, e.g. ABCPE1234F');
  return normalizePan(rawNumber);
};

const saveDocument = async (userId, type, { number: rawNumber, nameOnDocument }, files = {}) => {
  const application = await getEditableDraft(userId);
  const existing = application.documents.find((doc) => doc.type === type);
  if (existing?.status === 'VERIFIED') {
    throw ApiError.conflict(`Your ${DOCUMENT_LABEL[type]} is already verified and cannot be replaced`);
  }

  const number = normalizeDocumentNumber(type, rawNumber);
  const front = files.front?.[0];
  const back = files.back?.[0];

  if (!front && !existing) throw ApiError.badRequest(`Upload a photo of the front of your ${DOCUMENT_LABEL[type]} as "front"`);
  if (type === 'AADHAAR' && !back && !existing?.backFileKey) {
    throw ApiError.badRequest('Upload a photo of the back of your Aadhaar card as "back"');
  }
  if (type === 'PAN' && back) throw ApiError.badRequest('A PAN card only needs the "front" image');

  return storeDocument(application, type, { number, nameOnDocument, front, back });
};

// Encrypts the number, uploads any new files and saves the row, putting the
// document (back) in the verification queue. `hashInput` is what uniqueness
// across accounts is judged on; `details` are extra columns to set.
const storeDocument = async (application, type, { number, hashInput = number, nameOnDocument, details = {}, front, back }) => {
  const existing = application.documents.find((doc) => doc.type === type);
  const numberHash = kycCrypto.hashNumber(type, hashInput);
  const duplicateMessage = `This ${DOCUMENT_LABEL[type]} is already registered with another account`;
  const usedElsewhere = await prisma.professionalDocument.findFirst({ where: { type, numberHash, professionalId: { not: application.id } } });
  if (usedElsewhere) throw ApiError.conflict(duplicateMessage);

  const upload = async (file, side) => {
    const key = `kyc/${application.id}/${type.toLowerCase()}-${side}-${crypto.randomUUID()}.${extensionFor(file.mimetype)}`;
    await storage.put(key, file.buffer, file.mimetype);
    return key;
  };
  const frontKey = front ? await upload(front, 'front') : null;
  const backKey = back ? await upload(back, 'back') : null;

  const data = {
    numberEncrypted: kycCrypto.encrypt(number),
    numberHash,
    numberLast4: number.slice(-4),
    nameOnDocument,
    ...details,
    ...(frontKey && { frontFileKey: frontKey, frontFileMime: front.mimetype }),
    ...(backKey && { backFileKey: backKey, backFileMime: back.mimetype }),
    // Any change puts the document back in the verification queue.
    status: 'PENDING',
    rejectionReason: null,
    verificationSource: null,
    verificationRef: null,
    verifiedById: null,
    verifiedAt: null,
  };

  try {
    // Not an upsert: an update may legitimately carry no files, which a
    // create payload could not.
    if (existing) {
      await prisma.professionalDocument.update({ where: { id: existing.id }, data });
    } else {
      await prisma.professionalDocument.create({ data: { professionalId: application.id, type, ...data } });
    }
  } catch (err) {
    await Promise.all([frontKey, backKey].filter(Boolean).map(storage.remove));
    // Lost a race with another account registering the same number.
    if (err.code === 'P2002') throw ApiError.conflict(duplicateMessage);
    throw err;
  }

  // The replaced images are no longer referenced.
  if (frontKey && existing) await storage.remove(existing.frontFileKey);
  if (backKey && existing?.backFileKey) await storage.remove(existing.backFileKey);

  return buildView(await loadByUserId(application.userId));
};

const saveBankDetails = async (userId, body, files = {}) => {
  const application = await getEditableDraft(userId);
  const existing = application.documents.find((doc) => doc.type === 'BANK_ACCOUNT');
  if (existing?.status === 'VERIFIED') throw ApiError.conflict('Your bank account is already verified and cannot be replaced');

  const proof = files.proof?.[0];
  if (!proof && !existing) throw ApiError.badRequest('Upload a cancelled cheque or the first page of your passbook as "proof"');

  return storeDocument(application, 'BANK_ACCOUNT', {
    number: body.accountNumber,
    // Account numbers are only unique within a bank; the first four IFSC characters identify the bank.
    hashInput: `${body.ifsc.slice(0, 4)}:${body.accountNumber}`,
    nameOnDocument: body.accountHolderName,
    details: { ifsc: body.ifsc, bankName: body.bankName, branchName: body.branchName, accountType: body.accountType, upiId: body.upiId },
    front: proof,
  });
};

const saveProfilePhoto = async (userId, files = {}) => {
  const application = await getEditableDraft(userId);
  const photo = files.photo?.[0];
  if (!photo) throw ApiError.badRequest('Upload a clear photo of your face as "photo"');

  const key = `profiles/${application.id}/photo-${crypto.randomUUID()}.${extensionFor(photo.mimetype)}`;
  await storage.put(key, photo.buffer, photo.mimetype);
  await prisma.professional.update({ where: { id: application.id }, data: { profilePhotoKey: key, profilePhotoMime: photo.mimetype } });
  if (application.profilePhotoKey) await storage.remove(application.profilePhotoKey);

  return buildView(await loadByUserId(userId));
};

// ---------------------------------------------------------------------------
// Step 4 — verify vendor, part 1: documents and bank account
// ---------------------------------------------------------------------------

const notifyVendor = (userId, title, body, status) => {
  notifications.sendPushNotification(userId, { title, body, data: { type: 'VENDOR_ONBOARDING', status } }).catch((err) => {
    logger.warn({ err: err.message, userId }, 'Failed to send onboarding notification');
  });
};

// Shared by the admin endpoints and automated providers. `actorId` is null
// when a provider made the call.
const applyDocumentDecision = async (applicationId, type, decision, { actorId = null, source = 'MANUAL', reference = null, reason = null } = {}) => {
  const result = await prisma.$transaction(async (tx) => {
    const application = await tx.professional.findUnique({ where: { id: applicationId }, include: { documents: true } });
    if (!application) throw ApiError.notFound('Application not found');
    if (application.onboardingStatus !== 'SUBMITTED') {
      throw ApiError.conflict(`Documents can only be verified while an application is SUBMITTED (this one is ${application.onboardingStatus})`);
    }
    const doc = application.documents.find((item) => item.type === type);
    if (!doc) throw ApiError.notFound(`No ${DOCUMENT_LABEL[type]} has been uploaded`);
    if (doc.status === 'REJECTED') throw ApiError.conflict(`This ${DOCUMENT_LABEL[type]} was already rejected`);
    if (decision === 'VERIFIED' && doc.status === 'VERIFIED') throw ApiError.conflict(`This ${DOCUMENT_LABEL[type]} is already verified`);

    await tx.professionalDocument.update({
      where: { id: doc.id },
      data: {
        status: decision,
        rejectionReason: decision === 'REJECTED' ? reason : null,
        verificationSource: source,
        verificationRef: reference,
        verifiedById: actorId,
        verifiedAt: decision === 'VERIFIED' ? new Date() : null,
      },
    });

    let toStatus = 'SUBMITTED';
    if (decision === 'REJECTED') {
      toStatus = 'CHANGES_REQUESTED';
    } else {
      const allVerified = REQUIRED_DOCUMENTS.every((required) =>
        required === type || application.documents.find((item) => item.type === required)?.status === 'VERIFIED',
      );
      if (allVerified) toStatus = 'PENDING_APPROVAL';
    }

    if (toStatus !== 'SUBMITTED') {
      await tx.professional.update({ where: { id: applicationId }, data: { onboardingStatus: toStatus, kycStatus: KYC_STATUS_FOR[toStatus] } });
    }
    await tx.vendorOnboardingEvent.create({
      data: {
        professionalId: applicationId,
        actorId,
        action: decision === 'VERIFIED' ? 'DOCUMENT_VERIFIED' : 'DOCUMENT_REJECTED',
        documentType: type,
        fromStatus: 'SUBMITTED',
        toStatus,
        note: reason,
      },
    });
    return { userId: application.userId, toStatus };
  });

  if (decision === 'REJECTED') {
    notifyVendor(result.userId, 'Document needs attention', `Your ${DOCUMENT_LABEL[type]} could not be verified: ${reason}`, result.toStatus);
  }
  return result;
};

// Runs the configured KYC provider over every document still waiting. With
// the 'manual' provider this does nothing and the documents stay queued for
// an admin; a provider failure is treated the same way.
const runAutomatedVerification = async (applicationId) => {
  const application = await loadById(applicationId);
  for (const doc of application.documents.filter((item) => item.status === 'PENDING')) {
    let result;
    try {
      result = await kycVerification.verifyDocument({
        type: doc.type,
        number: kycCrypto.decrypt(doc.numberEncrypted),
        nameOnDocument: doc.nameOnDocument,
        dateOfBirth: toDateString(application.dateOfBirth),
        ifsc: doc.ifsc, // BANK_ACCOUNT only
      });
    } catch (err) {
      logger.error({ err: err.message, applicationId, type: doc.type }, 'KYC provider failed; leaving document for manual review');
      continue;
    }
    if (result.status === 'PENDING') continue;

    const { toStatus } = await applyDocumentDecision(applicationId, doc.type, result.status, {
      source: result.source,
      reference: result.reference,
      reason: result.reason ?? 'Automated verification failed',
    });
    // A rejection sends the application back to the vendor; nothing more to check.
    if (toStatus === 'CHANGES_REQUESTED') break;
  }
};

const submit = async (userId) => {
  const application = await loadByUserId(userId);
  if (!application) throw ApiError.badRequest('Start your application before submitting it');
  assertEditable(application);

  const missing = computeSteps(application).filter((step) => !step.complete).map((step) => step.key);
  if (missing.length) throw ApiError.badRequest('Complete every step before submitting', { missing });
  if (application.homeZone && application.homeZone.cityId !== application.user.cityId) {
    throw ApiError.badRequest('Home zone must be in your city', { missing: ['services'] });
  }

  const fromStatus = application.onboardingStatus;
  // Documents verified in an earlier round stay verified, so a resubmission
  // that didn't touch them goes straight back to the super admin.
  const allVerified = REQUIRED_DOCUMENTS.every((type) => application.documents.find((doc) => doc.type === type)?.status === 'VERIFIED');
  const toStatus = allVerified ? 'PENDING_APPROVAL' : 'SUBMITTED';

  await prisma.$transaction(async (tx) => {
    // Conditional update so a double-tap can't submit twice.
    const { count } = await tx.professional.updateMany({
      where: { id: application.id, onboardingStatus: fromStatus },
      data: { onboardingStatus: toStatus, kycStatus: KYC_STATUS_FOR[toStatus], submittedAt: new Date(), reviewNote: null },
    });
    if (count === 0) throw ApiError.conflict('Your application has already been submitted');
    await tx.vendorOnboardingEvent.create({
      data: { professionalId: application.id, actorId: userId, action: application.submittedAt ? 'RESUBMITTED' : 'SUBMITTED', fromStatus, toStatus },
    });
  });

  if (toStatus === 'SUBMITTED') await runAutomatedVerification(application.id);
  return buildView(await loadByUserId(userId));
};

// ---------------------------------------------------------------------------
// Document files
// ---------------------------------------------------------------------------

const openDocumentFile = async (application, type, side) => {
  const doc = application.documents.find((item) => item.type === type);
  const key = side === 'front' ? doc?.frontFileKey : doc?.backFileKey;
  if (!key) throw ApiError.notFound('File not found');
  return {
    stream: await storage.getStream(key),
    mimeType: side === 'front' ? doc.frontFileMime : doc.backFileMime,
    filename: `${type.toLowerCase()}-${side}.${key.split('.').pop()}`,
  };
};

const getMyDocumentFile = async (userId, type, side) => {
  const application = await loadByUserId(userId);
  if (!application) throw ApiError.notFound('File not found');
  return openDocumentFile(application, type, side);
};

const getApplicationDocumentFile = async (id, type, side) => openDocumentFile(await loadById(id), type, side);

const openProfilePhoto = async (application) => {
  if (!application?.profilePhotoKey) throw ApiError.notFound('No profile photo uploaded');
  return {
    stream: await storage.getStream(application.profilePhotoKey),
    mimeType: application.profilePhotoMime,
    filename: `profile-photo.${application.profilePhotoKey.split('.').pop()}`,
  };
};

const getMyProfilePhoto = async (userId) => openProfilePhoto(await loadByUserId(userId));

const getApplicationProfilePhoto = async (id) => openProfilePhoto(await loadById(id));

// ---------------------------------------------------------------------------
// Admin: review queue
// ---------------------------------------------------------------------------

const listApplications = async ({ page, limit, status, cityId, zoneId, categoryId, search, submittedFrom, submittedTo, sortBy, sortOrder }) => {
  const userFilter = { ...(cityId && { cityId }), ...(search && personSearch(search)) };
  const submittedAt = dateRange(submittedFrom, submittedTo);
  const where = {
    ...(status && { onboardingStatus: { in: status } }),
    ...(zoneId && { homeZoneId: zoneId }),
    ...(categoryId && { categories: { has: categoryId } }),
    ...(submittedAt && { submittedAt }),
    ...(Object.keys(userFilter).length && { user: userFilter }),
  };

  // Default: the review queue — oldest submission first, never-submitted drafts last.
  const order = sortOrder ?? 'asc';
  const orderBy = !sortBy
    ? [{ submittedAt: { sort: 'asc', nulls: 'last' } }, { createdAt: 'asc' }]
    : sortBy === 'name'
      ? [{ user: { name: order } }]
      : sortBy === 'createdAt'
        ? [{ createdAt: order }]
        : [{ [sortBy]: { sort: order, nulls: 'last' } }, { createdAt: 'asc' }];

  const [rows, total] = await Promise.all([
    prisma.professional.findMany({
      where,
      ...toSkipTake({ page, limit }),
      orderBy,
      include: {
        user: { select: { id: true, name: true, phone: true, email: true, isActive: true, city: { select: { id: true, name: true } } } },
        homeZone: { select: { id: true, name: true } },
        documents: { select: { type: true, status: true } },
      },
    }),
    prisma.professional.count({ where }),
  ]);

  const items = rows.map((row) => ({
    id: row.id,
    status: row.onboardingStatus,
    userId: row.user.id,
    name: row.user.name,
    phone: row.user.phone,
    email: row.user.email,
    isActive: row.user.isActive,
    city: row.user.city,
    homeZone: row.homeZone,
    serviceCount: row.categories.length,
    experienceYears: row.experienceYears,
    profilePhoto: row.profilePhotoKey ? `/vendor-onboarding/applications/${row.id}/profile-photo` : null,
    documents: REQUIRED_DOCUMENTS.map((type) => ({ type, status: row.documents.find((doc) => doc.type === type)?.status ?? 'NOT_UPLOADED' })),
    submittedAt: row.submittedAt,
    reviewedAt: row.reviewedAt,
    createdAt: row.createdAt,
  }));
  return paginatedResponse(items, total, { page, limit });
};

const getSummary = async () => {
  const groups = await prisma.professional.groupBy({ by: ['onboardingStatus'], _count: { _all: true } });
  const byStatus = Object.fromEntries(Object.keys(KYC_STATUS_FOR).map((status) => [status, 0]));
  groups.forEach((group) => {
    byStatus[group.onboardingStatus] = group._count._all;
  });
  return {
    byStatus,
    total: Object.values(byStatus).reduce((sum, count) => sum + count, 0),
    // The two review queues: documents to check (any admin) and final decisions (super admin).
    awaitingDocumentVerification: byStatus.SUBMITTED,
    awaitingFinalApproval: byStatus.PENDING_APPROVAL,
  };
};

const getApplication = async (id) => {
  const application = await loadById(id);
  const [view, events, reviewedBy] = await Promise.all([
    buildView(application, { admin: true }),
    prisma.vendorOnboardingEvent.findMany({
      where: { professionalId: id },
      orderBy: { createdAt: 'asc' },
      select: { id: true, action: true, documentType: true, fromStatus: true, toStatus: true, note: true, createdAt: true, actor: { select: { id: true, name: true, role: true } } },
    }),
    application.reviewedById ? prisma.user.findUnique({ where: { id: application.reviewedById }, select: { id: true, name: true } }) : null,
  ]);
  return { ...view, user: { id: application.user.id, isActive: application.user.isActive }, reviewedBy, events };
};

const verifyDocument = async (id, type, actor) => {
  await applyDocumentDecision(id, type, 'VERIFIED', { actorId: actor.id });
  return getApplication(id);
};

const rejectDocument = async (id, type, reason, actor) => {
  await applyDocumentDecision(id, type, 'REJECTED', { actorId: actor.id, reason });
  return getApplication(id);
};

// ---------------------------------------------------------------------------
// Step 4 — verify vendor, part 2: the super admin's final decision
// (approve() is what takes the vendor to step 5, "Verified")
// ---------------------------------------------------------------------------

// Moves an application between statuses atomically, so two reviewers acting
// at once can't both succeed.
const transition = async (id, { from, to, action, actorId, note = null, data = {}, extra }) => {
  const application = await loadById(id);
  if (!from.includes(application.onboardingStatus)) {
    throw ApiError.conflict(`This application is ${application.onboardingStatus}; expected ${from.join(' or ')}`);
  }

  await prisma.$transaction(async (tx) => {
    const { count } = await tx.professional.updateMany({
      where: { id, onboardingStatus: application.onboardingStatus },
      data: { onboardingStatus: to, kycStatus: KYC_STATUS_FOR[to], ...data },
    });
    if (count === 0) throw ApiError.conflict('This application was just updated by someone else — reload and try again');
    await tx.vendorOnboardingEvent.create({
      data: { professionalId: id, actorId, action, fromStatus: application.onboardingStatus, toStatus: to, note },
    });
    if (extra) await extra(tx, application);
  });
  return application;
};

const approve = async (id, actor) => {
  const application = await transition(id, {
    from: ['PENDING_APPROVAL'],
    to: 'APPROVED',
    action: 'APPROVED',
    actorId: actor.id,
    data: { reviewedAt: new Date(), reviewedById: actor.id, reviewNote: null },
    extra: (tx, app) => tx.user.update({ where: { id: app.userId }, data: { isOnboarded: true } }),
  });
  notifyVendor(application.userId, 'You are approved', 'Your profile is verified. You can now start receiving jobs.', 'APPROVED');
  return getApplication(id);
};

const reject = async (id, reason, actor) => {
  const application = await transition(id, {
    from: REVIEWABLE_STATUSES,
    to: 'REJECTED',
    action: 'REJECTED',
    actorId: actor.id,
    note: reason,
    data: { reviewedAt: new Date(), reviewedById: actor.id, reviewNote: reason },
  });
  notifyVendor(application.userId, 'Application not approved', `Your application was not approved: ${reason}`, 'REJECTED');
  return getApplication(id);
};

// Gives a rejected vendor another chance: back to CHANGES_REQUESTED with
// everything they submitted intact, so they can fix it and resubmit.
const reopen = async (id, reason, actor) => {
  const application = await transition(id, {
    from: ['REJECTED'],
    to: 'CHANGES_REQUESTED',
    action: 'REOPENED',
    actorId: actor.id,
    note: reason,
    data: { reviewedAt: null, reviewedById: null, reviewNote: reason },
  });
  notifyVendor(application.userId, 'Application reopened', `You can update and resubmit your application: ${reason}`, 'CHANGES_REQUESTED');
  return getApplication(id);
};

const requestChanges = async (id, { reason, documents }, actor) => {
  const application = await transition(id, {
    from: REVIEWABLE_STATUSES,
    to: 'CHANGES_REQUESTED',
    action: 'CHANGES_REQUESTED',
    actorId: actor.id,
    note: reason,
    data: { reviewNote: reason },
    // Listed documents must be uploaded again, even if they were verified.
    extra: (tx) =>
      tx.professionalDocument.updateMany({
        where: { professionalId: id, type: { in: documents } },
        data: { status: 'REJECTED', rejectionReason: reason, verifiedById: null, verifiedAt: null },
      }),
  });
  notifyVendor(application.userId, 'Changes needed', `Please update your application: ${reason}`, 'CHANGES_REQUESTED');
  return getApplication(id);
};

module.exports = {
  requestOtp,
  verifyOtp,
  getMyApplication,
  getMyStatus,
  savePersonalDetails,
  saveServices,
  saveDocument,
  saveBankDetails,
  saveProfilePhoto,
  submit,
  getMyDocumentFile,
  getMyProfilePhoto,
  getApplicationProfilePhoto,
  listApplications,
  getSummary,
  getApplication,
  getApplicationDocumentFile,
  verifyDocument,
  rejectDocument,
  approve,
  reject,
  reopen,
  requestChanges,
};
