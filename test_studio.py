import unittest,tempfile,io,zipfile,json,base64
from pathlib import Path
from PIL import Image
import core,server
class Checks(unittest.TestCase):
 def setUp(self):
  self.tmp=tempfile.TemporaryDirectory();self.root=Path(self.tmp.name);self.client=server.app.test_client();self.olddata=server.DATA;server.DATA=self.root;server.projects={};server.connection.update(client='',last=0,ready=False);server.active=None;server.running=False;self.headers={'X-Studio-Token':server.TOKEN}
 def tearDown(self):server.DATA=self.olddata;self.tmp.cleanup()
 def post(self,path,d):return self.client.post(path,json=d,headers=self.headers)
 def image(self,color):
  b=io.BytesIO();Image.new('RGB',(640,360),color).save(b,format='PNG');return b.getvalue()
 def project(self):
  p=core.new_project();p['scenes']=[core.scene('Thumb','full','cover','thumbnail'),core.scene('A','a','visual a'),core.scene('B','b','visual b')];server.projects[p['id']]=p;server.persist(p);return p
 def test_plan_resume_tracks_new_wait_without_resending(self):
  p=self.project();p['scenes']=[];p['script']='Kịch bản kiểm tra.';c=core.queue_command(p,'plan','existing');c['status']='error';c['error']='old timeout';p['plan_error']='old timeout'
  r=self.post('/api/plan',{'project':p['id']});self.assertEqual(r.status_code,200);self.assertEqual(len(p['commands']),1);self.assertEqual(c['status'],'waiting');self.assertEqual(c['wait_cycle'],1);self.assertEqual(p['plan_error'],'');self.assertEqual(c['error'],'')
 def test_thumbnail_direct_uses_exact_prompt_without_plan(self):
  p=self.project();p['scenes']=[];c=core.queue_command(p,'plan','old');c['status']='waiting';p['plan_error']='old';r=self.post('/api/thumbnail-only',{'project':p['id'],'prompt':'Create image EXACT supplied content.'});self.assertEqual(r.status_code,200);self.assertEqual(c['status'],'abandoned');self.assertEqual(len(p['scenes']),1);self.assertEqual(core.prompt_for(p,p['scenes'][0]),'Create image EXACT supplied content.');self.assertEqual(p['plan_error'],'');self.assertFalse(server.running)
 def test_api_errors_are_json(self):
  r=self.post('/api/not-a-route',{});self.assertEqual(r.status_code,404);self.assertTrue(r.is_json);self.assertIn('bản cũ',r.json['error'])
  r=self.client.post('/api/plan',data='{broken',content_type='application/json',headers=self.headers);self.assertEqual(r.status_code,400);self.assertTrue(r.is_json)
 def test_local_split_preserves_numbers_and_needs_no_browser(self):
  p=self.project();p['scenes']=[];p['script']='Có hơn 300.000 tấn diesel và 309 người. '+('Nội dung thứ hai. '*12)+'\n\nĐoạn cuối giữ số 196.';p['style']='MẪU {{noi_dung}}';server.persist(p)
  r=self.post('/api/local-split',{'project':p['id'],'target':100});self.assertEqual(r.status_code,200);self.assertGreater(len(p['scenes']),2);self.assertEqual(p['commands'],[])
  combined=' '.join(s['source'] for s in p['scenes'][1:]);import re
  self.assertEqual(re.sub(r'\s+',' ',combined).strip(),re.sub(r'\s+',' ',p['script']).strip());self.assertIn('300.000',combined)
  self.assertTrue(all(not s['analysis_draft'] for s in p['scenes']));self.assertTrue(p['scenes'][1]['prompt'].startswith('MẪU Có'))
  d=self.post('/api/diagnostics',{'project':p['id']}).json;self.assertIsNone(d['heartbeat_age']);self.assertFalse(d['tab_ready']);self.assertEqual(d['commands'],[])
 def test_streaming_content_and_filled_templates(self):
  p=self.project();p['scenes']=[];p['script']='Toàn bài với số 309.';p['style']='Create image: “[DÁN NỘI DUNG TIẾNG VIỆT VÀO ĐÂY]”';p['thumbnail_style']='THUMB {{noi_dung}}';server.persist(p)
  self.post('/api/plan',{'project':p['id']});d={'client':'stream-tab','ready':True,'url':'https://chatgpt.com/c/test'};c=self.post('/bridge/poll',d).json['command']
  partial='{"scenes":[{"title":"Thumbnail","source":"Tóm tắt"},{"title":"Cảnh 1","source":"309 người bị thương."},{"title":"Cảnh 2","source":"dang'
  r=self.post('/bridge/result',{'client':'stream-tab','id':c['id'],'phase':'partial','text':partial});self.assertEqual(r.status_code,200);self.assertEqual(len(p['scenes']),2);sid=p['scenes'][1]['id']
  self.assertEqual(p['scenes'][1]['prompt'],'Create image: “309 người bị thương.”');self.assertTrue(p['scenes'][1]['analysis_draft']);self.assertEqual(self.post('/api/run',{'project':p['id']}).status_code,400)
  final='{"scenes":[{"title":"Thumbnail","source":"Tóm tắt"},{"title":"Cảnh 1","source":"309 người bị thương."},{"title":"Cảnh 2","source":"Đoạn tiếp theo."}]}'
  self.assertEqual(self.post('/bridge/result',{'client':'stream-tab','id':c['id'],'phase':'done','text':final}).status_code,200);self.assertEqual(p['scenes'][1]['id'],sid);self.assertFalse(p['scenes'][1]['analysis_draft']);self.assertEqual(p['scenes'][0]['prompt'],'THUMB Toàn bài với số 309.')
  s=p['scenes'][1];cmd=core.enqueue_scene(p,s);self.assertEqual(cmd['prompt'],s['prompt']);self.assertNotIn('[DÁN',cmd['prompt'])
 def test_templates_resume_and_versions(self):
  p=self.project();p['thumbnail_style']='THUMB';p['style']='VIDEO';a=p['scenes'][1]
  self.assertTrue(core.prompt_for(p,p['scenes'][0]).startswith('THUMB'));self.assertTrue(core.prompt_for(p,a).startswith('VIDEO'))
  c=core.enqueue_scene(p,a);c['status']='sent';a['status']='sent';same=core.enqueue_scene(p,a);self.assertEqual(same['id'],c['id']);self.assertEqual(len(p['commands']),1)
  first=core.save_image(self.root,p,a,self.image('red'));second=core.save_image(self.root,p,a,self.image('blue'));self.assertEqual(len(a['versions']),2);self.assertTrue((self.root/p['id']/first['file']).exists())
  self.assertEqual(a['selected'],second['id'])
 def test_zip_order_and_layer_flatten(self):
  p=self.project();a=p['scenes'][1];b=p['scenes'][2];va=core.save_image(self.root,p,a,self.image('red'));core.save_image(self.root,p,b,self.image('blue'))
  folder=self.root/p['id'];name='layers.zip'
  with zipfile.ZipFile(folder/name,'w') as z:z.writestr('nguoi_01.png',b'layer');z.writestr('vi_tri.json','{}');z.writestr('../bad',b'bad')
  a['split'][va['id']]={'status':'done','file':name};p['scenes']=[p['scenes'][0],b,a]
  with zipfile.ZipFile(io.BytesIO(core.zip_bytes(self.root,p))) as z:
   self.assertEqual(Image.open(z.open('anh/canh_001.png')).getpixel((0,0)),(0,0,255));self.assertIn('lop/canh_002/nguoi_01.png',z.namelist());self.assertFalse(any(n.endswith('.zip') or 'bad' in n for n in z.namelist()))
   rows=json.loads(z.read('danh_sach_canh.json'));self.assertEqual(rows[2]['id'],a['id'])
 def test_bridge_claim_pause_and_completion(self):
  p=self.project();s=p['scenes'][1];r=self.post('/api/run',{'project':p['id'],'scene':s['id']});self.assertEqual(r.status_code,200)
  d={'client':'test-tab','ready':True,'url':'https://chatgpt.com/c/test','browser':'Edge'}
  claim=self.post('/bridge/poll',d).json['command'];self.post('/bridge/result',{'client':'test-tab','id':claim['id'],'phase':'sent','url':d['url']})
  self.post('/api/stop',{'project':p['id'],'scene':s['id']});self.assertIsNone(self.post('/bridge/poll',d).json['command'])
  self.post('/api/run',{'project':p['id'],'scene':s['id']});nextclaim=self.post('/bridge/poll',d).json['command'];self.assertEqual(nextclaim['id'],claim['id']);self.assertEqual(nextclaim['status'],'waiting')
  payload={'client':'test-tab','id':claim['id'],'phase':'done','image':'data:image/png;base64,'+base64.b64encode(self.image('red')).decode()}
  self.assertEqual(self.post('/bridge/result',payload).status_code,200);self.post('/bridge/result',payload);self.assertEqual(len(s['versions']),1)
  saved=json.loads((self.root/p['id']/'project.json').read_text());self.assertEqual(saved['scenes'][1]['status'],'done')
 def test_auth_export_overwrite_partial(self):
  self.assertEqual(self.client.get('/api/state').status_code,403);p=self.project();folder=self.root/'exports';folder.mkdir()
  body={'project':p['id'],'folder':str(folder),'name':'set.zip'}
  self.assertTrue(self.post('/api/export',body).json['needs_partial']);body['partial']=True;self.assertTrue(self.post('/api/export',body).json['ok']);self.assertTrue(self.post('/api/export',body).json['needs_overwrite'])
  body.update(overwrite=True);self.assertTrue(self.post('/api/export',body).json['ok'])
 def test_legacy_copy_and_uncertain_send(self):
  oldfolder=self.root/'legacy';oldfolder.mkdir();(oldfolder/'x.png').write_bytes(self.image('green'));old={'script':'hello','style':'OLD','scenes':[{'title':'Thumb','prompt':'x','file':'x.png','status':'done'},{'title':'sent','prompt':'y','status':'sent'}]}
  p=core.migrate(old,oldfolder,self.root);self.assertTrue((oldfolder/'x.png').exists());self.assertEqual(len(p['scenes'][0]['versions']),1)
  with self.assertRaises(ValueError):core.enqueue_scene(p,p['scenes'][1])
  core.enqueue_scene(p,p['scenes'][1],redo=True)
 def test_manual_import_and_split_failure_preserves_image(self):
  p=self.project();s=p['scenes'][1];data={'project':p['id'],'scene':s['id'],'image':(io.BytesIO(self.image('red')),'test.png')}
  r=self.client.post('/api/import-image',data=data,headers=self.headers);self.assertEqual(r.status_code,200);v=core.selected(s)
  from unittest.mock import patch
  with patch('urllib.request.urlopen',side_effect=OSError('service offline')):server._split_task(p['id'],s['id'],v['id'])
  self.assertEqual(s['split'][v['id']]['status'],'error');self.assertEqual(s['status'],'done');self.assertTrue((self.root/p['id']/v['file']).exists())
if __name__=='__main__':unittest.main()
