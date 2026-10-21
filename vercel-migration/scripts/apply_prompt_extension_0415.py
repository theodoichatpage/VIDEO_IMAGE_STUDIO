from pathlib import Path
import zipfile

root = Path(__file__).resolve().parents[1]
handler = root / 'supabase/functions/studio-api/handler.ts'
app = root / 'src/App.tsx'
manifest = root / 'extension/manifest.json'

text = handler.read_text(encoding='utf-8')
old = "function imagePrompt(style: string, scene: Scene, ratio: string) { return 'Generate exactly ONE standalone image for a YouTube video slide. Do not create a collage, contact sheet, split panel, text, logo, or watermark. Aspect ratio: ' + ratio + '.\\n\\nGLOBAL STYLE:\\n' + style + '\\n\\nSCENE:\\n' + scene.prompt; }"
new = "function imagePrompt(style: string, scene: Scene, _ratio: string) { const template = style.trim(); const scenePrompt = scene.prompt.trim(); if (template.includes('{{SCENE_PROMPT}}')) return template.replaceAll('{{SCENE_PROMPT}}', scenePrompt); return ['SCENE:\\n' + scenePrompt, template].filter(Boolean).join('\\n\\n'); }"
if old not in text:
    raise SystemExit('imagePrompt source pattern not found')
handler.write_text(text.replace(old, new), encoding='utf-8')

app_text = app.read_text(encoding='utf-8')
app_text = app_text.replace("['0.4.10', '0.4.11', '0.4.12', '0.4.13', '0.4.14']", "['0.4.10', '0.4.11', '0.4.12', '0.4.13', '0.4.14', '0.4.15']")
app_text = app_text.replace("extensionVersion !== '0.4.14'", "extensionVersion !== '0.4.15'")
app_text = app_text.replace('cần cài v0.4.14.', 'cần cài v0.4.15.')
app_text = app_text.replace('/resources/VIDEO_IMAGE_STUDIO_ChatGPT_Extension_v0.4.14.zip', '/resources/VIDEO_IMAGE_STUDIO_ChatGPT_Extension_v0.4.15.zip')
app_text = app_text.replace('Tải Extension v0.4.14', 'Tải Extension v0.4.15')
app.write_text(app_text, encoding='utf-8')

manifest_text = manifest.read_text(encoding='utf-8').replace('"version": "0.4.14"', '"version": "0.4.15"')
manifest.write_text(manifest_text, encoding='utf-8')

zip_path = root / 'public/resources/VIDEO_IMAGE_STUDIO_ChatGPT_Extension_v0.4.15.zip'
with zipfile.ZipFile(zip_path, 'w', zipfile.ZIP_DEFLATED) as z:
    for p in sorted((root / 'extension').iterdir()):
        if p.is_file():
            z.write(p, p.name)
print(zip_path)
