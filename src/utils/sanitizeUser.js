// Strips fields that must never leave the API (password hash today; add
// future internal-only columns here) from a Prisma User record.
const sanitizeUser = (user) => {
  if (!user) return user;
  const { passwordHash: _passwordHash, ...safe } = user;
  return safe;
};

module.exports = sanitizeUser;
