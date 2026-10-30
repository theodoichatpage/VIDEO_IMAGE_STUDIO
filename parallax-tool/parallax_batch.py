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
        scenes += group_files(imgs, None if rel == "." else rel.replace(os.sep, "_"))
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


def render_scene(job):
    name, layers, cfg, out_path = job
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
    finally:
        writer.close()
    return name, out_path, motion


def safe_name(n):
    return re.sub(r'[\\/:*?"<>|]+', "_", n).strip() or "canh"


# ---------------------------------------------------------------- GUI
def run_gui():
    import tkinter as tk
    from tkinter import ttk, filedialog, messagebox

    root = tk.Tk()
    root.title("Parallax 2.5D - tạo video hàng loạt")
    root.geometry("640x720")
    pad = {"padx": 8, "pady": 4}

    v_in = tk.StringVar()
    v_out = tk.StringVar()
    v_res = tk.StringVar(value="1920x1080 (ngang)")
    v_motion = tk.StringVar(value="Lia sang phải")
    v_dur = tk.DoubleVar(value=5)
    v_fps = tk.IntVar(value=30)
    v_strength = tk.IntVar(value=10)
    v_far = tk.IntVar(value=5)
    v_bg = tk.IntVar(value=20)
    v_mid = tk.IntVar(value=55)
    v_fg = tk.IntVar(value=110)
    v_blur = tk.IntVar(value=0)
    v_ease = tk.BooleanVar(value=True)
    v_quality = tk.IntVar(value=18)
    cpu = os.cpu_count() or 2
    v_workers = tk.IntVar(value=max(1, min(cpu // 2, 6)))

    frm = ttk.Frame(root)
    frm.pack(fill="both", expand=True, padx=10, pady=10)

    def folder_row(r, label, var, title):
        ttk.Label(frm, text=label).grid(row=r, column=0, sticky="w", **pad)
        ttk.Entry(frm, textvariable=var).grid(row=r, column=1, sticky="ew", **pad)

        def pick():
            d = filedialog.askdirectory(title=title)
            if d:
                var.set(d)
                if var is v_in and not v_out.get():
                    v_out.set(os.path.join(d, "video_xuat"))
                if var is v_in:
                    preview_count()
        ttk.Button(frm, text="Chọn…", command=pick).grid(row=r, column=2, **pad)

    folder_row(0, "Thư mục ảnh", v_in, "Chọn thư mục chứa ảnh")
    folder_row(1, "Thư mục xuất", v_out, "Chọn nơi lưu video")
    info = ttk.Label(frm, text="Chọn thẳng thư mục Parallax do Tab Tách ảnh lưu (Pictures\\VIDEO_IMAGE_STUDIO\\Parallax):\n"
                               "quét mọi thư mục con, mỗi thư mục = 1 cảnh. Tên lớp far / bg / mid / fg (hoặc hau / trung / tien);\n"
                               "không có tên lớp thì cứ 3 ảnh theo thứ tự tên = 1 cảnh (hậu → trung → tiền).", foreground="#666")
    info.grid(row=2, column=0, columnspan=3, sticky="w", **pad)

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

    btn = ttk.Button(frm, text="▶  BẮT ĐẦU TẠO VIDEO")
    btn.grid(row=16, column=0, columnspan=3, sticky="ew", padx=8, pady=10)
    bar = ttk.Progressbar(frm, mode="determinate")
    bar.grid(row=17, column=0, columnspan=3, sticky="ew", **pad)
    log = tk.Text(frm, height=10, wrap="word")
    log.grid(row=18, column=0, columnspan=3, sticky="nsew", **pad)
    frm.columnconfigure(1, weight=1)
    frm.rowconfigure(18, weight=1)

    def write(msg):
        root.after(0, lambda: (log.insert("end", msg + "\n"), log.see("end")))

    def preview_count():
        try:
            sc = find_scenes(v_in.get())
            write(f"Tìm thấy {len(sc)} cảnh trong thư mục.")
        except Exception as e:
            write(f"Lỗi đọc thư mục: {e}")

    def start():
        src, dst = v_in.get(), v_out.get()
        if not os.path.isdir(src):
            messagebox.showerror("Thiếu thư mục", "Hãy chọn thư mục ảnh.")
            return
        scenes = find_scenes(src)
        if not scenes:
            messagebox.showerror("Không có ảnh", "Không tìm thấy ảnh nào trong thư mục.")
            return
        os.makedirs(dst, exist_ok=True)
        W, H = RESOLUTIONS[v_res.get()]
        cfg = {
            "W": W, "H": H, "fps": int(v_fps.get()), "duration": max(0.5, float(v_dur.get())),
            "strength": v_strength.get() / 100, "motion": MOTIONS[v_motion.get()],
            "speeds": {"far": v_far.get() / 100, "bg": v_bg.get() / 100, "mid": v_mid.get() / 100, "fg": v_fg.get() / 100},
            "blur": v_blur.get(), "ease": v_ease.get(), "crf": v_quality.get(),
        }
        jobs = [(n, d, cfg, os.path.join(dst, safe_name(n) + ".mp4")) for n, d in scenes]
        btn.config(state="disabled")
        bar.config(maximum=len(jobs), value=0)
        write(f"Bắt đầu tạo {len(jobs)} video ({W}x{H}, {cfg['fps']}fps, {cfg['duration']}s)…")

        def work():
            done = ok = 0
            try:
                with ProcessPoolExecutor(max_workers=v_workers.get()) as ex:
                    futs = {ex.submit(render_scene, j): j[0] for j in jobs}
                    for f in as_completed(futs):
                        done += 1
                        try:
                            name, path, extra = f.result()
                            if path:
                                ok += 1
                                write(f"✓ {name}  ({extra})")
                            else:
                                write(f"✗ {name}: {extra}")
                        except Exception as e:
                            write(f"✗ {futs[f]}: {e}")
                        root.after(0, lambda d=done: bar.config(value=d))
                write(f"XONG: {ok}/{len(jobs)} video → {dst}")
                if ok and sys.platform == "win32":
                    os.startfile(dst)
            except Exception:
                write(traceback.format_exc())
            finally:
                root.after(0, lambda: btn.config(state="normal"))

        threading.Thread(target=work, daemon=True).start()

    btn.config(command=start)
    root.mainloop()


def run_cli(src, dst, motion="random", workers=2):
    """Chạy không giao diện: Parallax25D.exe --cli <thư mục ảnh> <thư mục xuất>"""
    os.makedirs(dst, exist_ok=True)
    cfg = {"W": 1920, "H": 1080, "fps": 30, "duration": 5, "strength": 0.1, "motion": motion,
           "speeds": {"far": 0.05, "bg": 0.2, "mid": 0.55, "fg": 1.1}, "blur": 0, "ease": True, "crf": 18}
    jobs = [(n, d, cfg, os.path.join(dst, safe_name(n) + ".mp4")) for n, d in find_scenes(src)]
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
