import unittest,io,wave,time,copy
from pathlib import Path
import core,server,test_studio
class VideoRoutes(unittest.TestCase):
 setUp=test_studio.Checks.setUp
 tearDown=test_studio.Checks.tearDown
 post=test_studio.Checks.post
 project=test_studio.Checks.project
 image=test_studio.Checks.image
 def test_recipe_voice_and_real_export(self):
  p=self.project()
  for s,color in zip(p['scenes'],['white','red','blue']):core.save_image(server.DATA,p,s,self.image(color))
  d=self.post('/api/video-project',{'project':p['id']}).json;self.assertEqual(len(d['items']),2)
  body={'project':p['id'],'clips':[{'id':s['id'],'seconds':.6,'motion':'still'} for s in p['scenes'][1:]],'resolution':'1280x720','use_voice':True}
  self.assertEqual(self.post('/api/video-render',body).status_code,400)
  audio=io.BytesIO()
  with wave.open(audio,'wb') as f:f.setparams((1,2,8000,0,'NONE','not compressed'));f.writeframes(b'\0\0'*8000)
  audio.seek(0);r=self.client.post('/api/video-voice',data={'project':p['id'],'voice':(audio,'voice.wav')},headers=self.headers)
  self.assertEqual(r.status_code,200,r.json)
  self.assertEqual(self.post('/api/video-save',body).status_code,200)
  self.assertEqual(self.post('/api/video-render',body).status_code,200)
  for _ in range(150):
   state=self.post('/api/video-project',{'project':p['id']}).json
   if state['job']['status']!='running':break
   time.sleep(.1)
  self.assertEqual(state['job']['status'],'done',state)
  response=self.client.get(state['job']['url']);self.assertEqual(response.status_code,200);response.close()
  self.assertEqual(p['video_recipe']['clips'],body['clips'])
 def test_duplicate_and_foreign_scene_rejected(self):
  p=self.project();core.save_image(server.DATA,p,p['scenes'][1],self.image('red'))
  c={'id':p['scenes'][1]['id'],'seconds':1,'motion':'still'}
  for clips in [[c,c],[dict(c,id='foreign')],[dict(c,seconds=float('nan'))]]:
   self.assertEqual(self.post('/api/video-save',{'project':p['id'],'clips':clips}).status_code,400)
