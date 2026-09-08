import { randomUUID } from 'node:crypto';
import { HeaderMap } from '@apollo/server';
import { NextRequest, NextResponse } from 'next/server';
import { getDatabase } from '@/lib/database';
import { createApi } from '@/lib/graphql';
import { RoutingService } from '@/lib/routing';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const api = createApi();
const started = api.start();
export async function POST(request: NextRequest) {
  if (!request.headers.get('content-type')?.startsWith('application/json'))
    return NextResponse.json({ error: 'Use application/json.' }, { status: 415 });
  const origin = request.headers.get('origin');
  if (origin && origin !== request.nextUrl.origin)
    return NextResponse.json({ error: 'Cross-origin requests are not allowed.' }, { status: 403 });
  const body = await request.text();
  if (body.length > 16000)
    return NextResponse.json({ error: 'Request too large.' }, { status: 413 });
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return NextResponse.json({ error: 'Invalid JSON.' }, { status: 400 });
  }
  const existing = request.cookies.get('routing-session')?.value;
  const sessionId =
    existing &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(existing)
      ? existing
      : randomUUID();
  const service = new RoutingService(await getDatabase());
  await service.initialize(sessionId);
  await started;
  const headers = new HeaderMap();
  request.headers.forEach((value, key) => headers.set(key, value));
  const result = await api.executeHTTPGraphQLRequest({
    httpGraphQLRequest: { method: 'POST', headers, search: '', body: parsed },
    context: async () => ({ service, sessionId }),
  });
  if (result.body.kind !== 'complete')
    return NextResponse.json({ error: 'Streaming is not supported.' }, { status: 400 });
  const response = new NextResponse(result.body.string, {
    status: result.status ?? 200,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
  response.cookies.set('routing-session', sessionId, {
    httpOnly: true,
    sameSite: 'strict',
    secure: request.nextUrl.protocol === 'https:',
    path: '/',
    maxAge: 60 * 60 * 24 * 7,
  });
  return response;
}
