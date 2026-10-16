import unittest, tempfile, io, base64
from pathlib import Path
from PIL import Image
import core, server

class Recovery(unittest.TestCase):
 def test_receive_and_download_correct_scene(self):
  with tempfile.TemporaryDirectory() as tmp:
   old_data=server.DATA;server.DATA=Path(tmp)
   try:
    p=core.new_project();a=core.scene('A','First','a');b=core.scene('B','Second','b');p['scenes']=[a,b];server.projects={p['id']:p};server.connection.update(client='',last=0);server.active=None
    ca=core.enqueue_scene(p,a);ca['status']='abandoned';a['status']='error';cb=core.enqueue_scene(p,b)
    client=server.app.test_client();headers={'X-Studio-Token':server.TOKEN}
    reply=client.post('/api/receive-image',json={'project':p['id'],'scene':a['id']},headers=headers);self.assertEqual(reply.status_code,200)
    job=p['commands'][-1];self.assertEqual(job['candidate_job_ids'],[ca['id']]);self.assertTrue(job['receive_only']);self.assertEqual(job['prompt'],'')
    server.connection['client']='test';buf=io.BytesIO();Image.new('RGB',(640,360),'green').save(buf,format='PNG')
    reply=client.post('/bridge/result',json={'client':'test','id':job['id'],'phase':'done','image':'data:image/png;base64,'+base64.b64encode(buf.getvalue()).decode()},headers=headers);self.assertEqual(reply.status_code,200)
    reply=client.get('/download-image/'+p['id']+'/'+a['id']);self.assertEqual(reply.status_code,200);self.assertIn('attachment',reply.headers['Content-Disposition']);self.assertEqual(Image.open(io.BytesIO(reply.data)).getpixel((0,0)),(0,128,0));reply.close()
    self.assertEqual(client.get('/download-image/'+p['id']+'/'+b['id']).status_code,404)
   finally:server.DATA=old_data

if __name__=='__main__':unittest.main()
