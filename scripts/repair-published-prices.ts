import { prisma } from '../src/lib/db';
import { enqueueJob } from '../src/lib/jobs/queue';
import { roundSellingPriceToNine } from '../src/lib/pricing/formula';

const BATCH_SIZE = 50;

async function main() {
  const products = await prisma.codProduct.findMany({
    where: {
      mapping: {
        is: {
          OR: [
            { youCanProductId: { not: null } },
            { googleProductId: { not: null } },
          ],
        },
      },
    },
    select: { id: true, price: true },
    orderBy: { id: 'asc' },
  });

  let normalized = 0;
  for (let offset = 0; offset < products.length; offset += BATCH_SIZE) {
    const batch = products.slice(offset, offset + BATCH_SIZE);
    const updates = batch.flatMap((product) => {
      const currentPrice = Number(product.price);
      const price = roundSellingPriceToNine(currentPrice);
      if (!price || price === currentPrice) return [];
      normalized += 1;
      return [prisma.codProduct.update({ where: { id: product.id }, data: { price, lastError: null } })];
    });
    if (updates.length) await prisma.$transaction(updates);
  }

  for (let offset = 0; offset < products.length; offset += BATCH_SIZE) {
    const batch = products.slice(offset, offset + BATCH_SIZE);
    await Promise.all(batch.map((product) => enqueueJob('sync-product-price', { codProductId: product.id, force: true })));
  }

  console.log(JSON.stringify({ publishedProducts: products.length, normalized, queued: products.length }));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
