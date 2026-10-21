# Get Transcript Workspace Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the current simple Get Transcript tab with the approved five-region YouTube-to-rewritten-script workspace and simplify Local Engine labels in Settings.

**Architecture:** Keep transcript extraction and the existing ChatGPT Bridge as separate providers. The Get Transcript workspace owns project-scoped transcript/mindmap/section/rewrite state; mindmap branches define rewrite sections one-to-one; rewriting runs one section at a time through the existing ChatGPT bridge and final text is transferred through the existing project/session mechanism into Analysis.

**Tech Stack:** React 19, TypeScript, Vite, existing ChatGPT Bridge, existing local transcript engine/fallback endpoint, localStorage project persistence, CSS/Arial.

**Spec:** `vercel-migration/docs/superpowers/specs/2026-10-21-get-transcript-workspace-design.md`

## Global Constraints

- Work on branch `vercel-migration`.
- Keep the existing ChatGPT connection/Bridge; do not add a paid or second AI provider.
- Do not break Analysis, Image generation, Image separation, Projects, or the image Local Engine.
- Keep white/light-blue/blue VIDEO IMAGE STUDIO styling and Arial.
- Transcript engine status is automatic; no separate `Kiểm tra kết nối` button.
- Settings labels must be exactly `Tách ảnh Image Studio` and `Lấy thoại Youtube Transcripts`.
- Rewrite-all queues sections individually; never send the complete long script in one rewrite request.

## Review Focus

- Refresh/navigation during a partially rewritten project must restore completed sections and statuses safely.
- Malformed ChatGPT mindmap JSON must not overwrite the last valid mindmap.
- Duplicate or missing branch IDs must be rejected before script sections are created.
- Stopping rewrite-all must preserve completed outputs and must not start another section.
- Transfer to Analysis must preserve mindmap section order and update the current project, not another cached project.

---

### Task 1: Workspace domain model and persistence

**Files:**
- Create: `vercel-migration/src/transcriptWorkspace.ts`
- Create: `vercel-migration/src/transcriptWorkspace.test.ts`

**Interfaces:**
- Produces `MindmapBranch`, `ScriptSection`, `TranscriptWorkspaceState`.
- Produces `workspaceStorageKey(projectId: string): string`.
- Produces `loadTranscriptWorkspace(projectId: string): TranscriptWorkspaceState` and `saveTranscriptWorkspace(projectId: string, state: TranscriptWorkspaceState): void`.
- Produces `validateMindmapPayload(value: unknown): MindmapBranch[]`.
- Produces `assembleRewrittenScript(sections: ScriptSection[]): string`.

- [ ] Write failing tests for empty/default state, project isolation, valid ordered branches, malformed JSON shape, duplicate/missing IDs, persisted partial rewrite state, and ordered final assembly.
- [ ] Run the focused test and confirm failure before implementation.
- [ ] Implement the minimal typed state/persistence/validation helpers.
- [ ] Run focused tests and confirm pass.
- [ ] Commit domain model and persistence.

### Task 2: Transcript provider adapter and result normalization

**Files:**
- Create: `vercel-migration/src/transcriptProvider.ts`
- Create: `vercel-migration/src/transcriptProvider.test.ts`
- Modify: `vercel-migration/src/TranscriptTab.tsx`

**Interfaces:**
- Produces `fetchTranscript(input: {url: string; language?: string}): Promise<NormalizedTranscript>`.
- `NormalizedTranscript` exposes video ID, title/thumbnail when available, language/source, segments, full text, and optional duration.
- Local engine is attempted first; existing `/api/transcript` remains temporary fallback.

- [ ] Write failing tests proving local-first behavior, fallback behavior, normalized camelCase fields, and distinct offline/IP-block errors.
- [ ] Run focused tests and confirm failure.
- [ ] Implement provider adapter and replace inline transcript fetch in `TranscriptTab.tsx`.
- [ ] Run focused tests and confirm pass.
- [ ] Commit transcript adapter.

### Task 3: Mindmap generation through existing ChatGPT Bridge

**Files:**
- Create: `vercel-migration/src/transcriptAi.ts`
- Create: `vercel-migration/src/transcriptAi.test.ts`
- Modify: `vercel-migration/src/TranscriptTab.tsx`

**Interfaces:**
- Produces `buildMindmapPrompt(transcript: string, language?: string): string`.
- Produces `requestMindmap(...)` using the existing bridge request path/pattern already present in the application.
- Consumes `validateMindmapPayload` from Task 1.

- [ ] Write failing tests for strict JSON prompt contract, transcript inclusion, branch ordering, invalid response rejection, and preservation of prior valid state after invalid regeneration.
- [ ] Run focused tests and confirm failure.
- [ ] Implement prompt/bridge adapter without adding a new AI provider.
- [ ] Wire `Tạo mindmap` and `Tạo lại` into workspace state.
- [ ] Run focused tests and confirm pass.
- [ ] Commit mindmap generation.

### Task 4: Rewrite queue through existing ChatGPT Bridge

**Files:**
- Modify: `vercel-migration/src/transcriptAi.ts`
- Modify: `vercel-migration/src/transcriptAi.test.ts`
- Create: `vercel-migration/src/rewriteQueue.ts`
- Create: `vercel-migration/src/rewriteQueue.test.ts`

**Interfaces:**
- Produces `buildRewritePrompt(section, stylePrompt, context): string`.
- Produces a queue controller that processes one `ScriptSection` at a time and supports start, retry, and stop.
- Status values are `waiting | processing | done | error | stopped` internally and mapped to Vietnamese UI labels.

- [ ] Write failing tests for one-section prompt scope, style prompt inclusion, sequential processing, stop-before-next-section, retry-only-failed-section, and preservation of completed outputs.
- [ ] Run focused tests and confirm failure.
- [ ] Implement minimal rewrite prompt and queue controller.
- [ ] Run focused tests and confirm pass.
- [ ] Commit rewrite queue.

### Task 5: Five-region Get Transcript UI

**Files:**
- Replace/expand: `vercel-migration/src/TranscriptTab.tsx`
- Replace/expand: `vercel-migration/src/transcriptTab.css`
- Create: `vercel-migration/src/MindmapView.tsx`

**Interfaces:**
- Consumes Tasks 1–4.
- Keeps existing `onUseTranscript(text, title?)` transfer callback unless the current App integration requires a compatible extension.

- [ ] Add component-level/state tests where the current test harness supports them; otherwise add pure view-model tests for region state and action enablement.
- [ ] Implement region 1 URL/language/options/transcript action matching reference layout.
- [ ] Implement region 2 transcript status, text, copy/download/video actions.
- [ ] Implement region 3 selectable mindmap with create/regenerate/fullscreen actions.
- [ ] Implement region 4 ordered script-section table with status/action controls synchronized one-to-one with mindmap branches.
- [ ] Implement region 5 style prompt, per-section controls, rewrite-all/stop, result, copy/download/fullscreen, and final transfer action.
- [ ] Persist project workspace after meaningful state changes and restore it on mount.
- [ ] Verify responsive desktop layout does not overlap at the current production width.
- [ ] Commit workspace UI.

### Task 6: Settings naming cleanup

**Files:**
- Modify: `vercel-migration/scripts/apply_transcript_engine_settings.mjs`
- Modify generated/current settings markup in `vercel-migration/src/App.tsx` only if required by the migration mechanism.

**Interfaces:**
- Existing automatic engine health check remains unchanged.

- [ ] Add/extend migration verification assertions for exact labels and absence of transcript `Kiểm tra kết nối` button.
- [ ] Change image engine label to `Tách ảnh Image Studio`.
- [ ] Change transcript engine label to `Lấy thoại Youtube Transcripts`.
- [ ] Remove only the transcript manual connection-check button; retain automatic status.
- [ ] Run migration twice to verify idempotence.
- [ ] Commit settings cleanup.

### Task 7: Analysis handoff and full regression verification

**Files:**
- Modify: `vercel-migration/src/App.tsx` only where necessary for the final handoff.
- Modify/add focused tests or verification scripts under `vercel-migration/src/` or `vercel-migration/scripts/` as appropriate.

**Interfaces:**
- Final action assembles rewritten sections in mindmap order and writes through the current project/session storage path before navigating to Analysis.

- [ ] Write a failing handoff test proving ordered rewritten text targets the active project and does not overwrite another project cache.
- [ ] Implement the minimal handoff integration.
- [ ] Run focused tests.
- [ ] Run all available tests.
- [ ] Run `npm run build` and require exit code 0.
- [ ] Run existing live/static verification scripts that do not mutate production.
- [ ] Inspect final diff for accidental changes to Analysis/Image/Image Separation/Projects.
- [ ] Commit final integration and verification fixes.

## Completion Evidence Required

Do not claim production completion from source changes alone. Report separately:

- source implementation commit(s);
- automated test result;
- local/CI build result;
- Vercel deployment status only if independently verified READY;
- real transcript + mindmap + rewrite smoke test status only if actually exercised end-to-end.
