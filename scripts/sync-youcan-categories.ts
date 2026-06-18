import { ensureMainYouCanCategories, syncYouCanCategories } from '@/lib/categories/youcan-sync';
import { prisma } from '@/lib/db';

async function main() {
  const syncResult = await syncYouCanCategories();
  const ensureResult = await ensureMainYouCanCategories();
  console.log(JSON.stringify({ synced: syncResult.synced, ...ensureResult }, null, 2));
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
