import { PrismaClient, SettingKind } from '@prisma/client';
import { categorySeedData } from '../src/lib/categories/main-categories';
import { SETTINGS } from '../src/lib/settings/registry';
import { toJsonValue } from '../src/lib/http/client';

const prisma = new PrismaClient();

const CANONICAL_DISCOUNT_RULES = [
  { quantity: 1, discountPercent: 0, label: 'أريد واحدة فقط', sortOrder: 10 },
  { quantity: 3, discountPercent: 33, label: 'أريد اثنان + واحدة مجانا', sortOrder: 20 },
  { quantity: 5, discountPercent: 40, label: 'أريد ثلاثة + اثنين مجانا', sortOrder: 30 },
] as const;

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

  await prisma.$transaction(async (tx) => {
    await tx.discountRule.deleteMany({
      where: {
        NOT: {
          OR: CANONICAL_DISCOUNT_RULES.map((rule) => ({ quantity: rule.quantity, discountPercent: rule.discountPercent })),
        },
      },
    });
    for (const rule of CANONICAL_DISCOUNT_RULES) {
      await tx.discountRule.upsert({
        where: { quantity_discountPercent: { quantity: rule.quantity, discountPercent: rule.discountPercent } },
        update: { label: rule.label, sortOrder: rule.sortOrder, isActive: true },
        create: { ...rule, isActive: true },
      });
    }
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
