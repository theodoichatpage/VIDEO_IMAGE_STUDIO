from pathlib import Path
p=Path(__file__).resolve().parents[1]/'src'/'App.tsx'
s=p.read_text(encoding='utf-8')
imp="import ImageSeparationTab from './ImageSeparationTab';\n"
if imp not in s:s=s.replace("import './index.css';\n", "import './index.css';\n"+imp)
old="([[FileText, '1. Phân tích'], [Image, '2. Tạo ảnh'], [Square, '3. Tiến trình'], [Folder, '4. Dự án'], [Scissors, '5. Tách ảnh'], [VideoIcon, '6. Dựng video']] as const)"
new="([[FileText, '1. Phân tích'], [Image, '2. Tạo ảnh'], [Scissors, '3. Tách ảnh'], [VideoIcon, '4. Dựng video'], [Folder, '5. Dự án']] as const)"
if old in s:s=s.replace(old,new)
needle="</section>}\n  </main>;\n}\n\nexport default App;"
replacement="""</section> : activeMenu === 2 ? <ImageSeparationTab projectId={sessionId} generatedImages={imageParts.flatMap((part, partIndex) => part.scenes.flatMap((scene, sceneIndex) => (scene.imageResults || []).filter(item => Boolean(item.url)).map((item, imageIndex) => ({ name: `Phần ${partIndex + 1} · Cảnh ${sceneIndex + 1} · Ảnh ${imageIndex + 1}`, url: item.url }))))} /> : <section className=\"image-empty\"><VideoIcon size={48} /><h2>{activeMenu === 3 ? '4. Dựng video' : '5. Dự án'}</h2><p>Chức năng này được giữ độc lập với Tab Tách ảnh.</p></section>}\n  </main>;\n}\n\nexport default App;"""
if needle in s:s=s.replace(needle,replacement)
elif '<ImageSeparationTab projectId={sessionId}' not in s:raise SystemExit('Không tìm thấy điểm tích hợp App.tsx')
p.write_text(s,encoding='utf-8')
