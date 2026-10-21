import fs from 'node:fs';
import path from 'node:path';
const p=path.resolve('src/App.tsx');let s=fs.readFileSync(p,'utf8');
const imp="import ImageSeparationTab from './ImageSeparationTab';\n";if(!s.includes(imp))s=s.replace("import './index.css';\n",`import './index.css';\n${imp}`);
const old="([[FileText, '1. Phân tích'], [Image, '2. Tạo ảnh'], [Square, '3. Tiến trình'], [Folder, '4. Dự án'], [Scissors, '5. Tách ảnh'], [VideoIcon, '6. Dựng video']] as const)";
const nav="([[FileText, '1. Phân tích'], [Image, '2. Tạo ảnh'], [Scissors, '3. Tách ảnh'], [VideoIcon, '4. Dựng video'], [Folder, '5. Dự án']] as const)";if(s.includes(old))s=s.replace(old,nav);
const imageStart='</div> : <section className="image-workspace">';if(s.includes(imageStart))s=s.replace(imageStart,'</div> : activeMenu === 1 ? <section className="image-workspace">');
const needle='</section>}\n  </main>;\n}\n\nexport default App;';
const replacement='</section> : activeMenu === 2 ? <ImageSeparationTab projectId={sessionId} generatedImages={imageParts.flatMap((part, partIndex) => part.scenes.flatMap((scene, sceneIndex) => (scene.imageResults || []).map((item, imageIndex) => ({ name: `Phần ${partIndex + 1} · Cảnh ${sceneIndex + 1} · Ảnh ${imageIndex + 1}`, url: item.url }))))} /> : <section className="image-empty"><VideoIcon size={48} /><h2>{activeMenu === 3 ? "4. Dựng video" : "5. Dự án"}</h2><p>Chức năng này được giữ độc lập với Tab Tách ảnh.</p></section>}\n  </main>;\n}\n\nexport default App;';
if(s.includes(needle))s=s.replace(needle,replacement);else if(!s.includes('<ImageSeparationTab projectId={sessionId}'))throw new Error('Không tìm thấy điểm tích hợp App.tsx');
if(!s.includes('const [showSettings, setShowSettings]'))s=s.replace("  const [showConnection, setShowConnection] = useState(false);","  const [showConnection, setShowConnection] = useState(false);\n  const [showSettings, setShowSettings] = useState(false);");
const settingsOld='<Settings size={18} /><span>Cài đặt</span>';
const settingsNew='<button type="button" className="settings-launch" onClick={() => setShowSettings(true)}><Settings size={18} /><span>Cài đặt</span></button>';
if(s.includes(settingsOld))s=s.replace(settingsOld,settingsNew);
const modalAnchor='    {showResultImport && <div className="connection-modal"';
const settingsModal='    {showSettings && <div className="connection-modal" role="dialog" aria-modal="true" aria-label="Cài đặt"><section className="connection-dialog settings-dialog"><button type="button" className="modal-close" onClick={() => setShowSettings(false)} aria-label="Đóng">×</button><h2>Cài đặt</h2><h3>VIDEO IMAGE STUDIO Local Engine</h3><p className="modal-help">Local Engine chạy SAM2 trực tiếp trên máy Windows để Tab Tách ảnh hoạt động. File cài đặt này cũng là file cập nhật: khi có phiên bản mới, tải lại và chạy để cập nhật.</p><a className="analyze-all modal-copy local-engine-download" href="/resources/VIDEO_IMAGE_STUDIO_Local_Engine_Setup.bat" download><Download size={16}/> Tải / Cập nhật Local Engine</a><p className="modal-help">Lần đầu: tải file → chạy file → chờ cài đặt hoàn tất. Sau đó Local Engine sẽ được khởi động. Khi web báo chưa chạy, mở lại file cài đặt hoặc chạy Start Local Engine trong thư mục cài đặt.</p></section></div>}\n';
if(!s.includes('local-engine-download')&&s.includes(modalAnchor))s=s.replace(modalAnchor,settingsModal+modalAnchor);
fs.writeFileSync(p,s,'utf8');

// Publish a tiny updater/installer. It always downloads the Local Engine files from the current production deployment,
// so the same Settings button remains valid for future engine updates.
const publicDir=path.resolve('public/resources/local-engine');fs.mkdirSync(publicDir,{recursive:true});
const engineDir=path.resolve('local-engine');
const files=fs.readdirSync(engineDir).filter(name=>fs.statSync(path.join(engineDir,name)).isFile()&&!name.startsWith('.'));
for(const name of files)fs.copyFileSync(path.join(engineDir,name),path.join(publicDir,name));
fs.writeFileSync(path.resolve('public/resources/local-engine/manifest.json'),JSON.stringify({version:'1.0.0',files},null,2));
const bat=`@echo off\r\nsetlocal EnableExtensions\r\ntitle VIDEO IMAGE STUDIO Local Engine Setup\r\nset "BASE=https://video-image-studio.vercel.app/resources/local-engine"\r\nset "DEST=%LOCALAPPDATA%\\VIDEO_IMAGE_STUDIO\\LocalEngine"\r\necho.\r\necho ===============================================\r\necho  VIDEO IMAGE STUDIO - LOCAL ENGINE SETUP\r\necho ===============================================\r\necho.\r\nif not exist "%DEST%" mkdir "%DEST%"\r\ncd /d "%DEST%"\r\necho Dang tai/cap nhat Local Engine...\r\n`+files.map(name=>`curl.exe -fL --retry 3 "%BASE%/${name}" -o "${name}" || goto :error`).join('\r\n')+`\r\necho.\r\necho Dang cai dat dependencies...\r\ncall install_windows.bat\r\nif errorlevel 1 goto :error\r\necho.\r\necho Khoi dong Local Engine...\r\nstart "VIDEO IMAGE STUDIO Local Engine" "%DEST%\\start_engine.bat"\r\necho.\r\necho HOAN TAT. Quay lai VIDEO IMAGE STUDIO va bam nut lam moi Local Engine.\r\npause\r\nexit /b 0\r\n:error\r\necho.\r\necho KHONG THE TAI/CAP NHAT LOCAL ENGINE. Kiem tra Internet va thu lai.\r\npause\r\nexit /b 1\r\n`;
fs.writeFileSync(path.resolve('public/resources/VIDEO_IMAGE_STUDIO_Local_Engine_Setup.bat'),bat,'utf8');
