const multer = require('multer');
const ApiError = require('../utils/ApiError');
const { relaxed } = require('../utils/onboardingValidation');

const MAX_FILE_BYTES = 5 * 1024 * 1024;

// Allowed upload types, each with the leading bytes a genuine file must have.
// The browser-supplied MIME type is only a claim, so the content is checked too.
const FILE_TYPES = {
  'image/jpeg': { ext: 'jpg', matches: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  'image/png': { ext: 'png', matches: (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  'image/webp': { ext: 'webp', matches: (b) => b.subarray(0, 4).toString() === 'RIFF' && b.subarray(8, 12).toString() === 'WEBP' },
  'application/pdf': { ext: 'pdf', matches: (b) => b.subarray(0, 5).toString() === '%PDF-' },
};

const UNKNOWN_TYPE = 'application/octet-stream';

const extensionFor = (mimeType) => FILE_TYPES[mimeType]?.ext ?? 'bin';

// Usage: uploadFiles(['front', 'back']) — accepts at most one file per named
// field, kept in memory as req.files.<field>[0]. Run before validate(), since
// multipart text fields only land on req.body once multer has parsed them.
// Pass { imagesOnly: true } where a PDF makes no sense (profile photos).
const uploadFiles = (fieldNames, { imagesOnly = false } = {}) => {
  const parser = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: MAX_FILE_BYTES, files: fieldNames.length },
  }).fields(fieldNames.map((name) => ({ name, maxCount: 1 })));

  return (req, res, next) => {
    parser(req, res, (err) => {
      if (err instanceof multer.MulterError) {
        const message = err.code === 'LIMIT_FILE_SIZE' ? 'Each file must be 5 MB or smaller' : `Upload rejected: ${err.message}`;
        return next(ApiError.badRequest(message));
      }
      if (err) return next(err);

      for (const [field, [file]] of Object.entries(req.files ?? {})) {
        const type = FILE_TYPES[file.mimetype];
        const genuine = type && type.matches(file.buffer);
        const allowed = genuine && !(imagesOnly && file.mimetype === 'application/pdf');
        if (relaxed) {
          // Onboarding validation off: any file is accepted. One that isn't a
          // real image or PDF is stored as an opaque download, never as
          // something a browser would render.
          if (!genuine) file.mimetype = UNKNOWN_TYPE;
          continue;
        }
        if (!allowed) {
          return next(ApiError.badRequest(`"${field}" must be a JPEG, PNG${imagesOnly ? ' or WebP image' : ', WebP or PDF file'}`));
        }
      }
      req.body ??= {};
      next();
    });
  };
};

// Usage: uploadImages('images', 5) — up to `max` JPEG / PNG / WebP files in
// one field, kept in memory as req.files (an array). Always checked: these
// are shown to other people, so only genuine images are accepted.
const uploadImages = (fieldName, max) => {
  const parser = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_FILE_BYTES, files: max } }).array(fieldName, max);
  return (req, res, next) => {
    parser(req, res, (err) => {
      if (err instanceof multer.MulterError) {
        const message =
          err.code === 'LIMIT_FILE_SIZE' ? 'Each image must be 5 MB or smaller' : ['LIMIT_FILE_COUNT', 'LIMIT_UNEXPECTED_FILE'].includes(err.code) ? `Send up to ${max} images in "${fieldName}"` : `Upload rejected: ${err.message}`;
        return next(ApiError.badRequest(message));
      }
      if (err) return next(err);
      for (const file of req.files ?? []) {
        const type = FILE_TYPES[file.mimetype];
        if (!type || file.mimetype === 'application/pdf' || !type.matches(file.buffer)) return next(ApiError.badRequest('Each file must be a JPEG, PNG or WebP image'));
      }
      req.body ??= {};
      next();
    });
  };
};

module.exports = { uploadFiles, uploadImages, extensionFor };
