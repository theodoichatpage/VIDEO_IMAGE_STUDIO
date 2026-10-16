import unittest,json
import test_layouts,server,scene_analysis as analysis
class Routing(unittest.TestCase):
 setUp=test_layouts.LayoutChecks.setUp
 tearDown=test_layouts.LayoutChecks.tearDown
 post=test_layouts.LayoutChecks.post
 project=test_layouts.LayoutChecks.project
 response=test_layouts.LayoutChecks.response
 def test_new_analysis_uses_connected_tab_then_review_stays_there(self):
  p=self.project();p.update(conversation='https://chatgpt.com/c/old-image',analysis_conversation='https://chatgpt.com/c/old-analysis',manual_drafts=[{'slot':'scene-1','source':'Đoạn gốc.'}])
  self.assertEqual(self.post('/api/layout-analysis',{'project':p['id']}).status_code,200);c=p['commands'][0];self.assertEqual(c['url'],'')
  server.connection['client']='layout';new='https://chatgpt.com/c/new-analysis'
  self.post('/bridge/result',{'client':'layout','id':c['id'],'phase':'sent','url':new})
  self.assertEqual(p['conversation'],'https://chatgpt.com/c/old-image');self.assertEqual(p['analysis_conversation'],new)
  self.response(p,c);self.assertEqual(p['commands'][-1]['url'],new)
 def test_analysis_never_includes_image_templates(self):
  p=self.project();p.update(style='Generate the image now. CONTENT_SECRET',thumbnail_style='Output only image. THUMB_SECRET',visual_style='Giấy ngà và mực đen.',manual_drafts=[{'slot':'scene-1','source':'Đoạn gốc.'}])
  snapshot=analysis.inputs(p,'rows')
  for prompt in (analysis.draft_prompt(snapshot),analysis.review_prompt(snapshot,{'scenes':[]})):
   self.assertNotIn('CONTENT_SECRET',prompt);self.assertNotIn('THUMB_SECRET',prompt);self.assertNotIn('Generate the image now',prompt);self.assertIn('Giấy ngà',prompt);self.assertIn('Đoạn gốc',prompt)
 def test_script_prompt_requests_records(self):
  p=self.project();p['script']='Kịch bản.';text=analysis.draft_prompt(analysis.inputs(p,'script'));self.assertNotIn('Tạo thumbnail',text);self.assertIn('Lập bản ghi',text)
