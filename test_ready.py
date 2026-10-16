import unittest,tempfile,time,io,base64
from pathlib import Path
from PIL import Image
import core,server
class Ready(unittest.TestCase):
 def test_detected_image_stops_timer_then_save_completes(self):
  with tempfile.TemporaryDirectory() as tmp:
   old=server.DATA;server.DATA=Path(tmp)
   try:
    p=core.new_project();target=core.scene();p['scenes']=[target];c=core.enqueue_scene(p,target);server.projects={p['id']:p};server.connection['client']='tab';server.active=[p['id'],c['id']];server.running=True
    client=server.app.test_client();headers={'X-Studio-Token':server.TOKEN}
    def report(phase,**extras):return client.post('/bridge/result',json={'client':'tab','id':c['id'],'phase':phase,**extras},headers=headers)
    self.assertEqual(report('image_ready').status_code,200);self.assertEqual(target['status'],'image_ready');stopped=target['stopped_at'];self.assertFalse(server.running)
    report('error',error='Transfer blocked');self.assertEqual(target['status'],'image_ready');self.assertEqual(target['stopped_at'],stopped);self.assertEqual(target['versions'],[])
    report('saving');buf=io.BytesIO();Image.new('RGB',(640,360),'red').save(buf,format='PNG');self.assertEqual(report('done',image='data:image/png;base64,'+base64.b64encode(buf.getvalue()).decode()).status_code,200)
    self.assertEqual(target['status'],'done');self.assertEqual(target['error'],'');self.assertEqual(len(target['versions']),1)
   finally:server.DATA=old
 def test_user_confirmation_does_not_fake_saved_image(self):
  with tempfile.TemporaryDirectory() as tmp:
   old=server.DATA;server.DATA=Path(tmp)
   try:
    p=core.new_project();target=core.scene();p['scenes']=[target];core.enqueue_scene(p,target);server.projects={p['id']:p};server.running=True
    client=server.app.test_client();r=client.post('/api/image-created',json={'project':p['id'],'scene':target['id']},headers={'X-Studio-Token':server.TOKEN})
    self.assertEqual(r.status_code,200);self.assertEqual(target['status'],'image_ready');self.assertTrue(target['user_confirmed_created']);self.assertEqual(target['versions'],[]);self.assertIn('stopped_at',target);self.assertFalse(server.running)
   finally:server.DATA=old
if __name__=='__main__':unittest.main()
