import fs from 'node:fs';
import path from 'node:path';

const appPath=path.resolve('src/App.tsx');
let s=fs.readFileSync(appPath,'utf8');

// 1) Remove duplicated scene source block: this information already exists in Analysis.
s=s.replace(/\{selectedImageScene && <details className="scene-source">[\s\S]*?<\/details>\}/g,'');

// 2) Turn the top image processing banners into one transient bottom-right status toast.
const oldBanners=`{session?.activeJob && <p className="notice image-work-summary" role="status">Đang chạy: {activeImageScene||(session.activeJob.type==='part_analysis'?'Phân tích phân cảnh':session.activeJob.type==='script_structure'?'Phân tích và chia kịch bản':'Tạo ảnh')}. Hàng đợi và tác vụ này sẽ hủy khi bấm Dừng tất cả.</p>}{imageActionFeedback && <p className="notice image-action-feedback" role="status" aria-live="polite">{imageActionFeedback}</p>}{imageSyncFeedback && <p className="notice image-sync-banner" role="status" aria-live="polite">{imageSyncFeedback}</p>}{syncDiagnostic && session?.activeJob?.type === 'image_generation' && <p className="notice" role="status">Đồng bộ ảnh: {syncDiagnostic}</p>}`;
if(s.includes(oldBanners))s=s.replace(oldBanners,'');

// Remove the second inline sync feedback under preview actions too; toast is the single status surface.
s=s.replace(`{imageSyncFeedback && <p className="notice image-sync-feedback" role="status" aria-live="polite">{imageSyncFeedback}</p>}`,'');

// Insert transient toast state/effect once, immediately after active image status calculation.
const statusAnchor=`  const activeImageScene=session?.activeJob?.sceneKey?(()=>{const [id,index]=session.activeJob.sceneKey.split(':');const part=session.parts?.find(p=>p.id===id);return part?part.title+' · '+(part.scenes[Number(index)]?.title||'cảnh đang xử lý'):''})():'';`;
if(s.includes(statusAnchor)&&!s.includes('const [imageToast, setImageToast]')){
  s=s.replace(statusAnchor,statusAnchor+`\n  const [imageToast, setImageToast] = useState('');\n  const imageStatusMessage = imageSyncFeedback || imageActionFeedback || (syncDiagnostic && session?.activeJob?.type === 'image_generation' ? 'Đồng bộ ảnh: ' + syncDiagnostic : session?.activeJob ? 'Đang chạy: ' + (activeImageScene || (session.activeJob.type === 'part_analysis' ? 'Phân tích phân cảnh' : session.activeJob.type === 'script_structure' ? 'Phân tích và chia kịch bản' : 'Tạo ảnh')) : '');\n  useEffect(()=>{ if(activeMenu!==2 || !imageStatusMessage)return; setImageToast(imageStatusMessage); const timer=window.setTimeout(()=>setImageToast(''),4200); return()=>window.clearTimeout(timer); },[activeMenu,imageStatusMessage]);`);
}

// Render toast once at the end of the image workspace.
const mainEnd='  </main>;';
if(s.includes(mainEnd)&&!s.includes('className="image-status-toast"')){
  s=s.replace(mainEnd,`    {activeMenu===2 && imageToast && <div className="image-status-toast" role="status" aria-live="polite">{imageToast}</div>}\n`+mainEnd);
}

fs.writeFileSync(appPath,s,'utf8');

const cssPath=path.resolve('src/index.css');
let css=fs.readFileSync(cssPath,'utf8');
const marker='/* compact-image-workspace-v1 */';
if(!css.includes(marker))css+=`\n${marker}\n.image-status-toast{position:fixed;right:18px;bottom:18px;z-index:1200;max-width:min(520px,calc(100vw - 36px));padding:10px 14px;border:1px solid #9fc8ef;border-radius:8px;background:rgba(248,252,255,.97);box-shadow:0 5px 18px rgba(26,72,112,.18);color:#185b94;font:600 12px/1.4 Arial,sans-serif;pointer-events:none}.production-preview .preview-empty:has(.generated-image){height:min(52vh,500px);min-height:300px;overflow:hidden;padding:8px;display:flex;align-items:center;justify-content:center;background:#f6faff}.production-preview .preview-empty .generated-image{display:block;width:100%;height:100%;max-width:100%;max-height:min(50vh,480px);object-fit:contain;border-radius:4px}.production-preview{min-width:0;overflow:hidden}.production-grid{align-items:stretch}.production-preview .preview-slots,.production-preview .preview-actions{flex-shrink:0}@media(max-height:800px){.production-preview .preview-empty:has(.generated-image){height:390px;min-height:260px}.production-preview .preview-empty .generated-image{max-height:370px}}\n`;

const fitMarker='/* image-preview-viewport-fit */';
if(!css.includes(fitMarker))css+=`\n${fitMarker}
.image-workspace{height:calc(100dvh - 56px);min-height:0;display:flex;flex-direction:column;overflow:hidden}
.image-workspace> *{flex-shrink:0}
.image-workspace .production-grid{flex:1 1 0;min-height:0;height:auto;grid-template-columns:minmax(0,21fr) minmax(0,36fr) minmax(0,43fr)}
.production-parts{overflow-y:auto}
.production-heading{flex-shrink:0}
.production-preview .preview-empty{min-height:0;overflow:hidden}
.production-preview .preview-empty:has(.generated-image){flex:1 1 0;height:auto;min-height:0;display:grid;grid-template-rows:minmax(0,1fr);grid-auto-rows:max-content;align-content:stretch}
.production-preview .preview-empty .generated-image{width:100%;height:100%;max-width:100%;max-height:100%;min-height:0;object-fit:contain}
`;
fs.writeFileSync(cssPath,css,'utf8');

// Fail build loudly if the requested transformations did not land.
const out=fs.readFileSync(appPath,'utf8');
if(out.includes('className="scene-source"'))throw new Error('scene-source block was not removed');
if(!out.includes('image-status-toast'))throw new Error('image status toast was not inserted');
if(out.includes('image-work-summary'))throw new Error('old image status banner still exists');

