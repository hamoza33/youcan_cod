import { LogSource } from '@prisma/client';
import { type AppEnv } from '@/lib/env';
import { requestJson } from '@/lib/http/client';
import { getConfig } from '@/lib/settings/config';

export type YouCanTokenResponse = {
  token_type: 'Bearer';
  expires_in: number;
  access_token: string;
  refresh_token: string;
};

export async function buildYouCanAuthorizationUrl(scopes: string[] = ['*']) {
  const env = await getConfig();
  if (!env.YOUCAN_CLIENT_ID || !env.YOUCAN_REDIRECT_URI) {
    throw new Error('YOUCAN_CLIENT_ID and YOUCAN_REDIRECT_URI are required to build the YouCan OAuth authorization URL.');
  }
  const url = new URL('https://seller-area.youcan.shop/admin/oauth/authorize');
  url.searchParams.set('client_id', env.YOUCAN_CLIENT_ID);
  url.searchParams.set('redirect_uri', env.YOUCAN_REDIRECT_URI);
  url.searchParams.set('response_type', 'code');
  for (const scope of scopes) url.searchParams.append('scope[]', scope);
  return url.toString();
}

export async function exchangeYouCanAuthorizationCode(code: string) {
  const env = await getConfig();
  const { clientId, clientSecret, redirectUri } = requireOAuthEnv(env);
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: redirectUri,
    code,
  });

  return requestJson<YouCanTokenResponse>(`${env.YOUCAN_BASE_URL.replace(/\/$/, '')}/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
    source: LogSource.YOUCAN,
  });
}

export async function refreshYouCanAccessToken(refreshToken?: string) {
  const env = await getConfig();
  const tokenToRefresh = refreshToken ?? env.YOUCAN_REFRESH_TOKEN;
  const { clientId, clientSecret } = requireOAuthEnv(env);
  if (!tokenToRefresh) throw new Error('YOUCAN_REFRESH_TOKEN is required to refresh the YouCan access token.');
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: tokenToRefresh,
  });

  return requestJson<YouCanTokenResponse>(`${env.YOUCAN_BASE_URL.replace(/\/$/, '')}/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
    source: LogSource.YOUCAN,
  });
}

function requireOAuthEnv(env: AppEnv) {
  if (!env.YOUCAN_CLIENT_ID || !env.YOUCAN_CLIENT_SECRET || !env.YOUCAN_REDIRECT_URI) {
    throw new Error('YOUCAN_CLIENT_ID, YOUCAN_CLIENT_SECRET, and YOUCAN_REDIRECT_URI are required for YouCan OAuth.');
  }
  return {
    clientId: env.YOUCAN_CLIENT_ID,
    clientSecret: env.YOUCAN_CLIENT_SECRET,
    redirectUri: env.YOUCAN_REDIRECT_URI,
  };
}
