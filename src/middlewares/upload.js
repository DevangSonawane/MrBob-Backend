const multer = require('multer');
const ApiError = require('../utils/ApiError');

const MAX_FILE_BYTES = 5 * 1024 * 1024;

// Allowed upload types, each with the leading bytes a genuine file must have.
// The browser-supplied MIME type is only a claim, so the content is checked too.
const FILE_TYPES = {
  'image/jpeg': { ext: 'jpg', matches: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  'image/png': { ext: 'png', matches: (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  'image/webp': { ext: 'webp', matches: (b) => b.subarray(0, 4).toString() === 'RIFF' && b.subarray(8, 12).toString() === 'WEBP' },
  'application/pdf': { ext: 'pdf', matches: (b) => b.subarray(0, 5).toString() === '%PDF-' },
};

const extensionFor = (mimeType) => FILE_TYPES[mimeType].ext;

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
        const allowed = type && type.matches(file.buffer) && !(imagesOnly && file.mimetype === 'application/pdf');
        if (!allowed) {
          return next(ApiError.badRequest(`"${field}" must be a JPEG, PNG${imagesOnly ? ' or WebP image' : ', WebP or PDF file'}`));
        }
      }
      req.body ??= {};
      next();
    });
  };
};

module.exports = { uploadFiles, extensionFor };
