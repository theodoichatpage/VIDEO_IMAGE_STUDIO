import tempfile,unittest
from pathlib import Path
from PIL import Image
import server,core
from download_watch import DownloadWatch
class Unconfirmed(unittest.TestCase):
 def test_download_completes_unconfirmed_and_resumes(self):
  saved=(server.DATA,server.projects,server.watches,server.connection.copy(),server.active,server.running)
  with tempfile.TemporaryDirectory() as tmp:
   root=Path(tmp);folder=root/'downloads';folder.mkdir();server.DATA=root/'projects';p=core.new_project();s=core.scene();p['scenes']=[s];c=core.enqueue_scene(p,s);c.update(status='sending',download_only=True);server.projects={p['id']:p};server.connection['client']='test';server.active=[p['id'],c['id']];server.running=True;clock=[0];w=DownloadWatch(folder,lambda:clock[0]);server.watches={p['id']:w}
   try:
    response=server.app.test_client().post('/bridge/result',json={'client':'test','id':c['id'],'phase':'send_unconfirmed','error':'Not confirmed'},headers={'X-Studio-Token':server.TOKEN});self.assertEqual(response.status_code,200);self.assertEqual(s['status'],'waiting_download');self.assertFalse(server.running)
    Image.new('RGB',(640,360),'green').save(folder/'result.png');server.scan_downloads();clock[0]=4;server.scan_downloads();self.assertEqual(s['status'],'done');self.assertTrue(server.running);self.assertIsNone(server.active);self.assertEqual(s['error'],'')
   finally:
    server.DATA,server.projects,server.watches,connection,server.active,server.running=saved;server.connection.clear();server.connection.update(connection)
