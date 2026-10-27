# Stop all — 2026-10-27

Scope: the Studio/ChatGPT analysis, rewrite, image generation and image synchronization pipeline. Local Engine algorithms and other tab implementations are unchanged.

The old stop operation canceled only the main active job. Detached capture tickets, orphan processing/queued scene states and local transcript jobs could survive. A request or image upload finishing later could restore old work.

Changes:

- A global Stop all control is available in the header and the image dashboard, including when there is no active main job. A visible summary identifies the active part/scene.
- Stop clears the server's active job, image queue, capture tickets, batch analysis queue and orphan running flags. Completed script/scene data and saved image files are retained.
- The session work epoch fences old writes and delayed start requests. Stop uses a conditional update. Uploads completing after Stop cannot restore the previous job or queue. Legacy sessions without an epoch remain supported.
- The web invalidates in-flight queue/dispatch results, cancels local transcript waiting/batch state, and waits for the extension's stop acknowledgement. Timeout or missing extension confirmation is displayed explicitly.
- Extension 0.4.19 stops linked ChatGPT task handlers, marks paired transcript jobs stopped, clears pending deliveries, aborts image downloads and ignores old captures/commands after the stop barrier. Work resumes only after a new explicit command.

Verification:

- Regression tests failed before the fix for orphan capture state, uploads completing after stop, delayed extension dispatch and delayed manual capture.
- 66 Node tests passed; 14 Vitest source tests passed with the existing Node localStorage polyfill.
- TypeScript passed with the pre-existing unused-declaration flags disabled; production build passed.
- Browser image test passed for Stop while enqueue is in flight, rejecting the delayed request, stopping detached capture, preserving completed PNG results, and explicit restart. It runs the actual web, extension and API handler with ChatGPT/DB/Storage fixtures.
- Transcript transport and batch browser tests passed, including global Stop preserving previous written output and suppressing late replies.
- ZIP has one enclosing folder, valid CRCs, manifest 0.4.19 and byte equality with the extension source.

The existing bare npm test configuration still reports Node test files as empty Vitest suites. They all pass under node --test. The affected files are background-delivery.test.mjs, extension-flow.test.mjs, image-capture.test.mjs, image-sync.test.mjs, image-transfer.test.mjs, image-scene-capture.test.mjs, reply-reader.test.mjs, session-flow.test.mjs, stop-all-extension.test.mjs, supabase-edge-api.test.mjs, transcript-bridge.test.mjs and vercel-api-route.test.mjs.

The Edge Function is v18; its JWT setting and database schema are unchanged. The extension requires a one-time update to 4.19 plus reloading both Studio and ChatGPT tabs. Missing acknowledgement is reported instead of claiming ChatGPT has stopped.

Live API v18 verification also passed in an isolated fixture: a normal write on a legacy session without workEpoch, all-stop of image/analysis/capture work, preservation of a completed image reference, rejection of late image/capture/analysis results, rejection of an old enqueue request, and explicit restart followed by another stop. The fixture row was removed afterward. No user's project or authenticated ChatGPT conversation was used.
