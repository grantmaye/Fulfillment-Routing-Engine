import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NextRequest } from 'next/server';
import { hasAllowedOrigin } from '../src/lib/request-origin';

test('same-origin localhost, IPv4 and IPv6 loopback survive NextURL normalization', () => {
  for (const host of ['localhost:3000', '127.0.0.1:3000', '[::1]:3000']) {
    const origin = `http://${host}`;
    const request = new NextRequest(`${origin}/api/graphql`, { headers: { host, origin } });
    assert.equal(request.nextUrl.hostname, 'localhost');
    assert.equal(hasAllowedOrigin(request), true, origin);
  }
});

test('origin checks retain exact host, port and scheme boundaries', () => {
  for (const origin of [
    'https://unrelated.example',
    'http://localhost:3000',
    'http://127.0.0.1:3001',
    'https://127.0.0.1:3000',
    'http://127.0.0.1.evil.example:3000',
    'http://127.0.0.1:3000@evil.example',
    'null',
    '',
  ]) {
    const request = new NextRequest('http://127.0.0.1:3000/api/graphql', {
      headers: { host: '127.0.0.1:3000', origin, 'x-forwarded-host': origin.slice(7) },
    });
    assert.equal(hasAllowedOrigin(request), false, origin);
  }
});

test('explicit origins require Host; absent Origin remains usable by CLI clients', () => {
  const url = 'http://localhost:3000/api/graphql';
  assert.equal(
    hasAllowedOrigin(new NextRequest(url, { headers: { origin: 'http://localhost:3000' } })),
    false,
  );
  assert.equal(
    hasAllowedOrigin(new NextRequest(url, { headers: { host: 'localhost:3000' } })),
    true,
  );
});

test('HTTPS same-origin requests remain allowed without a loopback exception', () => {
  const request = new NextRequest('https://dispatch.example/api/graphql', {
    headers: { host: 'dispatch.example', origin: 'https://dispatch.example' },
  });
  assert.equal(hasAllowedOrigin(request), true);
});
