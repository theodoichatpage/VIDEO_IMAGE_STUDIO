import threading,time,uuid
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from flask import Flask,jsonify,request,send_file
import numpy as np
from PIL import Image,ImageOps
from sam2_adapter import Sam2Adapter
ROOT=Path(__file__).resolve().parent; OUTPUT_ROOT=ROOT/'outputs'; MAX_PIXELS=16_000_000
ALLOWED_ORIGINS={'https://video-image-studio.vercel.app','http://localhost:5173','http://127.0.0.1:5173'}
app=Flask(__name__);app.config['MAX_CONTENT_LENGTH']=30*1024*1024
jobs={};lock=threading.Lock();pool=ThreadPoolExecutor(max_workers=1);adapter=Sam2Adapter(ROOT)
@app.after_request
def cors(response):
    origin=request.headers.get('Origin')
    if origin in ALLOWED_ORIGINS:
        response.headers['Access-Control-Allow-Origin']=origin;response.headers['Vary']='Origin';response.headers['Access-Control-Allow-Methods']='GET,POST,OPTIONS';response.headers['Access-Control-Allow-Headers']='Content-Type'
    return response
@app.route('/v1/<path:_path>',methods=['OPTIONS'])
def preflight(_path):return ('',204)
def classify(layer):
    name=str(layer.get('file',''))
    if name.startswith(('nen_','background_')):return 'background'
    if name.startswith('cum_nguoi_'):return 'person_group'
    if name.startswith('nguoi_'):return 'person'
    if name.startswith('chu_'):return 'text'
    return 'other'
def update(jid,**changes):
    with lock:
        if jid in jobs:jobs[jid].update(changes)
def run_job(jid,rgb,fill):
    def report(percent,message,*_):update(jid,status='processing',progress=max(0,min(100,int(percent))),message=message,updatedAt=time.time())
    try:
        report(2,'Đang chuẩn bị SAM 2.1.');result=adapter.separate(rgb,OUTPUT_ROOT/jid,fill=fill,report=report)
        result['layers']=[dict(layer,type=classify(layer),fileId=layer['file']) for layer in result['layers']]
        update(jid,status='complete',progress=100,message='Hoàn tất',result=result,updatedAt=time.time())
    except Exception as exc:update(jid,status='error',message=str(exc),error=str(exc),updatedAt=time.time())
@app.get('/v1/health')
def health():
    caps=adapter.capabilities();return jsonify(ok=True,version='1.1.0',sam2=caps['sam2'],device=caps['device'],ffmpeg=False)
@app.post('/v1/separate')
def separate():
    if any(j['status'] in ('queued','processing') for j in jobs.values()):return jsonify(error='Đang xử lý một ảnh. Vui lòng đợi.'),409
    upload=request.files.get('image')
    if not upload:return jsonify(error='Chọn ảnh trước.'),400
    if upload.mimetype not in {'image/jpeg','image/png','image/webp'}:return jsonify(error='Chỉ hỗ trợ JPG, PNG hoặc WebP.'),415
    try:
        image=ImageOps.exif_transpose(Image.open(upload.stream));image.load()
        if image.width*image.height>MAX_PIXELS:return jsonify(error='Ảnh quá lớn. Hãy dùng ảnh dưới 16 megapixel.'),400
        if image.mode=='RGBA':
            bg=Image.new('RGB',image.size,'white');bg.paste(image,mask=image.getchannel('A'));image=bg
        rgb=np.asarray(image.convert('RGB'))
    except Exception:return jsonify(error='Không đọc được ảnh.'),400
    jid=uuid.uuid4().hex;jobs[jid]={'jobId':jid,'status':'queued','progress':0,'message':'Đang chờ xử lý','createdAt':time.time(),'updatedAt':time.time()};pool.submit(run_job,jid,rgb,request.form.get('fill')=='1');return jsonify(jobId=jid),202
@app.get('/v1/jobs/<jid>')
def job(jid):
    item=jobs.get(jid)
    if not item:return jsonify(error='Không tìm thấy job.'),404
    return jsonify({k:v for k,v in item.items() if k!='result'})
@app.get('/v1/jobs/<jid>/result')
def result(jid):
    item=jobs.get(jid)
    if not item:return jsonify(error='Không tìm thấy job.'),404
    if item['status']!='complete':return jsonify(error='Job chưa hoàn tất.',status=item['status']),409
    return jsonify(item['result'])
def safe_file(jid,file_id):
    item=jobs.get(jid)
    if not item or item.get('status')!='complete':return None
    allowed={'cac_lop.zip','ghep_lai.png','anh_goc.png','vi_tri.json','background_da_lap.png'}|{layer['file'] for layer in item['result']['layers']}
    if file_id not in allowed:return None
    path=(OUTPUT_ROOT/jid/file_id).resolve();return path if path.is_relative_to((OUTPUT_ROOT/jid).resolve()) and path.is_file() else None
@app.get('/v1/jobs/<jid>/files/<path:file_id>')
def file(jid,file_id):
    path=safe_file(jid,file_id)
    if not path:return jsonify(error='File không còn trên máy.'),404
    return send_file(path,as_attachment=request.args.get('download')=='1')
@app.get('/v1/jobs/<jid>/zip')
def zip_file(jid):
    path=safe_file(jid,'cac_lop.zip')
    if not path:return jsonify(error='ZIP không còn trên máy.'),404
    return send_file(path,as_attachment=True,download_name='cac_lop.zip')
if __name__=='__main__':OUTPUT_ROOT.mkdir(parents=True,exist_ok=True);app.run(host='127.0.0.1',port=17841,debug=False,threaded=True)
