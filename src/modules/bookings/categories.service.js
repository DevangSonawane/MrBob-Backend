const crypto = require('crypto');
const prisma = require('../../config/prisma');
const ApiError = require('../../utils/ApiError');
const storage = require('../storage/storage.service');
const { extensionFor } = require('../../middlewares/upload');

const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

// What the API returns: the stored key stays private; `image` is the path to
// fetch the picture from (relative to the API base), or null when there is none.
const toView = ({ imageKey, imageMime: _mime, ...category }) => ({
  ...category,
  image: imageKey ? `/categories/${category.id}/image?v=${category.updatedAt.getTime()}` : null,
});

const find = async (id) => {
  const category = await prisma.serviceCategory.findUnique({ where: { id } });
  if (!category) throw ApiError.notFound('Category not found');
  return category;
};

const imageFrom = (files = {}) => {
  const image = files.image?.[0];
  if (image && !IMAGE_TYPES.includes(image.mimetype)) throw ApiError.badRequest('"image" must be a JPEG, PNG or WebP image');
  return image;
};

const storeImage = async (category, image) => {
  const key = `categories/${category.id}/image-${crypto.randomUUID()}.${extensionFor(image.mimetype)}`;
  await storage.put(key, image.buffer, image.mimetype);
  const updated = await prisma.serviceCategory.update({ where: { id: category.id }, data: { imageKey: key, imageMime: image.mimetype } });
  if (category.imageKey) await storage.remove(category.imageKey);
  return updated;
};

const list = async () => (await prisma.serviceCategory.findMany({ where: { isActive: true }, orderBy: { name: 'asc' } })).map(toView);

const create = async (data, files) => {
  const image = imageFrom(files);
  const name = data.name.trim();
  const existing = await prisma.serviceCategory.findFirst({ where: { name: { equals: name, mode: 'insensitive' } } });
  if (existing) throw ApiError.conflict(`${existing.name} already exists`);
  const category = await prisma.serviceCategory.create({ data: { ...data, name } });
  return toView(image ? await storeImage(category, image) : category);
};

const setImage = async (id, files) => {
  const category = await find(id);
  const image = imageFrom(files);
  if (!image) throw ApiError.badRequest('Upload an image as "image"');
  return toView(await storeImage(category, image));
};

const removeImage = async (id) => {
  const category = await find(id);
  if (!category.imageKey) return toView(category);
  const updated = await prisma.serviceCategory.update({ where: { id }, data: { imageKey: null, imageMime: null } });
  await storage.remove(category.imageKey);
  return toView(updated);
};

const openImage = async (id) => {
  const category = await find(id);
  if (!category.imageKey) throw ApiError.notFound('This category has no image');
  return { stream: await storage.getStream(category.imageKey), mimeType: category.imageMime };
};

module.exports = { list, create, setImage, removeImage, openImage };
