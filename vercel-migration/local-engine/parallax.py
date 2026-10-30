"""Tách ảnh thành các lớp chiều sâu (tiền / trung / hậu cảnh) cho hiệu ứng 2.5D Parallax.

Quy trình:
  1. Đo chiều sâu bằng Depth Anything V2 (ảnh đơn, chạy được trên CPU).
  2. Tìm nhân vật/con vật (GroundingDINO + SAM2) để không cắt đôi chủ thể giữa hai lớp.
  3. Chia ảnh thành 3 hoặc 4 dải chiều sâu, dọn các mảnh vụn.
  4. Bù lấp phần bị lớp gần hơn che (LaMa; dự phòng bằng OpenCV) để khi lớp trước trượt đi không lộ lỗ.
  5. Mọi lớp đều full khung, cùng kích thước ảnh gốc, lưu thẳng vào một thư mục.
"""
import io
import json
import os
import re
import zipfile
from pathlib import Path

import numpy as np
from PIL import Image

DEPTH_REPO = 'depth-anything/Depth-Anything-V2-Small-hf'
LAMA_FILE = 'big-lama.pt'
LAMA_URL = 'https://github.com/enesmsahin/simple-lama-inpainting/releases/download/v0.1.0/big-lama.pt'

# (tên file, tiêu đề, loại) — xếp từ xa đến gần
LAYER_SETS = {
    3: [('01_bg', 'Hậu cảnh', 'background'), ('02_mid', 'Trung cảnh', 'midground'), ('03_fg', 'Tiền cảnh', 'foreground')],
    4: [('00_far', 'Toàn cảnh xa', 'far'), ('01_bg', 'Hậu cảnh', 'background'),
        ('02_mid', 'Trung cảnh', 'midground'), ('03_fg', 'Tiền cảnh', 'foreground')],
}
ALL_LAYER_FILES = {f'{name}.png' for layers in LAYER_SETS.values() for name, _, _ in layers}


def default_output_root():
    custom = os.environ.get('VIS_PARALLAX_DIR')
    if custom:
        return Path(custom)
    return Path.home() / 'Pictures' / 'VIDEO_IMAGE_STUDIO' / 'Parallax'


def safe_segment(text, fallback):
    text = re.sub(r'[<>:"/\\|?*\x00-\x1F]+', '_', str(text or '')).strip().strip('.')
    return text[:80] or fallback


# ------------------------------------------------------------------ models
class DepthEstimator:
    def __init__(self, root, device):
        import torch
        from transformers import AutoImageProcessor, AutoModelForDepthEstimation
        cache = str(Path(root) / 'models' / 'huggingface')
        self.torch = torch
        self.device = device
        self.processor = AutoImageProcessor.from_pretrained(DEPTH_REPO, cache_dir=cache)
        self.model = AutoModelForDepthEstimation.from_pretrained(DEPTH_REPO, cache_dir=cache).to(device).eval()

    def predict(self, rgb):
        """Trả về mảng float32 0..1, giá trị lớn = gần ống kính."""
        torch = self.torch
        h, w = rgb.shape[:2]
        inputs = self.processor(images=Image.fromarray(rgb), return_tensors='pt').to(self.device)
        with torch.inference_mode():
            pred = self.model(**inputs).predicted_depth
            pred = torch.nn.functional.interpolate(pred.unsqueeze(1), size=(h, w), mode='bicubic', align_corners=False)
        d = pred[0, 0].float().cpu().numpy()
        lo, hi = np.percentile(d, 1), np.percentile(d, 99)
        return np.clip((d - lo) / max(hi - lo, 1e-6), 0, 1).astype(np.float32)


class LamaInpainter:
    """Big-LaMa (TorchScript). Ảnh lớn được xử lý ở cạnh tối đa 1024px rồi chỉ dán lại vùng cần lấp."""

    def __init__(self, model_path, device):
        import torch
        self.torch = torch
        self.device = device
        self.model = torch.jit.load(str(model_path), map_location=device).eval()

    def __call__(self, rgb, mask):
        import cv2
        torch = self.torch
        h, w = rgb.shape[:2]
        scale = min(1.0, 1024 / max(h, w))
        if scale < 1:
            sw, sh = max(8, round(w * scale)), max(8, round(h * scale))
            img = cv2.resize(rgb, (sw, sh), interpolation=cv2.INTER_AREA)
            msk = cv2.resize(mask.astype(np.uint8) * 255, (sw, sh), interpolation=cv2.INTER_AREA) > 0
        else:
            img, msk = rgb, mask
        ih, iw = img.shape[:2]
        ph, pw = (8 - ih % 8) % 8, (8 - iw % 8) % 8
        img_p = np.pad(img, ((0, ph), (0, pw), (0, 0)), mode='reflect')
        msk_p = np.pad(msk, ((0, ph), (0, pw)), mode='reflect')
        t_img = torch.from_numpy(img_p).permute(2, 0, 1).unsqueeze(0).float().div(255).to(self.device)
        t_msk = torch.from_numpy(msk_p.astype(np.float32)).unsqueeze(0).unsqueeze(0).to(self.device)
        with torch.inference_mode():
            out = self.model(t_img, t_msk)
        out = (out[0].permute(1, 2, 0).cpu().numpy()[:ih, :iw] * 255).clip(0, 255).astype(np.uint8)
        if scale < 1:
            out = cv2.resize(out, (w, h), interpolation=cv2.INTER_CUBIC)
        result = rgb.copy()
        result[mask] = out[mask]
        return result


def opencv_inpaint(rgb, mask):
    import cv2
    holes = mask.astype(np.uint8) * 255
    first = cv2.inpaint(np.ascontiguousarray(rgb), holes, 7, cv2.INPAINT_TELEA)
    result = cv2.inpaint(first, holes, 5, cv2.INPAINT_NS)
    result[~mask] = rgb[~mask]
    return result


class SubjectFinder:
    """Nhận diện người/con vật và lấy đường viền bằng SAM2."""

    def __init__(self, sam_model, root, device, shared=None):
        if shared is not None:  # dùng lại model đã nạp của chế độ tách thành phần
            self.processor, self.detector, self.predictor = shared.processor, shared.detector, shared.predictor
        else:
            from transformers import AutoProcessor, AutoModelForZeroShotObjectDetection
            from sam2.sam2_image_predictor import SAM2ImagePredictor
            cache = str(Path(root) / 'models' / 'huggingface')
            self.processor = AutoProcessor.from_pretrained('IDEA-Research/grounding-dino-tiny', cache_dir=cache)
            self.detector = AutoModelForZeroShotObjectDetection.from_pretrained(
                'IDEA-Research/grounding-dino-tiny', cache_dir=cache).to(device).eval()
            self.predictor = SAM2ImagePredictor(sam_model)
        self.device = device

    def find(self, rgb, max_subjects=6):
        import torch
        h, w = rgb.shape[:2]
        inputs = self.processor(images=Image.fromarray(rgb), text='person. animal.', return_tensors='pt').to(self.device)
        with torch.inference_mode():
            outputs = self.detector(**inputs)
        res = self.processor.post_process_grounded_object_detection(
            outputs, inputs.input_ids, box_threshold=.3, text_threshold=.25, target_sizes=[(h, w)])[0]
        boxes = res['boxes'].detach().cpu().numpy()
        scores = res['scores'].detach().cpu().numpy()
        kept = []
        for i in np.argsort(-scores):
            b = boxes[i]
            if (b[2] - b[0]) * (b[3] - b[1]) < 0.004 * w * h:
                continue
            dup = False
            for c in kept:
                inter = np.prod(np.maximum(0, np.minimum(b[2:], c[2:]) - np.maximum(b[:2], c[:2])))
                union = np.prod(b[2:] - b[:2]) + np.prod(c[2:] - c[:2]) - inter
                if inter / max(union, 1) > .6:
                    dup = True
                    break
            if not dup:
                kept.append(b)
            if len(kept) >= max_subjects:
                break
        masks = []
        if kept:
            with torch.inference_mode():
                self.predictor.set_image(rgb)
                for b in kept:
                    m, q, _ = self.predictor.predict(box=np.asarray(b), multimask_output=True)
                    masks.append(m[int(np.argmax(q))].astype(bool))
        return masks


# ------------------------------------------------------------------ chia lớp
def _kmeans_thresholds(values, k):
    """Ngưỡng chia 1 chiều (k cụm) — trả về k-1 ngưỡng tăng dần."""
    import cv2
    if k <= 1 or values.size < k * 10:
        return np.array([], np.float32)
    samples = values.reshape(-1, 1).astype(np.float32)
    if samples.shape[0] > 200_000:
        samples = samples[np.random.default_rng(0).choice(samples.shape[0], 200_000, replace=False)]
    crit = (cv2.TERM_CRITERIA_EPS + cv2.TERM_CRITERIA_MAX_ITER, 50, 1e-4)
    _, _, centers = cv2.kmeans(samples, k, None, crit, 3, cv2.KMEANS_PP_CENTERS)
    c = np.sort(centers.ravel())
    return ((c[:-1] + c[1:]) / 2).astype(np.float32)


def assign_bands(depth, subject, n):
    """Trả về mảng nhãn 0 (xa nhất) .. n-1 (gần nhất)."""
    bands = np.zeros(depth.shape, np.int32)
    if subject is not None and subject.any():
        ds = depth[subject]
        mid = n - 2  # chủ thể luôn nằm ở lớp ngay sau tiền cảnh
        near_t = min(0.98, float(np.percentile(ds, 95)) + 0.04)
        plane_t = float(np.percentile(ds, 10)) - 0.03
        fg = (depth > near_t) & ~subject
        same_plane = (~subject) & (~fg) & (depth >= plane_t)
        far = ~(subject | fg | same_plane)
        bands[subject | same_plane] = mid
        bands[fg] = n - 1
        if mid >= 1:
            t = _kmeans_thresholds(depth[far], mid)
            bands[far] = np.digitize(depth[far], t) if t.size else 0
        else:
            bands[far] = 0
    else:
        t = _kmeans_thresholds(depth, n)
        bands = np.digitize(depth, t).astype(np.int32) if t.size else bands
    return bands


def clean_bands(bands, n, protect=None):
    """Bỏ mảnh vụn ở các lớp gần (đẩy về lớp xa hơn), lấp lỗ nhỏ bên trong."""
    import cv2
    h, w = bands.shape
    min_area = max(64, int(0.0015 * h * w))
    k = max(3, int(round(min(h, w) / 300)) | 1)
    kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (k, k))
    for b in range(n - 1, 0, -1):
        m = (bands == b).astype(np.uint8)
        m = cv2.morphologyEx(m, cv2.MORPH_OPEN, kernel)
        m = cv2.morphologyEx(m, cv2.MORPH_CLOSE, kernel)
        count, lab, stats, _ = cv2.connectedComponentsWithStats(m, 8)
        keep = np.zeros(count, bool)
        keep[1:] = stats[1:, cv2.CC_STAT_AREA] >= min_area
        m = keep[lab]
        if protect is not None:
            m |= protect & (bands == b)
        lost = (bands == b) & ~m
        bands[lost] = b - 1
        gained = m & (bands < b)
        if protect is not None:
            gained &= ~protect  # không lấn vào chủ thể
        bands[gained] = b
    return bands


def build_layers(rgb, bands, n, inpaint, report):
    """Trả về list RGBA (xa → gần), mỗi lớp full khung."""
    import cv2
    h, w = bands.shape
    ring = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (9, 9))
    ext_r = max(15, int(0.05 * max(h, w))) | 1  # lớp giữa được kéo dài vào vùng bị che ~5% khung
    ext_kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (ext_r, ext_r))
    out = []
    for b in range(n):
        own = bands == b
        if b == n - 1:
            content, alpha = rgb, own
        else:
            nearer = bands > b
            hole = cv2.dilate(nearer.astype(np.uint8), ring) > 0  # nới rộng để xóa viền màu của vật phía trước
            report(55 + int(35 * b / max(n - 1, 1)), f'Đang bù lấp vùng bị che ở lớp {b + 1}/{n}.')
            content = inpaint(rgb, hole) if hole.any() else rgb
            if b == 0:
                alpha = np.ones((h, w), bool)
            else:
                alpha = own | ((cv2.dilate(own.astype(np.uint8), ext_kernel) > 0) & hole)
        a = alpha.astype(np.float32)
        if b > 0:
            a = cv2.GaussianBlur(a, (0, 0), 1.0)
            a[own] = np.maximum(a[own], 0.5)  # giữ trọn pixel của chính lớp
        rgba = np.dstack([content, (a * 255 + 0.5).clip(0, 255).astype(np.uint8)])
        out.append(rgba)
    return out


def composite(layers):
    acc = np.zeros(layers[0].shape[:2] + (3,), np.float32)
    for l in layers:
        a = l[..., 3:4].astype(np.float32) / 255
        acc = l[..., :3].astype(np.float32) * a + acc * (1 - a)
    return (acc + 0.5).clip(0, 255).astype(np.uint8)


def depth_preview(depth, bands, n):
    import cv2
    d8 = (depth * 255).astype(np.uint8)
    color = cv2.applyColorMap(d8, cv2.COLORMAP_INFERNO)[..., ::-1]
    edges = np.zeros(bands.shape, bool)
    edges[:-1] |= bands[:-1] != bands[1:]
    edges[:, :-1] |= bands[:, :-1] != bands[:, 1:]
    edges = cv2.dilate(edges.astype(np.uint8), np.ones((3, 3), np.uint8)) > 0
    color[edges] = (255, 255, 255)
    return color


# ------------------------------------------------------------------ toàn bộ quy trình
def separate_parallax(rgb, *, depth_model, find_subjects, inpaint, n_layers, job_dir, save_dir, report):
    n = 4 if int(n_layers) == 4 else 3
    names = LAYER_SETS[n]
    h, w = rgb.shape[:2]
    warnings = []

    report(10, 'Đang đo chiều sâu của ảnh.')
    depth = depth_model.predict(rgb)
    import cv2
    depth = cv2.bilateralFilter(depth, 9, 0.08, 7)

    report(25, 'Đang tìm nhân vật / chủ thể chính.')
    subject = None
    try:
        masks = [m for m in find_subjects(rgb) if m.any()]
        if masks:
            # chủ thể chính = vùng lớn nhất; vật khác chỉ được tính là chủ thể nếu ở cùng độ sâu
            # (tránh kéo máy bay / chim xa tít trên trời vào trung cảnh)
            main = max(masks, key=lambda m: m.sum())
            main_depth = float(np.median(depth[main]))
            subject = np.zeros((h, w), bool)
            for m in masks:
                if m is main or float(np.median(depth[m])) >= main_depth - 0.15:
                    subject |= m
    except Exception as exc:  # không có chủ thể vẫn tách theo chiều sâu
        warnings.append('Không nhận diện được chủ thể: ' + str(exc))
    if subject is None or not subject.any():
        subject = None
        warnings.append('Không thấy nhân vật/con vật — đã tách thuần theo chiều sâu.')

    report(45, f'Đang chia ảnh thành {n} lớp chiều sâu.')
    bands = assign_bands(depth, subject, n)
    bands = clean_bands(bands, n, protect=subject)
    shares = [float((bands == b).mean()) for b in range(n)]
    if shares[-1] < 0.01:
        warnings.append('Ảnh gần như không có tiền cảnh — lớp tiền cảnh sẽ trống. '
                        'Tạo ảnh có vật thể ở sát ống kính (cành lá, đá, khung cửa…) để hiệu ứng rõ hơn.')

    layers = build_layers(rgb, bands, n, inpaint, report)

    report(93, 'Đang lưu các lớp vào thư mục.')
    check = composite(layers)
    diff = float(np.abs(check.astype(np.int16) - rgb.astype(np.int16)).mean())
    info = []
    files = {}
    for (name, title, kind), rgba, share in zip(names, layers, shares):
        buf = io.BytesIO()
        Image.fromarray(rgba).save(buf, format='PNG', compress_level=3)
        files[f'{name}.png'] = buf.getvalue()
        info.append(dict(id=len(info), title=title, file=f'{name}.png', type=kind, x=0, y=0, width=w, height=h,
                         pixels=int(share * w * h)))
    extras = {}
    for fname, arr in [('anh_goc.png', rgb), ('ghep_lai.png', check), ('do_sau.png', depth_preview(depth, bands, n))]:
        buf = io.BytesIO()
        Image.fromarray(arr).save(buf, format='PNG', compress_level=3)
        extras[fname] = buf.getvalue()
    meta = dict(mode='parallax', width=w, height=h, layer_count=n, mean_reconstruction_error=round(diff, 3),
                layers=info, order='xa_den_gan')
    meta_bytes = json.dumps(meta, ensure_ascii=False, indent=2).encode('utf-8')

    # 1) thư mục của job (để giao diện web xem / tải)
    job_dir = Path(job_dir)
    job_dir.mkdir(parents=True, exist_ok=True)
    zbuf = io.BytesIO()
    with zipfile.ZipFile(zbuf, 'w', zipfile.ZIP_DEFLATED) as z:
        for fname, data in {**files, **extras}.items():
            (job_dir / fname).write_bytes(data)
            z.writestr(fname if fname in files else '_kiem_tra/' + fname, data)
        z.writestr('vi_tri.json', meta_bytes)
    (job_dir / 'vi_tri.json').write_bytes(meta_bytes)
    (job_dir / 'cac_lop.zip').write_bytes(zbuf.getvalue())

    # 2) thư mục cố định trên máy — mỗi ảnh 1 thư mục, dùng thẳng cho Parallax25D
    saved = None
    if save_dir:
        try:
            save_dir = Path(save_dir)
            (save_dir / '_kiem_tra').mkdir(parents=True, exist_ok=True)
            for old in ALL_LAYER_FILES:  # tách lại 3 lớp sau khi từng tách 4 lớp: xoá lớp cũ
                p = save_dir / old
                if p.exists():
                    p.unlink()
            for fname, data in files.items():
                (save_dir / fname).write_bytes(data)
            for fname, data in extras.items():
                (save_dir / '_kiem_tra' / fname).write_bytes(data)
            (save_dir / 'vi_tri.json').write_bytes(meta_bytes)
            saved = str(save_dir)
        except OSError as exc:
            warnings.append('Không lưu được vào thư mục: ' + str(exc))

    return {'mode': 'parallax', 'layers': info, 'exact': diff < 2.0, 'background_filled': True,
            'warning': ' '.join(warnings) or None, 'width': w, 'height': h, 'saved_dir': saved,
            'layer_count': n}
