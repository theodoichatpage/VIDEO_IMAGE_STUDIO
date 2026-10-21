# Tab 3 Tách ảnh + Local Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Triển khai Tab `3. Tách ảnh` hoạt động thật trên VIDEO IMAGE STUDIO, kết nối trực tiếp từ trình duyệt tới Local Engine Windows chạy SAM2/OpenCV và trả layer PNG/ZIP.

**Architecture:** Web Vercel chỉ làm UI, quản lý nguồn ảnh, job và kết quả. Local Engine bind `127.0.0.1:17841`, nhận ảnh multipart, chạy adapter SAM2 hiện có trong worker, lưu job/layer local và cung cấp API polling/download. Không đưa SAM2 lên Vercel và không thay logic Phân tích/Tạo ảnh.

**Tech Stack:** React 19 + TypeScript + Vite + lucide-react; Python Local Engine + SAM2/PyTorch/OpenCV hiện có; HTTP loopback; pytest cho Local Engine; build TypeScript/Vite cho web.

**Spec:** `docs/superpowers/specs/2026-10-21-local-image-separation-engine-design.md`

## Global Constraints

- Repository: `theodoichatpage/VIDEO_IMAGE_STUDIO`; branch `vercel-migration`.
- Tab order: `1. Phân tích → 2. Tạo ảnh → 3. Tách ảnh → 4. Dựng video → 5. Dự án`; bỏ tab Tiến trình riêng.
- UI giữ phong cách production hiện tại: nền trắng, viền xanh nhạt, nút xanh, Arial; ảnh thiết kế Tab Tách ảnh là chuẩn bố cục.
- Local API base URL cố định `http://127.0.0.1:17841`; không listen LAN/Internet.
- CORS chỉ production origin VIDEO IMAGE STUDIO và localhost development.
- Không API AI/GPU cloud trả phí; CPU phải dùng được, CUDA chỉ là tăng tốc tùy chọn.
- Không thay endpoint/logic Phân tích và Tạo ảnh hiện có.
- Không dùng mock/progress giả trong production.
- Tái sử dụng thuật toán/source SAM2/OpenCV hiện có; không viết lại segmentation từ đầu.

## Review Focus

- Local Engine tắt hoặc khởi động chậm: web vẫn hoạt động, báo offline và cho kiểm tra lại.
- Upload file sai loại/quá lớn/tên file độc hại: Local Engine từ chối an toàn và không dùng path từ browser.
- Reload tab khi job đang chạy: khôi phục `jobId` và tiếp tục polling nếu job còn tồn tại.
- Job hoàn tất nhưng một file layer local đã bị xóa: UI giữ metadata nhưng đánh dấu file không còn thay vì crash.
- Nhiều job liên tiếp: kết quả/job hiện tại không bị lẫn và model SAM2 không reload cho mỗi ảnh.

---

### Task 1: Chốt adapter SAM2 và Local Engine contract

**Files:**
- Create: `vercel-migration/local-engine/app.py`
- Create: `vercel-migration/local-engine/models.py`
- Create: `vercel-migration/local-engine/sam2_adapter.py`
- Create: `vercel-migration/local-engine/requirements.txt`
- Create: `vercel-migration/local-engine/tests/test_health.py`
- Create: `vercel-migration/local-engine/tests/test_validation.py`

**Interfaces:**
- Produces: `GET /v1/health`; `Sam2Adapter.load()`; `Sam2Adapter.separate(input_path, output_dir, options, progress_cb) -> SeparationResult`.
- Consumes: entrypoint/model loading/segmentation/output logic từ source `Tach_Nguoi_Chu_Nen` đã cung cấp; giữ nguyên thuật toán đã chạy được.

- [ ] **Step 1:** Đọc source SAM2 hiện có, ghi mapping entrypoint/model/output vào comment/module docs của `sam2_adapter.py`; không triển khai adapter bằng phỏng đoán nếu source chưa hiện diện trong workspace.
- [ ] **Step 2:** Viết test `test_health_binds_expected_capabilities` và validation cho MIME/kích thước/tên file.
- [ ] **Step 3:** Chạy pytest và xác nhận test fail trước implementation.
- [ ] **Step 4:** Implement health, cấu hình loopback/CORS/validation và adapter interface tối thiểu; model được cache sau lần load đầu.
- [ ] **Step 5:** Chạy pytest, xác nhận PASS; kiểm tra process chỉ bind `127.0.0.1:17841`.
- [ ] **Step 6:** Commit `feat: scaffold local separation engine`.

### Task 2: Job API + SAM2 processing + layer/ZIP output

**Files:**
- Create: `vercel-migration/local-engine/jobs.py`
- Create: `vercel-migration/local-engine/storage.py`
- Create: `vercel-migration/local-engine/tests/test_jobs.py`
- Create: `vercel-migration/local-engine/tests/test_files.py`
- Modify: `vercel-migration/local-engine/app.py`
- Modify: `vercel-migration/local-engine/sam2_adapter.py`

**Interfaces:**
- Produces: `POST /v1/separate`; `GET /v1/jobs/{jobId}`; `GET /v1/jobs/{jobId}/result`; `GET /v1/jobs/{jobId}/files/{fileId}`; ZIP download for current job.
- Job state: `queued | processing | complete | error`, progress `0..100` sourced from actual processing milestones.

- [ ] **Step 1:** Viết tests cho job lifecycle, progress monotonic, lỗi SAM2, file isolation giữa jobs, file missing và ZIP chỉ chứa output của job hiện tại.
- [ ] **Step 2:** Chạy tests và xác nhận FAIL.
- [ ] **Step 3:** Implement job store/worker/storage với UUID server-generated, safe filenames và per-job directories.
- [ ] **Step 4:** Nối `Sam2Adapter.separate()` thật; map output thành `background/person/text/other` theo metadata/source thực tế, không bịa layer không tồn tại.
- [ ] **Step 5:** Implement result/file/ZIP endpoints và lỗi 404/410 phù hợp khi local asset đã mất.
- [ ] **Step 6:** Chạy toàn bộ Local Engine tests; xác nhận PASS.
- [ ] **Step 7:** Commit `feat: process separation jobs with sam2`.

### Task 3: Web Local Engine client + resumable polling

**Files:**
- Create: `vercel-migration/src/localEngine.ts`
- Create: `vercel-migration/src/separationTypes.ts`
- Create: `vercel-migration/tests/local-engine-client.test.ts`

**Interfaces:**
- Produces: `checkLocalEngine()`, `createSeparationJob(file, options)`, `getSeparationJob(jobId)`, `getSeparationResult(jobId)`, `getSeparationFileUrl(jobId, fileId)`, `getSeparationZipUrl(jobId)`.

- [ ] **Step 1:** Viết tests cho health online/offline, request multipart, polling complete/error và URL encoding.
- [ ] **Step 2:** Chạy tests và xác nhận FAIL.
- [ ] **Step 3:** Implement typed client dùng base URL `http://127.0.0.1:17841`, timeout/AbortController và lỗi thân thiện.
- [ ] **Step 4:** Implement persistence của active `jobId` theo session/project để reload có thể tiếp tục poll.
- [ ] **Step 5:** Chạy tests/build và xác nhận PASS.
- [ ] **Step 6:** Commit `feat: add local separation client`.

### Task 4: Tab 3 Tách ảnh UI thật

**Files:**
- Create: `vercel-migration/src/ImageSeparationTab.tsx`
- Create: `vercel-migration/src/imageSeparation.css`
- Modify: `vercel-migration/src/App.tsx`
- Modify: `vercel-migration/src/index.css` only for shared navigation/layout rules when necessary.

**Interfaces:**
- Consumes: Local Engine client from Task 3; generated-image/session data already held by `App.tsx`.
- Produces: functional Tab 3 UI: source picker, preview, options, progress, categorized result cards, layer download, ZIP, retry/reconnect.

- [ ] **Step 1:** Add component-level/state tests where existing test harness permits; at minimum define deterministic state transitions for offline/idle/uploading/processing/complete/error.
- [ ] **Step 2:** Implement nav order exactly `Phân tích, Tạo ảnh, Tách ảnh, Dựng video, Dự án`; remove standalone Tiến trình nav without deleting progress logic used inside other tabs.
- [ ] **Step 3:** Implement layout matching approved light mockup: `Chọn ảnh cần tách`, `Xem ảnh gốc`, `Tùy chọn tách ảnh`, `Tiến trình xử lý`, `Kết quả tách ảnh`.
- [ ] **Step 4:** Wire `Ảnh đã tạo` to actual generated-image data and `Tải lên` to local JPG/PNG/WebP selection; no sample thumbnails in production.
- [ ] **Step 5:** Wire `Bắt đầu tách ảnh` → real upload → polling → progress → result; disable only separation action when engine offline.
- [ ] **Step 6:** Render real result filters `Tất cả lớp/Nền/Người/Chữ`; transparent PNG uses checkerboard; wire `Xem`, `Tải xuống`, `Tải tất cả (ZIP)`.
- [ ] **Step 7:** Implement reconnect/retry and missing-local-file state; restore active job after reload.
- [ ] **Step 8:** Run `npm run build`; confirm Phân tích/Tạo ảnh compile unchanged.
- [ ] **Step 9:** Commit `feat: add functional image separation tab`.

### Task 5: Recomposition check + project metadata

**Files:**
- Create: `vercel-migration/src/separationComposite.ts`
- Modify: `vercel-migration/src/ImageSeparationTab.tsx`
- Modify: project/session persistence code in `vercel-migration/src/App.tsx` only at the established persistence boundary.

**Interfaces:**
- Produces: client-side preview recomposition from returned PNG layers; project metadata reference to separation job/layers without cloud-uploading large layer files.

- [ ] **Step 1:** Viết test cho layer ordering/composite metadata và stale/missing local assets.
- [ ] **Step 2:** Implement `Ghép lại ảnh để kiểm tra` using returned layer dimensions/order; do not alter source files.
- [ ] **Step 3:** Implement `Lưu kết quả vào dự án hiện tại` as metadata only for V1, including job ID, source image identity, layer type/name/file ID and local availability marker.
- [ ] **Step 4:** Run tests/build and confirm PASS.
- [ ] **Step 5:** Commit `feat: save separation results to project`.

### Task 6: Windows one-time install/startup

**Files:**
- Create: `vercel-migration/local-engine/install_windows.bat`
- Create: `vercel-migration/local-engine/start_engine.bat`
- Create: `vercel-migration/local-engine/README.md`
- Create: `vercel-migration/local-engine/.gitignore`

**Interfaces:**
- Produces: one-time local setup, cached model/dependencies, simple background/start workflow; future-compatible location for FFmpeg capability reporting.

- [ ] **Step 1:** Implement installer that creates isolated Python environment, installs pinned requirements and validates SAM2 model availability without downloading on every run.
- [ ] **Step 2:** Implement launcher that starts only loopback server and prevents accidental duplicate instances/port confusion.
- [ ] **Step 3:** Document CPU default and optional CUDA detection; document exact health URL and troubleshooting.
- [ ] **Step 4:** Verify scripts on Windows-compatible command syntax and Local Engine health startup path.
- [ ] **Step 5:** Commit `feat: add windows local engine launcher`.

### Task 7: End-to-end acceptance + regression

**Files:**
- Create/Modify: tests only as required by actual harness; no production mock path.

**Interfaces:**
- Consumes: all prior tasks.
- Produces: evidence that real SAM2 path and existing web features coexist.

- [ ] **Step 1:** Run full Local Engine test suite.
- [ ] **Step 2:** Run web build and available web tests.
- [ ] **Step 3:** Start Local Engine and verify `/v1/health` reports SAM2 capability and loopback binding.
- [ ] **Step 4:** End-to-end with one real image: select/upload → separate → observe non-fake progress → complete → display real PNG layers → download one layer → download ZIP.
- [ ] **Step 5:** Stop Local Engine and verify web remains usable, Tab 3 shows offline, Phân tích/Tạo ảnh are unaffected.
- [ ] **Step 6:** Verify navigation order and no standalone Tiến trình tab.
- [ ] **Step 7:** Verify Vercel production build/deployment for web changes; do not claim READY without deployment evidence.
- [ ] **Step 8:** Commit any test fixes as `test: verify image separation workflow`.
