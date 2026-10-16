import unittest,tempfile,time
from pathlib import Path
import server,core
class Switch(unittest.TestCase):
 def test_transfer_blocks_old_client_and_preserves_queued(self):
  saved=(server.DATA,server.projects,server.connection.copy(),server.running,server.active)
  with tempfile.TemporaryDirectory() as tmp:
   server.DATA=Path(tmp);p=core.new_project();a=core.scene();b=core.scene();p['scenes']=[a,b];old=core.enqueue_scene(p,a);old['status']='awaiting_download';a['status']='waiting_download';new=core.enqueue_scene(p,b);server.projects={p['id']:p};server.active=[p['id'],old['id']];server.connection.update(client='old',last=time.time(),ready=True)
   try:
    client=server.app.test_client();h={'X-Studio-Token':server.TOKEN}
    response=client.post('/bridge/bind',json={'client':'new','ready':True,'url':'https://chatgpt.com/c/new'},headers=h);self.assertEqual(response.status_code,200);self.assertEqual(old['status'],'abandoned');self.assertEqual(new['status'],'queued')
    server.connection['last']=0
    self.assertEqual(client.post('/bridge/heartbeat',json={'client':'old','ready':True},headers=h).status_code,409)
    response=client.post('/bridge/poll',json={'client':'new','ready':True},headers=h);self.assertEqual(response.json['command']['id'],new['id'])
   finally:
    server.DATA,server.projects,c,server.running,server.active=saved;server.connection.clear();server.connection.update(c)
if __name__=='__main__':unittest.main()
