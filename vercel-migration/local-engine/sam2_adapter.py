from pathlib import Path
import io, zipfile
import numpy as np
from layers import export_layers, fill_background

class Sam2Adapter:
    """Adapter around the supplied SAM2 + GroundingDINO + EasyOCR engine."""
    def __init__(self, root: Path):
        self.root=Path(root); self.model=None; self.engine=None; self.device=None
    def load(self):
        if self.engine is not None: return self
        import torch
        from sam2.build_sam import build_sam2
        from semantic import SemanticEngine
        self.device='cuda' if torch.cuda.is_available() else 'cpu'
        self.model=build_sam2('configs/sam2.1/sam2.1_hiera_t.yaml',str(self.root/'models'/'sam2.1_hiera_tiny.pt'),device=self.device,apply_postprocessing=False)
        self.engine=SemanticEngine(self.model,self.root,self.device)
        return self
    def capabilities(self):
        try:
            import torch; device='cuda' if torch.cuda.is_available() else 'cpu'
        except Exception: device='unavailable'
        return {'sam2':(self.root/'models'/'sam2.1_hiera_tiny.pt').exists(),'device':self.device or device}
    def separate(self,rgb,output_dir:Path,*,fill=False,report=lambda *_:None):
        self.load(); labels,names,warnings=self.engine.segment(rgb,report); background=None
        if fill:
            report(90,'Đang lấp các vùng trống trên nền.')
            try: background=fill_background(rgb,labels)
            except Exception as exc: warnings.append('Chưa tạo được nền lấp: '+str(exc))
        report(95,'Đang xuất người, cụm chữ, nền và kiểm tra ghép lại.')
        archive,layers,exact=export_layers(rgb,labels,background,names); output_dir.mkdir(parents=True,exist_ok=True); (output_dir/'cac_lop.zip').write_bytes(archive)
        with zipfile.ZipFile(io.BytesIO(archive)) as z:
            for member in z.infolist():
                target=(output_dir/member.filename).resolve()
                if not target.is_relative_to(output_dir.resolve()): raise ValueError('Unsafe output archive path')
            z.extractall(output_dir)
        return {'layers':layers,'exact':exact,'background_filled':background is not None,'warning':' '.join(warnings) or None,'width':int(rgb.shape[1]),'height':int(rgb.shape[0])}
