"""Project-owned local video editor endpoints."""
import math, shutil, threading, uuid
from pathlib import Path
from flask import request, jsonify, send_file
import video_builder
from core import selected


def register(app,studio):
    jobs={}
    @app.get('/video-editor')
    def video_editor():return (studio.ROOT/'video_editor.html').read_text(encoding='utf8').replace('__TOKEN__',studio.TOKEN),200,{'Cache-Control':'no-store'}

    @app.post('/api/video-project')
    def video_project():
        with studio.lock:
            p=studio.getp();items=[]
            for s in p['scenes']:
                v=selected(s)
                if v and s['kind']!='thumbnail':items.append(dict(id=s['id'],title=s['title'],source=s['source'],image='/image/'+p['id']+'/'+v['file']))
            job=jobs.get(p['id'],{}).get('state')
            return jsonify(items=items,recipe=p.get('video_recipe',{}),voice=p.get('video_voice'),job=job,output=('/video-file/'+p['id']+'/'+p['video_output']) if p.get('video_output') else None)

    @app.post('/api/video-voice')
    def video_voice():
        with studio.lock:
            pid=request.form.get('project');p=studio.projects.get(pid)
            if not p:raise ValueError('Không tìm thấy dự án.')
            upload=request.files.get('voice')
            if not upload:raise ValueError('Chọn bản thu voice.')
            suffix=Path(upload.filename or '').suffix.lower()
            if suffix not in ('.wav','.mp3','.m4a','.aac','.flac','.ogg'):raise ValueError('Chọn file âm thanh WAV, MP3, M4A, AAC, FLAC hoặc OGG.')
            folder=studio.DATA/pid;folder.mkdir(parents=True,exist_ok=True)
            name='voice-'+uuid.uuid4().hex+suffix;path=folder/name;upload.save(path)
        try:seconds=video_builder.duration(path)
        except Exception:path.unlink(missing_ok=True);raise
        with studio.lock:
            if studio.projects.get(pid) is not p:path.unlink(missing_ok=True);raise ValueError('Dự án đã đóng hoặc xóa.')
            p['video_voice']=dict(file=name,name=upload.filename,seconds=seconds);studio.persist(p)
            return jsonify(voice=p['video_voice'])

    def recipe(p,d):
        source=d.get('clips');lookup={s['id']:s for s in p['scenes'] if s['kind']!='thumbnail'};out=[];seen=set()
        if not isinstance(source,list) or not 1<=len(source)<=200:raise ValueError('Chọn từ 1 đến 200 ảnh đã tạo.')
        for clip in source:
            if not isinstance(clip,dict):raise ValueError('Cảnh không hợp lệ.')
            sid=clip.get('id');s=lookup.get(sid);v=selected(s) if s else None
            if not v or sid in seen:raise ValueError('Ảnh thiếu hoặc bị lặp trong danh sách dựng.')
            try:seconds=float(clip.get('seconds',5))
            except (TypeError,ValueError):raise ValueError('Thời lượng phải là số.')
            if not math.isfinite(seconds) or not .5<=seconds<=600:raise ValueError('Thời lượng mỗi ảnh từ 0,5 đến 600 giây.')
            motion=clip.get('motion','still')
            if motion not in ('still','zoom'):raise ValueError('Hiệu ứng không hợp lệ.')
            seen.add(sid);out.append(dict(id=sid,seconds=seconds,motion=motion))
        resolution=d.get('resolution','1920x1080')
        if resolution not in ('1920x1080','1080x1920','1280x720'):raise ValueError('Kích thước video không hợp lệ.')
        return dict(clips=out,resolution=resolution,use_voice=d.get('use_voice',True) is True)

    @app.post('/api/video-save')
    def video_save():
        with studio.lock:
            p=studio.getp();p['video_recipe']=recipe(p,request.json);studio.persist(p);return jsonify(ok=True)

    @app.post('/api/video-render')
    def video_render():
        with studio.lock:
            p=studio.getp();pid=p['id'];existing=jobs.get(pid)
            if existing and existing['state']['status']=='running':raise ValueError('Dự án đang dựng video. Hủy hoặc chờ hoàn tất.')
            config=recipe(p,request.json);folder=studio.DATA/pid;lookup={s['id']:s for s in p['scenes']}
            if config['use_voice'] and not p.get('video_voice'):raise ValueError('Nhập voice hoặc bỏ chọn Ghép voice.')
            voice=folder/p['video_voice']['file'] if config['use_voice'] else None
            total=sum(round(c['seconds']*25)/25 for c in config['clips'])
            if voice and p['video_voice']['seconds']>total+.08:raise ValueError('Video ngắn hơn voice. Tăng thời lượng ảnh hoặc bấm Chia đều theo voice.')
            video_builder.binary();job_id=uuid.uuid4().hex;work=folder/('video-'+job_id);work.mkdir(parents=True)
            clips=[]
            try:
                for i,c in enumerate(config['clips']):
                    v=selected(lookup[c['id']]);src=folder/v['file'];dest=work/(str(i)+src.suffix);shutil.copyfile(src,dest)
                    clips.append(dict(path=str(dest),seconds=c['seconds'],motion=c['motion']))
                if voice:dest=work/('voice'+voice.suffix);shutil.copyfile(voice,dest);voice=dest
            except Exception:shutil.rmtree(work,ignore_errors=True);raise
            output=folder/('video-'+job_id+'.mp4');cancel=threading.Event();state=dict(status='running',completed=0,total=len(clips),message='Đang dựng ảnh đầu tiên',id=job_id)
            jobs[pid]=dict(state=state,cancel=cancel);p['video_recipe']=config;studio.persist(p)
        def worker():
            try:
                width,height=map(int,config['resolution'].split('x'))
                def progress(update):
                    with studio.lock:
                        if studio.projects.get(pid) is not p:cancel.set()
                        state.update(update)
                video_builder.render(clips,str(voice) if voice else None,output,width,height,progress,cancel)
                with studio.lock:
                    if studio.projects.get(pid) is not p:output.unlink(missing_ok=True);return
                    p['video_output']=output.name;studio.persist(p);state.update(status='done',message='Đã xuất MP4',url='/video-file/'+pid+'/'+output.name)
            except Exception as error:
                with studio.lock:state.update(status='cancelled' if cancel.is_set() else 'error',message=str(error))
            finally:shutil.rmtree(work,ignore_errors=True)
        threading.Thread(target=worker,daemon=True).start();return jsonify(job=state)

    @app.post('/api/video-cancel')
    def video_cancel():
        with studio.lock:
            p=studio.getp();job=jobs.get(p['id'])
            if job and job['state']['status']=='running':job['cancel'].set()
            return jsonify(ok=True)

    @app.get('/video-file/<pid>/<name>')
    def video_file(pid,name):
        p=studio.projects.get(pid)
        if not p or p.get('video_output')!=name:return '',404
        return send_file(studio.DATA/pid/name,conditional=True,as_attachment=request.args.get('download')=='1',download_name='video.mp4')
