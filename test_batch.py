import unittest,tempfile
from pathlib import Path
import server,core
class Batch(unittest.TestCase):
 def test_fifo_error_pause_recovery_and_no_duplicates(self):
  with tempfile.TemporaryDirectory() as tmp:
   old=server.DATA;server.DATA=Path(tmp)
   try:
    p=core.new_project();server.projects={p['id']:p};server.active=None;server.running=False;server.connection.update(client='',last=0)
    client=server.app.test_client();h={'X-Studio-Token':server.TOKEN}
    def post(path,d):return client.post(path,json=d,headers=h)
    body={'project':p['id'],'style':'STYLE {{noi_dung}}','thumbnail_style':'THUMB {{noi_dung}}','rows':[{'slot':'scene-'+str(i),'source':'Content '+str(i)} for i in range(1,4)]}
    self.assertEqual(post('/api/batch-images',body).json['queued'],3);self.assertEqual(post('/api/batch-images',body).json['queued'],0);self.assertEqual(len(p['commands']),3)
    d={'client':'tab','ready':True,'url':'https://chatgpt.com/'};first=post('/bridge/poll',d).json['command'];self.assertEqual(first['prompt'],'STYLE Content 1')
    post('/bridge/result',{'client':'tab','id':first['id'],'phase':'error','error':'send failed'});self.assertFalse(server.running);self.assertIsNone(post('/bridge/poll',d).json['command']);self.assertEqual(p['commands'][1]['status'],'queued')
    post('/api/pick-image',{'project':p['id'],'scene':p['scenes'][0]['id']});pick=post('/bridge/poll',d).json['command'];self.assertTrue(pick['pick_image']);self.assertFalse(pick['restore_running'])
    post('/bridge/result',{'client':'tab','id':pick['id'],'phase':'error','error':'canceled'});post('/api/queue-control',{'project':p['id'],'action':'resume'});second=post('/bridge/poll',d).json['command'];self.assertEqual(second['id'],p['commands'][1]['id'])
   finally:server.DATA=old
if __name__=='__main__':unittest.main()
