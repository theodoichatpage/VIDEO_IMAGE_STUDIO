import json, unittest, copy
import server, core, test_layouts
class Revision47(unittest.TestCase):
 setUp=test_layouts.LayoutChecks.setUp
 tearDown=test_layouts.LayoutChecks.tearDown
 post=test_layouts.LayoutChecks.post
 project=test_layouts.LayoutChecks.project
 start=test_layouts.LayoutChecks.start
 def payload(self,p,c):
  return dict(job_id=c['id'],run_id=c['pipeline_id'],stage='split',part=1,groups=[dict(unit_ids=[u['id']]) for u in p['analysis_pipeline']['split_blocks'][0]])
 def test_unconfirmed_analysis_is_not_left_sending(self):
  p=self.start(script=True);c=p['commands'][-1];c.update(status='sending',sending_at=1)
  r=self.post('/bridge/result',dict(client='layout',id=c['id'],phase='send_unconfirmed',error='Không xác nhận được gửi'))
  self.assertEqual(r.status_code,200);self.assertEqual(c['status'],'error');self.assertFalse(server.running)
  self.assertIn('Không xác nhận',p['layout_status'])
 def test_manual_result_saves_once_and_continues_correct_part(self):
  p=self.start(script=True);c=p['commands'][-1];c.update(status='sending',sending_at=1)
  body=dict(project=p['id'],text=json.dumps(self.payload(p,c)))
  r=self.post('/api/analysis-import',body);self.assertEqual(r.status_code,200,r.json)
  self.assertEqual(p['analysis_pipeline']['saved'],1);self.assertEqual(c['status'],'done')
  self.assertEqual(p['commands'][-1]['layout_stage'],'plan')
  count=len(p['commands']);r=self.post('/api/analysis-import',body)
  self.assertEqual(r.status_code,400);self.assertEqual(len(p['commands']),count)
 def test_wrong_result_does_not_advance(self):
  p=self.start(script=True);c=p['commands'][-1];payload=self.payload(p,c);payload['run_id']='wrong'
  r=self.post('/api/analysis-import',dict(project=p['id'],text=json.dumps(payload)))
  self.assertEqual(r.status_code,400);self.assertEqual(p['analysis_pipeline']['saved'],0)
 def test_cancelled_result_cannot_be_imported(self):
  p=self.start(script=True);c=p['commands'][-1];payload=self.payload(p,c);self.post('/api/layout-cancel',{'project':p['id']})
  r=self.post('/api/analysis-import',dict(project=p['id'],text=json.dumps(payload)))
  self.assertEqual(r.status_code,400);self.assertEqual(p['analysis_pipeline']['saved'],0)

 def test_automatic_capture_is_opt_in_and_preserves_template(self):
  p=self.project();p['scenes']=[]
  r=self.post('/api/manual-image',dict(project=p['id'],slot='scene-1',source='Nội dung riêng',style='PHONG CÁCH {{noi_dung}}',capture_images=True))
  self.assertEqual(r.status_code,200,r.json);c=p['commands'][-1]
  self.assertFalse(c['download_only']);self.assertIn('PHONG CÁCH Nội dung riêng',c['prompt'])
 def test_auto_capture_saves_image_and_unblocks_next_scene(self):
  import base64,io
  from PIL import Image
  p=self.project();p['scenes']=[];server.connection['client']='auto'
  for i in [1,2]:
   self.assertEqual(self.post('/api/manual-image',dict(project=p['id'],slot=f'scene-{i}',source=f'Nội dung {i}',style='STYLE {{noi_dung}}',capture_images=True)).status_code,200)
  c=p['commands'][0]
  for phase in ['sending','sent','waiting','image_ready','saving']:
   self.assertEqual(self.post('/bridge/result',dict(client='auto',id=c['id'],phase=phase)).status_code,200)
  img=io.BytesIO();Image.new('RGB',(640,360),'red').save(img,format='PNG')
  r=self.post('/bridge/result',dict(client='auto',id=c['id'],phase='done',image='data:image/png;base64,'+base64.b64encode(img.getvalue()).decode()))
  self.assertEqual(r.status_code,200);self.assertTrue(server.running);self.assertIsNotNone(core.selected(p['scenes'][0]))
  poll=self.post('/bridge/poll',dict(client='auto',ready=True,generating=False))
  self.assertEqual(poll.json['command']['id'],p['commands'][1]['id'])
