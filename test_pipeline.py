import unittest,json,copy
import test_layouts,server,core,analysis_pipeline as pipeline
class Pipeline(unittest.TestCase):
 setUp=test_layouts.LayoutChecks.setUp
 tearDown=test_layouts.LayoutChecks.tearDown
 post=test_layouts.LayoutChecks.post
 project=test_layouts.LayoutChecks.project
 response=test_layouts.LayoutChecks.response
 finish=test_layouts.LayoutChecks.finish
 def begin(self,script='',count=9):
  p=self.project();p.update(scenes=[],commands=[],script=script,visual_style='STYLE_SECRET',style='GENERATE_IMAGE_SECRET',thumbnail_style='THUMB_SECRET',manual_drafts=[{'slot':f'scene-{i+1}','source':f'Nội dung {i+1}.'} for i in range(count)])
  r=self.post('/api/layout-analysis',{'project':p['id'],'mode':'script' if script else 'rows'});self.assertEqual(r.status_code,200);server.connection['client']='layout';return p

 def test_script_first_reply_is_scene_plan_not_internal_groups(self):
  p=self.begin(script='Đoạn một. Đoạn hai. Đoạn ba.')
  c=p['commands'][-1]
  self.assertEqual(c['layout_stage'],'plan')
  self.assertIn('"scenes"',c['prompt'])
  self.assertNotIn('"groups"',c['prompt'])
  self.assertTrue(c.get('pipeline_slots'))
 def test_split_contains_only_script_units_and_ids(self):
  p=self.begin(script='Đoạn một. Đoạn hai.');c=p['commands'][-1]
  for word in ('STYLE_SECRET','GENERATE_IMAGE_SECRET','THUMB_SECRET','visual_style','thumbnail'):self.assertNotIn(word,c['prompt'])
  self.assertEqual(c['layout_stage'],'split');self.response(p);self.assertEqual(p['analysis_pipeline']['stage'],'plan')
 def test_many_groups_save_and_no_image_job(self):
  p=self.begin(count=9);first=p['commands'][0];self.response(p)
  self.assertEqual(p['analysis_pipeline']['saved'],1);self.assertEqual(p['commands'][-1]['pipeline_index'],1);self.assertEqual(len(p['commands']),2)
  self.response(p,first);self.assertEqual(len(p['commands']),2)
  saved=json.loads((server.DATA/p['id']/'project.json').read_text());self.assertEqual(saved['analysis_pipeline']['saved'],1)
  self.finish(p);self.assertEqual(len(p['commands']),6);self.assertEqual(len(p['scene_layouts']),9);self.assertTrue(all(c['kind']=='plan' for c in p['commands']))
 def test_bad_part_does_not_advance_checkpoint(self):
  p=self.begin();before=copy.deepcopy(p['analysis_pipeline']);self.response(p,mutate=lambda d:d.update(part=99))
  after=p['analysis_pipeline'];self.assertEqual(after['index'],before['index']);self.assertEqual(after['layouts'],before['layouts']);self.assertEqual(after['saved'],0);self.assertEqual(len(p['commands']),1)
 def test_retry_starts_at_failed_group_not_first_group(self):
  p=self.begin();self.response(p);self.response(p,mutate=lambda d:d['scenes'].pop());old=p['commands'][-1]
  self.assertEqual(p['analysis_pipeline']['saved'],1)
  self.assertEqual(self.post('/api/analysis-resume',{'project':p['id']}).status_code,400)
  self.assertEqual(self.post('/api/analysis-resume',{'project':p['id'],'confirmed':True}).status_code,200)
  new=p['commands'][-1];self.assertEqual(new['pipeline_index'],1);self.assertNotEqual(new['id'],old['id']);self.assertEqual(new['url'],'');self.assertEqual(p['analysis_pipeline']['saved'],1)
  self.response(p,old);self.assertEqual(p['analysis_pipeline']['saved'],1);self.finish(p)
 def test_missing_or_duplicate_units_rejected(self):
  p=self.begin(script='Đoạn một. Đoạn hai.');self.response(p,mutate=lambda d:d['groups'].pop())
  self.assertEqual(p['analysis_pipeline']['segments'],[]);self.assertEqual(p['analysis_stage'],'error')
 def test_script_longer_than_49_scenes_is_preserved(self):
  script=' '.join(f'Đoạn nội dung thứ {i} có số {i}.' for i in range(60));p=self.begin(script=script);self.finish(p)
  self.assertEqual(len(p['manual_drafts']),61);self.assertEqual(' '.join(r['source'] for r in p['manual_drafts'][1:]),script);self.assertTrue(all(len(c.get('pipeline_slots',[]))<=4 for c in p['commands']))
 def test_resume_rejects_changed_input(self):
  p=self.begin();self.response(p,mutate=lambda d:d.update(run_id='wrong'));p['visual_style']='changed'
  self.assertEqual(self.post('/api/analysis-resume',{'project':p['id'],'confirmed':True}).status_code,400)
 def test_split_blocks_are_bounded_and_cover_whole_text(self):
  script=' '.join('Câu dài thứ '+str(i)+' '+'từ '*50+'.' for i in range(100));blocks=pipeline.blocks(pipeline.units(script));self.assertGreater(len(blocks),1)
  self.assertTrue(all(sum(len(x['text']) for x in b)<=4500 for b in blocks));self.assertEqual(' '.join(x['text'] for b in blocks for x in b),script)

 def test_checkpoint_can_be_reloaded_and_continued(self):
  p=self.begin();self.response(p);saved=json.loads((server.DATA/p['id']/'project.json').read_text());server.projects[p['id']]=saved
  self.assertEqual(saved['analysis_pipeline']['saved'],1);self.finish(saved)
  self.assertEqual(saved['analysis_pipeline']['saved'],6);self.assertEqual(len(saved['commands']),6)
