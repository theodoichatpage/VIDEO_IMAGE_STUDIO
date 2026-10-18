import { useEffect, useRef, useState } from 'react';
import { api } from './api';
import { Check, Clapperboard, Copy, Download, FileText, Folder, Image, Maximize2, Play, RotateCcw, Scissors, Settings, Square, Trash2, Video as VideoIcon } from 'lucide-react';
import './index.css';

type ImageState = 'waiting' | 'queued' | 'generating' | 'complete' | 'error' | 'stopped';
type ImageResult = { url: string; prompt: string; createdAt: number };
type Scene = { title: string; backdrop: string; content: string; character: string; emotion: string; shot: string; image: string; prompt: string; imageStatus?: ImageState; imageResults?: ImageResult[]; imagePrompt?: string; imageError?: string };
type PartStatus = 'pending' | 'ready' | 'processing' | 'complete' | 'error' | 'stopped';
type Part = { id: string; title: string; range: string; content: string; status: PartStatus; scenes: Scene[]; analysisText: string };
type Job = { id: string; type: 'script_structure' | 'part_analysis' | 'image_generation'; status: string; prompt: string; partId?: string; sceneKey?: string };
type Session = { id: string; script: string; status: string; activeJob?: Job | null; parts?: Part[]; bridgeLastSeen?: number; lastError?: string };

const makeId = () => crypto.randomUUID().replaceAll('-', '');
const statusText = (status: PartStatus) => ({ pending: 'Chưa phân tích', ready: 'Sẵn sàng phân cảnh', processing: 'Đang phân cảnh', complete: 'Hoàn tất', error: 'Lỗi', stopped: 'Đã dừng' }[status]);
const waitingPart = (index: number): Part => ({ id: 'waiting-' + index, title: 'Phần ' + (index + 1), range: 'Đang chờ', content: 'Đang chờ', status: 'pending', scenes: [], analysisText: '' });
const fillWaiting = (items: Part[], count: number, offset = 0) => Array.from({ length: count }, (_, index) => items[index] || waitingPart(offset + index));

const partKey = (scene: Scene, index: number) => scene.title + '-' + index;
const sceneKey = (partId: string, index: number) => partId + ':' + index;
const imageStateText = (status?: ImageState) => ({ waiting: 'Chờ', queued: 'Đã xếp hàng', generating: 'Đang tạo', complete: 'Hoàn tất', error: 'Lỗi', stopped: 'Đã dừng' }[status || 'waiting']);
const shortText = (text: string, limit: number) => text.length > limit ? text.slice(0, limit).trimEnd() + '…' : text;
const partName = (title: string) => title.replace(/^Phần\s*\d+\s*[-–:]?\s*/i, '').trim() || title;

function App() {
  const [sessionId] = useState(() => localStorage.getItem('vis-session') || makeId());
  const [session, setSession] = useState<Session | null>(null);
  const [script, setScript] = useState(() => localStorage.getItem('vis-script-draft') || '');
  const [stylePrompt, setStylePrompt] = useState(() => localStorage.getItem('vis-style-prompt') || '');
  const [notice, setNotice] = useState('Nhập toàn bộ kịch bản, sau đó bấm Phân tích & chia kịch bản.');
  const [busy, setBusy] = useState(false);
  const [activePartId, setActivePartId] = useState('pending-0');
  const [activeMenu, setActiveMenu] = useState(0);
  const [showConnection, setShowConnection] = useState(false);
  const [extensionPairCode, setExtensionPairCode] = useState('');
  const [extensionVersion, setExtensionVersion] = useState('');
  const [chatReady, setChatReady] = useState(false);
  const [bridgeMessage, setBridgeMessage] = useState('');
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

  const load = async () => {
    try {
      const { data } = await api.get('/api/sessions/' + sessionId);
      const next = data.session as Session | null;
      if (next) {
        setSession(next);
        if (!hydrated.current) {
          setScript(localStorage.getItem('vis-script-draft') || next.script || '');
          if (next.parts?.length) setActivePartId(next.parts[0].id);
          hydrated.current = true;
        }
      } else {
        const created = await api.post('/api/sessions', { id: sessionId });
        setSession(created.data.session as Session);
        localStorage.setItem('vis-session', sessionId);
        hydrated.current = true;
      }
    } catch { setNotice('Không thể kết nối máy chủ web. Hãy tải lại trang.'); }
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
        setPendingSyncCount(Number(event.data.pendingCount || 0));
        setConversationLabel(String(event.data.conversationLabel || event.data.conversationId || '')); 
      }
      if (event.data.type === 'studio-error') setNotice(event.data.message || 'Tiện ích không thể gửi lệnh.');
      if (event.data.type === 'studio-event' && event.data.payload?.jobId) {
        const payload = event.data.payload as { jobId: string; state?: string; text?: string };
        const jobId = String(payload.jobId);
        if (bridgeEventsInFlight.current.has(jobId)) return;
        bridgeEventsInFlight.current.add(jobId);
        void api.post('/api/bridge/' + sessionId + '/event', payload).then(({ data }) => {
          const next = data.session as Session;
          setSession(next);
          if (next.parts?.length) setActivePartId(next.parts[0].id);
          if (payload.state === 'sent') {
            setNotice('Đã gửi lệnh sang ChatGPT. Web đang chờ JSON kết quả, chưa xác nhận hoàn tất.');
            return;
          }
          if (payload.state === 'completed' || payload.state === 'error') {
            window.postMessage({ source: 'vis-web', type: 'studio-event-ack', jobId }, '*');
            setNotice(payload.state === 'completed' && next.parts?.length ? 'Đã lưu JSON ChatGPT và cập nhật các phần kịch bản.' : payload.state === 'completed' ? 'Đã lưu JSON kết quả từ ChatGPT.' : 'ChatGPT lỗi: ' + (next.lastError || payload.text || 'Web đã giải phóng tác vụ; bạn có thể bấm Phân tích lại.'));
          }
        }).catch(() => setNotice('Web chưa lưu được kết quả ChatGPT. Tiện ích sẽ tự gửi lại cho đến khi web xác nhận.')).finally(() => bridgeEventsInFlight.current.delete(jobId));
      }
    };
    window.addEventListener('message', receive); requestStatus();
    const timer = window.setInterval(requestStatus, 5000);
    return () => { window.removeEventListener('message', receive); window.clearInterval(timer); };
  }, [sessionId]);

  const bridgeConnected = extensionPairCode === sessionId && extensionVersion === '0.4.6' && chatReady;
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
  const analyzeStructure = async () => {
    if (!script.trim()) { setNotice('Hãy nhập toàn bộ kịch bản trước khi tách.'); return; }
    setBusy(true);
    try {
      await ensureSession();
      const { data } = await api.post('/api/sessions/' + sessionId + '/analysis', { script });
      const next = data.session as Session;
      setSession(next); setActivePartId('pending-0');
      localStorage.removeItem('vis-script-draft');
      setNotice('Đã gửi toàn bộ kịch bản sang ChatGPT để phân tích cấu trúc và quyết định số phần phù hợp.');
    } catch { setNotice('Không thể tạo phiên làm việc. Hãy tải lại trang rồi thử lại.'); } finally { setBusy(false); }
  };
  const runPart = async (part: Part) => {
    if (part.status === 'pending') { setNotice('Hãy để ChatGPT phân tích và chia kịch bản trước.'); return; }
    try {
      await ensureSession();
      const { data } = await api.post('/api/sessions/' + sessionId + '/parts/' + part.id + '/analysis');
      setSession(data.session as Session); setActivePartId(part.id);
      setNotice('Đã gửi ' + part.title + ' sang ChatGPT. Khi hoàn tất, web sẽ dừng và chờ bạn chọn phần kế tiếp.');
    } catch { setNotice('Không thể gửi phần này. Hãy tải lại trang rồi thử lại.'); }
  };
  const stopWork = async () => {
    window.postMessage({ source: 'vis-web', type: 'studio-stop' }, '*');
    try { const { data } = await api.post('/api/sessions/' + sessionId + '/stop'); setSession(data.session as Session); setNotice('Đã dừng tác vụ hiện tại trên web và ChatGPT.'); }
    catch { setNotice('Không thể dừng tác vụ.'); }
  };
  const copyPrompt = async (prompt: string) => { await navigator.clipboard?.writeText(prompt); setNotice('Đã sao chép mã kết nối.'); };
  const bindCurrentConversation = () => {
    window.postMessage({ source: 'vis-web', type: 'studio-bind-current-chat', pairCode: sessionId }, '*');
    setNotice('Đang yêu cầu Extension khóa vào hội thoại ChatGPT đang mở.');
  };
  const captureResult = () => { if (!session?.activeJob) return; window.postMessage({ source: 'vis-web', type: 'studio-capture-result', jobId: session.activeJob.id }, '*'); setNotice('Đang yêu cầu tiện ích lấy phản hồi cuối từ ChatGPT…'); };
  const changeStylePrompt = (value: string) => { setStylePrompt(value); localStorage.setItem('vis-style-prompt', value); };
  const combinedPrompt = (scene: Scene) => [stylePrompt.trim(), scene.prompt.trim()].filter(Boolean).join('\n\n');
  const queueImages = async (keys: string[]) => { if (!keys.length) return; try { await ensureSession(); const { data } = await api.post('/api/sessions/' + sessionId + '/images', { sceneKeys: keys, stylePrompt, ratio: imageRatio }); setSession(data.session as Session); setNotice(keys.length === 1 ? 'Đã xếp hàng tạo ảnh cho cảnh đang chọn.' : 'Đã xếp ' + keys.length + ' cảnh; ChatGPT sẽ tạo lần lượt từng ảnh.'); } catch (caught) { setNotice((caught as { response?: { data?: { error?: string } } })?.response?.data?.error || 'Không thể đưa cảnh vào hàng đợi tạo ảnh.'); } };

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
    <header className="topbar"><div className="brand"><Clapperboard size={30} /><strong>VIDEO IMAGE STUDIO</strong></div><nav aria-label="Các bước studio">{[[FileText, '1. Phân tích'], [Image, '2. Tạo ảnh'], [Square, '3. Tiến trình'], [Folder, '4. Dự án'], [Scissors, '5. Tách ảnh'], [VideoIcon, '6. Dựng video']].map(([Icon, label], index) => <button className={'nav-item ' + (index === activeMenu ? 'active' : '')} key={String(label)} type="button" onClick={() => setActiveMenu(index)}><Icon size={23} /><span>{label}</span></button>)}</nav><div className="top-tools"><span className={bridgeConnected ? 'top-connection online' : 'top-connection offline'}>{bridgeConnected ? '● Đã kết nối' : '● Chưa kết nối'}</span><button type="button" className="connect-button" onClick={() => setShowConnection(true)}>Kết nối ChatGPT</button><Settings size={18} /><span>Cài đặt</span><i>AI</i></div></header>
    {showConnection && <div className="connection-modal" role="dialog" aria-modal="true" aria-label="Kết nối ChatGPT"><section className="connection-dialog"><button type="button" className="modal-close" onClick={() => setShowConnection(false)} aria-label="Đóng">×</button><h2>Kết nối ChatGPT</h2><p className={bridgeConnected ? 'modal-status online' : 'modal-status offline'}>{bridgeConnected ? '● Đã kết nối ChatGPT · Extension v0.4.6' : '● Chưa kết nối ChatGPT'}</p>{conversationLabel && <p className="modal-help"><b>Hội thoại đang khóa:</b> {conversationLabel}</p>}<p className="modal-help">Mở đúng hội thoại ChatGPT bạn muốn dùng rồi bấm Kết nối hội thoại đang mở. Extension phải khóa đúng hội thoại này và không tự chuyển về hội thoại cũ.</p><button type="button" className="analyze-all modal-copy" onClick={bindCurrentConversation}>Kết nối hội thoại đang mở</button>{!bridgeConnected && bridgeMessage && <p className="modal-help"><b>Lý do:</b> {bridgeMessage}</p>}{extensionVersion && extensionVersion !== '0.4.6' && <p className="modal-help"><b>Extension hiện tại: v{extensionVersion} — cần cài v0.4.6.</b></p>}<label>Mã kết nối<code>{sessionId}</code></label><button type="button" className="analyze-all modal-copy" onClick={() => copyPrompt(sessionId)}><Copy size={16} /> Sao chép mã kết nối</button><a className="outline modal-install" href="./resources/VIDEO_IMAGE_STUDIO_ChatGPT_Extension.zip" download>Tải Extension v0.4.6</a></section></div>}
    {activeMenu === 0 ? <div className="workspace">
      <section className="left-column panel"><div className="panel-heading"><FileText /><div><h1>1. PHÂN TÍCH KỊCH BẢN</h1><p>ChatGPT đọc kịch bản, tự chia thành số phần phù hợp, rồi phân tích chi tiết từng phần thành phân cảnh.</p></div></div>
