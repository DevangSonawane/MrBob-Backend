const catchAsync = require('../../utils/catchAsync');
const service = require('./vendorOnboarding.service');

const ok = (res, data) => res.status(200).json({ success: true, data });

// Documents are private: never cacheable, always served inline to the
// authenticated caller only.
const sendFile = (res, next, file) => {
  res.set({
    'Content-Type': file.mimeType,
    'Content-Disposition': `inline; filename="${file.filename}"`,
    'Cache-Control': 'private, no-store',
  });
  file.stream.on('error', next);
  file.stream.pipe(res);
};

// --- Vendor ---

const requestOtp = catchAsync(async (req, res) => ok(res, await service.requestOtp(req.body.phone)));

const verifyOtp = catchAsync(async (req, res) => ok(res, await service.verifyOtp(req.body.phone, req.body.otp)));

const getMyStatus = catchAsync(async (req, res) => ok(res, await service.getMyStatus(req.user.id)));

const getMine = catchAsync(async (req, res) => ok(res, await service.getMyApplication(req.user.id)));

const savePersonalDetails = catchAsync(async (req, res) => ok(res, await service.savePersonalDetails(req.user.id, req.body)));

const saveServices = catchAsync(async (req, res) => ok(res, await service.saveServices(req.user.id, req.body)));

const saveDocument = catchAsync(async (req, res) =>
  ok(res, await service.saveDocument(req.user.id, req.params.type, req.body, req.files)),
);

const saveBankDetails = catchAsync(async (req, res) => ok(res, await service.saveBankDetails(req.user.id, req.body, req.files)));

const saveProfilePhoto = catchAsync(async (req, res) => ok(res, await service.saveProfilePhoto(req.user.id, req.files)));

const getMyProfilePhoto = catchAsync(async (req, res, next) => sendFile(res, next, await service.getMyProfilePhoto(req.user.id)));

const getMyDocumentFile = catchAsync(async (req, res, next) =>
  sendFile(res, next, await service.getMyDocumentFile(req.user.id, req.params.type, req.params.side)),
);

const submit = catchAsync(async (req, res) => ok(res, await service.submit(req.user.id)));

// --- Admin ---

const listApplications = catchAsync(async (req, res) => {
  const result = await service.listApplications(req.query);
  res.status(200).json({ success: true, ...result });
});

const getSummary = catchAsync(async (req, res) => ok(res, await service.getSummary()));

const getApplication = catchAsync(async (req, res) => ok(res, await service.getApplication(req.params.id)));

const getApplicationDocumentFile = catchAsync(async (req, res, next) =>
  sendFile(res, next, await service.getApplicationDocumentFile(req.params.id, req.params.type, req.params.side)),
);

const getApplicationProfilePhoto = catchAsync(async (req, res, next) =>
  sendFile(res, next, await service.getApplicationProfilePhoto(req.params.id)),
);

const reopen = catchAsync(async (req, res) => ok(res, await service.reopen(req.params.id, req.body.reason, req.user)));

const verifyDocument = catchAsync(async (req, res) => ok(res, await service.verifyDocument(req.params.id, req.params.type, req.user)));

const rejectDocument = catchAsync(async (req, res) =>
  ok(res, await service.rejectDocument(req.params.id, req.params.type, req.body.reason, req.user)),
);

const requestChanges = catchAsync(async (req, res) => ok(res, await service.requestChanges(req.params.id, req.body, req.user)));

const approve = catchAsync(async (req, res) => ok(res, await service.approve(req.params.id, req.user)));

const reject = catchAsync(async (req, res) => ok(res, await service.reject(req.params.id, req.body.reason, req.user)));

module.exports = {
  requestOtp,
  verifyOtp,
  getMyStatus,
  getMine,
  savePersonalDetails,
  saveServices,
  saveDocument,
  saveBankDetails,
  saveProfilePhoto,
  getMyProfilePhoto,
  getMyDocumentFile,
  submit,
  listApplications,
  getSummary,
  getApplication,
  getApplicationDocumentFile,
  getApplicationProfilePhoto,
  reopen,
  verifyDocument,
  rejectDocument,
  requestChanges,
  approve,
  reject,
};
