import unittest
import test_studio
import core,server
class Blockers(unittest.TestCase):
 setUp=test_studio.Checks.setUp
 tearDown=test_studio.Checks.tearDown
 post=test_studio.Checks.post
 project=test_studio.Checks.project
 def test_waiting_image_blocks_until_explicit_abandon(self):
  old=self.project();s=old['scenes'][1];s['versions']=[{'id':'keep','file':'keep.png'}];s['selected']='keep';c=core.enqueue_scene(old,s);c['status']='awaiting_download';s['status']='waiting_download';server.active=[old['id'],c['id']]
  new=core.new_project();new['script']='Kịch bản mới.';server.projects[new['id']]=new
  r=self.post('/api/layout-analysis',{'project':new['id'],'mode':'script'});self.assertEqual(r.status_code,409);self.assertEqual(r.json['blockers'][0]['id'],c['id']);self.assertEqual(c['status'],'awaiting_download')
  self.assertEqual(self.post('/api/abandon-blockers',{'project':new['id'],'ids':[c['id']]}).status_code,400)
  self.assertEqual(self.post('/api/abandon-blockers',{'project':new['id'],'ids':[c['id']],'confirmed':True}).status_code,200)
  self.assertEqual(s['selected'],'keep');self.assertEqual(s['versions'][0]['file'],'keep.png');self.assertEqual(c['status'],'abandoned');self.assertIsNone(server.active);self.assertFalse(server.running)
  self.assertEqual(self.post('/api/layout-analysis',{'project':new['id'],'mode':'script'}).status_code,200);self.assertEqual(new['commands'][-1]['kind'],'plan')
 def test_stale_ids_leave_other_jobs_unchanged(self):
  p=self.project();c=core.enqueue_scene(p,p['scenes'][1]);r=self.post('/api/abandon-blockers',{'project':p['id'],'ids':[c['id'],'missing'],'confirmed':True});self.assertEqual(r.status_code,400);self.assertEqual(c['status'],'queued')
