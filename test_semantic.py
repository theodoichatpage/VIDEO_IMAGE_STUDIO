import unittest,sys,io,zipfile,json,tempfile
from pathlib import Path
import numpy as np
from PIL import Image
sys.path.insert(0,str(Path(__file__).parent/'SAM2_Tach_Anh'))
from semantic import semantic_partition
from layers import export_layers
import server,core
class Semantic(unittest.TestCase):
 def test_person_and_paragraph_whole_and_reconstruct(self):
  rgb=np.arange(80*120*3,dtype=np.uint8).reshape(80,120,3);person=np.zeros((80,120),bool);person[5:75,10:40]=True
  labels,names=semantic_partition(rgb,[person],[[[[65,10],[110,10],[110,35],[65,35]],'7 điểm va chạm']])
  self.assertEqual(set(np.unique(labels)),{0,1,2});self.assertTrue(np.all(labels[person]==1));self.assertEqual(names[1],'Người 1');self.assertIn('7 điểm',names[2]);raw,info,exact=export_layers(rgb,labels,names);self.assertTrue(exact)
  with zipfile.ZipFile(io.BytesIO(raw)) as z:
   self.assertEqual(json.loads(z.read('vi_tri.json'))['layers'][1]['title'],'Người 1');rebuilt=np.array(Image.open(z.open('ghep_lai.png')));self.assertTrue(np.array_equal(rgb,rebuilt))
 def test_watch_preference_saved(self):
  with tempfile.TemporaryDirectory() as tmp:
   old=(server.DATA,server.projects,server.watches);server.DATA=Path(tmp)/'projects';folder=Path(tmp)/'downloads';folder.mkdir();p=core.new_project();server.projects={p['id']:p};server.watches={}
   try:
    client=server.app.test_client();h={'X-Studio-Token':server.TOKEN}
    client.post('/api/download-watch',json={'project':p['id'],'folder':str(folder),'enabled':True},headers=h)
    saved=json.loads((server.DATA/p['id']/'project.json').read_text());self.assertTrue(saved['download_watch_enabled']);self.assertEqual(saved['download_folder'],str(folder))
    client.post('/api/download-watch',json={'project':p['id'],'enabled':False},headers=h)
    self.assertFalse(json.loads((server.DATA/p['id']/'project.json').read_text())['download_watch_enabled'])
   finally:server.DATA,server.projects,server.watches=old
if __name__=='__main__':unittest.main()
