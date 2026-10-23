# Chunked Long-Script Analysis — Design Specification

Date: 2026-10-23
Status: Approved conversational design; pending written-spec review

## Goal

Prevent long scripts/transcripts from freezing the ChatGPT conversation or leaving VIDEO IMAGE STUDIO out of sync. Replace the current single huge structure-analysis request with a resumable chunked pipeline that sends smaller requests, stores progress after every successful chunk, and asks ChatGPT to return only short structural metadata instead of repeating the full script in JSON.

This mechanism applies to both:

1. Get Transcript → content-flow/script-part generation.
2. Analysis → initial script splitting before detailed scene analysis.

Detailed scene analysis remains downstream and continues to operate on the smaller generated script parts.

## Problem being solved

The current flow can send a script around 39,000+ characters to ChatGPT in one request and ask for a JSON response containing titles, ranges and large copied `content` fields. This creates very large model output, increases incomplete/invalid JSON risk, keeps the browser bridge waiting for a long time, and can leave the web app unable to reconcile the result.

The new design must avoid requiring ChatGPT to echo the original script.

## Architecture

Pipeline:

`Original script → local semantic-safe chunking → sequential ChatGPT chunk analysis → persisted short metadata → boundary reconciliation → local extraction from original script → final script parts → downstream processing`

The original script remains the source of truth throughout the process.

## 1. Local preliminary chunking

Chunking happens in the web application before ChatGPT is called.

Target chunk size:

- preferred: 6,000–10,000 characters;
- never split in the middle of a word;
- prefer paragraph boundaries;
- otherwise prefer sentence-ending punctuation;
- preserve exact source offsets for every chunk.

Each chunk records:

- `chunkId`;
- `index`;
- `startOffset`;
- `endOffset`;
- exact source text;
- processing status;
- attempts;
- returned metadata/error.

Chunking is deterministic for the same script and settings so a reload can resume safely.

## 2. Per-chunk ChatGPT analysis

Chunks are sent sequentially through the existing ChatGPT Bridge. Do not add a second AI provider.

Each request contains only:

- current chunk text;
- its absolute start/end offsets;
- a short summary/tail context from the previous completed chunk when needed for continuity;
- strict JSON response instructions.

ChatGPT must NOT return the original content.

Expected response shape:

```json
{
  "flows": [
    {
      "id": "c2-f1",
      "title": "Tên luồng nội dung",
      "summary": "Tóm tắt ngắn",
      "start": 8120,
      "end": 11350,
      "continuesFromPrevious": false,
      "continuesToNext": true
    }
  ]
}
```

`start` and `end` are absolute character offsets in the original script, not offsets inside the response.

Response validation rejects:

- malformed JSON;
- missing IDs/titles;
- offsets outside the current chunk bounds except an explicitly allowed boundary overlap;
- `end <= start`;
- duplicate IDs;
- unexpectedly large copied content fields.

A failed response does not erase prior successful chunks.

## 3. Progress persistence and recovery

Persist analysis state per project immediately after every chunk result.

States:

- `waiting`;
- `processing`;
- `done`;
- `error`;
- `stopped`.

The UI must expose progress such as:

- `Đang chia kịch bản 1/5`;
- `Đang phân tích 2/5`;
- `Đang ghép luồng`;
- `Hoàn tất`.

On reload/navigation, restore completed chunks and continue from the first unfinished chunk instead of restarting the entire script.

`Dừng phân tích` stops scheduling the next chunk. Completed chunk results remain stored.

A failed chunk can be retried independently.

## 4. Boundary reconciliation

After all chunks have valid metadata, do not send the full script back to ChatGPT.

The web application first performs deterministic local merging using:

- `continuesFromPrevious` / `continuesToNext`;
- adjacent offsets;
- matching/compatible flow titles.

If boundaries remain ambiguous, send ChatGPT one small reconciliation request containing only the short metadata for adjacent boundary candidates, never the full script.

The reconciliation response returns only merge decisions and corrected offsets.

## 5. Local final-part extraction

After boundaries are reconciled, the web application creates final script parts by slicing the original script with the final `start`/`end` offsets.

ChatGPT never needs to echo the final `content` field.

Each final part contains:

- stable ID;
- title;
- summary;
- start/end offsets;
- exact original content extracted locally;
- character count;
- downstream processing status.

Parts must cover the source in original order without unintended gaps or duplicated ranges. If coverage validation fails, do not mark the split complete.

## 6. Get Transcript integration

Mindmap is removed from the mandatory processing path.

Primary path becomes:

`YouTube → Transcript → Phân tích luồng nội dung → Các phần kịch bản → Prompt phong cách & viết lại → Kịch bản cuối cùng`

The existing visual mindmap may be removed or retained later as an optional visualization generated from already-created short metadata. It must not block script processing.

For the current implementation, prioritize the fast content-flow list and script-part table over mindmap generation.

## 7. Analysis-tab integration

Replace the current one-shot `Phân tích & chia kịch bản` structure request with the same chunked analyzer.

The Analysis tab should show chunk progress instead of a single indefinite `ChatGPT đang phân tích cấu trúc` state.

After final parts exist, the existing detailed scene-analysis workflow continues per part. This design does not redesign detailed scene generation.

## 8. ChatGPT Bridge behavior

Use the existing extension/bridge connection.

Requirements:

- only one chunk-analysis request active at a time;
- correlate every response with project ID, analysis run ID and chunk ID;
- ignore stale responses from a stopped/replaced run;
- schedule the next chunk only after the current response validates and is persisted;
- timeout/error must put only that chunk into error state;
- no automatic duplicate resend while a request is still active.

This prevents multiple ChatGPT tabs/responses from racing and overwriting web state.

## 9. Run identity and stale-result protection

Every analysis start creates an `analysisRunId` derived/generated for that run.

All bridge commands/results carry:

- project ID;
- analysisRunId;
- chunk ID;
- request kind.

When the user stops, restarts, changes the source script, or starts a new split, the old run is invalidated. Late ChatGPT responses from the old run must be ignored.

## 10. Source-change protection

Store a lightweight source fingerprint with chunk state.

If the script/transcript changes after chunking begins:

- do not apply old offsets to the new text;
- invalidate the old split run;
- preserve it only as historical/recoverable state if useful;
- require a new chunk analysis for the modified source.

## 11. UI changes

### Get Transcript

Replace mandatory Mindmap processing controls with a compact `Phân tích luồng nội dung` area showing:

- number of local chunks;
- current chunk `x/y`;
- status per chunk;
- retry for failed chunk;
- stop/resume;
- final list/table of semantic script parts.

The rewrite-by-part area remains and consumes the final parts.

### Analysis

The initial structure-analysis area shows:

- `Đang chia kịch bản`;
- chunk progress;
- current state;
- `Dừng phân tích`;
- retry/resume where relevant.

Once final parts are ready, render them in the existing parts UI and enable downstream detailed scene analysis.

## 12. Performance limits

- Default target: about 8,000 characters per chunk within the 6,000–10,000 range.
- Process sequentially by default for ChatGPT Bridge stability.
- Do not parallelize multiple browser ChatGPT prompts.
- Keep per-chunk model response intentionally short.
- Do not include original full script in reconciliation requests.
- Do not include full prior chunk text as continuity context; use short summary/tail only.

## 13. Error handling

### Invalid JSON

Mark only current chunk `error`; retain raw response diagnostic; allow retry.

### ChatGPT conversation busy/unresponsive

Do not queue additional chunks. Keep current progress persisted and expose Resume/Retry.

### Extension disconnect

Pause queue without losing completed results. Resume after bridge reconnects.

### Coverage failure

Do not create final parts until ranges cover the intended script correctly and monotonically. Surface which boundary needs correction.

### User stop

Stop before the next request, retain completed results, and mark untouched chunks stopped/waiting in a resumable form.

## 14. Compatibility

Do not break:

- project/session storage semantics;
- existing ChatGPT connection UI;
- detailed scene analysis after script parts exist;
- Image generation;
- Image separation;
- Projects;
- Local Transcript Engine;
- image Local Engine.

If bridge protocol changes are required, keep backward compatibility with currently supported extension versions where practical or publish/update the extension and installer together.

## 15. Verification requirements

Implementation is not complete until evidence confirms:

1. deterministic local chunking respects paragraph/sentence boundaries and source offsets;
2. a ~39,000-character script is divided into several bounded requests rather than one giant request;
3. ChatGPT chunk responses contain metadata only, not copied full content;
4. invalid JSON fails only one chunk;
5. refresh restores completed progress;
6. stop prevents the next chunk from being sent;
7. stale responses from an old run are ignored;
8. final parts are extracted from the original source and preserve order/coverage;
9. Get Transcript can create parts without mandatory Mindmap generation;
10. Analysis uses the chunked split before detailed scene analysis;
11. existing downstream tabs still build and operate;
12. production build exits successfully;
13. Vercel READY is reported only if independently verified.
