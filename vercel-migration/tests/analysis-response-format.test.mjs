import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';
test('text analysis respects the requested output format',()=>{const source=readFileSync('extension/content.js','utf8');assert.match(source,/Follow the output format specified in the prompt/);assert.doesNotMatch(source,/Return only the rewritten script, without JSON or markdown/)});
