import unittest

class StableAnalysisUiChecks(unittest.TestCase):
    def test_refresh_skips_repaint_when_state_is_unchanged(self):
        with open('index.html', encoding='utf8') as source:
            html = source.read()
        self.assertIn("let lastPaintSignature='';", html)
        self.assertIn('const nextPaintSignature=JSON.stringify', html)
        self.assertIn('if(nextPaintSignature!==lastPaintSignature)', html)

if __name__ == '__main__':
    unittest.main()
