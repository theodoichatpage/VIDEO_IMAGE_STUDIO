import unittest,json
import analysis_pipeline as p
class AutoFlow(unittest.TestCase):
 def test_dynamic_parts_auto_advance_and_complete(self):
  pr={'commands':[],'analysis_conversation':''}; snap={'mode':'script','script':'Một. Hai. Ba.','rows':[],'visual_style':'IGNORED','style':'IMG','thumbnail_style':'IMG'}
  c=p.start(pr,snap); st=pr['analysis_pipeline']
  parts=[{'part':i,'title':f'P{i}','summary':'S','role':'R','source':x} for i,x in enumerate(['Một.','Hai.','Ba.'],1)]
  d={'job_id':c['id'],'run_id':st['id'],'stage':'analyze_part','part':1,'total_parts':3,'parts':parts,'scenes':[{'title':'C1','source':'Một.','focus':'F','role':'R'}]}
  self.assertTrue(p.accept(pr,c,json.dumps(d,ensure_ascii=False)))
  self.assertEqual(pr['analysis_pipeline']['current_part'],2); self.assertEqual(pr['analysis_pipeline']['total_parts'],3)
  for n,src in [(2,'Hai.'),(3,'Ba.')]:
   c=pr['commands'][-1]; st=pr['analysis_pipeline']; d={'job_id':c['id'],'run_id':st['id'],'stage':'analyze_part','part':n,'scenes':[{'title':f'C{n}','source':src,'focus':'F','role':'R'}]}
   running=p.accept(pr,c,json.dumps(d,ensure_ascii=False))
  self.assertFalse(running);self.assertEqual(pr['analysis_pipeline']['stage'],'analysis_complete');self.assertEqual(len(pr['manual_drafts']),4)
 def test_prompt_does_not_use_image_style(self):
  pr={'commands':[],'analysis_conversation':''}; snap={'mode':'script','script':'ABC','rows':[],'visual_style':'SECRET_IMAGE_STYLE','style':'IMG_PROMPT','thumbnail_style':'THUMB'}
  c=p.start(pr,snap); self.assertNotIn('SECRET_IMAGE_STYLE',c['prompt']);self.assertNotIn('IMG_PROMPT',c['prompt']);self.assertNotIn('THUMB',c['prompt'])
if __name__=='__main__': unittest.main()
