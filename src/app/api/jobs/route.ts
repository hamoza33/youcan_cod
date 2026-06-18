import { NextResponse } from 'next/server';
import { z } from 'zod';
import { CountryCode } from '@prisma/client';
import { enqueueJob } from '@/lib/jobs/queue';
import { getSettingValue } from '@/lib/settings/runtime';

const schema = z.object({
  name: z.enum(['discover-cod-products', 'sync-stock', 'refresh-gmc-status', 'enrich-seo', 'import-youcan', 'push-gmc', 'ensure-cod-sku', 'sync-youcan-categories']),
  codProductId: z.string().optional(),
  country: z.nativeEnum(CountryCode).optional(),
  force: z.boolean().optional(),
});

export async function POST(request: Request) {
  const body = schema.parse(await request.json());
  const defaultCountry = await getSettingValue<CountryCode>('country.default').catch(() => CountryCode.SA);
  const job = await enqueueJob(body.name, { codProductId: body.codProductId, country: body.country ?? defaultCountry, force: body.force });
  return NextResponse.json({ ok: true, jobId: job.id });
}
