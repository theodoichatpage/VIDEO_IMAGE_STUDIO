"""Semantic person instances and OCR line layers; adapted from the supplied SAM2 package."""
import numpy as np
from PIL import Image

def compose_labels(shape,people,texts):
    labels=np.zeros(shape,np.int32);names={0:('nen_con_lai.png','Nền còn lại')};idx=0
    for prefix,items,title in [('chu',texts,'Cụm chữ'),('nguoi',people,'Người')]:
        for mask in items:
            mask=np.asarray(mask,bool)
            if mask.shape!=shape:raise ValueError('Sai kích thước vùng tách')
            keep=mask&(labels==0)
            if not keep.any():continue
            idx+=1;labels[keep]=idx;names[idx]=(f'{prefix}_{sum(1 for n in names.values() if n[0].startswith(prefix+"_"))+1:02d}.png',title)
    return labels,names

def group_lines(boxes):
    lines=[]
    for b in sorted(boxes,key=lambda b:(b[1]+b[3],b[0])):
        x,y,r,t=b;chosen=None
        for line in lines:
            a,c,d,e=line['box'];overlap=max(0,min(t,e)-max(y,c));gap=max(0,x-d,a-r)
            if overlap>=.55*min(t-y,e-c) and gap<=1.5*max(t-y,e-c):chosen=line;break
        if chosen is None:lines.append({'box':list(b),'words':[b]})
        else:
            a,c,d,e=chosen['box'];chosen['box']=[min(a,x),min(c,y),max(d,r),max(e,t)];chosen['words'].append(b)
    return lines

class SemanticEngine:
    def __init__(self,sam,root,device):
        import easyocr
        from transformers import AutoProcessor,AutoModelForZeroShotObjectDetection
        from sam2.sam2_image_predictor import SAM2ImagePredictor
        self.device=device;self.predictor=SAM2ImagePredictor(sam)
        self.processor=AutoProcessor.from_pretrained('IDEA-Research/grounding-dino-tiny',cache_dir=str(root/'models'/'huggingface'))
        self.detector=AutoModelForZeroShotObjectDetection.from_pretrained('IDEA-Research/grounding-dino-tiny',cache_dir=str(root/'models'/'huggingface')).to(device).eval()
        self.ocr=easyocr.Reader(['vi','en'],gpu=device=='cuda',model_storage_directory=str(root/'models'/'ocr'))
    def segment(self,rgb,report):
        import torch,cv2
        h,w=rgb.shape[:2];report(15,'Đang nhận diện từng người bằng Grounding DINO.')
        inputs=self.processor(images=Image.fromarray(rgb),text='person.',return_tensors='pt').to(self.device)
        with torch.inference_mode():outputs=self.detector(**inputs)
        results=self.processor.post_process_grounded_object_detection(outputs,inputs.input_ids,box_threshold=.25,text_threshold=.20,target_sizes=[(h,w)])[0]
        boxes=results['boxes'].detach().cpu().numpy();scores=results['scores'].detach().cpu().numpy();kept=[]
        for i in np.argsort(-scores):
            b=boxes[i];duplicate=False
            for c in kept:
                inter=np.prod(np.maximum(0,np.minimum(b[2:],c[2:])-np.maximum(b[:2],c[:2])));union=np.prod(b[2:]-b[:2])+np.prod(c[2:]-c[:2])-inter
                if inter/max(union,1)>.65:duplicate=True;break
            if not duplicate:kept.append(b)
        report(30,'Đang nhận diện chữ và gom các từ cùng dòng.');detected=self.ocr.readtext(rgb,paragraph=False,min_size=8,mag_ratio=1.5);words=[]
        for polygon,word,confidence in detected:
            if confidence<.15:continue
            p=np.asarray(polygon);x,y=np.floor(p.min(0)).astype(int);r,t=np.ceil(p.max(0)).astype(int);x=max(0,x-2);y=max(0,y-2);r=min(w,r+3);t=min(h,t+3)
            if r>x and t>y:words.append((x,y,r,t))
        lines=group_lines(words);report(40,'Đang mã hóa ảnh để lấy đường viền người và chữ.')
        with torch.inference_mode():self.predictor.set_image(rgb)
        people=[];texts=[];total=len(kept)+len(words);done=0
        with torch.inference_mode():
            for b in kept:
                masks,quality,_=self.predictor.predict(box=np.asarray(b),multimask_output=True);people.append(masks[int(np.argmax(quality))].astype(bool));done+=1;report(45+int(40*done/max(total,1)),f'Đã lấy đường viền {done}/{total} vùng.')
            for line in lines:
                combined=np.zeros((h,w),bool)
                for x,y,r,t in line['words']:
                    masks,quality,_=self.predictor.predict(box=np.array([x,y,r,t]),multimask_output=True);region=np.zeros((h,w),bool);region[y:t,x:r]=True;candidates=[m.astype(bool)&region for m in masks];valid=[i for i,m in enumerate(candidates) if .03<=m.sum()/((r-x)*(t-y))<=.90]
                    if valid:mask=candidates[max(valid,key=lambda i:quality[i])]
                    else:
                        crop=np.ascontiguousarray(rgb[y:t,x:r]);gc=np.full(crop.shape[:2],cv2.GC_PR_FGD,np.uint8);gc[[0,-1],:]=cv2.GC_BGD;gc[:,[0,-1]]=cv2.GC_BGD
                        try:cv2.grabCut(crop,gc,None,np.zeros((1,65)),np.zeros((1,65)),3,cv2.GC_INIT_WITH_MASK);local=(gc==cv2.GC_FGD)|(gc==cv2.GC_PR_FGD)
                        except cv2.error:local=np.zeros(crop.shape[:2],bool)
                        mask=np.zeros((h,w),bool);mask[y:t,x:r]=local
                    combined|=mask;done+=1;report(45+int(40*done/max(total,1)),f'Đã lấy đường viền {done}/{total} vùng.')
                if combined.any():texts.append(combined)
        labels,names=compose_labels((h,w),people,texts);warnings=[]
        if not people:warnings.append('AI chưa nhận diện được người trong ảnh.')
        if not texts:warnings.append('AI chưa nhận diện được cụm chữ trong ảnh.')
        return labels,names,warnings
