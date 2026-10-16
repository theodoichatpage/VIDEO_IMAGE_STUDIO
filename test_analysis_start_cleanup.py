import unittest
from pathlib import Path

class CleanupContract(unittest.TestCase):
    def test_script_analysis_abandons_old_layout_jobs_before_start(self):
        src=Path('server.py').read_text(encoding='utf-8')
        marker="if mode=='script':\n            # Five-part analysis owns the text-analysis lane"
        self.assertIn(marker,src)
        self.assertIn("c['status']='abandoned'",src[src.index(marker):src.index(marker)+700])

if __name__=='__main__': unittest.main()
