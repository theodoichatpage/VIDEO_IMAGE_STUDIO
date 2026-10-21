import { useEffect, useRef, useState } from 'react';
import { api } from './api';
import { Check, Clapperboard, Copy, Download, FileText, Folder, Image, Maximize2, Play, RotateCcw, Scissors, Settings, Square, Trash2, Video as VideoIcon } from 'lucide-react';
import './index.css';

import type { ImageState, Scene, PartStatus, Part, Session } from './types';

const makeId = () => crypto.randomUUID().replaceAll('-', '');
const statusText = (status: PartStatus) => ({ pending: 'Chờ', ready: 'Sẵn sàng', processing: 'Đang xử lý', complete: 'Hoàn tất', error: 'Lỗi', stopped: 'Đã dừng' }[status]);
const waitingPart = (index: number): Part => ({ id: 'waiting-' + index, title: 'Phần ' + (index + 1), range: 'Đang chờ', content: 'Đang chờ', status: 'pending', scenes: [], analysisText: '' });
const fillWaiting = (items: Part[], count: number, offset = 0) => Array.from({ length: count }, (_, index) => items[index] || waitingPart(offset + index));

const partKey = (scene: Scene, index: number) => scene.title + '-' + index;
const sceneKey = (partId: string, index: number) => partId + ':' + index;
const imageStateText = (status?: ImageState) => ({ waiting: 'Chờ', queued: 'Đã xếp hàng', generating: 'Đang tạo', complete: 'Hoàn tất', error: 'Lỗi', stopped: 'Đã dừng' }[status || 'waiting']);
const shortText = (text: string, limit: number) => text.length > limit ? text.slice(0, limit).trimEnd() + '…' : text;
const partName = (title: string) => title.replace(/^Phần\s*\d+\s*[-–:]?\s*/i, '').trim() || title;

function App() {
  const [sessionId] = useState(() => {
    const id = localStorage.getItem('vis-session') || makeId();
    localStorage.setItem('vis-session', id);
    return id;
  });
  const [session, setSessionState] = useState<Session | null>(() => {
    try { const cached = JSON.parse(localStorage.getItem('vis-project-' + sessionId) || 'null'); return cached?.id === sessionId ? cached : null; } catch { return null; }
  });
  const [serverReady, setServerReady] = useState(false);
  useEffect(() => { if (session) { try { localStorage.setItem('vis-project-' + sessionId, JSON.stringify(session)); } catch { /* Server remains the primary copy. */ } } }, [session]);
  const setSession = (next: Session | null) => setSessionState(previous =>
    previous && next && (previous.updatedAt || 0) > (next.updatedAt || 0) ? previous : next);
  const [script, setScript] = useState(() => localStorage.getItem('vis-script-draft') || '');
  const [stylePrompt, setStylePrompt] = useState(() => localStorage.getItem('vis-style-prompt') || '');
  const [notice, setNotice] = useState('Nhập toàn bộ kịch bản, sau đó bấm Phân tích & chia kịch bản.');
  const [busy, setBusy] = useState(false);
  const [activePartId, setActivePartId] = useState('pending-0');
  const [activeMenu, setActiveMenu] = useState(0);
  const [showConnection, setShowConnection] = useState(false);
  const [showResultImport, setShowResultImport] = useState(false);
  const [importPartId, setImportPartId] = useState('');
  const [importExpectedJobId, setImportExpectedJobId] = useState<string | null>(null);
  const [importText, setImportText] = useState('');
  const [importError, setImportError] = useState('');
  const [importBusy, setImportBusy] = useState(false);
  const [extensionPairCode, setExtensionPairCode] = useState('');
  const [extensionVersion, setExtensionVersion] = useState('');
  const [chatReady, setChatReady] = useState(false);
  const [bridgeMessage, setBridgeMessage] = useState('');
  const [syncDiagnostic, setSyncDiagnostic] = useState('');
  const [pendingSyncCount, setPendingSyncCount] = useState(0);
  const [conversationLabel, setConversationLabel] = useState('');
  const [partsPage, setPartsPage] = useState(0);
  const [resultsPage, setResultsPage] = useState(0);
  const [imagePartId, setImagePartId] = useState('');
  const [imageSceneIndex, setImageSceneIndex] = useState(0);
  const [imageRatio, setImageRatio] = useState('16:9 (1920x1080)');
  const [imagesPerScene, setImagesPerScene] = useState('1');
  const [parallelImages, setParallelImages] = useState('1');
  const hydrated = useRef(false);
  const bridgeEventsInFlight = useRef(new Set<string>());
  const bridgeEventQueue = useRef(Promise.resolve());
  const loadInFlight = useRef(false);

  const load = async () => {
    if (loadInFlight.current) return;
    loadInFlight.current = true;
    try {
      const { data } = await api.get('/api/sessions/' + sessionId);
      const next = data.session as Session | null;
      if (next) {
        setSession(next);
        setServerReady(true);
        if (!hydrated.current) {
          setScript(localStorage.getItem('vis-script-draft') || next.script || '');
          if (!localStorage.getItem('vis-style-prompt') && next.stylePrompt) setStylePrompt(next.stylePrompt);
          if (next.parts?.length) setActivePartId(next.parts[0].id);
          hydrated.current = true;
        }
      } else {
        const saved = JSON.parse(localStorage.getItem('vis-project-' + sessionId) || 'null') as Session | null;
        if (saved?.parts?.length || saved?.script) { setNotice('Chưa tìm thấy bản dự án trên máy chủ. Bản lưu trên máy vẫn được giữ; chưa tạo phiên rỗng thay thế.'); return; }
        const created = await api.post('/api/sessions', { id: sessionId });
        setSession(created.data.session as Session);
        setServerReady(true);
        localStorage.setItem('vis-session', sessionId);
        hydrated.current = true;
      }
    } catch (caught) { setNotice('Máy chủ: ' + (caught instanceof Error ? caught.message : 'Không thể kết nối.')); }
    finally { loadInFlight.current = false; }
  };
  useEffect(() => { void load(); const timer = window.setInterval(() => void load(), 4000); return () => window.clearInterval(timer); }, []);

  useEffect(() => {
    const requestStatus = () => window.postMessage({ source: 'vis-web', type: 'studio-status' }, '*');
    const receive = (event: MessageEvent) => {
      if (event.source !== window || event.data?.source !== 'vis-extension') return;
      if (event.data.type === 'studio-status') {
        setExtensionPairCode(event.data.pairCode || '');
        setExtensionVersion(event.data.version || '');
        setChatReady(Boolean(event.data.chatReady));
        setBridgeMessage(event.data.message || '');
        setSyncDiagnostic(event.data.syncDiagnostic || '');
        if (event.data.pairCode === sessionId && event.data.chatReady) setNotice(current => current.startsWith('Đang yêu cầu Extension') ? 'Đã kết nối với hội thoại ChatGPT. Tiện ích sẽ tự kiểm tra và nhận kết quả đang chờ.' : current);
        setPendingSyncCount(Number(event.data.pendingCount || 0));
        setConversationLabel(String(event.data.conversationLabel || event.data.conversationId || '')); 
      }
      if (event.data.type === 'studio-error') setNotice(event.data.message || 'Tiện ích không thể gửi lệnh.');
      if (event.data.type === 'studio-event' && event.data.payload?.jobId) {
        if (event.data.serverManaged) { void load(); return; }
        const payload = event.data.payload as { jobId: string; state?: string; text?: string };
        const jobId = String(payload.jobId);
        const eventKey = jobId + ':' + payload.state;
        if (bridgeEventsInFlight.current.has(eventKey)) return;
        bridgeEventsInFlight.current.add(eventKey);
        bridgeEventQueue.current = bridgeEventQueue.current.then(() => api.post('/api/bridge/' + sessionId + '/event', payload)).then(({ data }) => {
          const next = data.session as Session;
          setSession(next);
          if (data.ignored) {
            window.postMessage({ source: 'vis-web', type: 'studio-event-ack', jobId }, '*');
            return;
          }
          if (next.parts?.length) setActivePartId(current => next.parts?.some(part => part.id === current) ? current : next.parts![0].id);
          if (payload.state === 'sent') {
            setNotice('Đã gửi lệnh sang ChatGPT. Web đang chờ JSON kết quả, chưa xác nhận hoàn tất.');
            return;
          }
          if (payload.state === 'completed' || payload.state === 'error') {
            window.postMessage({ source: 'vis-web', type: 'studio-event-ack', jobId }, '*');
            setNotice(payload.state === 'completed' && next.parts?.length ? 'Đã lưu JSON ChatGPT và cập nhật các phần kịch bản.' : payload.state === 'completed' ? 'Đã lưu JSON kết quả từ ChatGPT.' : 'ChatGPT lỗi: ' + (next.lastError || payload.text || 'Web đã giải phóng tác vụ; bạn có thể bấm Phân tích lại.'));
          }
        }).catch((caught) => setNotice('Chưa lưu được kết quả: ' + (caught instanceof Error ? caught.message : 'Máy chủ không phản hồi.') + ' Tiện ích sẽ gửi lại.')).finally(() => bridgeEventsInFlight.current.delete(eventKey));
      }
    };
    window.addEventListener('message', receive); requestStatus();
    const timer = window.setInterval(requestStatus, 5000);
    return () => { window.removeEventListener('message', receive); window.clearInterval(timer); };
  }, [sessionId]);

  const bridgeConnected = extensionPairCode === sessionId && ['0.4.10', '0.4.11', '0.4.12', '0.4.13', '0.4.14', '0.4.15', '0.4.16', '0.4.17'].includes(extensionVersion) && chatReady;
  useEffect(() => {
    if (!bridgeConnected || !session?.activeJob || !['queued', 'sending'].includes(session.activeJob.status)) return;
    let cancelled = false;
    const dispatch = () => void api.get('/api/bridge/' + sessionId + '/next').then(({ data }) => {
      if (!cancelled && data.discarded) { setSession(data.session as Session); setNotice('Đã chặn lệnh tồn đọng từ luồng cũ. Phần đang xử lý đã trở về Sẵn sàng; hãy bấm Phân tích phân cảnh lại.'); return; } if (!cancelled && data.command) window.postMessage({ source: 'vis-web', type: 'studio-send', pairCode: sessionId, command: data.command }, '*');
    }).catch(() => { if (!cancelled) setNotice('Không thể lấy lệnh để gửi cho tiện ích.'); });
    dispatch();
    const timer = window.setInterval(dispatch, 2000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [bridgeConnected, session?.activeJob?.id, session?.activeJob?.status, sessionId]);

  const changeScript = (value: string) => { setScript(value); localStorage.setItem('vis-script-draft', value); };
  const ensureSession = async () => {
    const { data: lookup } = await api.get('/api/sessions/' + sessionId);
    if (lookup.session) {
      const current = lookup.session as Session;
      setSession(current);
      localStorage.setItem('vis-session', sessionId);
      return current;
    }
    const { data } = await api.post('/api/sessions', { id: sessionId });
    const created = data.session as Session;
    setSession(created);
    localStorage.setItem('vis-session', sessionId);
    return created;
  };
  const analyzeStructure = async (confirmReset = false) => {
    if (!script.trim()) { setNotice('Hãy nhập toàn bộ kịch bản trước khi tách.'); return; }
    setBusy(true);
    try {
      const current = await ensureSession();
      if (current.parts?.length && !confirmReset) { setNotice('Đã khóa phân tích lại để bảo vệ kết quả hiện có.'); return; }
      const { data } = await api.post('/api/sessions/' + sessionId + '/analysis', { script, confirmReset });
      const next = data.session as Session;
      setSession(next); setActivePartId('pending-0');
      localStorage.removeItem('vis-script-draft');
      setNotice('Đã gửi toàn bộ kịch bản sang ChatGPT để phân tích cấu trúc và quyết định số phần phù hợp.');
    } catch (caught) { setNotice(caught instanceof Error ? caught.message : 'Không thể bắt đầu phân tích.'); } finally { setBusy(false); }
  };
  const runPart = async (part: Part) => {
    if (part.status === 'pending') { setNotice('Hãy để ChatGPT phân tích và chia kịch bản trước.'); return; }
    if (busy) return;
    setBusy(true);
    try {
      await ensureSession();
      const { data } = await api.post('/api/sessions/' + sessionId + '/parts/' + part.id + '/analysis');
      setSession(data.session as Session); setActivePartId(part.id);
      setNotice('Đã gửi ' + part.title + ' sang ChatGPT. Khi hoàn tất, web sẽ dừng và chờ bạn chọn phần kế tiếp.');
    } catch (caught) { setNotice(caught instanceof Error ? caught.message : 'Không thể gửi phần này.'); }
    finally { setBusy(false); }
  };
  const stopWork = async () => {
    window.postMessage({ source: 'vis-web', type: 'studio-stop' }, '*');
    try { const { data } = await api.post('/api/sessions/' + sessionId + '/stop'); setSession(data.session as Session); setNotice('Đã dừng tác vụ hiện tại trên web và ChatGPT.'); }
    catch (caught) { setNotice('Chưa xác nhận dừng: ' + (caught instanceof Error ? caught.message : 'Máy chủ không phản hồi.')); }
  };
  const runAllParts = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const { data } = await api.post('/api/sessions/' + sessionId + '/parts/batch');
      const next = data.session as Session;
      setSession(next);
      if (next.activeJob?.partId) setActivePartId(next.activeJob.partId);
      setNotice(next.batchAnalysis ? 'Đang phân cảnh lần lượt các phần chưa hoàn tất. Gặp lỗi sẽ tạm dừng.' : 'Tất cả các phần đã hoàn tất.');
    } catch (caught) { setNotice(caught instanceof Error ? caught.message : 'Không thể bắt đầu phân cảnh toàn bộ.'); }
    finally { setBusy(false); }
  };
  const copyPrompt = async (prompt: string) => { await navigator.clipboard?.writeText(prompt); setNotice('Đã sao chép mã kết nối.'); };
  const bindCurrentConversation = () => {
    window.postMessage({ source: 'vis-web', type: 'studio-bind-current-chat', pairCode: sessionId }, '*');
    setNotice('Đang yêu cầu Extension khóa vào hội thoại ChatGPT đang mở.');
  };
  const syncJob = session?.activeJob || (session?.lastJob?.status === 'error' ? session.lastJob : null);
  const recoveryPart = session?.parts?.find(part => part.id === activePartId);
  const selectImportPart = (id: string) => {
    setImportPartId(id);
    setImportExpectedJobId(session?.activeJob?.partId === id ? session.activeJob.id : null);
    setImportError('');
  };
  const openResultImport = () => {
    const target = session?.activeJob?.partId || (recoveryPart?.status !== 'complete' ? recoveryPart?.id : '') || session?.parts?.find(part => part.status !== 'complete')?.id;
    if (!target) { setNotice('Các phần hiện có đã được lưu kết quả.'); return; }
    selectImportPart(target); setImportText(''); setShowResultImport(true);
  };
  const pasteResult = async () => {
    try { setImportText(await navigator.clipboard.readText()); setImportError(''); }
    catch { setImportError('Hãy bấm vào ô bên dưới và nhấn Ctrl + V để dán toàn bộ JSON.'); }
  };
  const saveImportedResult = async () => {
    if (importBusy || !importText.trim()) return;
    setImportBusy(true); setImportError('');
    try {
      const { data } = await api.post('/api/sessions/' + sessionId + '/parts/' + importPartId + '/result', { text: importText, expectedJobId: importExpectedJobId });
      const next = data.session as Session;
      setSession(next); setActivePartId(importPartId);
      const index = next.parts?.findIndex(part => part.id === importPartId) ?? 0;
      setResultsPage(Math.max(0, Math.floor(index / 10)));
      if (importExpectedJobId) window.postMessage({ source: 'vis-web', type: 'studio-event-ack', jobId: importExpectedJobId }, '*');
      const part = next.parts?.find(item => item.id === importPartId);
      setNotice('Đã lưu ' + (part?.scenes.length || 0) + ' cảnh vào ' + (part?.title || 'phần đã chọn') + '. Bạn có thể phân tích phần tiếp theo.');
      setShowResultImport(false); setImportText('');
    } catch (caught) { setImportError(caught instanceof Error ? caught.message : 'Chưa lưu được kết quả. Nội dung đã dán vẫn được giữ lại.'); }
    finally { setImportBusy(false); }
  };
  const captureResult = async () => {
    try {
      let command = syncJob;
      if (!command && recoveryPart) {
        const { data } = await api.post('/api/sessions/' + sessionId + '/parts/' + recoveryPart.id + '/recover');
        const next = data.session as Session;
        setSession(next); command = next.activeJob || null;
        if (!command) { setNotice('Phần này đã có kết quả được lưu.'); return; }
      }
      if (!command) return;
      window.postMessage({ source: 'vis-web', type: 'studio-capture-result', jobId: command.id, command }, '*');
      setNotice(command.type === 'image_generation' ? 'Đang nhận tệp ảnh từ đúng cảnh trong ChatGPT…' : 'Đang lấy JSON đã có trong đúng hội thoại ChatGPT để hoàn tất phần đang chờ…');
    } catch (caught) { setNotice(caught instanceof Error ? caught.message : 'Không thể khởi tạo đồng bộ kết quả.'); }
  };
  const changeStylePrompt = (value: string) => { setStylePrompt(value); localStorage.setItem('vis-style-prompt', value); };
  const combinedPrompt = (scene: Scene) => stylePrompt.includes('{{SCENE_PROMPT}}') ? stylePrompt.trim().replaceAll('{{SCENE_PROMPT}}', scene.prompt.trim()) : ['SCENE:\n' + scene.prompt.trim(), stylePrompt.trim()].filter(Boolean).join('\n\n');
  const saveStyle = async () => {
    try { const { data } = await api.post('/api/sessions/' + sessionId + '/settings', { stylePrompt }); setSession(data.session as Session); setNotice('Đã lưu mẫu prompt chung vào dự án.'); }
    catch (error) { setNotice(error instanceof Error ? error.message : 'Chưa lưu được prompt.'); }
  };
  const recoverImage = async () => {
    if (!selectedImagePart) return;
    try { const { data } = await api.post('/api/sessions/' + sessionId + '/images/recover', { sceneKey: sceneKey(selectedImagePart.id, imageSceneIndex) }); setSession(data.session as Session); setNotice('Đang nhận lại tệp ảnh của cảnh này từ đúng hội thoại ChatGPT, không gửi lệnh tạo ảnh mới.'); }
    catch (error) { setNotice(error instanceof Error ? error.message : 'Chưa đồng bộ được ảnh.'); }
  };
  const queueImages = async (keys: string[]) => {
    if (!['0.4.16', '0.4.17'].includes(extensionVersion)) { setShowConnection(true); setNotice('Hãy cập nhật Extension 0.4.17 để đồng bộ tệp ảnh.'); return; } if (!keys.length) return; try { await ensureSession(); const { data } = await api.post('/api/sessions/' + sessionId + '/images', { sceneKeys: keys, stylePrompt, ratio: imageRatio }); setSession(data.session as Session); setNotice(keys.length === 1 ? 'Đã xếp hàng tạo ảnh cho cảnh đang chọn.' : 'Đã xếp ' + keys.length + ' cảnh; ChatGPT sẽ tạo lần lượt từng ảnh.'); } catch (caught) { setNotice((caught as { response?: { data?: { error?: string } } })?.response?.data?.error || 'Không thể đưa cảnh vào hàng đợi tạo ảnh.'); } };

  const storedParts = session?.parts || [];
  const partsPerPage = 5;
  const resultsPerPage = 10;
  const partsPageCount = Math.max(1, Math.ceil(storedParts.length / partsPerPage));
  const resultsPageCount = Math.max(1, Math.ceil(storedParts.length / resultsPerPage));
  const safePartsPage = Math.min(partsPage, partsPageCount - 1);
  const safeResultsPage = Math.min(resultsPage, resultsPageCount - 1);
  const visibleParts = fillWaiting(storedParts.slice(safePartsPage * partsPerPage, safePartsPage * partsPerPage + partsPerPage), partsPerPage, safePartsPage * partsPerPage);
  const visibleResults = fillWaiting(storedParts.slice(safeResultsPage * resultsPerPage, safeResultsPage * resultsPerPage + resultsPerPage), resultsPerPage, safeResultsPage * resultsPerPage);
  const activePart = storedParts.find(part => part.id === activePartId) || visibleResults.find(part => !part.id.startsWith('waiting-')) || visibleResults[0];
  const sceneEstimate = (script.match(/\bcảnh\s*\d+/gi) || []).length;
  const imageParts = storedParts.filter(part => part.scenes.length > 0);
  const totalImageScenes = imageParts.reduce((total, part) => total + part.scenes.length, 0);
  const selectedImagePart = imageParts.find(part => part.id === imagePartId) || imageParts[0];
  const selectedImageScene = selectedImagePart?.scenes[Math.min(imageSceneIndex, Math.max(0, selectedImagePart.scenes.length - 1))];
  const selectedImageKey = selectedImagePart ? sceneKey(selectedImagePart.id, imageSceneIndex) : '';
  const completedImageCount = imageParts.reduce((sum, part) => sum + part.scenes.filter(scene => scene.imageStatus === 'complete').length, 0);
  const queuedImageCount = imageParts.reduce((sum, part) => sum + part.scenes.filter(scene => scene.imageStatus === 'queued' || scene.imageStatus === 'generating').length, 0);
  const createSelectedImage = () => { if (selectedImageKey) void queueImages([selectedImageKey]); };
  const createPartImages = () => { if (selectedImagePart) void queueImages(selectedImagePart.scenes.map((_, index) => sceneKey(selectedImagePart.id, index))); };
  const createAllImages = () => void queueImages(imageParts.flatMap(part => part.scenes.map((_, index) => sceneKey(part.id, index))));
  const selectImagePart = (part: Part) => { setImagePartId(part.id); setImageSceneIndex(0); };

  return <main className="studio">
    <header className="topbar"><div className="brand"><Clapperboard size={30} /><strong>VIDEO IMAGE STUDIO</strong></div><nav aria-label="Các bước studio">{([[FileText, '1. Phân tích'], [Image, '2. Tạo ảnh'], [Square, '3. Tiến trình'], [Folder, '4. Dự án'], [Scissors, '5. Tách ảnh'], [VideoIcon, '6. Dựng video']] as const).map(([Icon, label], index) => <button className={'nav-item ' + (index === activeMenu ? 'active' : '')} key={String(label)} type="button" onClick={() => setActiveMenu(index)}><Icon size={23} /><span>{label}</span></button>)}</nav><div className="top-tools"><span className={bridgeConnected ? 'top-connection online' : 'top-connection offline'}>{bridgeConnected ? '● Đã kết nối' : '● Chưa kết nối'}</span><button type="button" className="connect-button" onClick={() => setShowConnection(true)}>Kết nối ChatGPT</button><Settings size={18} /><span>Cài đặt</span><i>AI</i></div></header>
    {!serverReady && <div role="status" className="notice">{session?.parts?.length ? 'Đang hiển thị bản lưu dự án trên máy, chờ kết nối máy chủ…' : 'Đang tải dự án từ máy chủ. Không cần phân tích lại kịch bản.'}</div>}
    {showConnection && <div className="connection-modal" role="dialog" aria-modal="true" aria-label="Kết nối ChatGPT"><section className="connection-dialog"><button type="button" className="modal-close" onClick={() => setShowConnection(false)} aria-label="Đóng">×</button><h2>Kết nối ChatGPT</h2><p className={bridgeConnected ? 'modal-status online' : 'modal-status offline'}>{bridgeConnected ? '● Đã kết nối ChatGPT · Extension v' + extensionVersion : '● Chưa kết nối ChatGPT'}</p>{conversationLabel && <p className="modal-help"><b>Hội thoại đang khóa:</b> {conversationLabel}</p>}<p className="modal-help">Mở đúng hội thoại ChatGPT bạn muốn dùng rồi bấm Kết nối hội thoại đang mở.</p><button type="button" className="analyze-all modal-copy" onClick={bindCurrentConversation}>Kết nối hội thoại đang mở</button>{!bridgeConnected && bridgeMessage && <p className="modal-help"><b>Lý do:</b> {bridgeMessage}</p>}{extensionVersion && extensionVersion !== '0.4.17' && <p className="modal-help"><b>Extension hiện tại: v{extensionVersion} — cần cài v0.4.17.</b></p>}<label>Mã kết nối<code>{sessionId}</code></label><button type="button" className="analyze-all modal-copy" onClick={() => copyPrompt(sessionId)}><Copy size={16} /> Sao chép mã kết nối</button><a className="outline modal-install" href="/resources/VIDEO_IMAGE_STUDIO_ChatGPT_Extension_v0.4.17.zip" download>Tải Extension v0.4.17</a></section></div>}
    {showResultImport && <div className="connection-modal" role="dialog" aria-modal="true" aria-label="Dán JSON kết quả"><section className="connection-dialog json-import-dialog"><button type="button" className="modal-close" disabled={importBusy} onClick={() => setShowResultImport(false)} aria-label="Đóng">×</button><h2>Dán JSON kết quả</h2><p className="modal-help">Sao chép toàn bộ câu trả lời JSON của ChatGPT và dán vào đây. Lưu thành công sẽ chuyển phần này sang Hoàn tất để tiếp tục phần kế tiếp.</p><label>Lưu vào phần<select value={importPartId} disabled={importBusy} onChange={event => selectImportPart(event.target.value)}>{session?.parts?.map(part => <option key={part.id} value={part.id} disabled={part.status === 'complete' && part.scenes.length > 0}>{part.title}{part.status === 'complete' ? ' — Đã có kết quả' : ''}</option>)}</select></label><div className="import-clipboard"><button type="button" className="outline" disabled={importBusy} onClick={pasteResult}>Dán từ clipboard</button><span>Hoặc nhấn Ctrl + V trong ô bên dưới</span></div><textarea aria-label="JSON kết quả phân cảnh" value={importText} disabled={importBusy} onChange={event => setImportText(event.target.value)} placeholder={'Dán toàn bộ JSON: {"scenes":[…]}'} spellCheck={false} />{importError && <p className="import-error" role="alert">{importError}</p>}<button type="button" className="analyze-all modal-copy" disabled={importBusy || !importPartId || !importText.trim()} onClick={saveImportedResult}>{importBusy ? 'Đang lưu kết quả…' : 'Lưu kết quả vào phần đã chọn'}</button></section></div>}
    {activeMenu === 0 ? <div className="workspace">
      <section className="left-column panel"><div className="panel-heading"><FileText /><div><h1>1. PHÂN TÍCH KỊCH BẢN</h1><p>ChatGPT đọc kịch bản, tự chia thành số phần phù hợp, rồi phân tích chi tiết từng phần thành phân cảnh.</p></div><button type="button" className="outline result-import-launch" disabled={!session?.parts?.length} onClick={openResultImport}>Dán JSON kết quả</button></div>
        <section className="script-box"><h2><FileText size={20} /> Toàn bộ kịch bản</h2><div className="file-row"><FileText size={22} /><div><b>{script.trim() ? 'Kịch bản đang chỉnh sửa' : 'Chưa có kịch bản'}</b><small>{sceneEstimate ? sceneEstimate + ' cảnh nhận diện · ' : ''}{script.length.toLocaleString('vi-VN')} ký tự</small></div><span className="uploaded">● Sẵn sàng</span><button type="button" className="outline"><Folder size={17} /> Thay đổi</button></div><textarea className="screenplay" value={script} onChange={event => changeScript(event.target.value)} placeholder="Dán hoặc nhập toàn bộ kịch bản tại đây…" /><p className="script-meta">Số ký tự: {script.length.toLocaleString('vi-VN')} <b>|</b> <span>{session?.status === 'structure_processing' ? 'ChatGPT đang phân tích cấu trúc' : storedParts.length ? 'Đã chia ' + storedParts.length + ' phần' : 'Chưa phân tích'}</span></p><div className="analysis-controls"><button className="analyze-all split-button" type="button" onClick={() => void analyzeStructure()} disabled={busy || Boolean(session?.activeJob) || storedParts.length > 0} title={storedParts.length ? 'Đã phân tích. Nút được khóa để bảo vệ kết quả.' : 'Phân tích và chia kịch bản'}><Play size={18} fill="currentColor" /> {busy ? 'Đang khởi tạo…' : 'Phân tích & chia kịch bản'}</button><button className="danger split-button stop-analysis" type="button" onClick={stopWork} disabled={session?.activeJob?.type !== 'script_structure'}><Square size={16} /> Dừng phân tích</button><button className="outline split-button" type="button" onClick={captureResult} disabled={!session?.activeJob || session.activeJob.status !== 'waiting'}>Đồng bộ kết quả ngay{pendingSyncCount ? ' (' + pendingSyncCount + ')' : ''}</button></div></section>
        {storedParts.length > 0 && <div className="restart-analysis"><span>Đã phân tích — nút bắt đầu được khóa để bảo vệ kết quả.</span><button type="button" className="outline" disabled={busy || Boolean(session?.activeJob)} onClick={() => { if (window.confirm('Phân tích lại toàn bộ sẽ thay thế các phần và kết quả phân cảnh hiện có. Một bản sao kết quả hiện tại sẽ được lưu trên máy chủ. Bạn có chắc chắn muốn bắt đầu lại?')) void analyzeStructure(true); }}>Phân tích lại toàn bộ…</button></div>}
        <section className="parts">
          <div className="section-toolbar parts-toolbar">
            <h2>♙ Các phần <small>(5 phần/trang)</small></h2>
            <div className="batch-controls">
              <button type="button" className="analyze-all" disabled={busy || !storedParts.some(part => part.status !== 'complete') || Boolean(session?.batchAnalysis) || Boolean(session?.activeJob && session.activeJob.type !== 'part_analysis')} onClick={runAllParts} title="Chạy lần lượt tất cả các phần chưa hoàn tất; bỏ qua phần đã xong."><Play size={14} fill="currentColor" />{session?.batchAnalysis ? 'Đang chạy toàn bộ…' : 'Phân cảnh toàn bộ'}</button>
              {session?.batchAnalysis && <button type="button" className="danger outline" onClick={stopWork}>Dừng hàng loạt</button>}
            </div>
          </div>
          {session?.batchAnalysis && <p className="notice batch-notice">Đang chạy lần lượt · Còn {(session.analysisQueue?.length || 0) + (session.activeJob ? 1 : 0)} phần chưa xong</p>}
          <div className="part-list">{visibleParts.map((part, index) => {
            const waiting = part.id.startsWith('waiting-');
            const blocked = waiting || busy || Boolean(session?.activeJob);
            return <article className={'part-row ' + (activePart.id === part.id ? 'selected' : '') + (waiting ? ' placeholder-row' : '')} key={part.id}>
              <button type="button" className="part-number" disabled={waiting} onClick={() => setActivePartId(part.id)}>{safePartsPage * partsPerPage + index + 1}</button>
              <button type="button" className="part-label" disabled={waiting} onClick={() => setActivePartId(part.id)} title={part.title + '\n' + part.content}>
                <b>{waiting ? 'Đang chờ' : 'Phần ' + (safePartsPage * partsPerPage + index + 1) + ' · ' + shortText(partName(part.title), 34)}</b>
                <small>{waiting ? 'Chờ kịch bản' : shortText(part.content, 64)}</small>
              </button>
              <span className={'chip ' + (waiting || part.status === 'pending' ? 'waiting' : part.status)}>{waiting ? 'Chờ' : statusText(part.status)}</span>
              <span className="percent">{waiting ? '—' : part.scenes.length + ' cảnh'}</span>
              {waiting ? <button type="button" className="outline action" disabled>Chờ</button> : part.status === 'processing' ? <button type="button" className="danger action" onClick={stopWork}><Square size={13} /> Dừng</button> : part.status === 'complete' ? <button type="button" className="outline action" onClick={() => setActivePartId(part.id)}>◉ Xem</button> : <button type="button" className="outline action" disabled={blocked} onClick={() => runPart(part)}><Play size={13} fill="currentColor" /> Phân cảnh</button>}
              <button type="button" className="muted action" disabled={blocked} onClick={() => runPart(part)}><RotateCcw size={13} /> Tạo lại</button>
            </article>;
          })}</div>
          <div className="parts-footer"><div className="pager">
            <button type="button" aria-label="Trang phần trước" onClick={() => setPartsPage(page => Math.max(0, page - 1))} disabled={safePartsPage === 0}>‹</button>
            <span>{safePartsPage + 1} / {partsPageCount}</span>
            <button type="button" aria-label="Trang phần sau" onClick={() => setPartsPage(page => Math.min(partsPageCount - 1, page + 1))} disabled={safePartsPage >= partsPageCount - 1}>›</button>
          </div></div>
        </section>
        <p className="notice">{notice}</p>{session?.activeJob && syncDiagnostic && <p className="notice">Chờ đồng bộ: {syncDiagnostic}</p>}
      </section>
      <section className="right-column panel"><div className="panel-heading result-heading"><FileText /><div><h1>Kết quả phân tích từ ChatGPT <small>(10 phân cảnh/trang)</small></h1><p>Chi tiết phân cảnh và prompt của đúng phần bạn đang chọn.</p></div><div className="pager result-pager"><button type="button" onClick={() => setResultsPage(page => Math.max(0, page - 1))} disabled={safeResultsPage === 0}>‹</button><span>{safeResultsPage + 1} / {resultsPageCount}</span><button type="button" onClick={() => setResultsPage(page => Math.min(resultsPageCount - 1, page + 1))} disabled={safeResultsPage >= resultsPageCount - 1}>›</button></div></div><div className="result-tabs">{visibleResults.map((part, index) => { const waiting = part.id.startsWith('waiting-'); return <button type="button" key={part.id} disabled={waiting} onClick={() => setActivePartId(part.id)} className={activePart.id === part.id ? 'active' : waiting ? 'placeholder-tab' : ''}><b>{waiting ? 'Đang chờ' : 'Phần ' + (safeResultsPage * resultsPerPage + index + 1)}</b><span className={'chip ' + (waiting || part.status === 'pending' ? 'waiting' : part.status)}>{waiting ? 'Đang chờ' : statusText(part.status)}</span></button>})}</div><section className="results"><div className="result-title"><h2>{activePart.title}</h2><span className={'chip ' + (activePart.status === 'pending' ? 'waiting' : activePart.status)}>{statusText(activePart.status)}</span><small>{activePart.scenes.length ? 'Đã nhận ' + activePart.scenes.length + ' cảnh' + (activePart.receivedAt ? ' · ' + new Date(activePart.receivedAt).toLocaleTimeString('vi-VN') : '') : 'Chưa nhận được cảnh nào'}</small><button className="outline icon-only" type="button"><Maximize2 size={17} /></button></div><div className="result-scroll">{activePart.status === 'processing' && <p className="notice">{activePart.scenes.length ? 'Đang đồng bộ từng cảnh. Các cảnh bên dưới đã được lưu; tiếp tục chờ phản hồi hoàn tất.' : 'Đang chờ cảnh đầu tiên từ ChatGPT.'}</p>}{activePart.scenes.length ? activePart.scenes.map(scene => <article className="scene-result" key={scene.title}><h3><Clapperboard size={19} /> {scene.title}</h3><dl><dt>Bối cảnh:</dt><dd>{scene.backdrop}</dd><dt>Nội dung:</dt><dd>{scene.content}</dd><dt>Nhân vật:</dt><dd>{scene.character}</dd><dt>Cảm xúc:</dt><dd>{scene.emotion}</dd><dt>Góc quay đề xuất:</dt><dd>{scene.shot}</dd><dt>Gợi ý hình ảnh:</dt><dd>{scene.image}</dd></dl><div className="prompt scene-prompt"><b>Prompt cảnh</b><p>{scene.prompt || 'Chưa có prompt cảnh.'}</p></div></article>) : <p className="empty-result">{activePart.status === 'pending' ? 'Phần này đang chờ tách từ kịch bản tổng.' : activePart.status === 'processing' ? 'ChatGPT đang tạo prompt cảnh cho phần này…' : 'Phần này chưa có kết quả. Bấm Tạo prompt cảnh ở cột bên trái.'}</p>}</div></section></section>
    </div> : <section className="image-workspace"><div className="image-dashboard"><div className="image-title"><Image size={28} /><div><h1>2. TẠO ẢNH</h1><p>Tạo ảnh cho các phân cảnh đã phân tích. Prompt phong cách chung giữ đồng bộ toàn bộ video.</p></div></div><div className="image-stats"><span><small>Tổng phần</small><b>{imageParts.length}</b></span><span><small>Tổng cảnh</small><b>{totalImageScenes}</b></span><span className="done"><small>Hoàn tất</small><b>{completedImageCount}</b></span><span><small>Đang tạo</small><b>{queuedImageCount}</b></span><span><small>Chờ</small><b>{Math.max(0, totalImageScenes - completedImageCount - queuedImageCount)}</b></span><span className="failed"><small>Lỗi</small><b>{imageParts.reduce((sum, part) => sum + part.scenes.filter(scene => scene.imageStatus === 'error').length, 0)}</b></span></div><div className="image-actions"><button type="button" className="analyze-all" disabled={!selectedImagePart} onClick={createPartImages}><Play size={15} fill="currentColor" /> Tạo phần đang chọn</button><button type="button" className="analyze-all" disabled={!totalImageScenes} onClick={createAllImages}><Play size={15} fill="currentColor" /> Tạo tất cả</button><button type="button" className="danger" disabled={!session?.activeJob || session.activeJob.type !== 'image_generation'} onClick={stopWork}><Square size={14} /> Dừng</button></div></div><div className="style-bar"><label><b>Prompt phong cách chung <small>(áp dụng cho toàn bộ ảnh)</small></b><textarea value={stylePrompt} onChange={event => changeStylePrompt(event.target.value)} placeholder="Phong cách điện ảnh, màu sắc, ánh sáng, quy tắc nhân vật, chất liệu, kích thước, không chữ, không logo…" /></label><label>Tỷ lệ ảnh<select value={imageRatio} onChange={event => setImageRatio(event.target.value)}><option>16:9 (1920x1080)</option><option>9:16 (1080x1920)</option><option>1:1 (1024x1024)</option></select></label><label>Số ảnh / cảnh<select value={imagesPerScene} onChange={event => setImagesPerScene(event.target.value)}><option>1</option><option>2</option><option>4</option></select></label><label>Chạy đồng thời<select value={parallelImages} onChange={event => setParallelImages(event.target.value)}><option>1</option><option>2</option><option>3</option><option>5</option></select></label><button type="button" className="outline save-style" onClick={() => void saveStyle()}><RotateCcw size={14} /> Lưu prompt</button></div>{imageParts.length ? <div className="production-grid"><aside className="production-parts"><h2>▣ Các phần ({imageParts.length} phần)</h2>{imageParts.map((part, index) => <button type="button" key={part.id} className={selectedImagePart?.id === part.id ? 'active' : ''} onClick={() => selectImagePart(part)}><span className="production-number">{index + 1}</span><span><b>Phần {index + 1}</b><small>{part.scenes.length} cảnh</small><i><em style={{ width: '0%' }} />0 / {part.scenes.length}</i></span><strong>0%</strong></button>)}</aside><section className="production-scenes"><div className="production-heading"><h2>▣ Danh sách cảnh - {selectedImagePart?.title}</h2><span>{selectedImagePart?.scenes.length || 0} cảnh</span></div><div className="scene-table"><div className="scene-row table-head"><b>#</b><b>Tên cảnh (tóm tắt)</b><b>Trạng thái</b><b>Thao tác</b></div>{selectedImagePart?.scenes.map((scene, index) => <div className={'scene-row ' + (index === imageSceneIndex ? 'active' : '')} key={partKey(scene, index)}><b>{index + 1}</b><button type="button" className="scene-name" onClick={() => setImageSceneIndex(index)}>{scene.title}</button><span className={'chip ' + (scene.imageStatus === 'complete' ? 'complete' : scene.imageStatus === 'error' ? 'error' : 'waiting')}>{imageStateText(scene.imageStatus)}</span><button type="button" className="outline compact" onClick={() => void queueImages([sceneKey(selectedImagePart.id, index)])}>{scene.imageStatus === 'complete' ? 'Tạo lại' : 'Tạo ảnh'}</button></div>)}</div></section><section className="production-preview"><div className="production-heading"><h2>▣ Ảnh kết quả — {selectedImageScene?.title || 'Chọn một cảnh'}</h2><span className={'chip ' + (selectedImageScene?.imageStatus === 'complete' ? 'complete' : selectedImageScene?.imageStatus === 'error' ? 'error' : 'waiting')}>{imageStateText(selectedImageScene?.imageStatus)}</span></div>{selectedImageScene?.imageResults?.[0]?.url ? <div className="preview-empty"><img className="generated-image" src={selectedImageScene.imageResults[0].url} alt={selectedImageScene.title} onError={event => { event.currentTarget.style.display = 'none'; }} /><b>Kết quả ảnh</b>{selectedImageScene.imageError && <p role="status">{selectedImageScene.imageError}</p>}<small>Prompt đã ghép được lưu cùng cảnh này.</small></div> : <div className="preview-empty"><Image size={56} /><b>Chưa có ảnh</b><p>Ảnh của cảnh đang chọn sẽ hiển thị tại đây sau khi kết nối chức năng tạo ảnh.</p><button type="button" className="analyze-all" onClick={createSelectedImage}>Tạo ảnh cảnh này</button><small>Prompt sẽ tự ghép: phong cách chung + prompt riêng của cảnh.</small></div>}<div className="preview-slots">{Array.from({ length: Number(imagesPerScene) }, (_, index) => <button type="button" key={index} disabled><Image size={22} /><span>Ảnh {index + 1}</span></button>)}</div><div className="preview-actions"><button type="button" className="outline" disabled={Boolean(session?.activeJob) || !(selectedImageScene?.imagePrompt || selectedImageScene?.imageResults?.[0]?.prompt)} onClick={() => void recoverImage()}>Đồng bộ lại ảnh</button><button type="button" className="outline" disabled={session?.activeJob?.type !== 'image_generation'} onClick={captureResult}>Đồng bộ ngay</button><button type="button" className="analyze-all" disabled={!selectedImageScene?.imageResults?.length}><Check size={15} /> Chọn ảnh này</button><button type="button" className="outline" onClick={createSelectedImage}><RotateCcw size={15} /> Tạo lại</button><a className="outline" href={selectedImageScene?.imageResults?.[0]?.url} target="_blank" rel="noreferrer"><Download size={15} /> Mở / tải ảnh</a><button type="button" className="danger" disabled><Trash2 size={15} /> Xóa</button></div>{selectedImageScene && <details className="scene-source"><summary>Nội dung nguồn của cảnh</summary><p>{selectedImageScene.content}</p><p><b>Góc máy:</b> {selectedImageScene.shot}</p><p><b>Prompt cảnh:</b> {selectedImageScene.prompt || 'Chưa có prompt.'}</p><button type="button" className="outline" onClick={() => copyPrompt(combinedPrompt(selectedImageScene))}><Copy size={14} /> Sao chép prompt đã ghép</button></details>}</section></div> : <div className="image-empty"><Image size={48} /><h2>Chưa có phân cảnh để tạo ảnh</h2><p>Hoàn tất phân tích phân cảnh ở Tab 1. Các phần đã có phân cảnh sẽ tự động xuất hiện tại đây.</p></div>}</section>}
  </main>;
}

export default App;

