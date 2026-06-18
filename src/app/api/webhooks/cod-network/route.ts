import { NextResponse } from 'next/server';
import { CountryCode, LogLevel, LogSource, StockStatus } from '@prisma/client';
import { prisma } from '@/lib/db';
import { logEvent } from '@/lib/logger';
import { enqueueJob } from '@/lib/jobs/queue';
import { getOptionalEnv } from '@/lib/env';
import { normalizeCountryCode } from '@/lib/countries';
import { codBasePrice, numeric } from '@/lib/products/cod-pricing';
import { toJsonValue } from '@/lib/http/client';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const env = getOptionalEnv();
  if (env.COD_NETWORK_WEBHOOK_SECRET) {
    const supplied = request.headers.get('x-cod-webhook-secret') ?? request.headers.get('x-webhook-secret');
    if (supplied !== env.COD_NETWORK_WEBHOOK_SECRET) {
      return NextResponse.json({ ok: false, error: 'Unauthorized webhook' }, { status: 401 });
    }
  }

  const payload = await request.json();
  const items = extractItems(payload);
  let updated = 0;
  const touched: string[] = [];

  for (const item of items) {
    const sku = stringValue(item.sku ?? item.codSku ?? item.product_sku);
    const codProductId = stringValue(item.id ?? item.product_id ?? item.codProductId);
    if (!sku && !codProductId) continue;

    const product = sku
      ? await prisma.codProduct.findUnique({ where: { codSku: sku } })
      : await prisma.codProduct.findFirst({ where: { codProductId, country: normalizeCountryCode(item.country_iso_code ?? item.country ?? item.country_name, CountryCode.SA) } });
    if (!product) continue;

    const quantity = numeric(item.quantity ?? item.stock ?? item.stock_quantity ?? item.available_quantity);
    const stockStatus = quantity === 0 ? StockStatus.OUT_OF_STOCK : quantity == null ? product.stockStatus : StockStatus.IN_STOCK;
    const formulaSetting = await prisma.setting.findUnique({ where: { key: 'pricing.defaultFormula' } });
    const formula = (formulaSetting?.value as { type: 'markup_percent' | 'fixed_markup'; value: number; roundTo?: number } | null) ?? { type: 'markup_percent', value: 60, roundTo: 0.99 };
    const price = codBasePrice(item, formula) || Number(product.price ?? 0);

    await prisma.codProduct.update({
      where: { id: product.id },
      data: {
        stockQuantity: quantity ?? product.stockQuantity,
        stockStatus,
        price,
        rawPayload: toJsonValue(item),
        lastCodSyncAt: new Date(),
        lastError: null,
      },
    });
    updated += 1;
    touched.push(product.id);
    await enqueueJob('import-youcan', { codProductId: product.id, country: product.country, force: true });
    if (process.env.GOOGLE_MERCHANT_ENABLED === 'true') {
      await enqueueJob('push-gmc', { codProductId: product.id, country: product.country, force: true });
    }
  }

  await logEvent({
    source: LogSource.COD,
    level: updated ? LogLevel.INFO : LogLevel.WARN,
    message: `COD webhook processed ${updated} matching products`,
    context: { updated, itemCount: items.length },
  });

  return NextResponse.json({ ok: true, updated, touched });
}

function extractItems(payload: unknown): Record<string, unknown>[] {
  if (Array.isArray(payload)) return payload.filter(isRecord);
  if (!isRecord(payload)) return [];
  for (const key of ['data', 'products', 'items', 'product']) {
    const value = payload[key];
    if (Array.isArray(value)) return value.filter(isRecord);
    if (isRecord(value)) return [value];
  }
  return [payload];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function stringValue(value: unknown) {
  return typeof value === 'string' || typeof value === 'number' ? String(value).trim() || undefined : undefined;
}
