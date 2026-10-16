import json,unittest,copy
import test_studio
import core,server,scene_analysis as analysis
class LayoutChecks(unittest.TestCase):
 setUp=test_studio.Checks.setUp
 tearDown=test_studio.Checks.tearDown
 post=test_studio.Checks.post
 project=test_studio.Checks.project
 def start(self,script=False):
  p=self.project();p['commands']=[];p['visual_style']='Nét mực đen trên giấy trắng ngà, nhấn đỏ.'
  p['manual_drafts']=[{'slot':'scene-1','source':'Có 309 người.'},{'slot':'scene-2','source':'Họ rời đi.'}]
  if script:p['scenes']=[];p['script']='Có 309 người. Họ rời đi.'
  self.assertEqual(self.post('/api/layout-analysis',{'project':p['id'],'mode':'script' if script else 'rows'}).status_code,200)
  server.connection['client']='layout';return p
 def response(self,p,c=None,mutate=None):
  c=c or p['commands'][-1];snapshot=c['layout_snapshot']
  if c.get('pipeline_id'):
   flow=p['analysis_pipeline'];data={'job_id':c['id'],'run_id':c['pipeline_id'],'stage':c['layout_stage'],'part':c['pipeline_index']+1,'style_rules':'Mực đen, giấy ngà, điểm nhấn đỏ.','continuity':'Giữ nhận dạng xuyên suốt.'}
   if c['layout_stage']=='split':data['groups']=[{'unit_ids':[u['id']]} for u in flow['split_blocks'][c['pipeline_index']]]
   else:
    lookup={r['slot']:r for r in flow['rows']};data['scenes']=[{**lookup[slot],**{k:slot+' '+k for k in core.LAYOUT_FIELDS}} for slot in c['pipeline_slots']]
  else:
   rows=c.get('layout_expected_rows') or snapshot['rows'];data={'style_rules':'Mực đen','continuity':'Giữ nhận dạng','scenes':[{**row,**{k:row['slot']+' '+k for k in core.LAYOUT_FIELDS}} for row in rows]}
  if mutate:mutate(data)
  return self.post('/bridge/result',{'client':'layout','id':c['id'],'phase':'done','text':json.dumps(data)})
 def finish(self,p):
  for _ in range(250):
   if p.get('analysis_stage')=='ready':break
   result=self.response(p);self.assertEqual(result.status_code,200);self.assertNotIn('analysis_error',result.json)
  self.assertEqual(p['analysis_stage'],'ready');self.assertFalse(server.running)
 def approve(self,p,slot='scene-1'):
  self.assertEqual(self.post('/api/layout-save',{'project':p['id'],'slot':slot,**p['scene_layouts'][slot]}).status_code,200)
 def test_two_pass_review_queue_and_stale_source(self):
  p=self.start();ids=[s['id'] for s in p['scenes']];first=p['commands'][0]
  self.assertIn(p['visual_style'],first['prompt']);self.response(p)
  self.assertNotIn('scene_layouts',p);self.assertEqual(len(p['commands']),2);self.assertEqual(p['commands'][1]['layout_stage'],'review')
  # A duplicate callback cannot create a third pass.
  self.response(p,first);self.assertEqual(len(p['commands']),2)
  self.response(p);self.assertEqual(ids,[s['id'] for s in p['scenes']]);self.assertFalse(server.running)
  req={'project':p['id'],'slot':'scene-1','source':'Có 309 người.','style':p['style'],'kind':'scene'}
  self.assertEqual(self.post('/api/manual-image',req).status_code,400)
  self.approve(p);self.assertEqual(self.post('/api/manual-image',req).status_code,200)
  image=p['commands'][-1];self.assertTrue(image['download_only']);self.assertIn('scene-1 angle',image['prompt']);self.assertIn(p['visual_style'],image['prompt']);self.assertIn(p['analysis_continuity'],image['prompt'])
  count=len(p['commands']);req.update(slot='scene-2',source='Đã sửa');self.assertEqual(self.post('/api/manual-image',req).status_code,400);self.assertEqual(len(p['commands']),count)
 def test_full_script_preserved_and_no_images_enqueued(self):
  p=self.start(script=True);self.finish(p)
  self.assertEqual(p['manual_drafts'][0]['slot'],'thumbnail');self.assertEqual(' '.join(x['source'] for x in p['manual_drafts'][1:]),p['script'])
  self.assertEqual(p['scenes'],[]);self.assertTrue(all(c['kind']=='plan' for c in p['commands']));self.assertTrue(analysis.current(p))
  p['manual_drafts']=copy.deepcopy(p['manual_drafts']);p['manual_drafts'][1]['source']='Changed';self.assertFalse(analysis.current(p))
 def test_incomplete_script_errors_then_retry(self):
  p=self.start(script=True);result=self.response(p,mutate=lambda d:d['groups'].pop())
  self.assertIn('analysis_error',result.json);self.assertEqual(p['commands'][0]['status'],'error');self.assertFalse(server.running)
  self.assertEqual(self.post('/api/layout-analysis',{'project':p['id'],'mode':'script'}).status_code,200);self.assertEqual(p['commands'][0]['status'],'abandoned')
 def test_style_change_during_analysis_is_rejected(self):
  p=self.start();p['visual_style']='Màu nước xanh';r=self.response(p)
  self.assertIn('analysis_error',r.json);self.assertNotIn('scene_layouts',p);self.assertIsNone(server.active)
 def test_changed_inputs_block_approved_layout_without_mutation(self):
  p=self.start();self.finish(p);self.approve(p);count=len(p['scenes'])
  req={'project':p['id'],'slot':'scene-1','source':'Có 309 người.','style':'NEW','kind':'scene'}
  self.assertEqual(self.post('/api/manual-image',req).status_code,400);self.assertEqual(len(p['scenes']),count)
  p['manual_drafts'][1]['source']='Nội dung mới';self.assertFalse(analysis.current(p));self.assertEqual(self.post('/api/layout-save',{'project':p['id'],'slot':'scene-1',**p['scene_layouts']['scene-1']}).status_code,400)
 def test_cancel_ignores_late_result(self):
  p=self.start();c=p['commands'][0];self.post('/api/layout-cancel',{'project':p['id']});self.response(p,c)
  self.assertEqual(len(p['commands']),1);self.assertNotIn('scene_layouts',p);self.assertEqual(c['status'],'abandoned')
 def test_review_must_preserve_sources(self):
  p=self.start();self.response(p);self.response(p,mutate=lambda d:d['scenes'][0].update(source='Bịa lại'))
  self.assertEqual(p['analysis_stage'],'error');self.assertNotIn('scene_layouts',p)
 def test_project_isolation(self):
  p=self.start();other=core.new_project();server.projects[other['id']]=other;self.finish(p)
  self.assertNotIn('scene_layouts',other);self.assertNotIn('analysis_inputs',other)
 def test_warning_for_exact_repeated_composition(self):
  entry={k:'same' for k in core.LAYOUT_FIELDS}
  self.assertEqual(len(analysis.repetition_warnings({'scene-1':entry,'scene-2':entry})),1)

 def test_bridge_serializes_both_text_passes(self):
  p=self.start();d={'client':'layout','ready':True,'url':'https://chatgpt.com/c/test'}
  first=self.post('/bridge/poll',d).json['command'];self.assertEqual(first['layout_stage'],'plan')
  self.response(p,first);second=self.post('/bridge/poll',d).json['command']
  self.assertEqual(second['layout_stage'],'review');self.assertNotEqual(first['id'],second['id'])
  self.response(p,second);self.assertIsNone(self.post('/bridge/poll',d).json['command']);self.assertFalse(server.running)
