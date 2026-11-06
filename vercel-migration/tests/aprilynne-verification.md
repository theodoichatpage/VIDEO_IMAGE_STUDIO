# Automatic Aprilynne review verification — 2026-11-06

Target: `phase3-manager-presence`, based on `f5a355760db169969ad92b4e942ef1fa0a5d837a`.
This is the existing branch with the reported manual “Đối chiếu theo Aprilynne” control. The different production branch is not overwritten.

## Behavior
- Completed project Transcript rewrite wakes the mounted analysis controller without a start button or page reload.
- Existing ChatGPT transcript command transport and strict score/evidence parser are retained.
- Failed script criteria queue a repair of their affected sections, then the whole script is re-evaluated. Three automatic rounds maximum.
- Future cover/footage criteria are explicitly unscored, not given invented passing marks. Title matching is unscored when no target title exists. Every applicable script criterion must reach 8.
- The server saves each checkpoint and repaired script, verifies revision/work epoch/update stamp and rejects another active task or overwriting existing split results. Approval requires a complete passing report.
- Studio sends Manager `approved` only after the saved draft and server script match and the draft was transferred. Existing Manager code separately checks that fingerprint before requesting structure analysis.
- Paused/stopped/invalid/error/limited states never become successful receipts. Connection loss or another ChatGPT job waits for availability. Manual row and batch repair remain available.

## Automated checks
- New regression failed first: a passing applicable report originally returned `missing`, requiring a manual handoff.
- New API test failed first: `/analysis-review` returned 404 before implementation.
- All 43 Vitest unit tests pass.
- All 104 Node tests pass (existing analysis, lanes, transcript transport, images, stop, egress and text storage included).
- Ten browser fixture flows pass: successful automatic repair and Manager handoff; actual Transcript batch rewrite into automatic review/repair; disconnected/busy queue and reconnect; three-round exhaustion followed by manual repair; failed save blocks dispatch; invalid report blocks completion; Stop ignores late completion; legacy running/passed/transferred checkpoints require a durable save before continuing. The full successful flow keeps the same page instance.
- `tsc --noEmit --noUnusedLocals false --noUnusedParameters false` passes. Strict unused-symbol checks also flag pre-existing VideoIcon/combinedPrompt/_generatedImages in baseline files; no new type errors remain.
- Vite production build passes (1609 modules).

The browser tests use the real Studio React interface, with ChatGPT and API response fixtures at the external boundaries. API checkpoint logic is tested separately against an in-memory PostgREST fixture. They do not prove a real Windows Chrome/ChatGPT conversation completed. The protected Vercel preview cannot be inspected without an accepted Vercel authentication session; GitHub deployment status and API checks are verified separately.
