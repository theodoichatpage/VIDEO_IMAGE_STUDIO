import unittest,tempfile,wave,subprocess,json,threading
from pathlib import Path
from PIL import Image
import video_builder as video
class VideoBuilder(unittest.TestCase):
 def test_real_render_has_voice_correct_duration_and_order(self):
  with tempfile.TemporaryDirectory() as folder:
   root=Path(folder)
   for name,color in [('red','red'),('blue','blue')]:Image.new('RGB',(320,180),color).save(root/(name+'.png'))
   voice=root/'voice.wav'
   with wave.open(str(voice),'wb') as f:f.setparams((1,2,16000,0,'NONE','not compressed'));f.writeframes(b'\0\0'*48000)
   out=root/'out.mp4';updates=[]
   video.render([{'path':str(root/'red.png'),'seconds':1.5,'motion':'still'},{'path':str(root/'blue.png'),'seconds':1.5,'motion':'zoom'}],str(voice),out,320,180,updates.append,threading.Event())
   info=json.loads(subprocess.check_output(['ffprobe','-v','quiet','-show_streams','-show_format','-of','json',str(out)]))
   self.assertTrue(any(s['codec_type']=='audio' for s in info['streams']));self.assertAlmostEqual(float(info['format']['duration']),3,delta=.12)
   self.assertTrue(out.stat().st_size>1000);self.assertTrue(updates)
   for t,channel in [('0.5',0),('2',2)]:
    raw=subprocess.check_output(['ffmpeg','-v','error','-ss',t,'-i',str(out),'-frames:v','1','-vf','scale=1:1','-f','rawvideo','-pix_fmt','rgb24','-'])
    self.assertGreater(raw[channel],raw[2-channel]+100)
 def test_too_short_video_does_not_cut_voice(self):
  with tempfile.TemporaryDirectory() as folder:
   root=Path(folder);Image.new('RGB',(320,180)).save(root/'a.png')
   with wave.open(str(root/'v.wav'),'wb') as f:f.setparams((1,2,8000,0,'NONE','not compressed'));f.writeframes(b'\0\0'*24000)
   with self.assertRaises(ValueError):video.render([{'path':str(root/'a.png'),'seconds':1,'motion':'still'}],str(root/'v.wav'),root/'x.mp4',320,180,lambda _:None,threading.Event())
 def test_cancel_does_not_publish_output(self):
  with tempfile.TemporaryDirectory() as folder:
   root=Path(folder);Image.new('RGB',(320,180)).save(root/'a.png');cancel=threading.Event();cancel.set()
   with self.assertRaises(RuntimeError):video.render([{'path':str(root/'a.png'),'seconds':1,'motion':'still'}],None,root/'x.mp4',320,180,lambda _:None,cancel)
   self.assertFalse((root/'x.mp4').exists())
