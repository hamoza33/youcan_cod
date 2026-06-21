import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET() {
  const startedAt = Date.now();
  try {
    await prisma.$queryRaw`SELECT 1`;
    return NextResponse.json({ ok: true, database: 'ok', latencyMs: Date.now() - startedAt });
  } catch (error) {
    return NextResponse.json({ ok: false, database: 'error', error: String(error), latencyMs: Date.now() - startedAt }, { status: 500 });
  }
}
