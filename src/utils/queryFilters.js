const { z } = require('zod');

// Shared pieces for list-endpoint query strings.

// ?status=SUBMITTED,PENDING_APPROVAL -> ['SUBMITTED', 'PENDING_APPROVAL']
const commaList = (values) =>
  z
    .string()
    .transform((value) => [...new Set(value.split(',').map((item) => item.trim().toUpperCase()).filter(Boolean))])
    .pipe(z.array(z.enum(values)).min(1));

// ?isActive=true / ?isActive=false
const booleanFlag = z.enum(['true', 'false']).transform((value) => value === 'true');

const dateOnly = z.iso.date('Use YYYY-MM-DD');
const sortOrder = z.enum(['asc', 'desc']);

// Inclusive range over whole days (UTC) for a Prisma DateTime filter;
// undefined when neither end is given.
const dateRange = (from, to) => {
  if (!from && !to) return undefined;
  return {
    ...(from && { gte: new Date(`${from}T00:00:00.000Z`) }),
    ...(to && { lte: new Date(`${to}T23:59:59.999Z`) }),
  };
};

// Case-insensitive match on a person's name, phone or email.
const personSearch = (search) => ({
  OR: [
    { name: { contains: search, mode: 'insensitive' } },
    { phone: { contains: search } },
    { email: { contains: search, mode: 'insensitive' } },
  ],
});

module.exports = { commaList, booleanFlag, dateOnly, sortOrder, dateRange, personSearch };
