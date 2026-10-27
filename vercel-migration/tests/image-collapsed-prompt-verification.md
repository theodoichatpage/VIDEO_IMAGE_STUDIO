# ChatGPT collapsed image prompt recovery — extension 0.4.20

Production base: dc3faec89d726b1e669806d5f147d14e372f2115 (`vercel-migration`).

## Reproduction and fix

The browser regression failed before the fix with the same Studio diagnostic as the reported screenshot: image visible, prompt truncated behind Show more, no image matched, preview timed out. The extension now expands only Show more/read more controls in user turns and then uses the existing exact prompt/answer pairing. It never uses a shared style prefix or an arbitrary latest image. Both the automatic waiter and manual recovery use this path. An unsuccessful lookup now includes its reader reason for diagnosis.

## Validation

- Build passed, TypeScript passed.
- Node test runner: 66/66 passed, including stop barriers, image bytes/CORS, exact scene pairing, API preservation and delivery retry.
- Vitest source suites: 14/14 passed with a Node localStorage fixture.
- Browser image transport: real Studio UI -> extension scripts -> matched generated image -> CORS worker fallback -> real API handler -> fixture Storage -> preview and download. Tested collapsed prompts in both automatic and manual sync, a later unrelated image, no new prompt on recovery, selected scene isolation, queue/Stop regression.
- Browser transcript transport passed; partition, rewrite and Stop remain functional.
- ZIP: CRC valid, one enclosing folder, manifest 0.4.20, all files equal tested extension sources.

The browser uses fixture ChatGPT/DB/Storage. This environment cannot inspect the user's actual authenticated ChatGPT tab. No backend or user project data was changed.

## Existing test runner configuration limitation

Bare `npm test` still mixes Vitest and node:test files, and lacks browser localStorage. Failures: tests/background-delivery.test.mjs, tests/extension-flow.test.mjs, tests/image-capture.test.mjs, tests/image-scene-capture.test.mjs, tests/image-sync.test.mjs, tests/image-transfer.test.mjs, tests/reply-reader.test.mjs, tests/session-flow.test.mjs, tests/stop-all-extension.test.mjs, tests/supabase-edge-api.test.mjs, tests/transcript-bridge.test.mjs, tests/vercel-api-route.test.mjs report no Vitest suite. src/transcriptWorkspace.test.ts reports localStorage undefined. All 80 tests pass with their appropriate runners/fixture as above.

## User verification

Copy 4.20 files into the existing unpacked extension folder, Reload the extension, F5 both Studio and ChatGPT, keep the conversation containing the existing image open. Select that scene in Studio and choose Đồng bộ lại ảnh. No need to create the image again. On the next image request, leave ChatGPT open and confirm automatic arrival.
