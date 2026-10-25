# Image synchronization fix — extension 0.4.18

Verified 2026-10-25 against branch vercel-migration, parent 458330ea994739b37f834efdb8fdd2b10c5db0dc.

Reproduced failures before the fix:

- A generated image card outside the inner assistant text block was excluded from capture.
- Page fetch rejected a displayed cross-origin image; there was no extension downloader fallback.
- Valid PNG bytes served as application/octet-stream were rejected by the old MIME-only check.

Implementation retains exact prompt/scene correlation. The downloader accepts requests only from ChatGPT tabs, HTTPS ChatGPT image hosts, actual PNG/JPEG/WebP signatures and files up to 8 MB. Signed external hosts receive no ChatGPT credentials. Redirects are rejected. Failed Studio deliveries retain bytes for retry and expose the server's error. Successful manual capture releases the matching content waiter and prevents stale waiter completion.

Verification:

- Build: npm run build passed.
- TypeScript: tsc --noEmit --noUnusedLocals false --noUnusedParameters false passed. These flags accommodate existing unrelated unused declarations.
- Node tests: 54 passed.
- Vitest src tests: 14 passed, using a localStorage polyfill for the Node environment.
- image-transport.e2e.mjs passed: real Studio UI → real extension scripts → matching image in sibling card → simulated CORS failure → worker reads real 1024×576 PNG bytes → unmodified production API handler → Storage fixture → complete preview → download byte equality. After clearing the image result and reloading Studio, recovery restores the existing ChatGPT image without submitting another prompt.
- transcript-transport.e2e.mjs passed with actual bridge/background/content/reader, including rewrite batching and stop.
- transcript-batch.e2e.mjs passed for continuation, skip completed, stop during/between tasks, late reply suppression, resume and error pause.
- ZIP CRC passed; archived files equal extension source and use one enclosing folder.

Live user ChatGPT authentication and the production database were not used by these tests. This report does not claim the user's specific missing image has already been recovered.

Existing npm test configuration limitation: Vitest reports “No test suite found” for Node-runner files. All of these pass with node --test tests/*.test.mjs:

- background-delivery.test.mjs
- extension-flow.test.mjs
- image-capture.test.mjs
- image-sync.test.mjs
- image-transfer.test.mjs
- reply-reader.test.mjs
- session-flow.test.mjs
- supabase-edge-api.test.mjs
- transcript-bridge.test.mjs
- vercel-api-route.test.mjs

No backend or database change is included in this fix. The extension ZIP and web's version/download references are updated together. Update the existing unpacked extension directory and reload it to retain pending extension results and pairing.

## Follow-up: immediate sync feedback

The existing capture/recovery messages were only rendered in the Analysis tab. Image recovery also relied on the periodic extension poll instead of dispatching capture immediately.

The image tab now sends capture as soon as recovery returns a job; shows pending/complete/error feedback beside the buttons; disables duplicate clicks; releases pending UI after errors or a 45-second no-response timeout; and preserves the server task for retry. A matching saved result is required before showing success. A request for another scene shows a useful message. Stop invalidates an in-flight recovery request. Preview load failures show a message instead of silently hiding the image, and refreshed image URLs mount a fresh preview.

The browser regression failed on the old build waiting for the missing feedback element. On the fixed build it verifies immediate pending feedback, disabled duplicate buttons, successful recovery, explicit extension error and retry, and recovery from a 403 preview URL. It verifies no additional ChatGPT prompt is submitted. Extension remains 0.4.18; no extension/backend changes in this follow-up.
