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

## 2026-10-26: selected-scene capture with another active job

The screenshot's orange message came from Studio's scene-mismatch guard, before an extension capture request was sent. Both image sync buttons now request the selected scene's existing image prompt. The new images/capture endpoint reuses a matching active command or creates a bounded, ten-minute capture ticket without replacing another active job or generation queue. It never dispatches a new generation prompt. The existing images/recover endpoint remains compatible.

Captured files carry their job ID. UI completion requires that exact job ID, preventing an older completed image from being mistaken for the requested result. Capture creation and completion use conditional record updates with retries; completion re-reads the project after the upload to preserve concurrent script, job and scene changes. Image signatures, file-size checks and private signed Storage URLs remain in place. No schema or authentication setting is changed.

The deployed studio-api v15 source was read before editing. Its separation metadata support was retained when bringing the handler into the repository. Only the capture behavior and result-job metadata were added to that live base. The resulting Edge Function is v16.

Validation: 58 Node tests + 14 Vitest source tests passed; TypeScript and production build passed. New API regressions cover a selected scene while another scene runs, concurrent job completion during upload, conditional-save conflicts, invalid bytes, unknown scenes, duplicate delivery and reuse of the same active command. The browser image test now keeps a different scene active while recovering the selected scene and asserts that the other job remains active and no new ChatGPT prompt is submitted. Transcript transport and batch browser regressions also passed.

Bare npm test still misclassifies the Node-runner files, including the new image-scene-capture.test.mjs, as empty Vitest suites. All 11 such files pass with the Node runner; no test-runner configuration change is included. Live deployment verification is reported separately from fixture browser tests.

Live API verification on v16 also passed in an isolated verification session: prepare existing prompt B, stop that fixture job, queue A, capture B while A remains queued, save a real PNG to private Storage, download identical bytes via the signed URL, and ignore duplicate completion. The fixture's queued work was stopped afterward. No user's project or ChatGPT conversation was used for the live test.

## 2026-10-27: image controls appear unresponsive

The screenshot shows an active image job on scene 2 while other generation buttons are available. The old images endpoint rejected every new generation request with HTTP 409 whenever any job was active. Those errors were placed in Analysis-only notice state, so the image controls appeared to do nothing. Some sync controls were also permanently disabled when a scene had no saved generation prompt, without explaining why.

The image endpoint now appends eligible scenes behind an active image job, preserves that active job, skips active/queued duplicates, and returns accepted/duplicate counts. Conditional record updates preserve concurrent project updates. Text-analysis jobs remain protected with an explicit error. Stop marks all canceled queued scenes stopped. The image tab shows action and sync feedback above the style controls, provides immediate pending feedback, disables generation controls only while an enqueue request is in flight, and explains sync errors instead of permanently disabling the buttons for missing prompt metadata. Extension stays 4.18.

Regression evidence: the old API returned 409 in the new enqueue tests and the old UI failed the enabled-sync-button assertion. The fixed browser test clicks Create, Recreate, Create part and Create all with another active scene, checks visible pending feedback and duplicate protection, and checks sync feedback for a never-generated scene. The existing image capture, preview, download, transcript and rewrite-batch browser cases also pass.

Verification: build and TypeScript pass; 61 Node tests and 14 Vitest source tests pass. Bare npm test still reports the existing 11 Node files as empty Vitest suites; those files pass with node --test. The Edge Function for this follow-up is v17. No schema, authentication, extension ZIP or unrelated tab implementation changes are included.

Live API v17 validation passed in an isolated fixture: append A while B is active, skip a duplicate A/B request, advance automatically to A when B finishes with an error, and Stop A without clearing B's error history. The fixture row was removed afterward. No user's project or ChatGPT conversation was used.
