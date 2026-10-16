import unittest,time
from unittest.mock import patch
import test_layouts,server,core
class Recovery(unittest.TestCase):
 setUp=test_layouts.LayoutChecks.setUp
 tearDown=test_layouts.LayoutChecks.tearDown
 post=test_layouts.LayoutChecks.post
 project=test_layouts.LayoutChecks.project
 start=test_layouts.LayoutChecks.start
 response=test_layouts.LayoutChecks.response
 def test_partial_updates_analysis_progress_only(self):
  p=self.start();c=p['commands'][0];c.update(status='waiting',progress_at=time.time()-500)
  self.post('/bridge/result',{'client':'layout','id':c['id'],'phase':'partial','text':'{"scenes":['})
  self.assertEqual(c['response_text'],'{"scenes":[');self.assertLess(time.time()-c['progress_at'],2);self.assertIn('Đang nhận',p['layout_status'])
  last=c['progress_at'];self.post('/bridge/result',{'client':'layout','id':c['id'],'phase':'partial','text':'{"scenes":['});self.assertEqual(c['progress_at'],last)
 def test_five_minutes_does_not_expire_plan_but_fifteen_does(self):
  p=self.start();c=p['commands'][0];c.update(status='waiting',progress_at=time.time()-400);server.expire_jobs();self.assertEqual(c['status'],'waiting')
  c['progress_at']=time.time()-901;server.expire_jobs();self.assertEqual(c['status'],'error');self.assertEqual(p['analysis_stage'],'interrupted');self.assertIn('15 phút',p['layout_status'])
 def test_old_abandoned_state_is_reconciled(self):
  p=self.start();c=p['commands'][0];c.update(status='abandoned',error='timeout');server.expire_jobs();self.assertEqual(p['analysis_stage'],'interrupted');self.assertIn('timeout',p['layout_status'])
 def test_recovery_reuses_marker_without_queued_send(self):
  p=self.start();c=p['commands'][0];c.update(status='abandoned',sending_at=time.time()-800);server.running=False
  r=self.post('/api/layout-recover',{'project':p['id']});self.assertEqual(r.status_code,200);self.assertEqual(len(p['commands']),1);self.assertEqual(c['status'],'waiting');self.assertTrue(c['recover_plan'])
  polled=self.post('/bridge/poll',{'client':'layout','ready':True}).json['command'];self.assertEqual(polled['id'],c['id']);self.assertNotEqual(polled['status'],'queued')
  self.response(p,c);self.assertEqual(p['analysis_stage'],'review');self.assertEqual(len(p['commands']),2)
 def test_recovery_rejects_changed_input(self):
  p=self.start();c=p['commands'][0];c.update(status='error',sent_at=time.time());p['visual_style']='Changed'
  self.assertEqual(self.post('/api/layout-recover',{'project':p['id']}).status_code,400);self.assertEqual(c['status'],'error')
