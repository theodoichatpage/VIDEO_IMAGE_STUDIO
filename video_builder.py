"""Local still-image editing and MP4 export. No AI or external service."""
import math, os, re, shutil, subprocess, tempfile, time
from pathlib import Path


def binary():
    found=shutil.which('ffmpeg')
    if found:return found
    try:
        import imageio_ffmpeg
        return imageio_ffmpeg.get_ffmpeg_exe()
    except (ImportError,RuntimeError):raise ValueError('Thiếu FFmpeg. Chạy lại 0_VIDEO_IMAGE_STUDIO.bat để cài phần dựng video.')


def duration(path):
    result=subprocess.run([binary(),'-hide_banner','-i',str(path)],capture_output=True,text=True,encoding='utf8',errors='replace',timeout=20,creationflags=getattr(subprocess,'CREATE_NO_WINDOW',0))
    match=re.search(r'Duration: (\d+):(\d+):(\d+(?:\.\d+)?)',result.stderr)
    if not match or not re.search(r'Audio:',result.stderr):raise ValueError('Không đọc được thời lượng âm thanh. Dùng file WAV hoặc MP3 hợp lệ.')
    h,m,s=map(float,match.groups());return h*3600+m*60+s


def _run(args,cancel):
    if cancel.is_set():raise RuntimeError('Đã hủy dựng video.')
    with tempfile.TemporaryFile() as log:
        proc=subprocess.Popen([binary(),'-hide_banner','-loglevel','error','-nostdin','-y',*args],stdout=subprocess.DEVNULL,stderr=log,creationflags=getattr(subprocess,'CREATE_NO_WINDOW',0))
        started=time.monotonic()
        try:
            while proc.poll() is None:
                if cancel.wait(.15):raise RuntimeError('Đã hủy dựng video.')
                if time.monotonic()-started>1800:raise RuntimeError('Bước dựng video vượt 30 phút; đã dừng.')
            if proc.returncode:
                log.seek(0);raise RuntimeError('FFmpeg: '+log.read().decode('utf8','replace')[-1800:])
        finally:
            if proc.poll() is None:
                proc.terminate()
                try:proc.wait(timeout=5)
                except subprocess.TimeoutExpired:proc.kill();proc.wait()


def render(clips,voice,output,width=1920,height=1080,progress=lambda _:None,cancel=None):
    import threading
    cancel=cancel or threading.Event();output=Path(output)
    if not clips or len(clips)>200:raise ValueError('Chọn từ 1 đến 200 ảnh.')
    frames=[]
    for clip in clips:
        seconds=float(clip['seconds'])
        if not math.isfinite(seconds) or not .5<=seconds<=600:raise ValueError('Mỗi ảnh cần từ 0,5 đến 600 giây.')
        if not Path(clip['path']).is_file():raise ValueError('Thiếu file ảnh.')
        if clip.get('motion','still') not in ('still','zoom'):raise ValueError('Hiệu ứng không hợp lệ.')
        frames.append(round(seconds*25))
    total=sum(frames)/25
    if voice and duration(voice)>total+.08:raise ValueError('Video ngắn hơn voice. Tăng thời lượng các ảnh hoặc dùng Chia đều theo voice để không cắt lời.')
    output.parent.mkdir(parents=True,exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='render-',dir=output.parent) as folder:
        root=Path(folder);names=[]
        for index,(clip,count) in enumerate(zip(clips,frames)):
            name=f'clip-{index:04}.mp4';names.append(name)
            vf=f'scale={width}:{height}:force_original_aspect_ratio=decrease,pad={width}:{height}:(ow-iw)/2:(oh-ih)/2,setsar=1'
            if clip.get('motion')=='zoom':vf+=f",zoompan=z='1+0.06*on/{count}':x='iw/2-iw/zoom/2':y='ih/2-ih/zoom/2':d=1:s={width}x{height}:fps=25"
            _run(['-loop','1','-framerate','25','-i',clip['path'],'-vf',vf,'-frames:v',str(count),'-an','-c:v','libx264','-preset','veryfast','-crf','20','-pix_fmt','yuv420p','-threads','2',str(root/name)],cancel)
            progress({'completed':index+1,'total':len(clips),'message':f"Đã dựng {index+1}/{len(clips)} ảnh; đang ghép"})
        listing=root/'clips.txt';listing.write_text(''.join("file '"+name+"'\n" for name in names),encoding='utf8')
        args=['-f','concat','-safe','1','-i',str(listing)]
        if voice:args+=['-i',voice,'-map','0:v:0','-map','1:a:0','-c:a','aac','-b:a','192k','-af','apad']
        else:args+=['-an']
        tmp=root/'final.mp4'
        _run(args+['-c:v','copy','-t',str(total),'-movflags','+faststart',str(tmp)],cancel)
        if cancel.is_set():raise RuntimeError('Đã hủy dựng video.')
        os.replace(tmp,output)
    return str(output)
