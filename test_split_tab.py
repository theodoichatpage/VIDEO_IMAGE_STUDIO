import unittest,io,json
from unittest.mock import patch
import server
class Result(io.BytesIO):
 status=200
 headers={'Content-Type':'application/json'}
class SplitTab(unittest.TestCase):
 def test_original_ui_and_proxy(self):
  client=server.app.test_client()
  ui=client.get('/split-app/');self.assertEqual(ui.status_code,200)
  for item in ['Tách tất cả bằng AI','Xem ghép lại','/split-app/api/segment','/split-app/output/','DataTransfer'] :self.assertIn(item,ui.text)
  with patch.object(server.urllib.request,'urlopen',return_value=Result(b'{"id":"abc"}')) as request:
   response=client.post('/split-app/api/segment',data=b'image payload',content_type='multipart/form-data; boundary=one')
   self.assertEqual(response.json,{'id':'abc'});req=request.call_args.args[0];self.assertEqual(req.full_url,'http://127.0.0.1:7860/api/segment');self.assertEqual(req.data,b'image payload')
  with patch.object(server.urllib.request,'urlopen',side_effect=OSError('offline')):
   response=client.post('/split-app/api/segment',data=b'file');self.assertEqual(response.status_code,503);self.assertIn('SAM2',response.json['error'])
  self.assertEqual(client.get('/split-app/api/unknown').status_code,404)
  self.assertEqual(client.post('/split-app/api/segment',headers={'Origin':'https://example.com'}).status_code,403)
 def test_integrated_launch(self):
  client=server.app.test_client();saved=server.sam_process;server.sam_process=None
  try:
   with patch.object(server,'sam_is_running',return_value=False),patch.object(server.subprocess,'Popen') as launch:
    response=client.post('/api/open-sam',json={},headers={'X-Studio-Token':server.TOKEN});self.assertEqual(response.status_code,200);self.assertTrue(launch.call_args.args[0][1].endswith('start_integrated.py'))
    launch.return_value.poll.return_value=None
    client.post('/api/open-sam',json={},headers={'X-Studio-Token':server.TOKEN});self.assertEqual(launch.call_count,1)
  finally:server.sam_process=saved
 def test_header_order(self):
  html=server.INDEX_HTML
  self.assertLess(html.index('id="projectsTab"'),html.index('id="splitTab"'));self.assertIn('id="splitFrame"',html)
if __name__=='__main__':unittest.main()
