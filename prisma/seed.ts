import { PrismaClient, SettingKind } from '@prisma/client';
import { categorySeedData } from '../src/lib/categories/main-categories';
import { SETTINGS } from '../src/lib/settings/registry';
import { toJsonValue } from '../src/lib/http/client';

const prisma = new PrismaClient();

async function main() {
  for (const category of categorySeedData()) {
    await prisma.category.upsert({
      where: { slug: category.slug },
      update: {
        name: category.name,
        googleProductCategory: category.googleProductCategory,
        sortOrder: category.sortOrder,
        isActive: true,
      },
      create: {
        ...category,
        isActive: true,
      },
    });
  }

  await prisma.discountRule.createMany({
    data: [
      { quantity: 2, discountPercent: 20, label: 'Buy 2: 20% off', sortOrder: 10 },
      { quantity: 3, discountPercent: 30, label: 'Buy 3: 30% off', sortOrder: 20 },
      { quantity: 5, discountPercent: 30, label: 'Buy 5: 30% off', sortOrder: 30 },
    ],
    skipDuplicates: true,
  });

  const settings = SETTINGS.map((definition) => [
    definition.key,
    definition.defaultValue,
    SettingKind[definition.kind],
    definition.description,
    Boolean(definition.isSecret),
  ] as const);

  for (const [key, value, kind, description, isSecret] of settings) {
    await prisma.setting.upsert({
      where: { key },
      update: { kind, description, isSecret },
      create: { key, value: toJsonValue(value), kind, description, isSecret },
    });
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
