// Shapes a Prisma User record for an API response: strips fields that must
// never leave the API (password hash, internal storage keys) and replaces
// the photo's storage key with the API path it is served from.
const sanitizeUser = (user) => {
  if (!user) return user;
  const { passwordHash: _passwordHash, profilePhotoKey, profilePhotoMime: _profilePhotoMime, ...safe } = user;
  if (profilePhotoKey !== undefined) {
    safe.profilePhoto = profilePhotoKey ? `/users/${user.id}/photo` : null;
  }
  if (safe.dateOfBirth instanceof Date) safe.dateOfBirth = safe.dateOfBirth.toISOString().slice(0, 10);
  return safe;
};

module.exports = sanitizeUser;
