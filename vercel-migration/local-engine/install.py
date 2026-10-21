from pathlib import Path
import sys,os,subprocess,urllib.request,zipfile
ROOT=Path(__file__).resolve().parent
def cmd(*args):subprocess.run([sys.executable,'-m','pip',*args],check=True)
def download(url,path):
    temp=Path(str(path)+'.part');print('Downloading:',url,flush=True);urllib.request.urlretrieve(url,temp);temp.replace(path)
def main():
    if sys.version_info<(3,10) or sys.version_info>=(3,13):raise RuntimeError('Hãy dùng Python 3.11 hoặc 3.12.')
    cmd('install','--upgrade','pip');cmd('install','torch>=2.5.1','torchvision>=0.20.1','--index-url','https://download.pytorch.org/whl/cpu');cmd('install','flask>=3,<4','pillow>=10','numpy>=1.24','huggingface_hub','opencv-python-headless','transformers==4.50.3','easyocr==1.7.2')
    vendor=ROOT/'vendor';vendor.mkdir(exist_ok=True);repo=vendor/'sam2-main'
    if not (repo/'setup.py').exists():
        archive=vendor/'sam2.zip';download('https://github.com/facebookresearch/sam2/archive/refs/heads/main.zip',archive)
        with zipfile.ZipFile(archive) as z:
            for member in z.infolist():
                dest=(vendor/member.filename).resolve()
                if not dest.is_relative_to(vendor.resolve()):raise RuntimeError('Unsafe ZIP path')
            z.extractall(vendor)
        archive.unlink()
    os.environ['SAM2_BUILD_CUDA']='0';cmd('install','-e',str(repo));model=ROOT/'models/sam2.1_hiera_tiny.pt';model.parent.mkdir(exist_ok=True)
    if not model.exists():download('https://dl.fbaipublicfiles.com/segment_anything_2/092824/sam2.1_hiera_tiny.pt',model)
    print('Cài đặt hoàn tất. Chạy start_engine.bat',flush=True)
if __name__=='__main__':main()
