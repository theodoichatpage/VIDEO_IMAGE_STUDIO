import assert from 'node:assert/strict';
import test from 'node:test';
import { existsSync, readFileSync } from 'node:fs';

test('routes every /api request through the deployed API function', () => {
  const config = JSON.parse(readFileSync(new URL('../vercel.json', import.meta.url)));
  assert.equal(existsSync(new URL('../api/index.ts', import.meta.url)), true);
  assert.deepEqual(config.rewrites, [
    { source: '/api/:path*', destination: '/api?path=:path*' },
  ]);
});
