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
