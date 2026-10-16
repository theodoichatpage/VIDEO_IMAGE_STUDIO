import unittest,json
import analysis_pipeline as p

class Revision56(unittest.TestCase):
 def test_each_part_has_independent_status_and_result(self):
  pr={'commands':[],'analysis_conversation':''}; snap={'mode':'script','script':'Một. Hai.','rows':[],'visual_style':'X','style':'Y','thumbnail_style':'Z'}
  c=p.start(pr,snap); st=pr['analysis_pipeline']
  self.assertEqual(st['part_status']['1']['status'],'processing')
  parts=[{'part':1,'title':'P1','summary':'S1','role':'R','source':'Một.'},{'part':2,'title':'P2','summary':'S2','role':'R','source':'Hai.'}]
  d={'job_id':c['id'],'run_id':st['id'],'stage':'analyze_part','part':1,'total_parts':2,'parts':parts,'scenes':[{'title':'C1','source':'Một.','focus':'F','role':'R'}]}
  p.accept(pr,c,json.dumps(d,ensure_ascii=False)); st=pr['analysis_pipeline']
  self.assertEqual(st['part_status']['1']['status'],'complete');self.assertEqual(st['part_status']['1']['scene_count'],1)
  self.assertEqual(st['part_status']['2']['status'],'processing')

 def test_ui_and_extension_have_revision56_contract(self):
  html=open('index.html',encoding='utf8').read(); js=open('extension/content.js',encoding='utf8').read()
  self.assertIn('1. Phân tích',html); self.assertIn('2. Tạo ảnh',html)
  self.assertIn('analysisPartTabs',html); self.assertIn('analysisPartList',html)
  self.assertIn('Nhận kết quả phần này',html)
  self.assertIn('scanJsonProtocolReplies',js)
  self.assertIn("version:'0.3.56'",js)

if __name__=='__main__':unittest.main()
