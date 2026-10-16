import unittest,json
import analysis_pipeline as p
class T(unittest.TestCase):
 def test_five_approvals_create_ordered_drafts_without_visuals(self):
  pr={'commands':[],'analysis_conversation':''};snap={'mode':'script','script':'A B C D E','rows':[],'visual_style':'','style':'s','thumbnail_style':'t'};c=p.start(pr,snap)
  parts=[{'part':i,'title':f'P{i}','summary':'S','role':'R','source':x} for i,x in enumerate('ABCDE',1)]
  for n in range(1,6):
   st=pr['analysis_pipeline'];d={'job_id':c['id'],'run_id':st['id'],'stage':'analyze_part','part':n,'scenes':[{'title':f'C{n}','source':parts[n-1]['source'],'focus':'F','role':'R'}]}
   if n==1:d['parts']=parts
   p.accept(pr,c,json.dumps(d));c=p.approve_part(pr)
  self.assertEqual(pr['analysis_pipeline']['stage'],'analysis_complete');self.assertEqual([x['source'] for x in pr['manual_drafts'][1:]],list('ABCDE'));self.assertNotIn('scene_layouts',pr)
if __name__=='__main__':unittest.main()
