# Image-only ChatGPT DOM recovery — extension 0.4.21

Base: 96fbb1ba69e2f257ffb59db1a0d42b50256ba643, vercel-migration.

## Reproduction

The reported screenshot includes `no-user-anchor`. The browser regression replaces semantic user/assistant/article markup with generic div containers and a collapsed Show more prompt, matching this failure condition. Before the fix, Studio reports no-user-anchor and times out despite a loaded image. No claim is made that a screenshot reveals the complete authenticated ChatGPT DOM.

## Fix

- Detect exact prompt text in generic image-turn containers, independently of role/article/ResponseRoot selectors.
- Find generated-image cards on permitted ChatGPT/image hosts and include them in pre-command snapshots.
- Expand Show more even when the user turn has not yet been recognized.
- Shared prompt prefixes establish boundaries only; capture still requires a full matching prompt. Image sync never uses an arbitrary latest image without a user anchor.
- Keep the first image answer belonging to the matching user turn rather than jumping to a later unrelated scene.
- No API/backend or project-data changes. Existing Stop cancellation and delivery protections retained.

## Checks

- Build and TypeScript passed.
- Node suites: 66/66 passed.
- Vitest source suites: 14/14 passed with Node localStorage fixture.
- Browser image flow passed: actual Studio UI, extension and API handler, fixture ChatGPT/DB/Storage. Automatic scene 1 and scene 2 use distinct blue/red PNGs; second scene receives the red image. Also verifies manual recovery after reload, collapsed prompts, unrelated later image, no prompt resend, queue and Stop barriers, Storage preview/download.
- Transcript transport browser regression passed.
- ZIP 0.4.21 has one parent directory, valid CRC, matching manifest and byte equality with tested extension files.

The user's authenticated ChatGPT tab is not available in this environment; verify it after updating the unpacked extension and F5 both tabs. Existing images can be recovered without generating again.

## Existing bare npm test limitations

The unchanged runner mixes node:test files with Vitest. These report no Vitest suite: background-delivery.test.mjs, extension-flow.test.mjs, image-capture.test.mjs, image-scene-capture.test.mjs, image-sync.test.mjs, image-transfer.test.mjs, reply-reader.test.mjs, session-flow.test.mjs, stop-all-extension.test.mjs, supabase-edge-api.test.mjs, transcript-bridge.test.mjs, vercel-api-route.test.mjs. src/transcriptWorkspace.test.ts requires localStorage. All 80 tests pass under the appropriate runners/fixture above.
