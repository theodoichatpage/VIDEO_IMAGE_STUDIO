"""Semantic separation for isolated people, groups of people and OCR text blocks."""
import numpy as np
from PIL import Image


def _box_gap(a,b):
    ax1,ay1,ax2,ay2=a;bx1,by1,bx2,by2=b
    dx=max(0,max(ax1,bx1)-min(ax2,bx2));dy=max(0,max(ay1,by1)-min(ay2,by2))
    return dx,dy


def group_people(boxes,image_shape):
    """Cluster nearby/overlapping person detections. Isolated detections stay individual."""
    h,w=image_shape;boxes=[np.asarray(b,float) for b in boxes];groups=[];unused=set(range(len(boxes)))
    while unused:
        seed=unused.pop();cluster={seed};changed=True
        while changed:
            changed=False
            for j in list(unused):
                for i in cluster:
                    a,b=boxes[i],boxes[j];dx,dy=_box_gap(a,b)
                    ah=max(1,a[3]-a[1]);bh=max(1,b[3]-b[1]);aw=max(1,a[2]-a[0]);bw=max(1,b[2]-b[0])
                    # People form one visual group when their boxes overlap or are close relative to body size.
                    if dx<=0.42*max(aw,bw) and dy<=0.22*max(ah,bh):
                        cluster.add(j);unused.remove(j);changed=True;break
        groups.append(sorted(cluster))
    return groups


def group_lines(boxes):
    lines=[]
    for b in sorted(boxes,key=lambda b:(b[1],b[0])):
        x,y,r,t=b;chosen=None
        for line in lines:
            a,c,d,e=line['box'];overlap=max(0,min(t,e)-max(y,c));gap=max(0,x-d,a-r);height=max(1,min(t-y,e-c))
            if overlap>=.42*height and gap<=2.4*max(t-y,e-c):chosen=line;break
        if chosen is None:lines.append({'box':list(b),'words':[b]})
        else:
            a,c,d,e=chosen['box'];chosen['box']=[min(a,x),min(c,y),max(d,r),max(e,t)];chosen['words'].append(b)
    return lines


def group_text_blocks(lines):
    """Merge neighbouring OCR lines into one movable text block/phrase."""
    blocks=[]
    for line in sorted(lines,key=lambda x:(x['box'][1],x['box'][0])):
        x1,y1,x2,y2=line['box'];best=None;best_score=None
        for block in blocks:
            a,c,d,e=block['box'];v_gap=max(0,y1-e,c-y2);x_overlap=max(0,min(x2,d)-max(x1,a));min_w=max(1,min(x2-x1,d-a));h=max(1,max(y2-y1,e-c))
            aligned=x_overlap/min_w>=.22 or abs(x1-a)<=1.4*h or abs(x2-d)<=1.4*h
            if aligned and v_gap<=1.25*h:
                score=v_gap+abs(x1-a)*.15
                if best_score is None or score<best_score:best,best_score=block,score
        if best is None:blocks.append({'box':list(line['box']),'words':list(line['words'])})
        else:
            a,c,d,e=best['box'];best['box']=[min(a,x1),min(c,y1),max(d,x2),max(e,y2)];best['words'].extend(line['words'])
    return blocks


def compose_labels(shape,person_items,texts):
    labels=np.zeros(shape,np.int32);names={0:('nen_con_lai.png','Nền đã bù kín')};idx=0;counts={'chu':0,'nguoi':0,'cum_nguoi':0}
    # Text owns overlapping visible pixels, then people/groups.
    for mask in texts:
        mask=np.asarray(mask,bool);keep=mask&(labels==0)
        if not keep.any():continue
        idx+=1;counts['chu']+=1;labels[keep]=idx;names[idx]=(f"chu_{counts['chu']:02d}.png",'Cụm chữ')
    for kind,mask in person_items:
        mask=np.asarray(mask,bool);keep=mask&(labels==0)
        if not keep.any():continue
        idx+=1;counts[kind]+=1;labels[keep]=idx
        names[idx]=((f"cum_nguoi_{counts[kind]:02d}.png",'Cụm người') if kind=='cum_nguoi' else (f"nguoi_{counts[kind]:02d}.png",'Người'))
    return labels,names


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
        h,w=rgb.shape[:2];report(15,'Đang nhận diện người và cụm người.')
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
        clusters=group_people(kept,(h,w))
        report(30,'Đang nhận diện và gom chữ thành cụm nội dung.');detected=self.ocr.readtext(rgb,paragraph=False,min_size=8,mag_ratio=1.5);words=[]
        for polygon,word,confidence in detected:
            if confidence<.15:continue
            p=np.asarray(polygon);x,y=np.floor(p.min(0)).astype(int);r,t=np.ceil(p.max(0)).astype(int);x=max(0,x-2);y=max(0,y-2);r=min(w,r+3);t=min(h,t+3)
            if r>x and t>y:words.append((x,y,r,t))
        text_blocks=group_text_blocks(group_lines(words));report(40,'Đang lấy đường viền người, cụm người và cụm chữ.')
        with torch.inference_mode():self.predictor.set_image(rgb)
        raw_people=[];texts=[];total=len(kept)+len(words);done=0
        with torch.inference_mode():
            for b in kept:
                masks,quality,_=self.predictor.predict(box=np.asarray(b),multimask_output=True);raw_people.append(masks[int(np.argmax(quality))].astype(bool));done+=1;report(45+int(40*done/max(total,1)),f'Đã lấy đường viền {done}/{total} vùng.')
            for block in text_blocks:
                combined=np.zeros((h,w),bool)
                for x,y,r,t in block['words']:
                    masks,quality,_=self.predictor.predict(box=np.array([x,y,r,t]),multimask_output=True);region=np.zeros((h,w),bool);region[y:t,x:r]=True;candidates=[m.astype(bool)&region for m in masks];valid=[i for i,m in enumerate(candidates) if .03<=m.sum()/((r-x)*(t-y))<=.92]
                    if valid:mask=candidates[max(valid,key=lambda i:quality[i])]
                    else:
                        crop=np.ascontiguousarray(rgb[y:t,x:r]);gc=np.full(crop.shape[:2],cv2.GC_PR_FGD,np.uint8);gc[[0,-1],:]=cv2.GC_BGD;gc[:,[0,-1]]=cv2.GC_BGD
                        try:cv2.grabCut(crop,gc,None,np.zeros((1,65)),np.zeros((1,65)),3,cv2.GC_INIT_WITH_MASK);local=(gc==cv2.GC_FGD)|(gc==cv2.GC_PR_FGD)
                        except cv2.error:local=np.zeros(crop.shape[:2],bool)
                        mask=np.zeros((h,w),bool);mask[y:t,x:r]=local
                    combined|=mask;done+=1;report(45+int(40*done/max(total,1)),f'Đã lấy đường viền {done}/{total} vùng.')
                if combined.any():texts.append(combined)
        person_items=[]
        for cluster in clusters:
            merged=np.zeros((h,w),bool)
            for i in cluster:merged|=raw_people[i]
            person_items.append(('cum_nguoi' if len(cluster)>1 else 'nguoi',merged))
        labels,names=compose_labels((h,w),person_items,texts);warnings=[]
        if not person_items:warnings.append('AI chưa nhận diện được người hoặc cụm người trong ảnh.')
        if not texts:warnings.append('AI chưa nhận diện được cụm chữ trong ảnh.')
        return labels,names,warnings
