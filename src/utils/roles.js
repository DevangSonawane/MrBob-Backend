// SUPER_ADMIN is a superset of ADMIN: anything gated on ADMIN is open to both.
const isAdmin = (role) => role === 'ADMIN' || role === 'SUPER_ADMIN';
const isSuperAdmin = (role) => role === 'SUPER_ADMIN';

module.exports = { isAdmin, isSuperAdmin };
