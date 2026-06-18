import { NextResponse } from 'next/server';
import { exchangeYouCanAuthorizationCode } from '@/lib/integrations/youcan/oauth';
import { ApiError } from '@/lib/http/client';

export async function GET(request: Request) {
  const rawUrl = request.url;
  const code = getRawQueryParam(rawUrl, 'code');
  if (!code) {
    return NextResponse.json({ ok: false, error: 'Missing OAuth code in callback URL.' }, { status: 400 });
  }

  try {
    const token = await exchangeYouCanAuthorizationCode(code);
    return NextResponse.json({
      ok: true,
      message: 'YouCan OAuth token generated. Copy these values into .env.production on the VPS. They are intentionally not stored automatically.',
      accessTokenEnv: `YOUCAN_API_TOKEN=${token.access_token}`,
      refreshTokenEnv: token.refresh_token ? `YOUCAN_REFRESH_TOKEN=${token.refresh_token}` : null,
      expiresIn: token.expires_in,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json(
      {
        ok: false,
        error: message,
        upstream: error instanceof ApiError ? error.payload : undefined,
        codeLength: code.length,
        note:
          'YouCan rejected the authorization code. The callback now preserves raw encrypted code characters such as +. If this still fails after opening a fresh authorization link, the YouCan app may be using the embedded token_exchange flow rather than authorization_code.',
      },
      { status: 502 },
    );
  }
}

function getRawQueryParam(rawUrl: string, key: string) {
  const queryStart = rawUrl.indexOf('?');
  if (queryStart === -1) return null;
  const query = rawUrl.slice(queryStart + 1);
  for (const part of query.split('&')) {
    const eq = part.indexOf('=');
    const rawKey = eq === -1 ? part : part.slice(0, eq);
    if (decodeURIComponent(rawKey) !== key) continue;
    const rawValue = eq === -1 ? '' : part.slice(eq + 1);
    return decodeURIComponent(rawValue);
  }
  return null;
}
