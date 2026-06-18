import { PrismaClient, SettingKind } from '@prisma/client';
import { categorySeedData } from '../src/lib/categories/main-categories';

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

  const settings = [
    ['country.default', 'SA', SettingKind.STRING, 'Initial country scope. KSA only.'],
    ['pricing.defaultFormula', { type: 'markup_percent', value: 60, roundTo: 0.99 }, SettingKind.JSON, 'Default product pricing formula.'],
    ['visibility.default', true, SettingKind.BOOLEAN, 'Make imported products visible by default.'],
    ['sync.frequencyCron', '17 */2 * * *', SettingKind.STRING, 'Default sync frequency.'],
    ['ai.provider', 'DuckCoding', SettingKind.STRING, 'OpenAI-compatible provider name.'],
    ['ai.baseUrl', 'https://www.duckcoding.ai/', SettingKind.STRING, 'OpenAI-compatible base URL.'],
    ['ai.model', 'claude-opus-4-8', SettingKind.STRING, 'Default AI model for SEO/image/product identification.'],
    ['gmc.feedLabel', 'SA', SettingKind.STRING, 'Google Merchant feed label for Saudi Arabia.'],
    ['gmc.contentLanguage', 'ar', SettingKind.STRING, 'Default Google Merchant content language.'],
  ] as const;

  for (const [key, value, kind, description] of settings) {
    await prisma.setting.upsert({
      where: { key },
      update: {},
      create: { key, value, kind, description },
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
