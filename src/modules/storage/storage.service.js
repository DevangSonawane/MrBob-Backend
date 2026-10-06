const fs = require('fs');
const path = require('path');
const { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } = require('@aws-sdk/client-s3');
const env = require('../../config/env');
const logger = require('../../config/logger');
const ApiError = require('../../utils/ApiError');

// Private file storage. Files are only ever read back through an
// authenticated API route — nothing here produces a public URL.
//
// With R2 credentials set, objects go to the R2 bucket. Without them, dev and
// test write to UPLOAD_DIR on local disk; production refuses instead, because
// a container's disk is neither durable nor shared between instances.

const r2Configured = Boolean(env.R2_ACCOUNT_ID && env.R2_ACCESS_KEY_ID && env.R2_SECRET_ACCESS_KEY && env.R2_BUCKET_NAME);

let s3;
const getS3 = () => {
  s3 ??= new S3Client({
    region: 'auto',
    endpoint: `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId: env.R2_ACCESS_KEY_ID, secretAccessKey: env.R2_SECRET_ACCESS_KEY },
  });
  return s3;
};

const localRoot = path.resolve(process.cwd(), env.UPLOAD_DIR);

// Keys are generated server-side, but resolve defensively so a bad key can
// never escape the upload folder.
const localPath = (key) => {
  const resolved = path.resolve(localRoot, key);
  if (!resolved.startsWith(localRoot + path.sep)) throw new Error('Invalid storage key');
  return resolved;
};

const assertUsable = () => {
  if (!r2Configured && env.NODE_ENV === 'production') {
    throw new ApiError(503, 'Document storage is not configured (R2 credentials are missing)');
  }
};

const put = async (key, buffer, contentType) => {
  assertUsable();
  if (r2Configured) {
    await getS3().send(new PutObjectCommand({ Bucket: env.R2_BUCKET_NAME, Key: key, Body: buffer, ContentType: contentType }));
    return;
  }
  const target = localPath(key);
  await fs.promises.mkdir(path.dirname(target), { recursive: true });
  await fs.promises.writeFile(target, buffer);
};

// Returns a readable stream of the file's bytes.
const getStream = async (key) => {
  assertUsable();
  if (r2Configured) {
    try {
      const object = await getS3().send(new GetObjectCommand({ Bucket: env.R2_BUCKET_NAME, Key: key }));
      return object.Body;
    } catch (err) {
      if (err.name === 'NoSuchKey') throw ApiError.notFound('File not found');
      throw err;
    }
  }
  const target = localPath(key);
  try {
    await fs.promises.access(target);
  } catch {
    throw ApiError.notFound('File not found');
  }
  return fs.createReadStream(target);
};

// Best-effort: a leftover file is harmless, so failures are logged, not thrown.
const remove = async (key) => {
  try {
    if (r2Configured) {
      await getS3().send(new DeleteObjectCommand({ Bucket: env.R2_BUCKET_NAME, Key: key }));
    } else {
      await fs.promises.rm(localPath(key), { force: true });
    }
  } catch (err) {
    logger.warn({ err: err.message, key }, 'Failed to delete stored file');
  }
};

module.exports = { put, getStream, remove };
