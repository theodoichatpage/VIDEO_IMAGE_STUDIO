import unittest,json
import analysis_pipeline as p

class T(unittest.TestCase):
 def project(self): return {'commands':[],'analysis_conversation':''}
 def snap(self): return {'mode':'script','script':'Một. Hai. Ba. Bốn. Năm.','rows':[],'visual_style':'x','style':'s','thumbnail_style':'t'}
 def response(self,c,state,part=1):
  parts=[{'part':i,'title':f'P{i}','summary':f'S{i}','role':f'R{i}','source':x} for i,x in enumerate(['Một.','Hai.','Ba.','Bốn.','Năm.'],1)]
  d={'job_id':c['id'],'run_id':state['id'],'stage':'analyze_part','part':part,'scenes':[{'title':'C','source':parts[part-1]['source'],'focus':'F','role':'V'}]}
  if part==1:d['parts']=parts
  return json.dumps(d,ensure_ascii=False)
 def test_start_sends_full_script_and_pauses_after_part1(self):
  pr=self.project();c=p.start(pr,self.snap());self.assertIn('Một. Hai. Ba. Bốn. Năm.',c['prompt']);self.assertNotIn('shot',c['prompt'].lower());self.assertNotIn('angle',c['prompt'].lower())
  p.accept(pr,c,self.response(c,pr['analysis_pipeline']));s=pr['analysis_pipeline'];self.assertEqual(s['stage'],'awaiting_approval');self.assertEqual(len(s['parts']),5);self.assertEqual(s['current_part'],1)
 def test_rejects_changed_source(self):
  pr=self.project();c=p.start(pr,self.snap());d=json.loads(self.response(c,pr['analysis_pipeline']));d['scenes'][0]['source']='viết lại'
  with self.assertRaises(ValueError):p.accept(pr,c,json.dumps(d,ensure_ascii=False))
if __name__=='__main__':unittest.main()
