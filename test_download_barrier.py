import unittest,tempfile
from pathlib import Path
import server,core

class DownloadBarrier(unittest.TestCase):
 def test_run_and_lost_active_cannot_bypass_download(self):
  saved=(server.DATA,server.projects,server.watches,server.connection.copy(),server.active,server.running)
  with tempfile.TemporaryDirectory() as tmp:
   server.DATA=Path(tmp);p=core.new_project();p['style']='image {{noi_dung}}';p['scenes']=[core.scene('one','one','one'),core.scene('two','two','two')];server.projects={p['id']:p};server.watches={};server.active=None;server.running=False;server.connection['client']='test';client=server.app.test_client();h={'X-Studio-Token':server.TOKEN}
   def post(path,data):return client.post(path,json=data,headers=h)
   try:
    post('/api/run',{'project':p['id']});first=post('/bridge/poll',{'client':'test','ready':True}).json['command'];self.assertTrue(first['download_only'])
    post('/bridge/result',{'client':'test','id':first['id'],'phase':'sent'});server.active=None
    post('/api/run',{'project':p['id']});self.assertEqual(len(p['commands']),2)
    for _ in range(3):self.assertEqual(post('/bridge/poll',{'client':'test','ready':True}).json['command']['id'],first['id'])
    self.assertEqual(p['scenes'][0]['status'],'waiting_download')
   finally:
    server.DATA,server.projects,server.watches,connection,server.active,server.running=saved;server.connection.clear();server.connection.update(connection)
if __name__=='__main__':unittest.main()
