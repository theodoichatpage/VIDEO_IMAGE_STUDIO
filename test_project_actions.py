import unittest,json
import test_studio
import server,core
class ProjectActions(unittest.TestCase):
 setUp=test_studio.Checks.setUp
 tearDown=test_studio.Checks.tearDown
 post=test_studio.Checks.post
 project=test_studio.Checks.project
 def test_delete_requires_confirmation_and_archives_files(self):
  p=self.project();folder=server.DATA/p['id'];(folder/'saved.png').write_bytes(b'keep')
  c=core.enqueue_scene(p,p['scenes'][1]);c['status']='awaiting_download';server.active=[p['id'],c['id']];server.watches[p['id']]=object()
  self.assertEqual(self.post('/api/delete-project',{'project':p['id']}).status_code,400);self.assertTrue(folder.exists())
  self.assertEqual(self.post('/api/delete-project',{'project':p['id'],'confirmed':True}).status_code,200)
  self.assertNotIn(p['id'],server.projects);self.assertNotIn(p['id'],server.watches);self.assertIsNone(server.active);self.assertFalse(folder.exists())
  archived=next((server.DATA/'_deleted').iterdir());self.assertEqual((archived/'saved.png').read_bytes(),b'keep');saved=json.loads((archived/'project.json').read_text());self.assertEqual(saved['commands'][0]['status'],'abandoned');self.assertEqual(list(server.DATA.glob('*/project.json')),[])
 def test_delete_does_not_change_another_project(self):
  p=self.project();other=self.project();c=core.enqueue_scene(other,other['scenes'][1]);server.active=[other['id'],c['id']];server.running=True
  self.post('/api/delete-project',{'project':p['id'],'confirmed':True});self.assertIn(other['id'],server.projects);self.assertEqual(c['status'],'queued');self.assertEqual(server.active,[other['id'],c['id']]);self.assertTrue(server.running)
 def test_reject_delete_during_split(self):
  p=self.project();p['scenes'][0]['split']={'v':{'status':'running'}}
  self.assertEqual(self.post('/api/delete-project',{'project':p['id'],'confirmed':True}).status_code,400);self.assertIn(p['id'],server.projects)
 def test_reason_identifies_project_scene_and_missing_watch(self):
  p=self.project();p['download_folder']='C:/Images';c=core.enqueue_scene(p,p['scenes'][1]);c['status']='awaiting_download';server.watches.pop(p['id'],None)
  d=self.post('/api/analysis-blockers',{'project':p['id']}).json['blockers'][0]
  self.assertEqual(d['project_id'],p['id']);self.assertEqual(d['scene_id'],p['scenes'][1]['id']);self.assertIn('C:/Images',d['reason']);self.assertIn('chưa bật',d['reason'])
