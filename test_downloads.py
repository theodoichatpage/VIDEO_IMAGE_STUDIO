import io,tempfile,unittest,threading,time
from pathlib import Path
from PIL import Image
import core,server
from download_watch import DownloadWatch
class Downloads(unittest.TestCase):
 def image(self,path,color='green'):
  Image.new('RGB',(640,360),color).save(path)
 def test_watch_baseline_partial_and_stable(self):
  with tempfile.TemporaryDirectory() as tmp:
   folder=Path(tmp);self.image(folder/'old.png');now=[0];watch=DownloadWatch(folder,lambda:now[0]);self.image(folder/'new.png');(folder/'new.png.crdownload').write_bytes(b'partial')
   watch.scan();self.assertEqual(watch.pending,{})
   (folder/'new.png.crdownload').unlink();watch.scan();now[0]=4;watch.scan();self.assertEqual(len(watch.pending),1);file_id=next(iter(watch.pending));item,raw=watch.take(file_id);self.assertEqual(item['name'],'new.png');watch.consume(file_id);watch.scan();self.assertEqual(watch.pending,{})
 def test_server_completes_only_after_file_and_stability(self):
  with tempfile.TemporaryDirectory() as tmp:
   root=Path(tmp);folder=root/'downloads';folder.mkdir();self.image(folder/'old.png');old=server.DATA;server.DATA=root/'projects';server.watches={};p=core.new_project();target=core.scene('Ảnh 1','a','p');target['status']='error';p['scenes']=[target];server.projects={p['id']:p};server.active=None
   try:
    client=server.app.test_client();h={'X-Studio-Token':server.TOKEN}
    self.assertEqual(client.post('/api/download-watch',json={'project':p['id'],'enabled':True,'folder':str(folder)},headers=h).status_code,200)
    clock=[0];watch=server.watches[p['id']];watch.clock=lambda:clock[0]
    self.assertEqual(client.post('/api/await-download',json={'project':p['id'],'scene':target['id']},headers=h).status_code,200)
    server.scan_downloads();self.assertEqual(target['status'],'waiting_download');self.assertEqual(target['versions'],[])
    self.image(folder/'new.png');server.scan_downloads();self.assertEqual(target['versions'],[]);clock[0]=4;server.scan_downloads();self.assertEqual(target['status'],'done');self.assertIn('stopped_at',target);self.assertEqual(len(target['versions']),1);self.assertEqual(target['error'],'');server.scan_downloads();self.assertEqual(len(target['versions']),1)
   finally:server.DATA=old;server.watches={}
 def test_background_completion_and_next_job_without_ui_poll(self):
  with tempfile.TemporaryDirectory() as tmp:
   root=Path(tmp);folder=root/'downloads';folder.mkdir();saved=(server.DATA,server.projects,server.watches,server.active,server.running,server.connection.copy());server.DATA=root/'projects'
   p=core.new_project();a=core.scene();a['status']='waiting_download';b=core.scene();p['scenes']=[a,b]
   first={'id':'first','scene_id':a['id'],'status':'awaiting_download','created':time.time(),'kind':'image'};second={'id':'second','scene_id':b['id'],'status':'queued','created':time.time()+1,'kind':'image'};p['commands']=[first,second];a['command']='first';server.projects={p['id']:p};server.active=[p['id'],'first'];server.running=True;server.connection.update(client='test',last=time.time(),ready=True)
   clock=[0];watch=DownloadWatch(folder,lambda:clock[0]);server.watches={p['id']:watch};stop=threading.Event();thread=threading.Thread(target=server.monitor_downloads,args=(stop,0.01));thread.start()
   try:
    self.image(folder/'new.png')
    deadline=time.monotonic()+2
    while not watch.samples and time.monotonic()<deadline:stop.wait(0.01)
    clock[0]=4
    deadline=time.monotonic()+2
    while a['status']!='done' and time.monotonic()<deadline:stop.wait(0.01)
    self.assertEqual(a['status'],'done');self.assertEqual(first['status'],'done');self.assertIsNone(server.active)
    response=server.app.test_client().post('/bridge/poll',json={'client':'test','ready':True},headers={'X-Studio-Token':server.TOKEN})
    self.assertEqual(response.status_code,200);self.assertEqual(response.json['command']['id'],'second');self.assertEqual(len(a['versions']),1)
   finally:
    stop.set();thread.join(2);server.DATA,server.projects,server.watches,server.active,server.running,connection=saved;server.connection.clear();server.connection.update(connection)
 def test_download_signal_selects_file_without_state_poll(self):
  with tempfile.TemporaryDirectory() as tmp:
   root=Path(tmp);folder=root/'downloads';folder.mkdir();saved=(server.DATA,server.projects,server.watches,server.download_signals,server.connection.copy());server.DATA=root/'projects';p=core.new_project();a=core.scene();a['status']='waiting_download';p['scenes']=[a];server.projects={p['id']:p};clock=[0];w=DownloadWatch(folder,lambda:clock[0]);server.watches={p['id']:w};server.download_signals={};server.connection['client']='test'
   try:
    self.image(folder/'a.png');self.image(folder/'b.png');server.scan_downloads()
    response=server.app.test_client().post('/bridge/download-complete',json={'client':'test','filename':str(folder/'b.png')},headers={'X-Studio-Token':server.TOKEN});self.assertEqual(response.status_code,200)
    clock[0]=4;server.scan_downloads();self.assertEqual(a['status'],'done');self.assertEqual(len(a['versions']),1);self.assertEqual(len(w.pending),1)
   finally:
    server.DATA,server.projects,server.watches,server.download_signals,c=saved;server.connection.clear();server.connection.update(c)
 def test_multiple_files_require_choice(self):
  with tempfile.TemporaryDirectory() as tmp:
   root=Path(tmp);folder=root/'downloads';folder.mkdir();old=server.DATA;server.DATA=root/'projects';p=core.new_project();a=core.scene();a['status']='waiting_download';p['scenes']=[a];server.projects={p['id']:p};clock=[0];w=DownloadWatch(folder,lambda:clock[0]);server.watches={p['id']:w}
   try:
    self.image(folder/'a.png');server.scan_downloads();clock[0]=2;self.image(folder/'b.png');server.scan_downloads();clock[0]=4;server.scan_downloads();self.assertEqual(a['versions'],[]);clock[0]=6;server.scan_downloads();self.assertEqual(len(w.pending),2)
    choice=next(i for i,d in w.pending.items() if d['name']=='b.png');server.accept_download(p,a,w,choice);self.assertEqual(a['status'],'done');self.assertEqual(len(a['versions']),1)
   finally:server.DATA=old;server.watches={}
if __name__=='__main__':unittest.main()
