import { NextResponse } from 'next/server';
import { buildYouCanAuthorizationUrl } from '@/lib/integrations/youcan/oauth';

export async function GET() {
  return NextResponse.json({ authorizationUrl: buildYouCanAuthorizationUrl(['*']) });
}
