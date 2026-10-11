const bcrypt = require('bcryptjs');
const prisma = require('../../config/prisma');

async function main() {
  let city = await prisma.city.findFirst({ where: { name: 'Bengaluru' } });
  if (!city) {
    city = await prisma.city.create({ data: { name: 'Bengaluru', tier: 'TIER_1' } });
  }

  let zone = await prisma.zone.findFirst({ where: { name: 'Koramangala', cityId: city.id } });
  if (!zone) {
    zone = await prisma.zone.create({ data: { cityId: city.id, name: 'Koramangala' } });
  }

  const categories = [
    { name: 'Electrician', tier: 'REPAIR', basePrice: 299 },
    { name: 'Plumber', tier: 'REPAIR', basePrice: 349 },
    { name: 'AC Repair', tier: 'REPAIR', basePrice: 499 },
  ];

  for (const category of categories) {
    const existing = await prisma.serviceCategory.findFirst({ where: { name: category.name } });
    if (!existing) {
      await prisma.serviceCategory.create({ data: category });
    }
  }

  // The bootstrap account is a super admin: it gives final approval on vendor
  // onboarding and is the only role that can create other super admins.
  const admin = await prisma.user.upsert({
    where: { phone: '+919999999999' },
    update: { role: 'SUPER_ADMIN' },
    create: {
      phone: '+919999999999',
      name: 'Platform Admin',
      role: 'SUPER_ADMIN',
      cityId: city.id,
    },
  });

  // The admin dashboard signs in with email + password. Give the bootstrap
  // account those by running the seed with SEED_SUPER_ADMIN_EMAIL and
  // SEED_SUPER_ADMIN_PASSWORD set; re-running with new values changes them.
  const email = process.env.SEED_SUPER_ADMIN_EMAIL;
  const password = process.env.SEED_SUPER_ADMIN_PASSWORD;
  if (email && password) {
    if (password.length < 8) throw new Error('SEED_SUPER_ADMIN_PASSWORD must be at least 8 characters');
    const owner = await prisma.user.findUnique({ where: { email } });
    if (owner && owner.id !== admin.id) throw new Error(`${email} already belongs to another account`);
    await prisma.user.update({ where: { id: admin.id }, data: { email, passwordHash: await bcrypt.hash(password, 12), isOnboarded: true } });
  }

  console.log('Seeded:', {
    city: city.name,
    zone: zone.name,
    categories: categories.length,
    admin: admin.phone,
    dashboardLogin: email && password ? email : 'not set (run with SEED_SUPER_ADMIN_EMAIL and SEED_SUPER_ADMIN_PASSWORD)',
  });
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
