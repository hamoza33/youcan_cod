import { CountryCode } from '@prisma/client';
import { discoverCodProducts } from '@/lib/jobs/pipeline';

async function main() {
  const result = await discoverCodProducts(CountryCode.SA);
  console.log(JSON.stringify(result, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
