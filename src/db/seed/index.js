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

  console.log('Seeded:', { city: city.name, zone: zone.name, categories: categories.length, admin: admin.phone });
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
