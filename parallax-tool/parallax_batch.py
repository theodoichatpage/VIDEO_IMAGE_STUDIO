"""Parallax 2.5D - tạo video giả 3D hàng loạt từ 3-4 lớp ảnh (toàn cảnh xa / hậu / trung / tiền cảnh)."""
import math
import multiprocessing as mp
import os
import random
import re
import sys
import threading
import traceback
from concurrent.futures import ProcessPoolExecutor, as_completed

from PIL import Image, ImageFilter

IMG_EXT = {".png", ".jpg", ".jpeg", ".webp", ".bmp"}
LAYER_KEYS = ("far", "bg", "mid", "fg")  # xa -> gần

MOTIONS = {
    "Lia sang phải": "right",
    "Lia sang trái": "left",
    "Lia lên": "up",
    "Lia xuống": "down",
    "Đẩy vào (zoom in)": "zoomin",
    "Kéo ra (zoom out)": "zoomout",
    "Đẩy vào + lia phải": "dolly",
    "Ngẫu nhiên mỗi cảnh": "random",
}
RANDOM_POOL = ["right", "left", "up", "down", "zoomin", "zoomout", "dolly"]
RESOLUTIONS = {
    "1920x1080 (ngang)": (1920, 1080),
    "1080x1920 (dọc)": (1080, 1920),
    "1080x1080 (vuông)": (1080, 1080),
    "1280x720": (1280, 720),
    "3840x2160 (4K)": (3840, 2160),
}


# ---------------------------------------------------------------- tìm cảnh
def layer_key(name):
    n = os.path.splitext(name)[0].lower()
    tokens = re.split(r"[^a-z0-9]+", n)
    if any(t in ("far", "sky", "troi", "xa", "toancanh") for t in tokens) or "toan_canh" in n:
        return "far"
    if any(t in ("bg", "back", "background", "hau", "hauc", "haucanh") for t in tokens) or "hau_canh" in n or "background" in n:
        return "bg"
    if any(t in ("fg", "front", "foreground", "tien", "tiencanh") for t in tokens) or "tien_canh" in n or "foreground" in n:
        return "fg"
    if any(t in ("mid", "middle", "midground", "trung", "trungcanh", "char", "nhanvat") for t in tokens) or "trung_canh" in n or "midground" in n:
        return "mid"
    return None


def base_name(name):
    b = os.path.splitext(name)[0]
    b = re.sub(r"^\d+[_\-\s.]*", "", b)  # "01_bg" -> "bg" (số thứ tự lớp do Local Engine đặt)
    b = re.sub(r"[_\-\s.]*(far|sky|bg|background|back|mid|middle|midground|fg|foreground|front|"
               r"hau[_\s-]?canh|trung[_\s-]?canh|tien[_\s-]?canh|hau|trung|tien|layer[_\s-]?\d|[123])$",
               "", b, flags=re.I)
    return b.strip() or "canh"


def natural_key(s):
    return [int(t) if t.isdigit() else t.lower() for t in re.split(r"(\d+)", s)]


def group_files(files, fallback_name):
    """files: list đường dẫn ảnh -> list (tên cảnh, {bg,mid,fg})."""
    files = sorted(files, key=lambda p: natural_key(os.path.basename(p)))
    if not files:
        return []
    names = [os.path.basename(f) for f in files]
    if all(layer_key(n) for n in names):
        groups = {}
        for f, n in zip(files, names):
            groups.setdefault(base_name(n), {})[layer_key(n)] = f
        if len(groups) == 1:
            return [(fallback_name or next(iter(groups)), next(iter(groups.values())))]
        return list(groups.items())
    out = []
    for i in range(0, len(files), 3):
        chunk = files[i:i + 3]
        d = dict(zip(("bg", "mid", "fg"), chunk))  # không có tên lớp: 3 ảnh = hậu, trung, tiền
        name = fallback_name if (fallback_name and len(files) <= 3) else base_name(os.path.basename(chunk[0]))
        out.append((name, d))
    return out


def find_scenes(folder):
    """Quét cả thư mục con nhiều cấp: mỗi thư mục có ảnh = 1 cảnh (hoặc nhiều cảnh nếu ảnh để chung).
    Bỏ qua thư mục bắt đầu bằng '_' hoặc '.' (vd: _kiem_tra do Local Engine tạo)."""
    scenes = []
    for cur, dirs, files in os.walk(folder):
        dirs[:] = sorted((d for d in dirs if not d.startswith(("_", "."))), key=natural_key)
        imgs = [os.path.join(cur, f) for f in files if os.path.splitext(f)[1].lower() in IMG_EXT]
        if not imgs:
            continue
        rel = os.path.relpath(cur, folder)
        # chọn thẳng 1 thư mục cảnh -> lấy tên thư mục đó làm tên video
        name = os.path.basename(os.path.normpath(folder)) if rel == "." else rel.replace(os.sep, "/")
        scenes += group_files(imgs, name)
    # tên trùng -> thêm số
    seen = {}
    result = []
    for name, d in scenes:
        k = name
        if k in seen:
            seen[k] += 1
            k = f"{name}_{seen[name]}"
        else:
            seen[k] = 1
        result.append((k, d))
    return result


# ---------------------------------------------------------------- render
def ease(t, on):
    return (1 - math.cos(math.pi * t)) / 2 if on else t


def layer_params(motion, p, A, k, W, H):
    """Trả về (hệ số phóng so với 'cover', dx, dy)."""
    if motion in ("left", "right", "up", "down"):
        s = 1 + A * k
        horiz = motion in ("left", "right")
        travel = A * k * (W if horiz else H)
        d = -1 if motion in ("right", "down") else 1
        off = d * (p - 0.5) * travel
        return s, (off if horiz else 0.0), (0.0 if horiz else off)
    if motion == "zoomin":
        return 1 + A * k * p, 0.0, 0.0
    if motion == "zoomout":
        return 1 + A * k * (1 - p), 0.0, 0.0
    if motion == "dolly":
        return 1 + A * k * (0.5 + p), -(p - 0.5) * A * k * W * 0.5, 0.0
    return 1.0, 0.0, 0.0


def max_factor(motion, A, k):
    if motion == "dolly":
        return 1 + A * k * 1.5
    return 1 + A * k


def prepare_layer(path, W, H, motion, A, k, blur):
    im = Image.open(path)
    im = im.convert("RGBA")
    iw, ih = im.size
    cover = max(W / iw, H / ih)
    # thu nhỏ trước 1 lần (Lanczos) để mỗi khung chỉ còn phóng ~1x -> nét và nhanh
    pre = cover * max_factor(motion, A, k)
    if pre < 1:
        im = im.resize((max(1, round(iw * pre)), max(1, round(ih * pre))), Image.LANCZOS)
    pre_scale = im.size[0] / iw  # tỉ lệ ảnh đã chuẩn bị so với gốc
    if blur > 0:
        r = blur * (W / 1920) / (cover / pre_scale)
        im = im.filter(ImageFilter.GaussianBlur(max(0.1, r)))
    import numpy as np
    arr = np.asarray(im, dtype=np.uint16)
    arr[..., :3] = (arr[..., :3] * arr[..., 3:4] + 127) // 255  # nhân sẵn alpha để mép trong suốt không bị viền
    arr = np.ascontiguousarray(arr.astype(np.uint8))
    return arr, cover / pre_scale  # 'cover' tính theo ảnh đã chuẩn bị


def _report(q, *msg):
    if q is not None:
        try:
            q.put_nowait(msg)
        except Exception:
            pass


def render_scene(job):
    """job = (tên, lớp, cấu hình, file ra[, hàng đợi tiến trình])."""
    name, layers, cfg, out_path = job[:4]
    q = job[4] if len(job) > 4 else None
    _report(q, "start", name, 0)
    import cv2
    import imageio_ffmpeg
    import numpy as np
    cv2.setNumThreads(1)  # song song theo cảnh, không theo luồng trong 1 cảnh

    W, H = cfg["W"], cfg["H"]
    fps, dur = cfg["fps"], cfg["duration"]
    A = cfg["strength"]
    motion = cfg["motion"]
    if motion == "random":
        motion = random.Random(name).choice(RANDOM_POOL)

    prepared = []
    for key in LAYER_KEYS:
        if layers.get(key):
            k = cfg["speeds"][key]
            im, cov = prepare_layer(layers[key], W, H, motion, A, k, cfg["blur"] if key == "fg" else 0)
            prepared.append((im, cov, k))
    if not prepared:
        return name, None, "không có ảnh"

    n = max(1, round(fps * dur))
    writer = imageio_ffmpeg.write_frames(
        out_path, (W, H), fps=fps, codec="libx264", pix_fmt_in="rgb24", pix_fmt_out="yuv420p",
        macro_block_size=1, output_params=["-crf", str(cfg["crf"]), "-preset", "fast", "-movflags", "+faststart"],
        ffmpeg_log_level="error",
    )
    writer.send(None)
    try:
        for i in range(n):
            t = i / (n - 1) if n > 1 else 0
            p = ease(t, cfg["ease"])
            frame = None
            for arr, cov, k in prepared:
                f, dx, dy = layer_params(motion, p, A, k, W, H)
                s = cov * f
                ih, iw = arr.shape[:2]
                ox = (W - iw * s) / 2 + dx
                oy = (H - ih * s) / 2 + dy
                M = np.float32([[s, 0, ox], [0, s, oy]])
                lay = cv2.warpAffine(arr, M, (W, H), flags=cv2.INTER_LINEAR,
                                     borderMode=cv2.BORDER_CONSTANT, borderValue=(0, 0, 0, 0))
                rgb = cv2.cvtColor(lay, cv2.COLOR_RGBA2RGB)
                if frame is None:  # lớp dưới cùng: nền đen + lớp đã nhân alpha
                    frame = rgb
                else:
                    inv = cv2.cvtColor(255 - lay[..., 3], cv2.COLOR_GRAY2RGB)
                    frame = cv2.add(cv2.multiply(frame, inv, scale=1 / 255), rgb)
            writer.send(memoryview(np.ascontiguousarray(frame)))
            if i % 3 == 2 or i == n - 1:
                _report(q, "frame", name, (i + 1) / n)
    finally:
        writer.close()
    return name, out_path, motion


def safe_name(n):
    return re.sub(r'[\\/:*?"<>|]+', "_", n).strip() or "canh"


def video_path(dst, name):
    """'du_an_x/Cảnh 1 - abc' -> <dst>/du_an_x/Cảnh 1 - abc.mp4 (giữ cấu trúc thư mục, tên video = tên cảnh)."""
    parts = [safe_name(p) for p in name.split("/") if p.strip()] or ["canh"]
    path = os.path.join(dst, *parts) + ".mp4"
    os.makedirs(os.path.dirname(path), exist_ok=True)
    return path


# ---------------------------------------------------------------- GUI
def default_input_dir():
    p = os.path.join(os.path.expanduser("~"), "Pictures", "VIDEO_IMAGE_STUDIO", "Parallax")
    return p if os.path.isdir(p) else ""


def default_output_dir():
    return os.path.join(os.path.expanduser("~"), "Videos", "Parallax25D")


def fmt_time(sec):
    sec = int(max(0, sec))
    return f"{sec // 60} phút {sec % 60:02d} giây" if sec >= 60 else f"{sec} giây"


def run_gui():
    import queue as queue_mod
    import time
    import tkinter as tk
    from tkinter import ttk, filedialog, messagebox

    root = tk.Tk()
    root.title("Parallax 2.5D - tạo video hàng loạt")
    root.geometry("1240x700")
    root.minsize(1000, 600)
    pad = {"padx": 8, "pady": 4}

    v_in = tk.StringVar(value=default_input_dir())
    v_out = tk.StringVar(value=default_output_dir())
    v_res = tk.StringVar(value="1920x1080 (ngang)")
    v_motion = tk.StringVar(value="Ngẫu nhiên mỗi cảnh")
    v_dur = tk.DoubleVar(value=5)
    v_fps = tk.IntVar(value=30)
    v_strength = tk.IntVar(value=10)
    v_far = tk.IntVar(value=5)
    v_bg = tk.IntVar(value=20)
    v_mid = tk.IntVar(value=55)
    v_fg = tk.IntVar(value=110)
    v_blur = tk.IntVar(value=0)
    v_ease = tk.BooleanVar(value=True)
    v_skip = tk.BooleanVar(value=True)
    v_quality = tk.IntVar(value=18)
    cpu = os.cpu_count() or 2
    v_workers = tk.IntVar(value=max(1, min(cpu // 2, 6)))

    paned = ttk.Panedwindow(root, orient="horizontal")
    paned.pack(fill="both", expand=True, padx=8, pady=8)

    # ---------------- bên trái: cài đặt (giữ như cũ)
    frm = ttk.Frame(paned)
    paned.add(frm, weight=1)

    def folder_row(r, label, var, title):
        ttk.Label(frm, text=label).grid(row=r, column=0, sticky="w", **pad)
        ttk.Entry(frm, textvariable=var).grid(row=r, column=1, sticky="ew", **pad)

        def pick():
            d = filedialog.askdirectory(title=title, initialdir=var.get() or None)
            if d:
                var.set(d)
                if var is v_in:
                    refresh_scenes()
        ttk.Button(frm, text="Chọn…", command=pick).grid(row=r, column=2, **pad)

    folder_row(0, "Thư mục ảnh", v_in, "Chọn thư mục tổng (vd: Pictures\\VIDEO_IMAGE_STUDIO\\Parallax)")
    folder_row(1, "Thư mục xuất", v_out, "Chọn nơi lưu video")
    ttk.Label(frm, foreground="#666", justify="left", text=(
        "Chọn thư mục tổng: tự tìm mọi thư mục cảnh bên trong (mỗi thư mục = 1 video,\n"
        "tên video = tên thư mục, vd \"Cảnh 1 - abc\"). Thư mục bắt đầu bằng _ được bỏ qua.")).grid(
        row=2, column=0, columnspan=3, sticky="w", **pad)

    ttk.Label(frm, text="Khung hình").grid(row=3, column=0, sticky="w", **pad)
    ttk.Combobox(frm, textvariable=v_res, values=list(RESOLUTIONS), state="readonly").grid(row=3, column=1, sticky="ew", **pad)
    ttk.Label(frm, text="Chuyển động").grid(row=4, column=0, sticky="w", **pad)
    ttk.Combobox(frm, textvariable=v_motion, values=list(MOTIONS), state="readonly").grid(row=4, column=1, sticky="ew", **pad)
    ttk.Label(frm, text="Thời lượng (giây)").grid(row=5, column=0, sticky="w", **pad)
    ttk.Spinbox(frm, from_=1, to=60, increment=0.5, textvariable=v_dur, width=8).grid(row=5, column=1, sticky="w", **pad)
    ttk.Label(frm, text="FPS").grid(row=6, column=0, sticky="w", **pad)
    ttk.Combobox(frm, textvariable=v_fps, values=[24, 25, 30, 60], width=6, state="readonly").grid(row=6, column=1, sticky="w", **pad)

    def slider(r, label, var, lo, hi, fmt):
        ttk.Label(frm, text=label).grid(row=r, column=0, sticky="w", **pad)
        lab = ttk.Label(frm, width=7)
        lab.grid(row=r, column=2, sticky="w", **pad)

        def upd(*_):
            lab.config(text=fmt(var.get()))
        ttk.Scale(frm, from_=lo, to=hi, variable=var, command=lambda v: (var.set(round(float(v))), upd())).grid(
            row=r, column=1, sticky="ew", **pad)
        upd()

    slider(7, "Biên độ chuyển động", v_strength, 2, 30, lambda v: f"{v}%")
    slider(8, "Tốc độ toàn cảnh xa (lớp 4)", v_far, 0, 200, lambda v: f"{v / 100:.2f}x")
    slider(9, "Tốc độ hậu cảnh", v_bg, 0, 200, lambda v: f"{v / 100:.2f}x")
    slider(10, "Tốc độ trung cảnh", v_mid, 0, 200, lambda v: f"{v / 100:.2f}x")
    slider(11, "Tốc độ tiền cảnh", v_fg, 0, 200, lambda v: f"{v / 100:.2f}x")
    slider(12, "Làm mờ tiền cảnh", v_blur, 0, 20, lambda v: f"{v}px")
    slider(13, "Chất lượng (CRF, nhỏ = nét)", v_quality, 14, 30, lambda v: str(v))
    slider(14, "Số video chạy song song", v_workers, 1, max(1, cpu), lambda v: str(v))
    ttk.Checkbutton(frm, text="Chuyển động mượt (chậm đầu – chậm cuối)", variable=v_ease).grid(
        row=15, column=0, columnspan=3, sticky="w", **pad)
    ttk.Checkbutton(frm, text="Bỏ qua cảnh đã có video (chỉ tạo cảnh mới / cảnh vừa tách lại)", variable=v_skip).grid(
        row=16, column=0, columnspan=3, sticky="w", **pad)
    btn = ttk.Button(frm, text="▶  BẮT ĐẦU TẠO VIDEO")
    btn.grid(row=17, column=0, columnspan=3, sticky="ew", padx=8, pady=10)
    frm.columnconfigure(1, weight=1)

    # ---------------- bên phải: tiến trình
    right = ttk.Frame(paned, padding=(12, 4, 4, 4))
    paned.add(right, weight=1)
    ttk.Label(right, text="TIẾN TRÌNH", font=("Segoe UI", 10, "bold"), foreground="#555").pack(anchor="w")
    top = ttk.Frame(right)
    top.pack(fill="x", pady=(2, 4))
    pct_lab = ttk.Label(top, text="0%", font=("Segoe UI", 30, "bold"), foreground="#1a73e8")
    pct_lab.pack(side="left")
    sum_lab = ttk.Label(top, text="Chưa bắt đầu", font=("Segoe UI", 10), justify="left")
    sum_lab.pack(side="left", padx=14)
    total_bar = ttk.Progressbar(right, mode="determinate", maximum=1000)
    total_bar.pack(fill="x", pady=(0, 6))
    cur_lab = ttk.Label(right, text="", font=("Segoe UI", 10, "bold"), foreground="#22543a")
    cur_lab.pack(anchor="w", pady=(0, 4))

    cols = ("pct", "state")
    tree = ttk.Treeview(right, columns=cols, show="tree headings", height=12)
    tree.heading("#0", text="Cảnh")
    tree.heading("pct", text="%")
    tree.heading("state", text="Trạng thái")
    tree.column("#0", width=330, stretch=True)
    tree.column("pct", width=60, anchor="center", stretch=False)
    tree.column("state", width=150, anchor="w", stretch=False)
    tree.tag_configure("run", foreground="#1a73e8")
    tree.tag_configure("ok", foreground="#1e7e34")
    tree.tag_configure("err", foreground="#c0392b")
    tree.tag_configure("skip", foreground="#888")
    tree.pack(fill="both", expand=True)

    log = tk.Text(right, height=6, wrap="word", font=("Consolas", 8), foreground="#555", background="#f6f7f9",
                  relief="flat")
    log.pack(fill="x", pady=(6, 0))

    def write(msg):
        def _do():
            log.insert("end", time.strftime("%H:%M:%S ") + msg + "\n")
            log.see("end")
        root.after(0, _do)

    state = {"scenes": [], "progress": {}, "q": None, "start": 0.0, "running": False, "total": 0, "done": 0}

    def refresh_scenes():
        tree.delete(*tree.get_children())
        state["progress"] = {}
        src = v_in.get()
        if not os.path.isdir(src):
            sum_lab.config(text="Chưa chọn thư mục ảnh")
            return
        try:
            scenes = find_scenes(src)
        except Exception as e:
            write(f"Lỗi đọc thư mục: {e}")
            return
        state["scenes"] = scenes
        for n, d in scenes:
            tree.insert("", "end", iid=n, text=f"{n}   ({len(d)} lớp)", values=("", "Chờ"))
        sum_lab.config(text=f"Tìm thấy {len(scenes)} cảnh trong thư mục")
        pct_lab.config(text="0%")
        total_bar.config(value=0)
        write(f"Tìm thấy {len(scenes)} cảnh.")

    def set_row(name, pct=None, text=None, tag=None):
        if not tree.exists(name):
            return
        vals = list(tree.item(name, "values"))
        if pct is not None:
            vals[0] = f"{int(pct * 100)}%"
        if text is not None:
            vals[1] = text
        tree.item(name, values=vals, tags=(tag,) if tag else ())
        if tag == "run":
            tree.see(name)

    def update_total():
        total = state["total"]
        if not total:
            return
        frac = sum(state["progress"].values()) / total
        total_bar.config(value=int(frac * 1000))
        pct_lab.config(text=f"{int(frac * 100)}%")
        elapsed = time.time() - state["start"]
        left = elapsed / frac - elapsed if frac > 0.02 else None
        txt = f"Đã xong {state['done']}/{total} cảnh\nĐã chạy {fmt_time(elapsed)}"
        if left is not None and state["running"]:
            txt += f" · còn khoảng {fmt_time(left)}"
        sum_lab.config(text=txt)
        running = [n for n, p in state["progress"].items() if 0 < p < 1]
        cur_lab.config(text=("Đang tạo: " + ", ".join(running[:3]) + (" …" if len(running) > 3 else "")) if running else "")

    def poll():
        q = state["q"]
        if q is not None:
            try:
                while True:
                    kind, name, val = q.get_nowait()
                    state["progress"][name] = max(state["progress"].get(name, 0), float(val))
                    set_row(name, val, "Đang tạo video…" if kind == "frame" else "Đang chuẩn bị lớp…", "run")
            except queue_mod.Empty:
                pass
            except Exception:
                pass
        if state["running"] or q is not None:
            update_total()
        root.after(200, poll)

    def start():
        src, dst = v_in.get(), v_out.get()
        if not os.path.isdir(src):
            messagebox.showerror("Thiếu thư mục", "Hãy chọn thư mục ảnh.")
            return
        refresh_scenes()
        scenes = state["scenes"]
        if not scenes:
            messagebox.showerror("Không có ảnh", "Không tìm thấy cảnh nào trong thư mục.")
            return
        os.makedirs(dst, exist_ok=True)
        W, H = RESOLUTIONS[v_res.get()]
        cfg = {
            "W": W, "H": H, "fps": int(v_fps.get()), "duration": max(0.5, float(v_dur.get())),
            "strength": v_strength.get() / 100, "motion": MOTIONS[v_motion.get()],
            "speeds": {"far": v_far.get() / 100, "bg": v_bg.get() / 100, "mid": v_mid.get() / 100, "fg": v_fg.get() / 100},
            "blur": v_blur.get(), "ease": v_ease.get(), "crf": v_quality.get(),
        }
        manager = mp.Manager()
        q = manager.Queue()
        jobs, skipped = [], 0
        for n, d in scenes:
            out = video_path(dst, n)
            if v_skip.get() and os.path.exists(out) and os.path.getmtime(out) >= max(os.path.getmtime(p) for p in d.values()):
                skipped += 1
                set_row(n, 1, "Đã có video – bỏ qua", "skip")
                continue
            jobs.append((n, d, cfg, out, q))
        state.update(q=q, start=time.time(), running=True, total=len(jobs), done=0,
                     progress={j[0]: 0.0 for j in jobs})
        if skipped:
            write(f"Bỏ qua {skipped} cảnh đã có video.")
        if not jobs:
            state.update(running=False, q=None)
            sum_lab.config(text=f"Không có cảnh mới cần tạo ({skipped} cảnh đã có video)")
            pct_lab.config(text="100%")
            manager.shutdown()
            return
        btn.config(state="disabled")
        write(f"Bắt đầu tạo {len(jobs)} video ({W}x{H}, {cfg['fps']}fps, {cfg['duration']}s)…")

        def work():
            ok = 0
            try:
                with ProcessPoolExecutor(max_workers=v_workers.get()) as ex:
                    futs = {ex.submit(render_scene, j): j[0] for j in jobs}
                    for f in as_completed(futs):
                        name = futs[f]
                        state["done"] += 1
                        state["progress"][name] = 1.0
                        try:
                            _, path, extra = f.result()
                            if path:
                                ok += 1
                                root.after(0, lambda n=name, e=extra: set_row(n, 1, f"Xong ✓ ({e})", "ok"))
                                write(f"✓ {name} ({extra})")
                            else:
                                root.after(0, lambda n=name, e=extra: set_row(n, None, f"Lỗi: {e}", "err"))
                                write(f"✗ {name}: {extra}")
                        except Exception as e:
                            root.after(0, lambda n=name, e=e: set_row(n, None, f"Lỗi: {e}", "err"))
                            write(f"✗ {name}: {e}")
                write(f"XONG: {ok}/{len(jobs)} video → {dst}")
                if ok and sys.platform == "win32":
                    os.startfile(dst)
            except Exception:
                write(traceback.format_exc())
            finally:
                state["running"] = False

                def _end():
                    update_total()
                    cur_lab.config(text=f"Hoàn tất {ok}/{len(jobs)} video" + (f" · bỏ qua {skipped}" if skipped else ""))
                    btn.config(state="normal")
                    state["q"] = None
                    try:
                        manager.shutdown()
                    except Exception:
                        pass
                root.after(300, _end)

        threading.Thread(target=work, daemon=True).start()

    btn.config(command=start)
    root.after(200, poll)
    if v_in.get():
        root.after(100, refresh_scenes)
    root.mainloop()


def run_cli(src, dst, motion="random", workers=2):
    """Chạy không giao diện: Parallax25D.exe --cli <thư mục ảnh> <thư mục xuất>"""
    os.makedirs(dst, exist_ok=True)
    cfg = {"W": 1920, "H": 1080, "fps": 30, "duration": 5, "strength": 0.1, "motion": motion,
           "speeds": {"far": 0.05, "bg": 0.2, "mid": 0.55, "fg": 1.1}, "blur": 0, "ease": True, "crf": 18}
    jobs = [(n, d, cfg, video_path(dst, n)) for n, d in find_scenes(src)]
    lines = []
    with ProcessPoolExecutor(max_workers=workers) as ex:
        for f in as_completed([ex.submit(render_scene, j) for j in jobs]):
            lines.append(repr(f.result()))
    with open(os.path.join(dst, "log.txt"), "w", encoding="utf-8") as fh:
        fh.write("\n".join(lines) + f"\nDONE {len(lines)}/{len(jobs)}\n")


if __name__ == "__main__":
    mp.freeze_support()
    if len(sys.argv) >= 4 and sys.argv[1] == "--cli":
        run_cli(sys.argv[2], sys.argv[3])
    else:
        run_gui()
