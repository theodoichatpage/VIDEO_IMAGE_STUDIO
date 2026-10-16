import unittest,tempfile
from pathlib import Path
from connection_config import load_token
class Pairing(unittest.TestCase):
 def test_token_survives_restart(self):
  with tempfile.TemporaryDirectory() as tmp:
   p=Path(tmp)/'studio_connection.json';first=load_token(p);self.assertEqual(first,load_token(p));self.assertEqual(len(first),32)
 def test_invalid_config_does_not_rotate_silently(self):
  with tempfile.TemporaryDirectory() as tmp:
   p=Path(tmp)/'studio_connection.json';p.write_text('{broken')
   with self.assertRaises(ValueError):load_token(p)
   self.assertEqual(p.read_text(),'{broken')
