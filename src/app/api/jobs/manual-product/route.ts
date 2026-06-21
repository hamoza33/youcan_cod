import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { importToYouCan, pushToGmc } from '@/lib/jobs/pipeline';
import { upsertManualProduct } from '@/lib/products/manual-product';
import { getOptionalConfig } from '@/lib/settings/config';

export const dynamic = 'force-dynamic';

const manualProductSchema = z.object({
  codProductId: z.string().optional(),
  codDropProductId: z.string().optional(),
  codSku: z.string().min(1),
  name: z.string().min(1),
  description: z.string().optional(),
  price: z.coerce.number().positive().optional(),
  compareAtPrice: z.coerce.number().positive().optional(),
  productCost: z.coerce.number().positive().optional(),
  currency: z.string().default('SAR'),
  stockQuantity: z.coerce.number().int().nonnegative().optional(),
  imageUrls: z.array(z.string()).default([]),
  categorySlug: z.string().optional(),
  visible: z.boolean().default(true),
  seo: z.record(z.unknown()).optional(),
  pushGmc: z.boolean().optional(),
});

export async function POST(request: Request) {
  let stage: 'prepare-product' | 'import-youcan' | 'push-gmc' = 'prepare-product';

  try {
    const input = manualProductSchema.parse(await request.json());
    const env = await getOptionalConfig();
    const product = await upsertManualProduct(input);

    stage = 'import-youcan';
    const youCanProduct = await importToYouCan(product.id, { enqueueGmc: false });

    stage = 'push-gmc';
    const gmcResponse = (input.pushGmc ?? env.GOOGLE_MERCHANT_ENABLED === 'true') ? await pushToGmc(product.id) : null;

    const refreshed = await prisma.codProduct.findUniqueOrThrow({
      where: { id: product.id },
      include: { mapping: true, seoMetadata: true, category: true },
    });

    return NextResponse.json({
      ok: true,
      product: {
        id: refreshed.id,
        codProductId: refreshed.codProductId,
        codSku: refreshed.codSku,
        title: refreshed.seoMetadata?.title ?? refreshed.name,
        importStatus: refreshed.importStatus,
        seoStatus: refreshed.seoStatus,
        gmcStatus: refreshed.gmcStatus,
        lastError: refreshed.lastError,
      },
      youCan: {
        productId: refreshed.mapping?.youCanProductId,
        variantId: refreshed.mapping?.youCanVariantId,
        slug: refreshed.mapping?.youCanSlug,
        publicUrl: refreshed.mapping?.youCanPublicUrl,
        response: {
          id: youCanProduct.id,
          slug: youCanProduct.slug,
          public_url: youCanProduct.public_url,
        },
      },
      gmc: gmcResponse ? { submitted: true, response: gmcResponse } : { submitted: false },
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        stage,
        error: error instanceof Error ? error.message : String(error),
      },
      { status: 500 },
    );
  }
}
