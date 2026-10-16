import unittest
import analysis_pipeline as p

class T(unittest.TestCase):
 def project(self): return {'commands':[],'analysis_conversation':''}
 def snap(self,script): return {'mode':'script','script':script,'rows':[],'visual_style':'x','style':'s','thumbnail_style':'t'}
 def test_49_scenes_split_into_ten_parts(self):
  script='\n\n'.join(f'CẢNH {i} - NỘI - NGÀY\nNội dung cảnh {i}.' for i in range(1,50))
  parts=p.split_script(script,max_scenes=5,max_chars=6000)
  self.assertEqual(len(parts),10)
  self.assertEqual((parts[0]['scene_start'],parts[0]['scene_end']),(1,5))
  self.assertEqual((parts[-1]['scene_start'],parts[-1]['scene_end']),(46,49))
  self.assertEqual(''.join(x['source'] for x in parts),script)
 def test_long_text_without_scene_markers_respects_char_limit(self):
  script=('Đoạn văn dài. '*1200).strip()
  parts=p.split_script(script,max_scenes=5,max_chars=6000)
  self.assertGreater(len(parts),1)
  self.assertTrue(all(len(x['source'])<=6100 for x in parts))
  self.assertEqual(''.join(x['source'] for x in parts),script)
 def test_start_precomputes_all_parts_and_queues_only_part_one(self):
  script='\n\n'.join(f'CẢNH {i} - NGOẠI - NGÀY\nNội dung {i}.' for i in range(1,13))
  pr=self.project();c=p.start(pr,self.snap(script));s=pr['analysis_pipeline']
  self.assertEqual(s['total_parts'],3);self.assertEqual(len(s['parts']),3)
  self.assertEqual(s['current_part'],1);self.assertEqual(c['part'],1)
  self.assertEqual(s['part_status']['1']['status'],'processing')
  self.assertEqual(s['part_status']['2']['status'],'waiting')
if __name__=='__main__':unittest.main()
