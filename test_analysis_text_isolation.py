import unittest
import analysis_pipeline as pipeline
from core import new_project

class IsolationTests(unittest.TestCase):
    def test_five_part_analysis_uses_dedicated_text_kind_and_no_visual_fields(self):
        p=new_project();p['name']='T'
        p['visual_style']='CINEMATIC IMAGE STYLE SHOULD NEVER LEAK'
        snap={'mode':'script','script':'Một câu. Hai câu. Ba câu.','rows':[]}
        c=pipeline.start(p,snap)
        self.assertEqual(c['kind'],'analysis_text')
        self.assertEqual(c['layout_stage'],'analyze_part')
        self.assertNotIn('CINEMATIC IMAGE STYLE SHOULD NEVER LEAK',c['prompt'])
        for forbidden in ('style_rules','"shot"','"angle"','"composition"','image_prompt'):
            self.assertNotIn(forbidden,c['prompt'])
        self.assertIn('KHÔNG tạo ảnh',c['prompt'])

if __name__=='__main__': unittest.main()
