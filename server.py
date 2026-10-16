import base64,io,json,os,threading,time,uuid,webbrowser,urllib.request,urllib.error,subprocess
from pathlib import Path
from flask import Flask,request,jsonify,send_file
from werkzeug.exceptions import HTTPException
from core import *
import scene_analysis as analysis
import analysis_pipeline as pipeline
from connection_config import load_token
from download_watch import DownloadWatch
ROOT=Path(__file__).resolve().parent;DATA=ROOT/'projects';DATA.mkdir(exist_ok=True)
app=Flask(__name__);app.config['MAX_CONTENT_LENGTH']=40*1024*1024
VERSION='0.3.56'
INDEX_HTML=(ROOT/'index.html').read_text(encoding='utf8')
TOKEN=load_token(ROOT/'studio_connection.json');lock=threading.RLock();projects={};connection={'last':0,'ready':False,'client':'','browser':'','url':''};current=None;active=None;running=False
for file in DATA.glob('*/project.json'):
    try:
        p=json.loads(file.read_text(encoding='utf8'))
        if p.get('schema')==3:projects[p['id']]=p
    except (ValueError,OSError):pass
def persist(p):p['schema']=3;atomic(DATA/p['id']/'project.json',p)
# Upgrade legacy projects by making a new copy, leaving source JSON and images intact.
upgrade_file=ROOT/'migration_index.json'
try:upgrades=json.loads(upgrade_file.read_text(encoding='utf8'))
except (OSError,ValueError):upgrades={}
for file in list(DATA.glob('*/project.json')):
    key=str(file.resolve())
    try:
        old=json.loads(file.read_text(encoding='utf8'))
        if old.get('schema')!=3 and key not in upgrades:
            p=migrate(old,file.parent,DATA);projects[p['id']]=p;persist(p);upgrades[key]=p['id'];atomic(upgrade_file,upgrades)
    except (ValueError,OSError):pass

# A previous process cannot confirm a dispatched job. Retain images and inputs,
# but do not let that uncertain job block or automatically resend on startup.
for p in projects.values():
    changed=False
    for c in p['commands']:
        if c.get('layout_job') and c['status']=='queued' and c.get('analysis_prompt_version') not in (45,56):
            c.update(status='abandoned',finished_at=time.time(),error='Yêu cầu phân tích từ bản cũ đã dừng để tránh gửi sai cuộc chat. Bắt đầu phân tích mới trên tab đã chọn.')
            p.update(analysis_stage='interrupted',layout_status=c['error']);changed=True
        if c['status'] in ('sending','sent','waiting','saving','paused'):
            c.update(status='abandoned',finished_at=time.time())
            if c.get('layout_job'):p.update(analysis_stage='error',layout_status='Phân tích bị gián đoạn khi mở lại Studio. Kiểm tra ChatGPT và phân tích lại.')
            target=next((x for x in p['scenes'] if x.get('command')==c['id']),None)
            if target and target['status']!='done':
                target.update(status='error',stopped_at=time.time(),error='Yêu cầu cũ đã ngừng theo dõi khi mở lại Studio. Kiểm tra ảnh trong ChatGPT; bấm Làm lại nếu cần tạo mới.')
            changed=True
    if changed:persist(p)
running=any(c['status']=='queued' for p in projects.values() for c in p['commands'])

def release_job(p,c,message,status='error'):
    global active
    c.update(status='abandoned',finished_at=time.time(),error=message)
    target=next((x for x in p['scenes'] if x.get('command')==c['id']),None)
    if target and target['status']!='done':target.update(status=status,stopped_at=time.time(),error=message if status=='error' else '')
    if active==[p['id'],c['id']]:active=None
    persist(p)

def expire_jobs():
    global running,active
    for p in projects.values():
        for c in p['commands']:
            timeout=900 if c.get('layout_job') else 300
            if c['status'] in ('sending','sent','waiting','saving') and time.time()-c.get('progress_at',c.get('sent_at',c['created']))>timeout:
                if c.get('layout_job'):
                    message='Phân tích không có dữ liệu mới trong 15 phút. Mở đúng cuộc chat và bấm Nhận lại kết quả; không cần gửi lại prompt.'
                    c.update(status='error',error=message,finished_at=time.time())
                    p.update(analysis_stage='interrupted',layout_status=message)
                    if active and active[1]==c['id']:active=None
                    persist(p)
                else:release_job(p,c,'Không nhận được tiến triển trong 5 phút. Hàng đợi đã tạm dừng; kiểm tra ChatGPT và nhận ảnh trước khi tiếp tục.')
                running=False
        latest=next((c for c in reversed(p['commands']) if c.get('layout_job')),None)
        if latest and latest['status'] in ('abandoned','error','paused') and p.get('analysis_stage') in ('split','plan','draft','review'):
            p.update(analysis_stage='interrupted',layout_status='Phân tích đã ngừng theo dõi: '+(latest.get('error') or 'Tác vụ bị dừng. Dùng Nhận lại kết quả để đọc phản hồi cũ.'));persist(p)


watches={}
download_signals={}
watch_restore_errors={}
for p in reversed(list(projects.values())):
    folder=p.get('download_folder','')
    if folder and p.get('download_watch_enabled',True):
        try:
            watch=DownloadWatch(folder)
            if not any(w.folder==watch.folder for w in watches.values()):watches[p['id']]=watch
        except Exception as e:watch_restore_errors[p['id']]=str(e)
def accept_download(p,target,watch,file_id):
    global active,running
    item,raw=watch.take(file_id)
    save_image(DATA,p,target,raw)
    now=time.time();target['stopped_at']=now
    for c in p['commands']:
        if c.get('scene_id')==target['id'] and c['status'] not in ('done','abandoned'):
            if c.pop('resume_after_download',False):running=True
            c.update(status='done',finished_at=now)
            if active==[p['id'],c['id']]:active=None
    watch.consume(file_id);watch.error='';p.pop('download_receiver',None);persist(p)

def scan_downloads():
    for pid,watch in list(watches.items()):
        p=projects.get(pid)
        if not p:continue
        try:
            watch.scan()
            target=next((x for x in p['scenes'] if x['id']==p.get('download_receiver')),None)
            if not target:
                candidates=[x for x in p['scenes'] if x['status']=='waiting_download']
                if len(candidates)==1:target=candidates[0]
            started=target.get('download_started',0) if target else 0
            eligible={i:d for i,d in watch.pending.items() if d['key'][2]/1e9>=started}
            signalled=[i for i,d in eligible.items() if str(d['path'].resolve()) in download_signals]
            if target and len(signalled)==1:
                item=watch.pending[signalled[0]];accept_download(p,target,watch,signalled[0]);download_signals.pop(str(item['path'].resolve()),None)
            elif target and len(eligible)==1 and sum(k not in watch.seen and k[2]/1e9>=started for k in watch.files())==1:accept_download(p,target,watch,next(iter(eligible)))
        except Exception as e:watch.error=str(e)

def monitor_downloads(stop,interval=1.0):
    # Independent of browser visibility and UI polling. Serialize with requests.
    while not stop.wait(interval):
        try:
            with lock:
                scan_downloads()
                expire_jobs()
        except Exception:
            app.logger.exception('Background download monitor failed')

@app.post('/api/download-watch')
def download_watch():
    with lock:
        p=getp();d=request.json
        if not d.get('enabled'):
            watches.pop(p['id'],None);p.pop('download_receiver',None);p['download_watch_enabled']=False;persist(p);return jsonify(ok=True)
        watch=DownloadWatch(str(d.get('folder','')))
        if any(pid!=p['id'] and w.folder==watch.folder for pid,w in watches.items()):raise ValueError('Thư mục này đang được dùng bởi bộ ảnh khác.')
        watches[p['id']]=watch
        p['download_folder']=str(watch.folder);p['download_watch_enabled']=True;persist(p);return jsonify(ok=True,folder=str(watch.folder))
@app.post('/api/download-folder')
def download_folder():
    import tkinter as tk
    from tkinter import filedialog
    root=tk.Tk();root.withdraw();root.attributes('-topmost',True)
    try:folder=filedialog.askdirectory(title='Chọn thư mục ảnh tải từ ChatGPT')
    finally:root.destroy()
    return jsonify(folder=folder)
@app.post('/api/await-download')
def await_download():
    with lock:
        p=getp();target=gets(p)
        if p['id'] not in watches:raise ValueError('Chọn thư mục và bật nhận ảnh trước.')
        if p.get('download_receiver') and p['download_receiver']!=target['id']:raise ValueError('Một dòng khác đang nhận file. Dừng dòng đó trước.')
        if any(x['id']!=target['id'] and x['status']=='waiting_download' for x in p['scenes']):raise ValueError('Một dòng khác đang chờ tải. Nhận xong dòng đó trước.')
        for c in p['commands']:
            if c.get('scene_id')==target['id'] and c['status'] not in ('done','abandoned'):release_job(p,c,'',status='paused')
        target.update(status='waiting_download',error='',download_started=time.time());target.pop('stopped_at',None)
        p['download_receiver']=target['id'];persist(p);return jsonify(ok=True)
@app.post('/api/attach-download')
def attach_download():
    with lock:
        p=getp();target=gets(p);watch=watches.get(p['id'])
        if not watch:raise ValueError('Chưa bật nhận ảnh.')
        accept_download(p,target,watch,request.json.get('file'));return jsonify(ok=True)

def getp():
    p=projects.get(request.json.get('project')) if request.is_json else None
    if not p:raise ValueError('Chọn dự án trước.')
    return p
def gets(p):
    s=next((s for s in p['scenes'] if s['id']==request.json.get('scene')),None)
    if not s:raise ValueError('Không tìm thấy cảnh.')
    return s
@app.before_request
def guard():
    if request.path.startswith('/api/') or request.path.startswith('/bridge/'):
        if request.headers.get('X-Studio-Token')!=TOKEN:return jsonify(error='Kết nối chưa được ghép mã.'),403
        if request.headers.get('Origin') and request.headers['Origin'] not in ('http://127.0.0.1:7871','http://localhost:7871') and not request.headers['Origin'].startswith(('chrome-extension://','moz-extension://')):return jsonify(error='Nguồn kết nối không hợp lệ.'),403
@app.errorhandler(ValueError)
def bad(e):return jsonify(error=str(e)),400
@app.errorhandler(Exception)
def unexpected(e):
    if not request.path.startswith(('/api/','/bridge/')):
        if isinstance(e,HTTPException):return e
        raise e
    if isinstance(e,HTTPException):
        message='Không tìm thấy chức năng. Có thể giao diện mới đang kết nối máy chủ bản cũ. Đóng cửa sổ chạy phần mềm cũ, mở lại bản mới và nhấn Ctrl+F5.' if e.code==404 else 'Yêu cầu không hợp lệ: '+e.description
        return jsonify(error=message),e.code
    app.logger.exception('Studio request failed')
    return jsonify(error='Máy chủ gặp lỗi khi xử lý. Xem cửa sổ chạy phần mềm để biết chi tiết; dữ liệu đã lưu được giữ nguyên.'),500
@app.get('/')
def index():return INDEX_HTML.replace('__TOKEN__',TOKEN),200,{'Cache-Control':'no-store'}
@app.get('/api/state')
def state():
    with lock:
        scan_downloads()
        expire_jobs()
        blocker=None
        if active:
            project=projects.get(active[0]);command=next((c for c in project['commands'] if c['id']==active[1]),None) if project else None
            if command:blocker={'project':project['name'],'status':command['status'],'title':next((x['title'] for x in project['scenes'] if x['id']==command.get('scene_id')),'Tác vụ')}
        return jsonify(blocker=blocker,version=VERSION,storage_root=str(DATA.resolve()),projects=list(projects.values()),connection={**connection,'connected':time.time()-connection['last']<90 and connection['ready'],'age':round(time.time()-connection['last']) if connection['last'] else None},active=active,running=running,download_watches={pid:{'enabled':True,'folder':str(w.folder),'pending':[{'id':i,'name':d['name']} for i,d in w.pending.items()],'error':w.error} for pid,w in watches.items()})
@app.post('/api/new')
def new():
    with lock:
        d=request.json or {};p=new_project()
        for key in ('thumbnail_style','style'):
            if key in d:p[key]=str(d[key])
        p['name']=str(d.get('name') or 'Dự án '+str(len(projects)+1));p['created_at']=time.time()
        projects[p['id']]=p;persist(p);return jsonify(p)

@app.post('/api/project-folder')
def project_folder():
    with lock:
        p=getp();folder=(DATA/p['id']).resolve()
        if request.json.get('open'):
            if os.name!='nt':raise ValueError('Mở thư mục trực tiếp được hỗ trợ trên Windows.')
            folder.mkdir(parents=True,exist_ok=True)
            try:
                subprocess.Popen(['explorer.exe',str(folder)],shell=False)
            except OSError:
                try:os.startfile(str(folder))
                except OSError as e:raise ValueError('Không mở được Explorer. Thư mục dự án: '+str(folder)) from e
        return jsonify(folder=str(folder))

@app.get('/download-project/<pid>')
def download_project(pid):
    with lock:
        p=projects.get(pid)
        if not p:raise ValueError('Không tìm thấy dự án.')
        return send_file(io.BytesIO(zip_bytes(DATA,p)),as_attachment=True,download_name='du_an_'+pid[:8]+'.zip',mimetype='application/zip')
@app.post('/api/save')
def save():
    with lock:
        p=getp()
        if any(c['status'] in ('queued','sending','sent','waiting','saving') for c in p['commands']):raise ValueError('Dừng và xử lý yêu cầu đang chờ trước khi đổi đầu vào.')
        for key in ('name','script','thumbnail_style','style','auto_split'):p[key]=request.json.get(key,p[key])
        persist(p);return jsonify(ok=True)
@app.post('/api/scene')
def edit_scene():
    with lock:
        p=getp();action=request.json['action']
        if action=='add':p['scenes'].append(scene())
        else:
            s=gets(p)
            if s['status'] in ('sending','sent','waiting','saving','queued'):raise ValueError('Cảnh đang xử lý; hãy dừng trước.')
            if s.get('analysis_draft'):raise ValueError('Cảnh đang phân tích. Đợi hoàn thành rồi chỉnh sửa.')
            if action=='edit':
                old_source=s['source'];old_prompt=s['prompt']
                for key in ('title','source','prompt'):s[key]=str(request.json.get(key,s[key]))
                if s.get('filled_template') and s['source']!=old_source and s['prompt']==old_prompt:
                    s['prompt']=fill_template(p['thumbnail_style'] if s['kind']=='thumbnail' else p['style'],p['script'] if s['kind']=='thumbnail' else s['source'])
            elif action=='delete':p['scenes'].remove(s)
            elif action=='move':
                i=p['scenes'].index(s);j=max(0,min(len(p['scenes'])-1,i+int(request.json['delta'])));p['scenes'].insert(j,p['scenes'].pop(i))
            elif action=='version':
                if not any(v['id']==request.json['version'] for v in s['versions']):raise ValueError('Phiên bản không tồn tại.')
                s['selected']=request.json['version'];s['status']='done'
        persist(p);return jsonify(ok=True)
@app.post('/api/local-split')
def local_split():
    global running,active
    with lock:
        p=getp()
        if any(not s.get('analysis_draft') for s in p['scenes']):raise ValueError('Đã có danh sách cảnh. Tạo dự án mới để tách lại, giữ nguyên kết quả cũ.')
        for c in p['commands']:
            if c['kind']=='plan' and c['status']!='done':c['status']='abandoned'
        running=False
        if active and active[0]==p['id']:active=None
        build_local_scenes(p,request.json.get('target',350));p['plan_error']='';persist(p);return jsonify(ok=True,count=len(p['scenes']))
@app.post('/api/diagnostics')
def diagnostics():
    with lock:
        p=getp();age=round(time.time()-connection['last']) if connection['last'] else None
        commands=[{'kind':c['kind'],'status':c['status'],'seconds':round(time.time()-c['created']),'error':c.get('error',''),'scene_title':next((s['title'] for s in p['scenes'] if s['id']==c['scene_id']),'Phân tích AI')} for c in p['commands'] if c['status'] not in ('done','abandoned')]
        return jsonify(server='Máy chủ Studio đang phản hồi',heartbeat_age=age,tab_ready=connection['ready'],url=connection['url'],running=running,commands=commands,images=sum(selected(s) is not None for s in p['scenes']),total=len(p['scenes']))
@app.post('/api/plan')
def plan():
    global running
    with lock:
        p=getp()
        if not p['script'].strip():raise ValueError('Nhập kịch bản trước.')
        if any(not s.get('analysis_draft') for s in p['scenes']):raise ValueError('Dự án đã có cảnh hoàn tất. Tạo dự án mới để phân tích lại, giữ nguyên kết quả cũ.')
        old=next((c for c in p['commands'] if c['kind']=='plan' and c['status'] not in ('done','abandoned')),None)
        if old:
            old['status']='waiting' if old['status']!='queued' else 'queued';old['error']='';old['wait_cycle']=old.get('wait_cycle',0)+1
        else:queue_command(p,'plan',plan_prompt(p))
        p['plan_status']='queued';p['plan_error']='';running=True;persist(p);return jsonify(ok=True)
@app.post('/api/thumbnail-only')
def thumbnail_only():
    global running,active
    with lock:
        p=getp();prompt=str(request.json.get('prompt','')).strip()
        if not prompt:raise ValueError('Nhập đầy đủ prompt thumbnail trước.')
        if any(c['kind']=='image' and c['status'] in ('sending','sent','waiting','saving') for c in p['commands']):raise ValueError('Có yêu cầu tạo ảnh chưa rõ kết quả. Dừng và kiểm tra ChatGPT trước.')
        running=False
        for c in p['commands']:
            if c['kind']=='plan' and c['status']!='done':c['status']='abandoned'
        if active and active[0]==p['id']:active=None
        p['plan_status']='idle';p['plan_error']='';p['thumbnail_style']=prompt
        p['scenes']=[s for s in p['scenes'] if not s.get('analysis_draft')]
        s=next((s for s in p['scenes'] if s['kind']=='thumbnail'),None)
        if not s:
            s=scene('Thumbnail','Tạo trực tiếp từ prompt đã nhập',prompt,'thumbnail');s['filled_template']=True;p['scenes'].insert(0,s)
        elif not s.get('versions') and not s.get('command'):s['prompt']=prompt;s['filled_template']=True
        persist(p);return jsonify(ok=True,scene=s['id'])
def validate_analysis_settings(p,d):
    if p.get('analysis_inputs'):
        proposed={**p,**{k:str(d[k]) for k in ('visual_style','style','thumbnail_style','script') if k in d}}
        if not analysis.current(proposed):raise ValueError('Phong cách hoặc nội dung đã đổi; phân tích lại trước khi tạo ảnh.')

def task_reason(p,c):
    status=c['status']
    if status=='awaiting_download':return 'Đã gửi prompt, đang chờ ảnh tải về. Thư mục nhận: '+str(p.get('download_folder') or 'chưa chọn')+('. Theo dõi thư mục chưa bật.' if p['id'] not in watches else '')
    if c.get('error'):return c['error']
    if status=='paused':return 'Tác vụ đã được tạm dừng; cần xử lý hoặc ngừng theo dõi.'
    if not connection.get('ready') or time.time()-connection['last']>=90:return 'Chưa có kết nối ChatGPT sẵn sàng.'
    if not running:return 'Hàng đợi đang tạm dừng. Bấm Tiếp tục hàng đợi hoặc kết thúc tác vụ.'
    return {'queued':'Đang xếp hàng, chờ tác vụ trước hoàn tất và ChatGPT sẵn sàng.','sending':'Tiện ích đang gửi prompt.','sent':'Đã gửi prompt; đang chờ phản hồi ChatGPT.','waiting':'Đang đợi phản hồi ChatGPT.','saving':'Đang lưu kết quả.','image_ready':'Đã phát hiện ảnh nhưng chưa nhận file.'}.get(status,'Cần kiểm tra tác vụ trong dự án.')

def analysis_blockers():
    return [{'id':c['id'],'project_id':p['id'],'project':p['name'],'scene_id':c.get('scene_id'),'reason':task_reason(p,c),'status':c['status'],'kind':c['kind'],'title':next((x['title'] for x in p['scenes'] if x['id']==c.get('scene_id')),'Phân tích kịch bản')} for p in projects.values() for c in p['commands'] if c['status'] not in ('done','abandoned')]

@app.post('/api/analysis-blockers')
def list_analysis_blockers():
    with lock:
        getp();items=analysis_blockers()
        reason='Có '+str(len(items))+' tác vụ chưa hoàn tất.' if items else 'Không có tác vụ đang chặn.'
        if not running:reason+=' Hàng đợi đang tạm dừng.'
        if not connection.get('ready') or time.time()-connection['last']>=90:reason+=' Chưa kết nối ChatGPT sẵn sàng.'
        return jsonify(blockers=items,reason=reason)

@app.post('/api/delete-project')
def delete_project():
    global active,running
    with lock:
        p=getp()
        if request.json.get('confirmed') is not True:raise ValueError('Xác nhận xóa đúng dự án trước.')
        if any(sp.get('status') in ('running','queued') for scene in p['scenes'] for sp in scene.get('split',{}).values()):raise ValueError('Đợi tách ảnh hoàn tất trước khi xóa dự án.')
        # Keep a recoverable copy outside the startup project scan.
        archived=json.loads(json.dumps(p));archived['deleted_at']=time.time()
        for c in archived['commands']:
            if c['status'] not in ('done','abandoned'):c.update(status='abandoned',finished_at=time.time())
        trash=DATA/'_deleted';trash.mkdir(exist_ok=True)
        destination=trash/(p['id']+'_'+uuid.uuid4().hex[:8]);source=DATA/p['id']
        source.rename(destination)
        try:atomic(destination/'project.json',archived)
        except Exception:
            destination.rename(source);raise
        watches.pop(p['id'],None)
        if active and active[0]==p['id']:active=None;running=False
        del projects[p['id']]
        return jsonify(ok=True)

@app.post('/api/abandon-blockers')
def abandon_blockers():
    global running
    with lock:
        getp();ids=request.json.get('ids')
        if request.json.get('confirmed') is not True or not isinstance(ids,list) or not ids:raise ValueError('Xem danh sách và xác nhận tác vụ cần ngừng theo dõi.')
        known={x['id'] for x in analysis_blockers()}
        if any(not isinstance(x,str) or x not in known for x in ids):raise ValueError('Danh sách đã thay đổi. Mở lại danh sách để kiểm tra.')
        for p in projects.values():
            for c in p['commands']:
                if c['id'] in ids:
                    release_job(p,c,'Người dùng chủ động ngừng theo dõi để xử lý hàng đợi.',status='paused')
                    if c.get('scene_id')==p.get('download_receiver'):p.pop('download_receiver',None)
                    if c.get('layout_job'):
                        p.update(analysis_stage='cancelled',layout_status='Đã ngừng theo dõi phân tích.')
                        if p.get('analysis_pipeline'):p['analysis_pipeline']['status']='cancelled'
            persist(p)
        running=False
        return jsonify(ok=True)

@app.post('/api/layout-analysis')
def layout_analysis():
    global running
    with lock:
        p=getp();mode=request.json.get('mode','rows')
        if mode not in ('rows','script'):raise ValueError('Chế độ phân tích không hợp lệ.')
        # Failed analysis jobs can be explicitly retried; never resend an uncertain image job.
        for c in p['commands']:
            if c.get('layout_job') and c['status']=='error':c['status']='abandoned'
        if mode=='script':
            # Five-part analysis owns the text-analysis lane. Retire every older
            # analysis command in this project so a stale stage=plan prompt can
            # never be polled after the user starts the new semantic workflow.
            for c in p['commands']:
                if c.get('layout_job') and c['status'] not in ('done','abandoned'):
                    c['status']='abandoned';c['finished_at']=time.time()
        blockers=analysis_blockers()
        if blockers:return jsonify(error='Có tác vụ chưa hoàn tất: '+blockers[0]['project']+' / '+blockers[0]['title']+'. Bấm Xử lý tác vụ chặn để xem.',blockers=blockers),409
        snapshot=analysis.inputs(p,mode)
        if mode=='script':
            if not snapshot['script']:raise ValueError('Nhập toàn bộ kịch bản trước.')
            if p['scenes']:raise ValueError('Dự án đã có cảnh/ảnh. Tạo dự án mới để tự chia lại kịch bản; kết quả cũ được giữ nguyên.')
        elif not snapshot['rows']:raise ValueError('Nhập nội dung các dòng trước.')
        if mode=='script':
            pipeline.start(p,snapshot)
        else:
            c=queue_command(p,'plan',analysis.draft_prompt(snapshot))
            c.update(layout_job=True,layout_stage='draft',layout_snapshot=snapshot,layout_expected_rows=snapshot['rows'],analysis_prompt_version=44,url='')
            p.update(analysis_stage='draft',layout_status='Lượt 1/2 · Phân tích các dòng đã nhập')
        running=True;persist(p);return jsonify(ok=True)

@app.post('/api/analysis-approve-part')
def analysis_approve_part():
    global running
    with lock:
        p=getp();state=p.get('analysis_pipeline')
        if not state:raise ValueError('Chưa có phiên phân tích kịch bản.')
        if analysis.signature(state['snapshot'])!=analysis.signature(analysis.inputs(p,'script')):raise ValueError('Kịch bản đã thay đổi. Cần phân tích lại từ đầu.')
        if any(c.get('pipeline_id')==state['id'] and c['status'] not in ('done','abandoned') for c in p['commands']):raise ValueError('Tác vụ phân tích hiện tại chưa kết thúc.')
        pipeline.approve_part(p);running=state['stage']=='analyzing_part';persist(p);return jsonify(ok=True,stage=state['stage'])

@app.post('/api/analysis-reanalyze-part')
def analysis_reanalyze_part():
    global running
    with lock:
        p=getp();state=p.get('analysis_pipeline')
        if not state:raise ValueError('Chưa có phiên phân tích kịch bản.')
        if analysis.signature(state['snapshot'])!=analysis.signature(analysis.inputs(p,'script')):raise ValueError('Kịch bản đã thay đổi. Cần phân tích lại từ đầu.')
        if any(c.get('pipeline_id')==state['id'] and c['status'] not in ('done','abandoned') for c in p['commands']):raise ValueError('Tác vụ phân tích hiện tại chưa kết thúc.')
        pipeline.reanalyze_part(p);running=True;persist(p);return jsonify(ok=True)

@app.post('/api/analysis-resume')
def analysis_resume():
    global running
    with lock:
        p=getp();state=p.get('analysis_pipeline')
        if not state or state['stage'] in ('awaiting_approval','analysis_complete'):raise ValueError('Không có phần đang gửi dở. Nếu đang chờ duyệt, hãy Duyệt hoặc Phân tích lại phần hiện tại.')
        if analysis.signature(state['snapshot'])!=analysis.signature(analysis.inputs(p,state['snapshot']['mode'])):raise ValueError('Đầu vào đã đổi. Cần bắt đầu phân tích mới.')
        if request.json.get('confirmed') is not True:raise ValueError('Xác nhận gửi lại phần chưa hoàn tất; các phần đã lưu được giữ nguyên.')
        pending=[c for c in p['commands'] if c.get('pipeline_id')==state['id'] and c['status'] not in ('done','abandoned')]
        if any(c['status'] not in ('error','paused') for c in pending):raise ValueError('Phần hiện tại còn đang chờ. Dùng Nhận lại kết quả để tránh gửi trùng.')
        pending_ids={c['id'] for c in pending}
        if any(x['id'] not in pending_ids for x in analysis_blockers()):raise ValueError('Có tác vụ khác chưa hoàn tất.')
        for c in pending:c['status']='abandoned'
        state['status']='running';pipeline.queue_next(p,first=True);running=True;persist(p);return jsonify(ok=True)

@app.post('/api/layout-recover')
def layout_recover():
    global active,running
    with lock:
        p=getp();c=next((c for c in reversed(p['commands']) if c.get('layout_job')),None)
        if not c or c['status']=='done':raise ValueError('Không có yêu cầu phân tích bị ngắt để nhận lại.')
        if not (c.get('sent_at') or c.get('sending_at')):raise ValueError('Chưa ghi nhận gửi yêu cầu. Kiểm tra ChatGPT trước khi phân tích mới.')
        if analysis.signature(c['layout_snapshot'])!=analysis.signature(analysis.inputs(p,c['layout_snapshot']['mode'])):raise ValueError('Đầu vào đã đổi; không thể gắn kết quả cũ vào nội dung mới.')
        if any(x['id']!=c['id'] for x in analysis_blockers()):raise ValueError('Xử lý các tác vụ khác trước khi nhận lại phân tích.')
        c.update(status='waiting',error='',recover_plan=True,wait_cycle=c.get('wait_cycle',0)+1,progress_at=time.time());c.pop('finished_at',None)
        if c.get('pipeline_id'):p['analysis_pipeline']['status']='running'
        p.update(analysis_stage=c['layout_stage'],layout_status=(pipeline.describe(p['analysis_pipeline']) if c.get('pipeline_id') else 'Đang nhận lại phân tích')+' · Đọc phản hồi cũ, không gửi lại prompt.')
        active=[p['id'],c['id']];running=True;persist(p);return jsonify(ok=True)

@app.post('/api/analysis-import')
def analysis_import():
    with lock:
        p=getp();text=str(request.json.get('text',''))
        if not text.strip() or len(text)>1000000:raise ValueError('Dán câu trả lời JSON hoàn chỉnh, tối đa 1 MB.')
        data=analysis.document(text)
        c=next((c for c in p['commands'] if c['id']==data.get('job_id') and c.get('pipeline_id')),None)
        if not c or c['status'] in ('done','abandoned'):raise ValueError('Kết quả không thuộc phần đang chờ hoặc phần này đã được lưu/hủy.')
        if any(x['id']!=c['id'] for x in analysis_blockers()):raise ValueError('Xử lý tác vụ khác trước khi nhập kết quả này.')
        # Use the same input, identity, completeness and ordering validation as the bridge.
        response=process_bridge_result(dict(id=c['id'],phase='done',text=text))
        result=response.get_json()
        if result.get('analysis_error'):return jsonify(error=result['analysis_error']),400
        return response

@app.post('/api/layout-cancel')
def layout_cancel():
    global active,running
    with lock:
        p=getp()
        for c in p['commands']:
            if c.get('layout_job') and c['status'] not in ('done','abandoned'):
                c.update(status='abandoned',finished_at=time.time())
                if active and active[1]==c['id']:active=None
        if p.get('analysis_pipeline'):p['analysis_pipeline']['status']='cancelled'
        p.update(layout_status='Đã hủy phân tích. Nếu ChatGPT còn trả lời, dừng trong tab ChatGPT trước khi phân tích lại.',analysis_stage='cancelled')
        running=any(c['status']=='queued' for project in projects.values() for c in project['commands']);persist(p);return jsonify(ok=True)

@app.post('/api/layout-save')
def layout_save():
    with lock:
        p=getp();slot=request.json.get('slot');entry=p.get('scene_layouts',{}).get(slot)
        if not entry:raise ValueError('Chưa có phương án cho dòng này.')
        if p.get('analysis_inputs') and not analysis.current(p):raise ValueError('Đầu vào đã đổi; phân tích lại trước khi duyệt.')
        if any(c['status'] not in ('done','abandoned') for c in p['commands']):raise ValueError('Xử lý xong tác vụ trước khi sửa phương án.')
        values={k:str(request.json.get(k,'')).strip() for k in LAYOUT_FIELDS}
        if not all(values.values()):raise ValueError('Điền đầy đủ phương án.')
        entry.update(values,approved=True);p['analysis_warnings']=analysis.repetition_warnings(p['scene_layouts']);persist(p);return jsonify(ok=True)

@app.post('/api/drafts')
def drafts():
    with lock:
        p=getp();d=request.json
        rows=d.get('rows',[])
        if not isinstance(rows,list) or len(rows)>201:raise ValueError('Danh sách nội dung không hợp lệ.')
        normalized=[];seen=set()
        for row in rows:
            slot=str(row.get('slot',''))
            if slot!='thumbnail' and not (slot.startswith('scene-') and slot[6:].isdigit() and 1<=int(slot[6:])<=200):raise ValueError('Dòng ảnh không hợp lệ.')
            if slot in seen:raise ValueError('Dòng ảnh bị trùng.')
            seen.add(slot);normalized.append(dict(slot=slot,source=str(row.get('source',''))))
        p['manual_drafts']=normalized
        if 'capture_images' in d:p['capture_images']=bool(d['capture_images'])
        for key in ('name','thumbnail_style','style','visual_style','script'):
            if key in d:p[key]=str(d[key])
        persist(p);return jsonify(ok=True)
@app.post('/api/batch-images')
def batch_images():
    global running
    with lock:
        p=getp();d=request.json;validate_analysis_settings(p,d);
        flow=p.get('analysis_pipeline');
        if flow and flow.get('stage') not in ('analysis_complete','visual_ready'):raise ValueError('Hoàn tất toàn bộ các phần phân tích trước khi tạo ảnh.');entries=d.get('rows',[])
        if not isinstance(entries,list) or len(entries)>201:raise ValueError('Danh sách ảnh không hợp lệ.')
        prepared=[];seen=set();skipped=0
        for item in entries:
            source=str(item.get('source','')).strip();slot=str(item.get('slot',''))
            if not source:continue
            if slot in seen:raise ValueError('Dòng ảnh bị trùng.')
            seen.add(slot)
            if slot!='thumbnail' and not (slot.startswith('scene-') and slot[6:].isdigit() and 1<=int(slot[6:])<=200):raise ValueError('Dòng ảnh không hợp lệ.')
            kind='thumbnail' if slot=='thumbnail' else 'scene';template=str(d.get('thumbnail_style' if kind=='thumbnail' else 'style','')).strip()
            if not template:raise ValueError('Nhập mẫu prompt chung trước.')
            sid=item.get('scene');target=next((x for x in p['scenes'] if x['id']==sid),None) if sid else next((x for x in p['scenes'] if x.get('manual_slot')==slot),None)
            if sid and not target:raise ValueError('Không tìm thấy dòng ảnh.')
            if target and target['status']!='pending':skipped+=1;continue
            layout_prompt(p,dict(source=source,kind=kind,prompt='',filled_template=True,manual_slot=slot))
            prepared.append((target,slot,kind,source,template))
        for target,slot,kind,source,template in prepared:
            if not target:target=scene();p['scenes'].append(target)
            target.update(manual_slot=slot,title='Thumbnail' if kind=='thumbnail' else 'Ảnh nội dung '+slot[6:],source=source,kind=kind,prompt=fill_template(template,source),filled_template=True)
            c=enqueue_scene(p,target);c.update(url='',download_only=not bool(d.get('capture_images',False)))
        if prepared:
            p.update(name=str(d.get('name',p['name'])),thumbnail_style=str(d.get('thumbnail_style',p['thumbnail_style'])),style=str(d.get('style',p['style'])),auto_split=False)
            running=True;persist(p)
        return jsonify(ok=True,queued=len(prepared),skipped=skipped)
@app.post('/api/queue-control')
def queue_control():
    global running
    with lock:
        getp();action=request.json.get('action')
        if action not in ('pause','resume'):raise ValueError('Thao tác không hợp lệ.')
        running=action=='resume'
        if not running:
            for project in projects.values():
                for command in project['commands']:command.pop('resume_after_download',None)
        return jsonify(ok=True,running=running)
@app.post('/api/manual-image')
def manual_image():
    global running
    with lock:
        p=getp();d=request.json;validate_analysis_settings(p,d);
        flow=p.get('analysis_pipeline');
        if flow and flow.get('stage') not in ('analysis_complete','visual_ready'):raise ValueError('Hoàn tất toàn bộ các phần phân tích trước khi tạo ảnh.');source=str(d.get('source','')).strip();kind=d.get('kind','scene')
        if not source:raise ValueError('Nhập nội dung ảnh trước.')
        if kind not in ('thumbnail','scene'):raise ValueError('Loại ảnh không hợp lệ.')
        template=str(d.get('thumbnail_style' if kind=='thumbnail' else 'style','')).strip()
        if not template:raise ValueError('Nhập mẫu prompt cho loại ảnh đã chọn.')
        slot=d.get('slot')
        if slot is not None:
            if kind=='thumbnail' and slot!='thumbnail':raise ValueError('Dòng thumbnail không hợp lệ.')
            if kind=='scene' and not (isinstance(slot,str) and slot.startswith('scene-') and slot[6:].isdigit() and 1<=int(slot[6:])<=200):raise ValueError('Dòng nội dung không hợp lệ.')
        layout_prompt(p,dict(source=source,kind=kind,prompt='',filled_template=True,manual_slot=slot))
        target=gets(p) if d.get('scene') else next((s for s in p['scenes'] if slot and s.get('manual_slot')==slot),None)
        if target and target['status']=='done' and not d.get('redo'):raise ValueError('Ảnh đã hoàn thành. Bấm Làm lại để tạo phiên bản mới.')
        if target and target['status'] in ('queued','sending','sent','waiting','saving','waiting_download'):raise ValueError('Dừng ảnh trước khi làm lại.')
        p['thumbnail_style']=str(d.get('thumbnail_style',p['thumbnail_style']));p['style']=str(d.get('style',p['style']));p['name']=str(d.get('name',p['name']));p['auto_split']=False
        if not target:
            target=scene(('Thumbnail' if kind=='thumbnail' else 'Ảnh nội dung')+' '+str(len(p['scenes'])+1));p['scenes'].append(target)
        target.update(source=source,kind=kind,prompt=fill_template(template,source),filled_template=True)
        if slot:
            target['manual_slot']=slot
            target['title']='Thumbnail' if slot=='thumbnail' else 'Ảnh nội dung '+slot[6:]
        target.pop('stopped_at',None)
        command=enqueue_scene(p,target,redo=bool(d.get('redo')));command.update(url='',download_only=not bool(d.get('capture_images',False)));running=True;persist(p);return jsonify(ok=True,scene=target['id'])
@app.post('/api/run')
def run():
    global running
    with lock:
        p=getp();sid=request.json.get('scene');redo=request.json.get('redo',False)
        flow=p.get('analysis_pipeline')
        if flow and flow.get('stage') not in ('analysis_complete','visual_ready'):raise ValueError('Hoàn tất toàn bộ các phần phân tích trước khi tạo ảnh.')
        if p.get('plan_status')=='streaming' or any(s.get('analysis_draft') for s in p['scenes']):raise ValueError('Đợi phân tích hoàn thành trước khi tạo ảnh.')
        targets=[gets(p)] if sid else [s for s in p['scenes'] if s['status']!='done']
        if redo and not request.json.get('confirmed'):raise ValueError('Tạo lại cần xác nhận vì có thể gửi yêu cầu mới.')
        for s in targets:
            if s['status']=='done' and not redo:continue
            if not s['prompt'].strip():raise ValueError('Cảnh thiếu prompt.')
            enqueue_scene(p,s,redo)
        running=True;persist(p);return jsonify(ok=True)
@app.post('/api/stop')
def stop():
    global running
    with lock:
        p=getp();sid=request.json.get('scene')
        for c in p['commands']:
            if sid and c['scene_id']!=sid:continue
            if c['status'] in ('queued','sending','sent','waiting','saving','awaiting_download','paused','error'):
                release_job(p,c,'',status='paused')
        if sid and p.get('download_receiver')==sid:p.pop('download_receiver',None)
        if sid:
            target=next((x for x in p['scenes'] if x['id']==sid),None)
            if target and target['status']=='waiting_download':target.update(status='paused',stopped_at=time.time())
        running=any(c['status']=='queued' for project in projects.values() for c in project['commands'])
        persist(p);return jsonify(ok=True)
@app.post('/bridge/heartbeat')
def bridge_heartbeat():
    with lock:
        d=request.json
        if connection['client'] and d.get('client')!=connection['client']:return jsonify(error='Kết nối đã chuyển sang tab khác. Bấm Chuyển kết nối sang tab này nếu muốn đổi lại.'),409
        connection.update(last=time.time(),ready=bool(d.get('ready')),client=d['client'],browser=d.get('browser',''),url=d.get('url',''))
        connection['bridge_diagnostics']=d.get('diagnostics',{})
        return jsonify(ok=True)
@app.post('/bridge/bind')
def bridge_bind():
    global running
    with lock:
        d=request.json or {}
        if not d.get('client') or not str(d.get('url','')).startswith('https://chatgpt.com/'):raise ValueError('Tab ChatGPT không hợp lệ.')
        if connection['client'] and connection['client']!=d['client']:
            for p in projects.values():
                for c in p['commands']:
                    if c['status'] in ('sending','sent','waiting','saving','awaiting_download'):
                        release_job(p,c,'Đã chuyển tab kết nối. Tác vụ cũ ngừng theo dõi; nhận ảnh bằng Nhập ảnh hoặc chủ động Làm lại để tránh gửi trùng.')
        connection.update(last=time.time(),poll_last=0,ready=bool(d.get('ready')),client=d['client'],browser=d.get('browser',''),url=d['url'])
        running=any(c['status']=='queued' for p in projects.values() for c in p['commands'])
        return jsonify(ok=True)

@app.post('/bridge/unbind')
def bridge_unbind():
    with lock:
        if request.json.get('client')==connection['client']:connection.update(client='',ready=False,last=0,poll_last=0,url='')
        return jsonify(ok=True)
@app.post('/bridge/poll')
def bridge_poll():
    global active,running
    with lock:
        d=request.json
        if connection['client'] and d['client']!=connection['client']:return jsonify(error='Kết nối đã chuyển sang tab khác.'),409
        connection.update(last=time.time(),poll_last=time.time(),ready=bool(d.get('ready')),client=d['client'],browser=d.get('browser',''),url=d.get('url',''))
        scan_downloads()
        expire_jobs()
        # The download barrier survives UI actions that clear the active pointer.
        pending_downloads=[(p,c) for p in projects.values() for c in p['commands'] if c['status']=='awaiting_download']
        if pending_downloads:
            p,c=min(pending_downloads,key=lambda pair:pair[1]['created'])
            active=[p['id'],c['id']]
            return jsonify(command=c,paused=False)
        if active:
            pid,cid=active;p=projects.get(pid);c=next((c for c in p['commands'] if c['id']==cid),None) if p else None
            if c and c['status']=='awaiting_download':return jsonify(command=c,paused=False)
            if c and c['status']=='image_ready':return jsonify(command=c,paused=False)
            if c and c['status'] in ('sending','sent','waiting','saving'):
                return jsonify(command=c if running and c['status']!='paused' else None,paused=not running)
            active=None
        if not running or not connection['ready']:return jsonify(command=None,paused=not running)
        jobs=[(p,c) for p in projects.values() for c in p['commands'] if c['status'] in ('waiting','sent','sending','queued','awaiting_download')]
        if jobs:
            p,c=min(jobs,key=lambda item:(not item[1].get('receive_only',False),item[1]['created']))
            if c['status']=='queued' and d.get('generating'):return jsonify(command=None,paused=False)
            active=[p['id'],c['id']];return jsonify(command=c,paused=False)
        return jsonify(command=None,paused=False)

@app.post('/bridge/download-complete')
def download_complete():
    with lock:
        d=request.json or {}
        if d.get('client')!=connection['client']:raise ValueError('Sai kết nối tiện ích.')
        path=Path(str(d.get('filename',''))).resolve()
        if path.suffix.lower() not in ('.png','.jpg','.jpeg','.webp'):return jsonify(ok=True,ignored=True)
        matching=[w for w in watches.values() if path.parent==w.folder]
        if not matching:return jsonify(ok=True,ignored=True)
        download_signals[str(path)]=time.time()
        scan_downloads()
        return jsonify(ok=True)
@app.post('/bridge/result')
def bridge_result():
    return process_bridge_result(request.json,check_client=True)

def process_bridge_result(d,check_client=False):
    global active,running
    with lock:
        if check_client and connection['client']!=d.get('client'):raise ValueError('Sai tab kết nối.')
        p=next((p for p in projects.values() if any(c['id']==d['id'] for c in p['commands'])),None)
        if not p:raise ValueError('Không tìm thấy công việc.')
        c=next(c for c in p['commands'] if c['id']==d['id']);s=next((s for s in p['scenes'] if s['id']==c['scene_id']),None)
        if c['status'] in ('done','abandoned'):return jsonify(ok=True)
        if s and s.get('command')!=c['id']:return jsonify(ok=True,ignored=True)
        phase=d['phase']
        if c.get('layout_job') and str(d.get('url','')).startswith('https://chatgpt.com/c/'):
            c['url']=d['url'];p['analysis_conversation']=d['url']
        if c.get('download_only') and (c['status']=='awaiting_download' or phase in ('waiting','saving','image_ready','done')):return jsonify(ok=True,awaiting_download=True)
        if c['status']=='paused' and phase!='done':return jsonify(ok=True,paused=True)
        if phase in ('sending','sent','waiting','saving'):
            if c['status']!=phase:c['progress_at']=time.time()
            if phase=='sending':c.setdefault('sending_at',time.time())
            if phase=='sent':c.setdefault('sent_at',time.time())
            c['status']=phase;c['url']=d.get('url',c['url'])
            if c.get('layout_job'):p['analysis_conversation']=c['url']
            else:p['conversation']=c['url']
            if s:s['status']=phase
            if phase=='sent' and c.get('download_only'):
                c['status']='awaiting_download'
                if s:s.update(status='waiting_download',download_started=time.time())
        elif phase=='image_ready':
            c.setdefault('restore_running',running);running=False;c.update(status='image_ready',image_ready_at=time.time())
            if s:s.update(status='image_ready',stopped_at=time.time(),error='')
        elif phase=='partial' and c.get('layout_job'):
            text=str(d.get('text',''))[:1000000]
            if text!=c.get('response_text',''):c['progress_at']=time.time()
            c.update(response_text=text,last_seen_at=time.time());p['layout_received_chars']=len(text)
            p['layout_status']=(pipeline.describe(p['analysis_pipeline']) if c.get('pipeline_id') else ('Lượt 1/2' if c['layout_stage']=='draft' else 'Lượt 2/2'))+' · '+('Đang nhận phản hồi' if text else 'Đã gửi, chờ ChatGPT trả lời')
        elif phase=='partial' and c.get('layout_rows'):
            p['layout_status']='Đang phân tích…'
        elif phase=='partial' and c['kind']=='plan':
            text=d.get('text','')[:500000];p['plan_received_chars']=len(text);p['plan_partial']=text;items=parse_objects(text)
            if items:merge_analysis(p,items)
            else:p['plan_status']='streaming'
        elif phase=='send_unconfirmed' and c.get('download_only') and s:
            c.update(status='awaiting_download',resume_after_download=running,send_unconfirmed=True,error=d.get('error',''))
            s.update(status='waiting_download',download_started=c.get('sent_at',c['created']),error='Chưa xác nhận gửi. Nếu ChatGPT đã tạo ảnh, tải về đúng thư mục; phần mềm vẫn tự nhận. Nếu prompt còn trong ô, bấm Gửi một lần.')
            active=[p['id'],c['id']];running=False
        elif phase in ('error','send_unconfirmed'):
            if c.get('layout_job'):
                c.update(status='error',error=d.get('error','Cần kiểm tra'),finished_at=time.time());active=None
                if p.get('analysis_pipeline'):
                    p['analysis_pipeline']['status']='error'
                    n=p['analysis_pipeline'].get('current_part');p['analysis_pipeline'].setdefault('part_status',{}).setdefault(str(n),{'scene_count':0}) .update(status='error',error=c.get('error','Cần kiểm tra'))
            elif c.get('image_ready_at'):
                c['status']='image_ready';active=None
                if s:s.update(status='image_ready',error=d.get('error','Chưa đồng bộ được ảnh'))
            else:release_job(p,c,d.get('error','Cần kiểm tra'))
            running=False
            if not s:p.update(plan_status='error',plan_error=c['error'])
            if c.get('layout_job') or c.get('layout_rows'):p.update(layout_status='Lỗi phân tích: '+c['error'],analysis_stage='error')
        elif phase=='done':
            if c.get('layout_job'):
                c['response_text']=str(d.get('text',''))[:1000000];c['last_seen_at']=time.time()
                snapshot=c['layout_snapshot']
                try:
                    if analysis.signature(snapshot)!=analysis.signature(analysis.inputs(p,snapshot['mode'])):raise ValueError('Đầu vào đã đổi trong khi phân tích. Bấm phân tích lại.')
                    if c.get('pipeline_id'):
                        running=pipeline.accept(p,c,d.get('text',''))
                    else:data,rows,layouts=analysis.validate(d.get('text',''),snapshot,c.get('layout_expected_rows'))
                except (ValueError,TypeError,AttributeError) as error:
                    c.update(status='error',error=str(error),finished_at=time.time());active=None;running=False
                    p.update(layout_status='Lỗi phân tích: '+str(error),analysis_stage='error')
                    if p.get('analysis_pipeline'):p['analysis_pipeline']['status']='error'
                    persist(p);return jsonify(ok=True,analysis_error=str(error))
                if c.get('pipeline_id'):pass
                elif c['layout_stage']=='draft':
                    p['analysis_draft']=data
                    next_command=queue_command(p,'plan',analysis.review_prompt(snapshot,data))
                    next_command.update(layout_job=True,layout_stage='review',layout_snapshot=snapshot,layout_expected_rows=rows,url=p.get('analysis_conversation',''),analysis_prompt_version=44)
                    p.update(layout_status='Lượt 2/2 · So sánh các cảnh, rà soát bố cục và phong cách',analysis_stage='review');running=True
                else:
                    p.update(scene_layouts=layouts,analysis_inputs=snapshot,analysis_style_rules=data['style_rules'],analysis_continuity=data['continuity'],analysis_warnings=analysis.repetition_warnings(layouts),analysis_stage='ready',layout_status='Đã rà soát 2 lượt — xem và duyệt phương án')
                    p['analysis_revision']=p.get('analysis_revision',0)+1
                    if snapshot['mode']=='script':p['manual_drafts']=rows;p['analysis_planned_rows']=[dict(row) for row in rows]
                    running=False
            elif c.get('layout_rows'):
                p['scene_layouts']=accept_layouts(d['text'],c['layout_rows']);p['layout_status']='Đã phân tích — cần xem và duyệt';running=False
            elif c['kind']=='plan':
                parsed=parse_plan(d['text'],p);merge_analysis(p,[{'title':s['title'],'source':s['source']} for s in parsed],final=True);p.update(plan_status='done',plan_error='');running=False
            else:
                s['status']='saving';raw=base64.b64decode(d['image'].split(',',1)[-1],validate=True);v=save_image(DATA,p,s,raw)
                if p['auto_split']:threading.Thread(target=split_task,args=(p['id'],s['id'],v['id']),daemon=True).start()
            c['status']='done';c['finished_at']=time.time();active=None
            if 'restore_running' in c:running=c['restore_running']
        persist(p);return jsonify(ok=True)
@app.post('/api/image-created')
def image_created():
    global running
    with lock:
        p=getp();target=gets(p)
        if selected(target):return jsonify(ok=True)
        for c in p['commands']:
            if c.get('scene_id')==target['id'] and c['status'] in ('queued','sending','sent','waiting','saving','image_ready'):
                release_job(p,c,'',status='image_ready')
        target.update(status='image_ready',stopped_at=time.time(),error='',user_confirmed_created=True)
        running=False;persist(p);return jsonify(ok=True)
@app.post('/api/pick-image')
def pick_image():
    global running
    with lock:
        p=getp();target=gets(p)
        if target['status'] in ('queued','sending','sent','waiting','saving','waiting_download'):raise ValueError('Dừng theo dõi dòng này trước khi chọn ảnh.')
        c=queue_command(p,'image','',target['id']);c.update(receive_only=True,pick_image=True,url='',restore_running=running)
        target.update(command=c['id'],status='queued',error='');target.pop('stopped_at',None)
        running=True;persist(p);return jsonify(ok=True)
@app.post('/api/receive-image')
def receive_image():
    global running
    with lock:
        p=getp();target=gets(p)
        if target['status'] in ('queued','sending','sent','waiting','saving','waiting_download'):raise ValueError('Dừng theo dõi ảnh này trước khi nhận lại.')
        ids=[c['id'] for c in p['commands'] if c.get('scene_id')==target['id'] and c['kind']=='image' and not c.get('receive_only')]
        if not ids:raise ValueError('Ảnh này chưa có mã yêu cầu. Dùng Nhập ảnh để chọn file đã tải từ ChatGPT.')
        c=queue_command(p,'image','',target['id']);c.update(receive_only=True,candidate_job_ids=ids,url='',restore_running=running)
        target.update(command=c['id'],status='queued',error='');target.pop('stopped_at',None)
        running=True;persist(p);return jsonify(ok=True)
@app.get('/download-image/<pid>/<sid>')
def download_image(pid,sid):
    with lock:
        p=projects.get(pid);target=next((s for s in p['scenes'] if s['id']==sid),None) if p else None
        v=selected(target) if target else None
        if not v:return '',404
        return send_file(DATA/pid/v['file'],as_attachment=True,download_name=('thumbnail' if target['kind']=='thumbnail' else 'anh_'+str(p['scenes'].index(target)+1))+'.png')
@app.post('/api/import-image')
def import_image():
    global active
    with lock:
        p=projects.get(request.form['project']);s=next((s for s in p['scenes'] if s['id']==request.form.get('scene')),None)
        if not s:s=scene(request.files['image'].filename or 'Ảnh nhập');p['scenes'].append(s)
        if s['status'] in ('sending','sent','waiting','saving'):raise ValueError('Dừng cảnh trước khi nhập ảnh thủ công.')
        save_image(DATA,p,s,request.files['image'].read())
        for c in p['commands']:
            if c['id']==s.get('command'):
                c['status']='abandoned';c['finished_at']=time.time()
                if active==[p['id'],c['id']]:active=None
        s['stopped_at']=time.time()
        if p.get('download_receiver')==s['id']:p.pop('download_receiver',None)
        persist(p);return jsonify(ok=True)
@app.post('/api/import-project')
def import_project():
    # Native folder picker preserves source and copies to new project.
    import tkinter as tk
    from tkinter import filedialog
    root=tk.Tk();root.withdraw();file=filedialog.askopenfilename(title='Chọn project.json của Studio cũ');root.destroy()
    if not file:return jsonify(ok=False)
    old=json.loads(Path(file).read_text(encoding='utf8'))
    with lock:
        p=migrate(old,Path(file).parent,DATA);projects[p['id']]=p;persist(p);return jsonify(p)
@app.post('/api/import-plan')
def import_plan():
    with lock:
        p=getp()
        if p['scenes']:raise ValueError('Tạo dự án mới trước khi nhập phân cảnh.')
        p['scenes']=parse_plan(request.json['text'],p);p['plan_status']='done'
        for c in p['commands']:
            if c['kind']=='plan':c['status']='abandoned'
        persist(p);return jsonify(ok=True)
@app.get('/image/<pid>/<name>')
def image(pid,name):
    p=projects.get(pid)
    if not p or not any(v['file']==name for s in p['scenes'] for v in s['versions']):return '',404
    return send_file(DATA/pid/name)
@app.post('/api/folder')
def folder():
    import tkinter as tk
    from tkinter import filedialog
    root=tk.Tk();root.withdraw();dest=filedialog.askdirectory(title='Chọn thư mục lưu ZIP');root.destroy();return jsonify(path=dest)
@app.post('/api/export')
def export():
    with lock:
        p=getp()
        if any(c['status'] in ('sending','sent','waiting','saving') for c in p['commands']) and running:raise ValueError('Dừng hàng đợi trước khi xuất để có kết quả nhất quán.')
        missing=sum(selected(s) is None for s in p['scenes'])
        if missing and not request.json.get('partial'):return jsonify(missing=missing,needs_partial=True)
        name=request.json.get('name','bo_anh_video.zip')
        if Path(name).name!=name or any(ch in name for ch in '\\/:*?"<>|'):raise ValueError('Tên ZIP không hợp lệ.')
        if not name.lower().endswith('.zip'):name+='.zip'
        dest=Path(request.json.get('folder',''))
        if not dest.is_dir():raise ValueError('Chọn thư mục lưu hợp lệ.')
        path=dest/name
        if path.exists() and not request.json.get('overwrite'):return jsonify(needs_overwrite=True)
        tmp=dest/(name+'.tmp');tmp.write_bytes(zip_bytes(DATA,p));tmp.replace(path);return jsonify(ok=True,path=str(path))
@app.post('/api/login')
def login():
    choice=request.json.get('browser','Edge');url='https://chatgpt.com/'
    if choice=='Firefox':return jsonify(error='Firefox chưa hỗ trợ tiện ích trong bản này. Chọn Edge hoặc Chrome.'),400
    candidates=[]
    if choice=='Edge':candidates=[Path(os.environ.get(k,''))/'Microsoft/Edge/Application/msedge.exe' for k in ('PROGRAMFILES(X86)','PROGRAMFILES','LOCALAPPDATA')]
    else:candidates=[Path(os.environ.get(k,''))/'Google/Chrome/Application/chrome.exe' for k in ('PROGRAMFILES','PROGRAMFILES(X86)','LOCALAPPDATA')]
    exe=next((p for p in candidates if p.is_file()),None)
    if not exe:raise ValueError('Không tìm thấy '+choice+'. Mở trình duyệt đó thủ công và vào chatgpt.com.')
    subprocess.Popen([str(exe),url]);return jsonify(ok=True)
split_mutex=threading.Lock()
@app.get('/split-app/')
def split_ui():return send_file(ROOT/'split_ui.html')

@app.route('/split-app/<path:part>',methods=['GET','POST'])
def split_proxy(part):
    import re
    if not (part=='api/segment' or re.fullmatch(r'api/job/[a-f0-9]{32}|output/[a-f0-9]{32}/[A-Za-z0-9_.-]+',part)):return 'Not found',404
    if request.method=='POST' and request.headers.get('Origin') not in (None,'http://127.0.0.1:7871','http://localhost:7871'):return 'Forbidden',403
    req=urllib.request.Request('http://127.0.0.1:7860/'+part,data=request.get_data() if request.method=='POST' else None,headers={'Content-Type':request.content_type or 'application/json'},method=request.method)
    try:
        with urllib.request.urlopen(req,timeout=30) as result:
            return result.read(),result.status,{'Content-Type':result.headers.get('Content-Type','application/octet-stream')}
    except urllib.error.HTTPError as e:return e.read(),e.code,{'Content-Type':'application/json'}
    except OSError:return jsonify(error='SAM2 chưa chạy. Bấm Mở SAM2 hoặc chạy 2_MO_UNG_DUNG.bat trong thư mục SAM2 đã cài.'),503

@app.post('/api/open-sam')
def open_sam():
    import sys
    global sam_process
    if sam_is_running():return jsonify(ok=True,message='SAM2 đang chạy.')
    if sam_process is not None and sam_process.poll() is None:return jsonify(ok=True,message='SAM2 đang cài hoặc khởi động. Xem cửa sổ vừa mở.')
    folder=ROOT/'SAM2_Tach_Anh'
    sam_process=subprocess.Popen([sys.executable,str(folder/'start_integrated.py')],cwd=str(folder),creationflags=getattr(subprocess,'CREATE_NEW_CONSOLE',0))
    return jsonify(ok=True,message='Đang mở SAM2 tích hợp. Lần đầu sẽ cài thư viện và tải mô hình.')

sam_process=None
def sam_is_running():
    try:
        with urllib.request.urlopen('http://127.0.0.1:7860/',timeout=1) as response:return b'SAM 2' in response.read()
    except OSError:return False

@app.get('/api/sam-status')
def sam_status():
    if sam_is_running():return jsonify(status='ready',message='SAM2 đã sẵn sàng. Có thể tách ảnh.')
    try:d=json.loads((ROOT/'SAM2_Tach_Anh/studio_status.json').read_text(encoding='utf8'))
    except (OSError,ValueError):d={'status':'stopped','message':'Bấm Cài và khởi động SAM2. Lần đầu cần Internet để tải thư viện và mô hình.'}
    return jsonify(d)

def split_task(pid,sid,vid):
    with split_mutex:_split_task(pid,sid,vid)
def _split_task(pid,sid,vid):
    p=projects[pid];s=next(s for s in p['scenes'] if s['id']==sid);v=next(v for v in s['versions'] if v['id']==vid);sp=s['split'].setdefault(vid,{'status':'pending','percent':0})
    try:
        if not sp.get('job'):
            raw=(DATA/pid/v['file']).read_bytes();b=uuid.uuid4().hex
            body=(f'--{b}\r\nContent-Disposition: form-data; name="detail"\r\n\r\n32\r\n--{b}\r\nContent-Disposition: form-data; name="fill"\r\n\r\n1\r\n--{b}\r\nContent-Disposition: form-data; name="image"; filename="image.png"\r\nContent-Type: image/png\r\n\r\n').encode()+raw+f'\r\n--{b}--\r\n'.encode()
            req=urllib.request.Request('http://127.0.0.1:7860/api/segment',data=body,headers={'Content-Type':f'multipart/form-data; boundary={b}'})
            sp['job']=json.load(urllib.request.urlopen(req,timeout=30))['id']
        with lock:sp['status']='running';persist(p)
        while True:
            d=json.load(urllib.request.urlopen('http://127.0.0.1:7860/api/job/'+sp['job'],timeout=15))
            with lock:sp.update(percent=d.get('percent',0),message=d.get('message',''));persist(p)
            if d['status']=='error':raise ValueError(d['message'])
            if d['status']=='done':
                raw=urllib.request.urlopen('http://127.0.0.1:7860/output/'+sp['job']+'/cac_lop.zip',timeout=60).read();name=sid+'_'+vid+'_layers.zip';(DATA/pid/name).write_bytes(raw)
                with lock:sp.update(status='done',percent=100,file=name,error='');persist(p)
                return
            time.sleep(2)
    except Exception as e:
        with lock:sp.update(status='error',error='Mở phần mềm tách SAM2 trước. Chi tiết: '+str(e));persist(p)
@app.post('/api/split')
def split():
    with lock:
        p=getp();s=gets(p);v=selected(s)
        if not v:raise ValueError('Chưa có ảnh.')
        sp=s['split'].get(v['id'],{})
        if sp.get('status') in ('running','queued'):return jsonify(ok=True)
        if sp.get('status')=='done':return jsonify(ok=True)
        if request.json.get('reset'):
            if not request.json.get('confirmed'):raise ValueError('Cần xác nhận gửi lại công việc tách.')
            s['split'][v['id']]={}
        s['split'].setdefault(v['id'],{})['status']='queued';persist(p)
        threading.Thread(target=split_task,args=(p['id'],s['id'],v['id']),daemon=True).start();return jsonify(ok=True)
import sys
from video_routes import register as register_video_routes
register_video_routes(app,sys.modules[__name__])

if __name__=='__main__':
    monitor_stop=threading.Event()
    threading.Thread(target=monitor_downloads,args=(monitor_stop,),daemon=True).start()
    threading.Timer(1.5,lambda:webbrowser.open('http://127.0.0.1:7871')).start()
    app.run(host='127.0.0.1',port=7871,threaded=False,debug=False)
