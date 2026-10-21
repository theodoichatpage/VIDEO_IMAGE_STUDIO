# Get Transcript Workspace — Design Specification

Date: 2026-10-21
Status: Approved in chat; pending written-spec review

## Goal

Redesign the existing Get Transcript tab in VIDEO IMAGE STUDIO into a complete YouTube-to-script workspace matching the supplied reference layout while keeping the current ChatGPT Bridge and project flow.

The workspace must retrieve a YouTube transcript, structure it into a mindmap, split it into script sections, rewrite each section using the user's saved personal style prompt, combine the rewritten sections, and transfer the final script to the existing Analysis tab.

## Product naming

Use shorter, clearer labels in Settings:

- `VIDEO IMAGE STUDIO Local Engine` → `Tách ảnh Image Studio`
- `YouTube Transcript Engine` → `Lấy thoại Youtube Transcripts`
- Remove the separate `Kiểm tra kết nối` button for the transcript engine. Connection status remains automatic.

The main product brand remains `VIDEO IMAGE STUDIO` unless explicitly changed later.

## Workspace layout

The Get Transcript page follows the supplied five-region layout.

### 1. Link YouTube

Top horizontal toolbar containing:

- YouTube URL field.
- Language selector.
- `Tùy chọn` button.
- Primary `Lấy Transcript` action.

Transcript retrieval prefers the local YouTube Transcript Engine and may fall back to the existing Vercel endpoint while migration remains in progress.

### 2. Transcript

Full-width transcript panel below the URL toolbar.

Show:

- retrieval success/error state;
- video duration when metadata is available;
- character count;
- estimated processing minutes where useful;
- timestamped transcript text;
- `Xem video`;
- `Sao chép`;
- `Tải xuống (.txt)`.

Transcript remains the source of truth for mindmap generation.

### 3. Mindmap nội dung

Large left panel.

Actions:

- `Tạo mindmap`;
- `Tạo lại`;
- `Xem toàn màn hình`.

The mindmap is generated through the existing ChatGPT Bridge, not a new AI backend.

The model receives the transcript and must return structured JSON representing the central topic and ordered content branches. Each top-level branch corresponds to exactly one script section in panel 4.

Mindmap nodes are selectable. Selecting a top-level node selects the corresponding script section.

### 4. Các phần kịch bản (từ mindmap)

Right panel showing sections derived directly from the mindmap.

Columns:

- order;
- section name;
- content summary;
- character count;
- processing status;
- action.

Statuses:

- `Chờ xử lý`;
- `Đang xử lý`;
- `Đã xử lý`;
- `Lỗi`;
- `Đã dừng`.

A section stores the transcript range/content associated with that mindmap branch. The frontend must not independently re-split the transcript after the mindmap has defined these sections.

### 5. Prompt phong cách & Viết lại kịch bản

Bottom full-width workspace with two areas.

Left side: personal style prompt editor. It stores reusable preferences such as tone, pronouns, pacing, humor, vocabulary habits, narrative habits, desired detail, and things to avoid. Provide `Lưu phong cách`.

Right side: processing controls and rewritten output.

Provide one action per script section plus:

- `Viết lại toàn bộ (từng phần)`;
- `Dừng xử lý`;
- rewritten-script result area;
- `Sao chép`;
- `Tải xuống (.txt)`;
- `Xem toàn màn hình`;
- `Hoàn tất & Đưa kịch bản sang Phân tích`.

## AI processing architecture

Reuse the current ChatGPT connection/Bridge already used by VIDEO IMAGE STUDIO.

Do not add a second AI provider or paid API.

### Mindmap request

Input:

- full transcript;
- language/context metadata where available.

Output must be strict structured JSON with ordered branches. Each branch contains at minimum:

- stable ID;
- title;
- summary;
- transcript content/range;
- optional child nodes.

### Rewrite request

Each request processes one section only.

Input:

- saved personal style prompt;
- current section content;
- section title and summary;
- minimal neighboring context needed to preserve continuity;
- explicit instruction not to duplicate content already assigned to another section.

Output is the rewritten text for that section.

`Viết lại toàn bộ` means queue all sections sequentially; it must not send the whole long script in one rewrite prompt.

This keeps prompts manageable and exposes progress to the user.

## State and persistence

Persist workspace state per current project so changing tabs or refreshing does not unnecessarily lose work.

Persist at minimum:

- YouTube URL;
- selected language;
- retrieved transcript;
- mindmap JSON;
- generated script sections;
- per-section processing state;
- per-section rewritten text;
- saved style prompt;
- assembled rewritten script.

The personal style prompt should be reusable across projects, while transcript/mindmap/rewrite state is project-specific.

## Transfer to Analysis

`Hoàn tất & Đưa kịch bản sang Phân tích` assembles rewritten sections in their original mindmap order and writes the final text into the existing project script/session storage used by Analysis.

Then switch to the Analysis tab using the current navigation/session mechanism.

Do not alter the Analysis parsing workflow itself as part of this feature.

## Error handling

- Transcript Engine offline: show a clear local-engine message and preserve the URL/input.
- YouTube/IP blocked: display the specific engine error instead of claiming no transcript exists.
- Mindmap malformed JSON: mark generation as failed and allow `Tạo lại`; never replace a valid previous mindmap until a new response validates.
- Rewrite failure: fail only the affected section and allow retry.
- Stop: stop queueing new sections; retain all completed outputs.
- Refresh/navigation: restore persisted workspace state.

## Visual requirements

Follow the supplied reference composition closely:

- white background;
- light-blue borders;
- blue primary controls;
- Arial;
- compact desktop layout;
- numbered conceptual regions are layout guidance and do not need permanent red annotation overlays;
- mindmap and section table displayed side-by-side;
- bottom rewrite workspace spans the page width.

The UI must remain functional, not a mockup.

## Scope protection

Do not break or redesign:

- Analysis;
- Image generation;
- Image separation;
- Projects;
- existing ChatGPT connection behavior;
- existing image Local Engine.

## Verification

Implementation must verify:

1. production build completes;
2. existing tabs still compile and render;
3. Transcript Engine connection state is automatic;
4. mindmap response validation rejects malformed data;
5. mindmap branches and script sections remain one-to-one and ordered;
6. rewrite queue processes sections independently and can stop/retry;
7. assembled output preserves section order;
8. transfer to Analysis populates the current project script;
9. Settings shows `Tách ảnh Image Studio` and `Lấy thoại Youtube Transcripts` and no transcript `Kiểm tra kết nối` button.
