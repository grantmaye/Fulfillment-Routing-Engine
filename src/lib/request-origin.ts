import type { NextRequest } from 'next/server';

/** Compare the browser's exact origin, not an allowlist of loopback aliases. */
export function hasAllowedOrigin(request: Pick<NextRequest, 'headers' | 'nextUrl'>): boolean {
  const origin = request.headers.get('origin');
  // Non-browser clients such as curl may omit Origin, as before.
  if (origin === null) return true;
  const host = request.headers.get('host');
  if (!host) return false;
  // NextURL canonicalizes 127.0.0.1 and [::1] to localhost. Use the actual
  // request Host, including its port, so each spelling works only with itself.
  // Do not use X-Forwarded-Host to expand trust without a proxy trust policy.
  return origin === `${request.nextUrl.protocol}//${host}`;
}
