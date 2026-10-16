import time,uuid
from pathlib import Path

class DownloadWatch:
    def __init__(self,folder,clock=time.time):
        if not str(folder).strip():raise ValueError('Nhập hoặc chọn thư mục nhận ảnh.')
        self.folder=Path(folder).expanduser().resolve();self.clock=clock
        if not self.folder.is_dir():raise ValueError('Thư mục nhận ảnh không tồn tại.')
        self.seen=set(self.files());self.samples={};self.pending={};self.error='';self.new_count=0
    def files(self):
        result={}
        for path in self.folder.iterdir():
            if path.suffix.lower() not in ('.png','.jpg','.jpeg','.webp') or path.is_symlink() or not path.is_file():continue
            if Path(str(path)+'.crdownload').exists() or Path(str(path)+'.part').exists():continue
            stat=path.stat();key=(path.name,stat.st_size,stat.st_mtime_ns)
            if 0<stat.st_size<=40*1024*1024:result[key]=path
        return result
    def scan(self):
        now=self.clock();files=self.files();self.new_count=sum(k not in self.seen for k in files)
        self.pending={i:d for i,d in self.pending.items() if d['key'] in files}
        pending_keys={d['key'] for d in self.pending.values()}
        self.samples={k:t for k,t in self.samples.items() if k in files}
        for key,path in files.items():
            if key in self.seen or key in pending_keys:continue
            since=self.samples.setdefault(key,now)
            if now-since>=3:
                self.pending[uuid.uuid4().hex]={'key':key,'path':path,'name':path.name}
        return list(self.pending)
    def take(self,file_id):
        item=self.pending.get(file_id)
        if not item:raise ValueError('File đã thay đổi hoặc không còn trong thư mục.')
        before=item['path'].stat();raw=item['path'].read_bytes();after=item['path'].stat()
        if (before.st_size,before.st_mtime_ns)!=(after.st_size,after.st_mtime_ns) or (item['name'],after.st_size,after.st_mtime_ns)!=item['key']:raise ValueError('File vẫn đang thay đổi; chờ tải xong.')
        return item,raw
    def consume(self,file_id):
        item=self.pending.pop(file_id,None)
        if item:self.seen.add(item['key'])
