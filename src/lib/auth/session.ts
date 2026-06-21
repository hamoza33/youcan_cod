export const SESSION_COOKIE_NAME = 'cod_admin_session';

export async function createSessionToken(password: string) {
  const data = new TextEncoder().encode(`cod-admin:${password}`);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function isValidSessionToken(token: string | undefined, adminPassword: string | undefined) {
  if (!adminPassword || !token) return false;
  const expected = await createSessionToken(adminPassword);
  return timingSafeEqual(token, expected);
}

function timingSafeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let index = 0; index < a.length; index += 1) {
    result |= a.charCodeAt(index) ^ b.charCodeAt(index);
  }
  return result === 0;
}
