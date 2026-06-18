import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';

export const dynamic = 'force-dynamic';

type Params = Promise<{ productId: string; index: string }>;

export async function GET(_request: Request, { params }: { params: Params }) {
  const { productId, index } = await params;
  const parsedIndex = Number(index);
  if (!Number.isInteger(parsedIndex) || parsedIndex < 0) {
    return NextResponse.json({ error: 'Invalid image index' }, { status: 400 });
  }

  const product = await prisma.codProduct.findUnique({ where: { id: productId }, select: { imageUrls: true } });
  const imageUrl = product?.imageUrls[parsedIndex];
  if (!imageUrl) {
    return NextResponse.json({ error: 'Image not found' }, { status: 404 });
  }

  const upstream = await fetch(imageUrl, { headers: { Accept: 'image/*,*/*' } });
  if (!upstream.ok || !upstream.body) {
    return NextResponse.json({ error: 'Could not fetch upstream image' }, { status: 502 });
  }

  return new NextResponse(upstream.body, {
    status: 200,
    headers: {
      'Content-Type': upstream.headers.get('content-type') ?? 'image/jpeg',
      'Cache-Control': 'public, max-age=86400, s-maxage=86400',
    },
  });
}
