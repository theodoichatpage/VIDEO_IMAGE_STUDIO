import unittest,tempfile,io,zipfile
from pathlib import Path
import server,core
from unittest.mock import patch
class Projects(unittest.TestCase):
 def test_new_project_keeps_templates_and_isolates_results(self):
  with tempfile.TemporaryDirectory() as tmp:
   saved=(server.DATA,server.projects);server.DATA=Path(tmp);server.projects={}
   try:
    client=server.app.test_client();h={'X-Studio-Token':server.TOKEN}
    a=client.post('/api/new',json={'name':'Old','thumbnail_style':'THUMB','style':'CONTENT'},headers=h).json
    old=server.projects[a['id']];old['scenes']=[core.scene(source='Old content')];old['manual_drafts']=[{'slot':'scene-1','source':'Old draft'}];server.persist(old)
    b=client.post('/api/new',json={'thumbnail_style':old['thumbnail_style'],'style':old['style']},headers=h).json
    self.assertNotEqual(a['id'],b['id']);self.assertEqual(b['scenes'],[]);self.assertEqual(b['commands'],[]);self.assertFalse(b.get('manual_drafts'));self.assertEqual(b['style'],'CONTENT');self.assertEqual(b['thumbnail_style'],'THUMB')
    self.assertTrue((server.DATA/a['id']/'project.json').exists());self.assertTrue((server.DATA/b['id']/'project.json').exists());self.assertEqual(old['scenes'][0]['source'],'Old content')
    folder=client.post('/api/project-folder',json={'project':b['id']},headers=h).json['folder'];self.assertEqual(Path(folder),server.DATA/b['id'])
    response=client.get('/download-project/'+a['id']);self.assertEqual(response.status_code,200)
    with zipfile.ZipFile(io.BytesIO(response.data)) as z:self.assertTrue(z.namelist())
   finally:server.DATA,server.projects=saved
 def test_template_replaces_old_script(self):
  for template in ['Create\n{{Old story}}\nSTYLE','Create\n[ DÁN NỘI DUNG ]\nVIETNAMESE SCRIPT:\nOld story\n\nSTYLE','Create “[DÁN NỘI DUNG TIẾNG VIỆT VÀO ĐÂY]”']:
   result=core.fill_template(template,'New story 500 tấn');self.assertIn('New story 500 tấn',result);self.assertNotIn('Old story',result)
 def test_open_folder_launches_explorer(self):
  with tempfile.TemporaryDirectory() as tmp:
   saved=(server.DATA,server.projects);server.DATA=Path(tmp);p=core.new_project();server.projects={p['id']:p}
   try:
    with patch.object(server.os,'name','nt'),patch.object(server.subprocess,'Popen') as launch:
     response=server.app.test_client().post('/api/project-folder',json={'project':p['id'],'open':True},headers={'X-Studio-Token':server.TOKEN})
     self.assertEqual(response.status_code,200);launch.assert_called_once_with(['explorer.exe',str((server.DATA/p['id']).resolve())],shell=False)
   finally:server.DATA,server.projects=saved
if __name__=='__main__':unittest.main()
