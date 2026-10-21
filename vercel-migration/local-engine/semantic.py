"""Semantic separation optimized for a small number of editable components."""
import numpy as np
from PIL import Image


def group_lines(boxes):
    lines=[]
    for b in sorted(boxes,key=lambda b:(b[1],b[0])):
        x,y,r,t=b;chosen=None
        for line in lines:
            a,c,d,e=line['box'];overlap=max(0,min(t,e)-max(y,c));gap=max(0,x-d,a-r);height=max(1,min(t-y,e-c))
            if overlap>=.35*height and gap<=3.2*max(t-y,e-c):chosen=line;break
        if chosen is None:lines.append({'box':list(b),'words':[b]})
        else:
            a,c,d,e=chosen['box'];chosen['box']=[min(a,x),min(c,y),max(d,r),max(e,t)];chosen['words'].append(b)
    return lines


def group_text_blocks(lines,image_shape):
    """Aggressively merge nearby OCR lines so the editor receives only a few useful text groups."""
    h,w=image_shape;blocks=[]
    for line in sorted(lines,key=lambda x:(x['box'][1],x['box'][0])):
        x1,y1,x2,y2=line['box'];best=None;best_score=None
        for block in blocks:
            a,c,d,e=block['box'];v_gap=max(0,y1-e,c-y2);x_gap=max(0,x1-d,a-x2);x_overlap=max(0,min(x2,d)-max(x1,a));min_w=max(1,min(x2-x1,d-a));hh=max(1,max(y2-y1,e-c))
            related=(x_overlap/min_w>=.12 or x_gap<=2.5*hh or abs(x1-a)<=2.0*hh) and v_gap<=1.8*hh
            if related:
                score=v_gap+x_gap*.35+abs(x1-a)*.08
                if best_score is None or score<best_score:best,best_score=block,score
        if best is None:blocks.append({'box':list(line['box']),'words':list(line['words'])})
        else:
            a,c,d,e=best['box'];best['box']=[min(a,x1),min(c,y1),max(d,x2),max(e,y2)];best['words'].extend(line['words'])
    # If OCR still produced many tiny blocks, merge nearest blocks until at most four remain.
    while len(blocks)>4:
        best_pair=None;best_dist=None
        for i in range(len(blocks)):
            for j in range(i+1,len(blocks)):
                a=blocks[i]['box'];b=blocks[j]['box'];ac=((a[0]+a[2])/2,(a[1]+a[3])/2);bc=((b[0]+b[2])/2,(b[1]+b[3])/2);dist=((ac[0]-bc[0])/max(w,1))**2+((ac[1]-bc[1])/max(h,1))**2
                if best_dist is None or dist<best_dist:best_pair,best_dist=(i,j),dist
        i,j=best_pair;A=blocks[i];B=blocks[j];a=A['box'];b=B['box'];A['box']=[min(a[0],b[0]),min(a[1],b[1]),max(a[2],b[2]),max(a[3],b[3])];A['words'].extend(B['words']);blocks.pop(j)
    return blocks


def compose_labels(shape,main_person,people_group,texts):
    labels=np.zeros(shape,np.int32);names={0:('nen_con_lai.png','Nền đã bù kín')};idx=0
    for n,mask in enumerate(texts,1):
        mask=np.asarray(mask,bool);keep=mask&(labels==0)
        if keep.any():idx+=1;labels[keep]=idx;names[idx]=(f'chu_{n:02d}.png','Cụm chữ')
    if people_group is not None:
        keep=np.asarray(people_group,bool)&(labels==0)
        if keep.any():idx+=1;labels[keep]=idx;names[idx]=('cum_nguoi_01.png','Cụm người')
    if main_person is not None:
        keep=np.asarray(main_person,bool)&(labels==0)
        if keep.any():idx+=1;labels[keep]=idx;names[idx]=('nguoi_01.png','Nhân vật chính')
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
        h,w=rgb.shape[:2];report(15,'Đang nhận diện nhân vật chính và cụm người.')
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
        # The largest detected person is the main editable character. All remaining people become one group layer.
        main_index=max(range(len(kept)),key=lambda i:max(1,kept[i][2]-kept[i][0])*max(1,kept[i][3]-kept[i][1])) if kept else None
        report(30,'Đang gom chữ thành một số ít cụm nội dung.');detected=self.ocr.readtext(rgb,paragraph=False,min_size=8,mag_ratio=1.5);words=[]
        for polygon,word,confidence in detected:
            if confidence<.15:continue
            p=np.asarray(polygon);x,y=np.floor(p.min(0)).astype(int);r,t=np.ceil(p.max(0)).astype(int);x=max(0,x-2);y=max(0,y-2);r=min(w,r+3);t=min(h,t+3)
            if r>x and t>y:words.append((x,y,r,t))
        text_blocks=group_text_blocks(group_lines(words),(h,w));report(40,'Đang lấy đường viền các thành phần chính.')
        with torch.inference_mode():self.predictor.set_image(rgb)
        raw_people=[];texts=[];total=len(kept)+len(words);done=0
        with torch.inference_mode():
            for b in kept:
                masks,quality,_=self.predictor.predict(box=np.asarray(b),multimask_output=True);raw_people.append(masks[int(np.argmax(quality))].astype(bool));done+=1;report(45+int(40*done/max(total,1)),f'Đã lấy đường viền {done}/{total} vùng.')
            for block in text_blocks:
                combined=np.zeros((h,w),bool)
                for x,y,r,t in block['words']:
                    masks,quality,_=self.predictor.predict(box=np.array([x,y,r,t]),multimask_output=True);region=np.zeros((h,w),bool);region[y:t,x:r]=True;candidates=[m.astype(bool)&region for m in masks];valid=[i for i,m in enumerate(candidates) if .03<=m.sum()/max((r-x)*(t-y),1)<=.92]
                    if valid:mask=candidates[max(valid,key=lambda i:quality[i])]
                    else:
                        crop=np.ascontiguousarray(rgb[y:t,x:r]);gc=np.full(crop.shape[:2],cv2.GC_PR_FGD,np.uint8);gc[[0,-1],:]=cv2.GC_BGD;gc[:,[0,-1]]=cv2.GC_BGD
                        try:cv2.grabCut(crop,gc,None,np.zeros((1,65)),np.zeros((1,65)),3,cv2.GC_INIT_WITH_MASK);local=(gc==cv2.GC_FGD)|(gc==cv2.GC_PR_FGD)
                        except cv2.error:local=np.zeros(crop.shape[:2],bool)
                        mask=np.zeros((h,w),bool);mask[y:t,x:r]=local
                    combined|=mask;done+=1;report(45+int(40*done/max(total,1)),f'Đã lấy đường viền {done}/{total} vùng.')
                if combined.any():texts.append(combined)
        main_person=raw_people[main_index] if main_index is not None else None;people_group=None
        if len(raw_people)>1:
            people_group=np.zeros((h,w),bool)
            for i,m in enumerate(raw_people):
                if i!=main_index:people_group|=m
            if not people_group.any():people_group=None
        labels,names=compose_labels((h,w),main_person,people_group,texts);warnings=[]
        if main_person is None:warnings.append('AI chưa nhận diện được nhân vật chính trong ảnh.')
        if not texts:warnings.append('AI chưa nhận diện được cụm chữ trong ảnh.')
        return labels,names,warnings
