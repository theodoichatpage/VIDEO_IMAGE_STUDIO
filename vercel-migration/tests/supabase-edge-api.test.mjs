import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';

test('browser API uses the Supabase edge endpoint', () => {
  assert.equal(existsSync(new URL('../supabase/functions/studio-api/index.ts', import.meta.url)), true);
  const client = readFileSync(new URL('../src/api.ts', import.meta.url), 'utf8');
  assert.match(client, /functions\/v1\/studio-api/);
  assert.match(client, /if \(!response\.ok \|\| data\.error\)/);
});

test('edge adapter preserves the status returned by the API handler', () => {
  const adapter = readFileSync(new URL('../supabase/functions/studio-api/index.ts', import.meta.url), 'utf8');
  assert.match(adapter, /result\.status = code/);
  assert.match(adapter, /status: result\.status/);
});

test('loading an unknown studio session returns an empty session instead of an API error', () => {
  const handler = readFileSync(new URL('../supabase/functions/studio-api/handler.ts', import.meta.url), 'utf8');
  assert.match(handler, /if \(path\.length === 2 && req\.method === 'GET'\) return send\(res, 200, \{ session: session \}\);/);
});
