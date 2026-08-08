import { prisma } from '@/lib/db';
import { remediateMerchantCatalog, updateAllDiscountVariantsOnYouCan } from '@/lib/jobs/pipeline';

async function main() {
  const cleanup = await remediateMerchantCatalog();
  const consistency = process.argv.includes('--normalize-youcan')
    ? await updateAllDiscountVariantsOnYouCan()
    : undefined;
  console.log(JSON.stringify({ cleanup, consistency }, null, 2));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
