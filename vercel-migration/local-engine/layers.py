import io,json,zipfile
import numpy as np
from PIL import Image

def export_layers(rgb,labels,background=None,names=None):
    h,w=rgb.shape[:2];buf=io.BytesIO();info=[];reconstructed=np.zeros_like(rgb)
    with zipfile.ZipFile(buf,'w',zipfile.ZIP_DEFLATED) as z:
        for idx in np.unique(labels):
            mask=labels==idx
            # The background layer is the completed/inpainted full frame when available.
            if idx==0 and background is not None:
                x=y=0;right=w;bottom=h;rgba=np.zeros((h,w,4),np.uint8);rgba[:,:,:3]=background;rgba[:,:,3]=255
            else:
                ys,xs=np.where(mask);x,y=int(xs.min()),int(ys.min());right,bottom=int(xs.max()+1),int(ys.max()+1)
                rgba=np.zeros((bottom-y,right-x,4),np.uint8);local=mask[y:bottom,x:right];rgba[:,:,:3]=rgb[y:bottom,x:right];rgba[:,:,3]=local.astype(np.uint8)*255;rgba[~local]=0
            name='nen_con_lai.png' if idx==0 else f'phan_{idx:03d}.png';title='Nền đã bù kín' if idx==0 and background is not None else ('Nền còn lại' if idx==0 else 'Phần '+str(idx))
            if names and int(idx) in names:name,title=names[int(idx)]
            if idx==0 and background is not None:title='Nền đã bù kín'
            b=io.BytesIO();Image.fromarray(rgba).save(b,format='PNG');z.writestr(name,b.getvalue());reconstructed[mask]=rgb[mask]
            info.append(dict(id=int(idx),title=title,file=name,x=x,y=y,width=right-x,height=bottom-y,pixels=int(mask.sum())))
        exact=bool(np.array_equal(reconstructed,rgb))
        for name,arr in [('anh_goc.png',rgb),('ghep_lai.png',reconstructed)]:
            b=io.BytesIO();Image.fromarray(arr).save(b,format='PNG');z.writestr(name,b.getvalue())
        if background is not None:
            b=io.BytesIO();Image.fromarray(background).save(b,format='PNG');z.writestr('background_da_lap.png',b.getvalue())
        z.writestr('vi_tri.json',json.dumps(dict(width=w,height=h,exact_reconstruction=exact,layers=info),ensure_ascii=False,indent=2))
    return buf.getvalue(),info,exact

def fill_background(rgb,labels):
    import cv2
    holes=(labels!=0).astype(np.uint8)*255
    if not np.any(holes):return rgb.copy()
    if np.all(holes):raise ValueError('Không còn vùng nền để suy ra màu. Hãy tách ít vùng hơn.')
    # Expand the removal mask slightly to eliminate coloured fringes around people/text.
    kernel=np.ones((7,7),np.uint8);holes=cv2.dilate(holes,kernel,iterations=1)
    # TELEA works well on small holes; a second NS pass softens larger filled areas.
    first=cv2.inpaint(np.ascontiguousarray(rgb),holes,7,cv2.INPAINT_TELEA)
    result=cv2.inpaint(first,holes,5,cv2.INPAINT_NS)
    result[holes==0]=rgb[holes==0]
    return result
