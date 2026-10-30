import { useEffect, useRef, useState } from 'react';
import { api } from './api';
import { resolveManagerLaunch } from './managerLaunch.mjs';
import { acceptManagerTranscript, readManagerTranscriptState } from './managerTranscript';
import { Check, Clapperboard, Copy, Download, FileText, Folder, Image, Maximize2, Play, RotateCcw, Scissors, Settings, Square, Trash2, Video as VideoIcon } from 'lucide-react';
import './index.css';
import { EXTENSION_VERSION, EXTENSION_DOWNLOAD_URL } from './extensionRelease';
import { loadTranscriptWorkspace, workspaceStorageKey } from './transcriptWorkspace';

import type { ImageState, Scene, PartStatus, Part, Session, Job } from './types';

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
  const [managerLaunch] = useState(() => resolveManagerLaunch(localStorage, location.search));
  const [sessionId] = useState(() => {
    if (managerLaunch.error) return localStorage.getItem('vis-session') || 'manager-project-unavailable';
    const id = managerLaunch.projectId || localStorage.getItem('vis-session') || makeId();
    localStorage.setItem('vis-session', id);
    return id;
  });
  const [session, setSessionState] = useState<Session | null>(() => {
    if (managerLaunch.error) return null;
    try { const cached = JSON.parse(localStorage.getItem('vis-project-' + sessionId) || 'null'); return cached?.id === sessionId ? cached : null; } catch { return null; }
  });
  const [serverReady, setServerReady] = useState(false);
  useEffect(() => { if (session) { try { localStorage.setItem('vis-project-' + sessionId, JSON.stringify(session)); } catch { /* Server remains the primary copy. */ } } }, [session]);
  const setSession = (next: Session | null) => setSessionState(previous =>
    previous && next && (previous.updatedAt || 0) > (next.updatedAt || 0) ? previous : next);
  const [script, setScript] = useState(() => localStorage.getItem('vis-script-draft') || '');
  const [stylePrompt, setStylePrompt] = useState(() => localStorage.getItem('vis-style-prompt') || '');
  const [notice, setNotice] = useState(managerLaunch.error || 'Nhập toàn bộ kịch bản, sau đó bấm Phân tích & chia kịch bản.');
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
  // This browser profile's ChatGPT lane. AI MANAGER can give each lane its own job to run tabs in parallel.
  const [laneId] = useState(() => { let value = localStorage.getItem('vis-lane-id') || ''; if (!/^[A-Za-z0-9_-]{6,64}$/.test(value)) { value = 'lane_' + crypto.randomUUID().replaceAll('-', '').slice(0, 16); localStorage.setItem('vis-lane-id', value); } return value; });
  const [extensionFacts, setExtensionFacts] = useState<{ account?: { key?: string; plan?: string; label?: string } | null; activeJobId?: string; chatTabs?: number }>({});
  const [extensionVersion, setExtensionVersion] = useState('');
  const [chatReady, setChatReady] = useState(false);
  const [bridgeMessage, setBridgeMessage] = useState('');
  const [syncDiagnostic, setSyncDiagnostic] = useState('');
  const [imageSyncPending, setImageSyncPending] = useState(false);
  const [imageQueuePending,setImageQueuePending]=useState(false);
  const [stopping,setStopping]=useState(false);
  const stopGate=useRef(false),workGeneration=useRef(0);
  const [imageActionFeedback,setImageActionFeedback]=useState('');
  const imageQueueRequest=useRef(false);
  const [imageSyncFeedback, setImageSyncFeedback] = useState('');
  const imageSyncRequest = useRef<{jobId:string;sceneKey:string}|null>(null);
  const imageSyncTimer = useRef<ReturnType<typeof setTimeout>|undefined>(undefined);
  const finishImageSync = (message:string) => {
    clearTimeout(imageSyncTimer.current);imageSyncRequest.current=null;
    setImageSyncPending(false);setImageSyncFeedback(message);
  };
  const beginImageSync = (key:string,jobId='') => {
    if(imageSyncRequest.current)return false;
    imageSyncRequest.current={jobId,sceneKey:key};setImageSyncPending(true);setImageActionFeedback('');
    setImageSyncFeedback('Đang yêu cầu đồng bộ ảnh từ ChatGPT…');
    imageSyncTimer.current=setTimeout(()=>finishImageSync('Chưa nhận được tệp ảnh sau 45 giây. Giữ đúng hội thoại ChatGPT mở, kiểm tra Extension '+EXTENSION_VERSION+' rồi thử Đồng bộ ngay. Tác vụ trên máy chủ vẫn được giữ.'),45000);
    return true;
  };
  const requestImageCapture = (command:Job) => {
    if(!imageSyncRequest.current&&!beginImageSync(command.sceneKey||'',command.id))return;
    if(imageSyncRequest.current)imageSyncRequest.current.jobId=command.id;
    setImageSyncFeedback('Đang nhận tệp ảnh từ đúng cảnh trong ChatGPT…');
    window.postMessage({source:'vis-web',type:'studio-capture-result',jobId:command.id,command},'*');
  };
  useEffect(()=>()=>clearTimeout(imageSyncTimer.current),[]);

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
    if (managerLaunch.error) { setNotice(managerLaunch.error); return; }
    if (loadInFlight.current||stopGate.current) return;
    const generation=workGeneration.current;
    loadInFlight.current = true;
    try {
      const { data } = await api.get('/api/sessions/' + sessionId);
      if(generation!==workGeneration.current||stopGate.current)return;
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
  // Polling costs Supabase egress. Ask for the small version stamp and download the project only when it
  // changed; poll fast only while work runs, slowly when idle, very slowly when the tab is hidden.
  const sessionRef = useRef(session); sessionRef.current = session;
  useEffect(() => {
    let stopped = false, timer: ReturnType<typeof setTimeout> | undefined, versionMissing = false;
    const busy = () => { const s = sessionRef.current as (Session & { imageJobs?: { status: string }[] }) | null; return Boolean(s?.activeJob || s?.laneJobs?.length || s?.batchAnalysis || s?.imageJobs?.some(job => ['queued', 'sending', 'sent', 'waiting'].includes(job.status))); };
    const delay = () => document.hidden ? (busy() ? 15000 : 60000) : (busy() ? 4000 : 15000);
    const tick = async () => {
      if (stopped) return;
      try {
        if (versionMissing || !sessionRef.current) await load();
        else {
          const { data } = await api.get<{ version: { updatedAt?: number; workEpoch?: number } | null }>('/api/sessions/' + sessionId + '/version');
          const current = sessionRef.current;
          if (!data.version || data.version.updatedAt !== current?.updatedAt || (data.version.workEpoch || 0) !== (current?.workEpoch || 0)) await load();
        }
      } catch (caught) { if (/Không tìm thấy API/.test(caught instanceof Error ? caught.message : '')) { versionMissing = true; await load(); } }
      if (!stopped) timer = setTimeout(() => void tick(), delay());
    };
    const wake = () => { if (!document.hidden) { clearTimeout(timer); void tick(); } };
    void load().then(() => { if (!stopped) timer = setTimeout(() => void tick(), delay()); });
    document.addEventListener('visibilitychange', wake);
    return () => { stopped = true; clearTimeout(timer); document.removeEventListener('visibilitychange', wake); };
  }, []);

  useEffect(() => {
    const requestStatus = () => window.postMessage({ source: 'vis-web', type: 'studio-status' }, '*');
    const receive = (event: MessageEvent) => {
      if (event.source !== window || event.data?.source !== 'vis-extension') return;
      if (event.data.type === 'studio-status') {
        setExtensionPairCode(event.data.pairCode || '');
        setExtensionVersion(event.data.version || '');
        setExtensionFacts({ account: event.data.account || null, activeJobId: String(event.data.activeJobId || ''), chatTabs: Number(event.data.chatTabCount || 0) });
        setChatReady(Boolean(event.data.chatReady));
        setBridgeMessage(event.data.message || '');
        setSyncDiagnostic(event.data.syncDiagnostic || '');
        if (event.data.pairCode === sessionId && event.data.chatReady) setNotice(current => current.startsWith('Đang yêu cầu Extension') ? 'Đã kết nối với hội thoại ChatGPT. Tiện ích sẽ tự kiểm tra và nhận kết quả đang chờ.' : current);
        setPendingSyncCount(Number(event.data.pendingCount || 0));
        setConversationLabel(String(event.data.conversationLabel || event.data.conversationId || '')); 
      }
      if (event.data.type === 'studio-error') {
        const message=event.data.message || 'Tiện ích không thể gửi lệnh.';setNotice(message);
        if(imageSyncRequest.current)finishImageSync('Chưa đồng bộ được ảnh: '+message);
      }
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

  const bridgeConnected = extensionPairCode === sessionId && ['0.4.10', '0.4.11', '0.4.12', '0.4.13', '0.4.14', '0.4.15', '0.4.16', '0.4.17', '0.4.18', '0.4.19', '0.4.20', '0.4.21', '0.4.22', '0.4.23', '0.4.24', '0.4.25', '0.4.26', '0.4.27', '0.4.28', '0.4.29', '0.4.30', '0.4.31', '0.4.32', '0.4.33', '0.4.34', '0.5.0', '0.5.1', '0.5.2', '0.5.3', '0.5.4', '0.5.5', '0.5.6', EXTENSION_VERSION].includes(extensionVersion) && chatReady;

  // Optional, read-only status signal to the local AI MANAGER.
  const [managerWatch, setManagerWatch] = useState(() => !managerLaunch.error && (Boolean(managerLaunch.runId) || localStorage.getItem('vis-manager-watch') === '1'));
  const managerTabId = useRef('tab_' + Math.random().toString(36).slice(2) + Date.now().toString(36));
  // Two Studio tabs in one browser share one extension: only one of them hands jobs to ChatGPT.
  const laneDispatcher = useRef(false);
  const holdsDispatch = () => {
    try {
      const lock = JSON.parse(localStorage.getItem('vis-lane-dispatcher') || 'null');
      if (lock && lock.tab !== managerTabId.current && Date.now() - lock.at < 6000) { laneDispatcher.current = false; return false; }
      localStorage.setItem('vis-lane-dispatcher', JSON.stringify({ tab: managerTabId.current, at: Date.now() }));
    } catch { /* Storage unavailable: behave like before. */ }
    laneDispatcher.current = true; return true;
  };
  // Latest content state for the Manager signal: counts only, never the script text itself.
  const managerContent = useRef({ script, session });
  managerContent.current = { script, session };
  useEffect(() => {
    if (!managerWatch) return;
    const url = 'http://127.0.0.1:8765/api/studio-presence';
    let pageHidden = false;
    const signal = () => {
      if (pageHidden) return;
      let projectName: string | null = null;
      let projects: {id: string; name: string; updatedAt: number | null}[] | null = null;
      let studioInstance = '';
      try {
        const metadata = JSON.parse(localStorage.getItem('vis-project-meta') || '[]');
        studioInstance = localStorage.getItem('vis-manager-instance') || crypto.randomUUID().replaceAll('-', '');
        localStorage.setItem('vis-manager-instance', studioInstance);
        if (Array.isArray(metadata) && metadata.length <= 500 && metadata.every((p: {id?: unknown; name?: unknown}) => typeof p.id === 'string' && typeof p.name === 'string')) projects = metadata.map((p: {id: string; name: string; updatedAt?: unknown}) => ({id: p.id, name: p.name, updatedAt: typeof p.updatedAt === 'number' ? p.updatedAt : null}));
        const name = Array.isArray(metadata) ? metadata.find((p: {id?: string; name?: unknown}) => p.id === sessionId)?.name : null;
        if (typeof name === 'string' && name.trim()) projectName = name.trim().slice(0, 200);
      } catch { /* An unavailable name must not break presence. */ }
      let projectState: Record<string, unknown> | undefined;
      try {
        const draft = managerContent.current.script.trim(), server = String(managerContent.current.session?.script || '').trim();
        const own = localStorage.getItem(workspaceStorageKey(sessionId)) !== null;
        const transcript = loadTranscriptWorkspace(sessionId).transcript;
        projectState = { scriptDraftChars: draft.length, serverScriptChars: server.length, scriptSync: !draft ? 'empty' : draft === server ? 'synced' : localStorage.getItem('vis-script-draft-owner') === sessionId ? 'pending' : 'unconfirmed',
          transcript: { exists: Boolean(transcript?.text?.trim()), chars: transcript?.text?.length || 0, segments: transcript?.segments?.length || 0, videoId: transcript?.videoId || '', scope: own ? 'project' : 'shared' },
          pipeline: readManagerTranscriptState() };
      } catch { /* Content state is optional for presence. */ }
      void fetch(url, {
        method: 'POST', headers: { 'Content-Type': 'text/plain' },
        body: JSON.stringify({ managerRunId: managerLaunch.runId, origin: location.origin, sessionId, activeProjectId: sessionId, studioInstance, tabId: managerTabId.current, chatReady: bridgeConnected, projectName, projects, projectState,
          worker: { laneId, lane: Boolean(managerLaunch.lane), extensionVersion, account: extensionFacts.account || null, extensionJob: extensionFacts.activeJobId || '', chatTabs: extensionFacts.chatTabs || 0, dispatcher: laneDispatcher.current } }),
      }).then(response => response.json()).then(reply => {
        // AI MANAGER may ask this project's tab to get the transcript and rewrite it (Get Transcript tab).
        if (reply?.command && acceptManagerTranscript(reply.command, sessionId)) setActiveMenu(0);
      }).catch(() => {});
    };
    const close = () => {
      if (pageHidden) return;
      pageHidden = true;
      const payload = JSON.stringify({ sessionId, tabId: managerTabId.current, event: 'close' });
      const blob = new Blob([payload], { type: 'text/plain' });
      if (!navigator.sendBeacon || !navigator.sendBeacon(url, blob)) {
        void fetch(url, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: payload, keepalive: true }).catch(() => {});
      }
    };
    const resume = () => {
      if (pageHidden) {
        managerTabId.current = 'tab_' + Math.random().toString(36).slice(2) + Date.now().toString(36);
        pageHidden = false;
      }
      signal();
    };
    signal();
    window.addEventListener('pagehide', close);
    window.addEventListener('pageshow', resume);
    const timer = window.setInterval(signal, 5000);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('pagehide', close);
      window.removeEventListener('pageshow', resume);
    };
  }, [managerWatch, sessionId, bridgeConnected, extensionFacts, extensionVersion]);
  // A Manager-launched tab saves the script typed in this project to the Studio server, so Manager
  // reads the same script after REFRESH. Only before analysis, never over a running job or existing parts.
  const managerScriptPending = !managerLaunch.error && managerLaunch.projectId === sessionId && Boolean(managerLaunch.runId) && serverReady && Boolean(session) && session?.id === sessionId
    && Boolean(script.trim()) && script.trim() !== String(session?.script || '').trim() && !session?.activeJob && !session?.parts?.length;
  const saveScriptForManager = async () => {
    const clean = script.trim(); if (!clean || stopGate.current) return;
    try {
      const { data } = await api.post('/api/sessions/' + sessionId + '/script', { script: clean, expectedWorkEpoch: session?.workEpoch || 0 });
      if (stopGate.current) return;
      setSession(data.session as Session); localStorage.setItem('vis-script-draft-owner', sessionId);
      setNotice('Đã lưu kịch bản lên Studio. AI MANAGER sẽ đọc lại và tiếp tục.');
    } catch (caught) { setNotice('Chưa lưu được kịch bản: ' + (caught instanceof Error ? caught.message : 'lỗi máy chủ')); }
  };
  useEffect(() => {
    if (!managerScriptPending || localStorage.getItem('vis-script-draft-owner') !== sessionId) return;
    const timer = window.setTimeout(() => { void saveScriptForManager(); }, 1500);
    return () => window.clearTimeout(timer);
  }, [managerScriptPending, script, session?.updatedAt]);
  const pendingShared = Boolean(session?.activeJob && ['queued', 'sending'].includes(session.activeJob.status) && (!session.activeJob.lane || session.activeJob.lane === laneId));
  const myLaneJob = session?.laneJobs?.find(job => job.lane === laneId && ['queued', 'sending'].includes(job.status));
  // A Studio tab AI MANAGER opened to run this project (main or extra ChatGPT browser) connects the
  // extension to the project by itself, unless the extension is busy with another job.
  // Retried every 20 s while not connected (e.g. the ChatGPT tab was not open yet).
  // Every Studio tab connects the extension to its project by itself: once when it opens, and again every
  // 20 s only while it has never been connected (failed attempt). If another tab later takes the extension,
  // this tab does not fight back. A job that is really running in this browser is never interrupted.
  const autoBound = useRef(0), everConnected = useRef(false);
  if (extensionPairCode === sessionId) everConnected.current = true;
  useEffect(() => {
    if (managerLaunch.error || !extensionVersion || extensionPairCode === sessionId || extensionFacts.activeJobId || everConnected.current) return;
    const bind = () => {
      if (Date.now() - autoBound.current < 20000) return;
      autoBound.current = Date.now();
      window.postMessage({ source: 'vis-web', type: 'studio-bind-current-chat', pairCode: sessionId }, '*');
      setNotice('AI MANAGER: đang kết nối ChatGPT của trình duyệt này với dự án. Cần một tab chatgpt.com đã đăng nhập.');
    };
    bind(); const timer = window.setInterval(bind, 5000);
    return () => window.clearInterval(timer);
  }, [extensionVersion, extensionPairCode, extensionFacts.activeJobId, sessionId]);
  useEffect(() => {
    if (!bridgeConnected || !(pendingShared || myLaneJob)) return;
    let cancelled = false;
    const generation=workGeneration.current;
    const dispatch = () => {if(stopGate.current||!holdsDispatch())return;void api.get('/api/bridge/' + sessionId + '/next?worker=' + laneId).then(({ data }) => {
      if(generation!==workGeneration.current||stopGate.current)return;
      if (!cancelled && data.discarded) { setSession(data.session as Session); setNotice('Đã chặn lệnh tồn đọng từ luồng cũ. Phần đang xử lý đã trở về Sẵn sàng; hãy bấm Phân tích phân cảnh lại.'); return; } if (!cancelled && data.command) window.postMessage({ source: 'vis-web', type: 'studio-send', pairCode: sessionId, command: data.command }, '*');
    }).catch(() => { if (!cancelled&&!stopGate.current) setNotice('Không thể lấy lệnh để gửi cho tiện ích.'); });};
    dispatch();
    const timer = window.setInterval(dispatch, 2000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [bridgeConnected, session?.activeJob?.id, session?.activeJob?.status, myLaneJob?.id, myLaneJob?.status, sessionId]);

  const changeScript = (value: string) => { setScript(value); localStorage.setItem('vis-script-draft', value); localStorage.setItem('vis-script-draft-owner', sessionId); };
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
    if(stopGate.current)return;const generation=workGeneration.current,expectedWorkEpoch=session?.workEpoch||0;
    if (!script.trim()) { setNotice('Hãy nhập toàn bộ kịch bản trước khi tách.'); return; }
    setBusy(true);
    try {
      const current = await ensureSession();if(stopGate.current||generation!==workGeneration.current)return;
      if (current.parts?.length && !confirmReset) { setNotice('Đã khóa phân tích lại để bảo vệ kết quả hiện có.'); return; }
      const { data } = await api.post('/api/sessions/' + sessionId + '/analysis', { expectedWorkEpoch,script, confirmReset });
      if(stopGate.current||generation!==workGeneration.current)return;
      const next = data.session as Session;
      setSession(next); setActivePartId('pending-0');
      localStorage.removeItem('vis-script-draft'); localStorage.removeItem('vis-script-draft-owner');
      setNotice('Đã gửi toàn bộ kịch bản sang ChatGPT để phân tích cấu trúc và quyết định số phần phù hợp.');
    } catch (caught) { setNotice(caught instanceof Error ? caught.message : 'Không thể bắt đầu phân tích.'); } finally { setBusy(false); }
  };
  const runPart = async (part: Part) => {
    if(stopGate.current)return;const generation=workGeneration.current,expectedWorkEpoch=session?.workEpoch||0;
    if (part.status === 'pending') { setNotice('Hãy để ChatGPT phân tích và chia kịch bản trước.'); return; }
    if (busy) return;
    setBusy(true);
    try {
      await ensureSession();if(stopGate.current||generation!==workGeneration.current)return;
      const { data } = await api.post('/api/sessions/' + sessionId + '/parts/' + part.id + '/analysis',{expectedWorkEpoch});
      if(stopGate.current||generation!==workGeneration.current)return;
      setSession(data.session as Session); setActivePartId(part.id);
      setNotice('Đã gửi ' + part.title + ' sang ChatGPT. Khi hoàn tất, web sẽ dừng và chờ bạn chọn phần kế tiếp.');
    } catch (caught) { setNotice(caught instanceof Error ? caught.message : 'Không thể gửi phần này.'); }
    finally { setBusy(false); }
  };
  const stopWork = async () => {
    if(stopGate.current)return;stopGate.current=true;workGeneration.current++;setStopping(true);setBusy(false);
    imageQueueRequest.current=false;setImageQueuePending(false);finishImageSync('');setSyncDiagnostic('');setPendingSyncCount(0);
    setImageActionFeedback('Đang dừng tất cả tác vụ, hàng đợi và đồng bộ…');
    localStorage.removeItem('vis-transcript-pending-'+sessionId);
    for(const key of ['vis-transcript-workspace-default','vis-transcript-workspace-'+sessionId])try{const workspace=JSON.parse(localStorage.getItem(key)||'null');if(workspace?.sections){workspace.sections=workspace.sections.map((section:{status:string})=>['waiting','processing'].includes(section.status)?{...section,status:'stopped'}:section);localStorage.setItem(key,JSON.stringify(workspace));}}catch{}
    window.postMessage({source:'vis-web',type:'studio-stop-all-local'},'*');
    window.postMessage({source:'vis-web',type:'studio-stop',scope:'all'},'*');
    try{
      const {data}=await api.post('/api/sessions/'+sessionId+'/stop',{},AbortSignal.timeout(15000));const next=data.session as Session;setSession(next);
      const requestId='stop-'+crypto.randomUUID();
      const confirmed=await new Promise<boolean>(resolve=>{
        const done=(ok:boolean)=>{clearTimeout(timeout);window.removeEventListener('message',receive);resolve(ok)};
        const receive=(event:MessageEvent)=>{if(event.source===window&&event.data?.source==='vis-extension'&&event.data.type==='studio-stop-result'&&event.data.requestId===requestId)done(Boolean(event.data.ok))};
        const timeout=setTimeout(()=>done(false),5000);window.addEventListener('message',receive);
        window.postMessage({source:'vis-web',type:'studio-stop',scope:'all',requestId,cancelledJobIds:next.finishedJobIds||[]},'*');
      });
      const message=confirmed?'Đã dừng tất cả: tác vụ đang chạy, hàng đợi, phân tích, viết lại và đồng bộ. Kết quả đã lưu được giữ nguyên.':'Studio đã dừng toàn bộ tác vụ. Chưa xác nhận dừng ChatGPT; hãy cập nhật Extension '+EXTENSION_VERSION+' và F5 tab ChatGPT.';
      setNotice(message);setImageActionFeedback(message);
    }catch(error){setImageActionFeedback('Đã gửi lệnh Dừng tới tiện ích nhưng máy chủ chưa xác nhận: '+(error instanceof Error?error.message:'Mất kết nối.')+' Hãy bấm Dừng tất cả để thử lại.');}
    finally{stopGate.current=false;setStopping(false);}
  };

  const runAllParts = async () => {
    if(stopGate.current)return;const generation=workGeneration.current;
    if (busy) return;
    setBusy(true);
    try {
      const { data } = await api.post('/api/sessions/' + sessionId + '/parts/batch',{expectedWorkEpoch:session?.workEpoch||0});
      if(stopGate.current||generation!==workGeneration.current)return;
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
    if(activeMenu===2){await recoverImage();return;}
    try {
      let command = syncJob;
      if (!command && recoveryPart) {
        const { data } = await api.post('/api/sessions/' + sessionId + '/parts/' + recoveryPart.id + '/recover');
        const next = data.session as Session;
        setSession(next); command = next.activeJob || null;
        if (!command) { setNotice('Phần này đã có kết quả được lưu.'); return; }
      }
      if (!command) return;
      if(command.type==='image_generation'){
        if(imageSyncRequest.current)return;
        requestImageCapture(command);return;
      }
      window.postMessage({ source: 'vis-web', type: 'studio-capture-result', jobId: command.id, command }, '*');
      setNotice('Đang lấy JSON đã có trong đúng hội thoại ChatGPT để hoàn tất phần đang chờ…');
    } catch (caught) { setNotice(caught instanceof Error ? caught.message : 'Không thể khởi tạo đồng bộ kết quả.'); }
  };
  const changeStylePrompt = (value: string) => { setStylePrompt(value); localStorage.setItem('vis-style-prompt', value); };
  const combinedPrompt = (scene: Scene) => stylePrompt.includes('{{SCENE_PROMPT}}') ? stylePrompt.trim().replaceAll('{{SCENE_PROMPT}}', scene.prompt.trim()) : ['SCENE:\n' + scene.prompt.trim(), stylePrompt.trim()].filter(Boolean).join('\n\n');
  // Visible save state next to the button (the shared notice is not shown on the image tab).
  const [styleSave, setStyleSave] = useState<{ state: 'idle' | 'saving' | 'saved' | 'error'; at?: number; message?: string }>({ state: 'idle' });
  const savedStyle = String(session?.stylePrompt || '');
  const styleDirty = stylePrompt.trim() !== savedStyle.trim();
  const saveStyle = async () => {
    if (styleSave.state === 'saving') return;
    setStyleSave({ state: 'saving' });
    try {
      const { data } = await api.post('/api/sessions/' + sessionId + '/settings', { stylePrompt });
      const next = data.session as Session;
      if (String(next?.stylePrompt || '').trim() !== stylePrompt.trim()) throw new Error('Máy chủ chưa ghi đúng nội dung vừa lưu.');
      setSession(next); setStyleSave({ state: 'saved', at: Date.now() }); setNotice('Đã lưu mẫu prompt chung vào dự án.');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Chưa lưu được prompt.';
      setStyleSave({ state: 'error', message }); setNotice(message);
    }
  };
  const styleStatus = styleSave.state === 'saving' ? { tone: 'busy', text: 'Đang lưu…' }
    : styleSave.state === 'error' ? { tone: 'bad', text: 'Lỗi lưu: ' + (styleSave.message || '') }
    : styleDirty ? { tone: 'warn', text: savedStyle.trim() ? 'Chưa lưu — bản đang sửa khác bản đã lưu (' + savedStyle.length.toLocaleString('vi-VN') + ' ký tự)' : 'Chưa lưu vào dự án' }
    : savedStyle.trim() ? { tone: 'ok', text: '✓ Đã lưu' + (styleSave.at ? ' lúc ' + new Date(styleSave.at).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' }) : '') + ' · ' + savedStyle.length.toLocaleString('vi-VN') + ' ký tự' }
    : { tone: 'warn', text: 'Chưa có prompt đã lưu' };
  const recoverImage = async () => {
    if (stopGate.current||!selectedImagePart || !beginImageSync(selectedImageKey)) return;
    const request=imageSyncRequest.current;
    try {
      const { data } = await api.post('/api/sessions/' + sessionId + '/images/capture', { sceneKey: selectedImageKey,expectedWorkEpoch:session?.workEpoch||0 });
      if(imageSyncRequest.current!==request)return;
      const next=data.session as Session;setSession(next);
      const command=data.command;
      if(!command||command.type!=='image_generation'||command.sceneKey!==request?.sceneKey)throw new Error('Máy chủ chưa khởi tạo được tác vụ nhận ảnh đúng cảnh.');
      requestImageCapture(command);
    } catch (error) { if(imageSyncRequest.current===request)finishImageSync('Chưa đồng bộ được ảnh: '+(error instanceof Error ? error.message : 'Không thể kết nối máy chủ.')); }
  };

  const queueImages = async (keys: string[]) => {
    if(imageQueueRequest.current||stopGate.current)return;
    const generation=workGeneration.current,expectedWorkEpoch=session?.workEpoch||0;
    if(!keys.length){setImageActionFeedback('Chưa có cảnh để tạo ảnh.');return;}
    if(!['0.4.16','0.4.17','0.4.18','0.4.19','0.4.20','0.4.21','0.4.22',EXTENSION_VERSION].includes(extensionVersion)){setShowConnection(true);setImageActionFeedback('Hãy cập nhật Extension '+EXTENSION_VERSION+' rồi kết nối lại ChatGPT.');return;}
    imageQueueRequest.current=true;setImageQueuePending(true);setImageSyncFeedback('');setImageActionFeedback('Đang xếp hàng tạo ảnh…');
    try{
      await ensureSession();if(generation!==workGeneration.current||stopGate.current)return;
      const {data}=await api.post('/api/sessions/'+sessionId+'/images',{sceneKeys:keys,stylePrompt,ratio:imageRatio,expectedWorkEpoch});
      if(generation!==workGeneration.current||stopGate.current)return;
      setSession(data.session as Session);
      const added=data.queuedCount??keys.length,existing=data.alreadyQueuedCount||0;
      setImageActionFeedback(added?`Đã xếp ${added} cảnh vào hàng đợi. ChatGPT sẽ tạo lần lượt, giữ nguyên cảnh đang xử lý.${existing?` ${existing} cảnh đã có trong hàng đợi nên không gửi trùng.`:''}`:`${existing} cảnh đang tạo hoặc đã có trong hàng đợi. Không gửi lệnh trùng.`);
    }catch(error){if(generation!==workGeneration.current||stopGate.current)return;setImageActionFeedback('Chưa xếp được ảnh: '+(error instanceof Error?error.message:'Máy chủ chưa phản hồi.'));}
    finally{if(generation===workGeneration.current){imageQueueRequest.current=false;setImageQueuePending(false);}}
  };

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
  useEffect(()=>{
    const request=imageSyncRequest.current;if(!request?.jobId||!session)return;
    const [partId,index]=request.sceneKey.split(':');
    const scene=session.parts?.find(part=>part.id===partId)?.scenes[Number(index)];
    if(session.activeJob?.id===request.jobId)return;
    if(scene?.imageStatus==='complete'&&scene.imageResults?.some(image=>image.jobId===request.jobId))finishImageSync('Đã đồng bộ ảnh và lưu vào Studio.');
    else if(session.lastJob?.id===request.jobId&&scene?.imageStatus==='error')finishImageSync('Chưa đồng bộ được ảnh: '+(scene.imageError||session.lastError||'Máy chủ chưa lưu được tệp.'));
    else if(session.lastJob?.id===request.jobId&&scene?.imageStatus==='stopped')finishImageSync('Đã dừng đồng bộ ảnh.');
  },[session]);
  const activeImageScene=session?.activeJob?.sceneKey?(()=>{const [id,index]=session.activeJob.sceneKey.split(':');const part=session.parts?.find(p=>p.id===id);return part?part.title+' · '+(part.scenes[Number(index)]?.title||'cảnh đang xử lý'):''})():'';
  const completedImageCount = imageParts.reduce((sum, part) => sum + part.scenes.filter(scene => scene.imageStatus === 'complete').length, 0);
  const queuedImageCount = imageParts.reduce((sum, part) => sum + part.scenes.filter(scene => scene.imageStatus === 'queued' || scene.imageStatus === 'generating').length, 0);
  const createSelectedImage = () => { if (selectedImageKey) void queueImages([selectedImageKey]); };
  const createPartImages = () => { if (selectedImagePart) void queueImages(selectedImagePart.scenes.map((_, index) => sceneKey(selectedImagePart.id, index))); };
  const createAllImages = () => void queueImages(imageParts.flatMap(part => part.scenes.map((_, index) => sceneKey(part.id, index))));
  const selectImagePart = (part: Part) => { setImagePartId(part.id); setImageSceneIndex(0); };

  if (managerLaunch.error) return <main className="studio"><p role="alert">{managerLaunch.error}</p><a href={location.origin}>Mở Studio bình thường</a></main>;
  return <main className="studio">
    <header className="topbar"><div className="brand"><Clapperboard size={30} /><strong>VIDEO IMAGE STUDIO</strong></div><nav aria-label="Các bước studio">{([[FileText, '1. Phân tích'], [Image, '2. Tạo ảnh'], [Square, '3. Tiến trình'], [Folder, '4. Dự án'], [Scissors, '5. Tách ảnh'], [VideoIcon, '6. Dựng video']] as const).map(([Icon, label], index) => <button className={'nav-item ' + (index === activeMenu ? 'active' : '')} key={String(label)} type="button" onClick={() => setActiveMenu(index)}><Icon size={23} /><span>{label}</span></button>)}</nav><div className="top-tools"><button type="button" className="danger" disabled={stopping} onClick={stopWork}><Square size={14}/>{stopping?'Đang dừng…':'Dừng tất cả'}</button><span className={bridgeConnected ? 'top-connection online' : 'top-connection offline'}>{bridgeConnected ? '● Đã kết nối' : '● Chưa kết nối'}</span><button type="button" className="connect-button" onClick={() => setShowConnection(true)}>Kết nối ChatGPT</button><Settings size={18} /><span>Cài đặt</span><i>AI</i></div></header>
    {!serverReady && <div role="status" className="notice">{session?.parts?.length ? 'Đang hiển thị bản lưu dự án trên máy, chờ kết nối máy chủ…' : 'Đang tải dự án từ máy chủ. Không cần phân tích lại kịch bản.'}</div>}
    {showConnection && <div className="connection-modal" role="dialog" aria-modal="true" aria-label="Kết nối ChatGPT"><section className="connection-dialog"><button type="button" className="modal-close" onClick={() => setShowConnection(false)} aria-label="Đóng">×</button><h2>Kết nối ChatGPT</h2><p className={bridgeConnected ? 'modal-status online' : 'modal-status offline'}>{bridgeConnected ? '● Đã kết nối ChatGPT · Extension v' + extensionVersion : '● Chưa kết nối ChatGPT'}</p>{conversationLabel && <p className="modal-help"><b>Hội thoại đang khóa:</b> {conversationLabel}</p>}<p className="modal-help">Mở đúng hội thoại ChatGPT bạn muốn dùng rồi bấm Kết nối hội thoại đang mở.</p><button type="button" className="analyze-all modal-copy" onClick={bindCurrentConversation}>Kết nối hội thoại đang mở</button>{!bridgeConnected && bridgeMessage && <p className="modal-help"><b>Lý do:</b> {bridgeMessage}</p>}{extensionVersion && extensionVersion !== EXTENSION_VERSION && <p className="modal-help"><b>Extension hiện tại: v{extensionVersion} — cần cài v{EXTENSION_VERSION}.</b></p>}<button type="button" className="outline modal-install" onClick={() => setManagerWatch(current => { const next = !current; localStorage.setItem('vis-manager-watch', next ? '1' : '0'); return next; })}>{managerWatch ? 'Tắt báo trạng thái AI MANAGER' : 'Bật báo trạng thái AI MANAGER'}</button><p className="modal-help">Chỉ gửi trạng thái kết nối đến AI MANAGER trên máy này; không gửi lệnh ChatGPT.</p><label>Mã kết nối<code>{sessionId}</code></label><button type="button" className="analyze-all modal-copy" onClick={() => copyPrompt(sessionId)}><Copy size={16} /> Sao chép mã kết nối</button><a className="outline modal-install" href={EXTENSION_DOWNLOAD_URL} download>Tải Extension v{EXTENSION_VERSION}</a></section></div>}
    {showResultImport && <div className="connection-modal" role="dialog" aria-modal="true" aria-label="Dán JSON kết quả"><section className="connection-dialog json-import-dialog"><button type="button" className="modal-close" disabled={importBusy} onClick={() => setShowResultImport(false)} aria-label="Đóng">×</button><h2>Dán JSON kết quả</h2><p className="modal-help">Sao chép toàn bộ câu trả lời JSON của ChatGPT và dán vào đây. Lưu thành công sẽ chuyển phần này sang Hoàn tất để tiếp tục phần kế tiếp.</p><label>Lưu vào phần<select value={importPartId} disabled={importBusy} onChange={event => selectImportPart(event.target.value)}>{session?.parts?.map(part => <option key={part.id} value={part.id} disabled={part.status === 'complete' && part.scenes.length > 0}>{part.title}{part.status === 'complete' ? ' — Đã có kết quả' : ''}</option>)}</select></label><div className="import-clipboard"><button type="button" className="outline" disabled={importBusy} onClick={pasteResult}>Dán từ clipboard</button><span>Hoặc nhấn Ctrl + V trong ô bên dưới</span></div><textarea aria-label="JSON kết quả phân cảnh" value={importText} disabled={importBusy} onChange={event => setImportText(event.target.value)} placeholder={'Dán toàn bộ JSON: {"scenes":[…]}'} spellCheck={false} />{importError && <p className="import-error" role="alert">{importError}</p>}<button type="button" className="analyze-all modal-copy" disabled={importBusy || !importPartId || !importText.trim()} onClick={saveImportedResult}>{importBusy ? 'Đang lưu kết quả…' : 'Lưu kết quả vào phần đã chọn'}</button></section></div>}
    {activeMenu === 0 ? <div className="workspace">
      <section className="left-column panel"><div className="panel-heading"><FileText /><div><h1>1. PHÂN TÍCH KỊCH BẢN</h1><p>ChatGPT đọc kịch bản, tự chia thành số phần phù hợp, rồi phân tích chi tiết từng phần thành phân cảnh.</p></div><button type="button" className="outline result-import-launch" disabled={!session?.parts?.length} onClick={openResultImport}>Dán JSON kết quả</button></div>
        <section className="script-box"><h2><FileText size={20} /> Toàn bộ kịch bản</h2><div className="file-row"><FileText size={22} /><div><b>{script.trim() ? 'Kịch bản đang chỉnh sửa' : 'Chưa có kịch bản'}</b><small>{sceneEstimate ? sceneEstimate + ' cảnh nhận diện · ' : ''}{script.length.toLocaleString('vi-VN')} ký tự</small></div><span className="uploaded">● Sẵn sàng</span><button type="button" className="outline"><Folder size={17} /> Thay đổi</button></div><textarea className="screenplay" value={script} onChange={event => changeScript(event.target.value)} placeholder="Dán hoặc nhập toàn bộ kịch bản tại đây…" />{managerScriptPending && localStorage.getItem('vis-script-draft-owner') !== sessionId && <button type="button" className="outline" onClick={() => void saveScriptForManager()}>Lưu kịch bản này cho AI MANAGER</button>}<p className="script-meta">Số ký tự: {script.length.toLocaleString('vi-VN')} <b>|</b> <span>{session?.status === 'structure_processing' ? 'ChatGPT đang phân tích cấu trúc' : storedParts.length ? 'Đã chia ' + storedParts.length + ' phần' : 'Chưa phân tích'}</span></p><div className="analysis-controls"><button className="analyze-all split-button" type="button" onClick={() => void analyzeStructure()} disabled={busy || Boolean(session?.activeJob) || storedParts.length > 0} title={storedParts.length ? 'Đã phân tích. Nút được khóa để bảo vệ kết quả.' : 'Phân tích và chia kịch bản'}><Play size={18} fill="currentColor" /> {busy ? 'Đang khởi tạo…' : 'Phân tích & chia kịch bản'}</button><button className="danger split-button stop-analysis" type="button" onClick={stopWork} disabled={stopping}><Square size={16} /> Dừng phân tích</button><button className="outline split-button" type="button" onClick={captureResult} disabled={!session?.activeJob || session.activeJob.status !== 'waiting'}>Đồng bộ kết quả ngay{pendingSyncCount ? ' (' + pendingSyncCount + ')' : ''}</button></div></section>
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
    </div> : <section className="image-workspace"><div className="image-dashboard"><div className="image-title"><Image size={28} /><div><h1>2. TẠO ẢNH</h1><p>Tạo ảnh cho các phân cảnh đã phân tích. Prompt phong cách chung giữ đồng bộ toàn bộ video.</p></div></div><div className="image-stats"><span><small>Tổng phần</small><b>{imageParts.length}</b></span><span><small>Tổng cảnh</small><b>{totalImageScenes}</b></span><span className="done"><small>Hoàn tất</small><b>{completedImageCount}</b></span><span><small>Đang tạo</small><b>{queuedImageCount}</b></span><span><small>Chờ</small><b>{Math.max(0, totalImageScenes - completedImageCount - queuedImageCount)}</b></span><span className="failed"><small>Lỗi</small><b>{imageParts.reduce((sum, part) => sum + part.scenes.filter(scene => scene.imageStatus === 'error').length, 0)}</b></span></div><div className="image-actions"><button type="button" className="analyze-all" disabled={stopping || imageQueuePending || !selectedImagePart} onClick={createPartImages}><Play size={15} fill="currentColor" /> Tạo phần đang chọn</button><button type="button" className="analyze-all" disabled={stopping || imageQueuePending || !totalImageScenes} onClick={createAllImages}><Play size={15} fill="currentColor" /> Tạo tất cả</button><button type="button" className="danger" disabled={stopping} onClick={stopWork}><Square size={14} /> {stopping?'Đang dừng…':'Dừng tất cả'}</button></div></div>{session?.activeJob && <p className="notice image-work-summary" role="status">Đang chạy: {activeImageScene||(session.activeJob.type==='part_analysis'?'Phân tích phân cảnh':session.activeJob.type==='script_structure'?'Phân tích và chia kịch bản':'Tạo ảnh')}. Hàng đợi và tác vụ này sẽ hủy khi bấm Dừng tất cả.</p>}{imageActionFeedback && <p className="notice image-action-feedback" role="status" aria-live="polite">{imageActionFeedback}</p>}{imageSyncFeedback && <p className="notice image-sync-banner" role="status" aria-live="polite">{imageSyncFeedback}</p>}{syncDiagnostic && session?.activeJob?.type === 'image_generation' && <p className="notice" role="status">Đồng bộ ảnh: {syncDiagnostic}</p>}<div className="style-bar"><label><b>Prompt phong cách chung <small>(áp dụng cho toàn bộ ảnh)</small></b><textarea value={stylePrompt} onChange={event => changeStylePrompt(event.target.value)} placeholder="Phong cách điện ảnh, màu sắc, ánh sáng, quy tắc nhân vật, chất liệu, kích thước, không chữ, không logo…" /></label><label>Tỷ lệ ảnh<select value={imageRatio} onChange={event => setImageRatio(event.target.value)}><option>16:9 (1920x1080)</option><option>9:16 (1080x1920)</option><option>1:1 (1024x1024)</option></select></label><label>Số ảnh / cảnh<select value={imagesPerScene} onChange={event => setImagesPerScene(event.target.value)}><option>1</option><option>2</option><option>4</option></select></label><label>Chạy đồng thời<select value={parallelImages} onChange={event => setParallelImages(event.target.value)}><option>1</option><option>2</option><option>3</option><option>5</option></select></label><div className="style-save"><button type="button" className="outline save-style" disabled={styleSave.state === 'saving'} onClick={() => void saveStyle()}><RotateCcw size={14} /> {styleSave.state === 'saving' ? 'Đang lưu…' : 'Lưu prompt'}</button><small className={'style-save-status ' + styleStatus.tone} role="status">{styleStatus.text}{styleDirty && savedStyle.trim() && styleSave.state !== 'saving' ? <button type="button" className="link-button" onClick={() => { changeStylePrompt(savedStyle); setStyleSave({ state: 'idle' }); }}>Dùng bản đã lưu</button> : null}</small>{stylePrompt.trim() && !stylePrompt.includes('{{SCENE_PROMPT}}') ? <small className="style-save-status warn">Thiếu {'{{SCENE_PROMPT}}'}: prompt cảnh sẽ được đặt riêng ở đầu lệnh.</small> : null}</div></div>{imageParts.length ? <div className="production-grid"><aside className="production-parts"><h2>▣ Các phần ({imageParts.length} phần)</h2>{imageParts.map((part, index) => <button type="button" key={part.id} className={selectedImagePart?.id === part.id ? 'active' : ''} onClick={() => selectImagePart(part)}><span className="production-number">{index + 1}</span><span><b>Phần {index + 1}</b><small>{part.scenes.length} cảnh</small><i><em style={{ width: '0%' }} />0 / {part.scenes.length}</i></span><strong>0%</strong></button>)}</aside><section className="production-scenes"><div className="production-heading"><h2>▣ Danh sách cảnh - {selectedImagePart?.title}</h2><span>{selectedImagePart?.scenes.length || 0} cảnh</span></div><div className="scene-table"><div className="scene-row table-head"><b>#</b><b>Tên cảnh (tóm tắt)</b><b>Trạng thái</b><b>Thao tác</b></div>{selectedImagePart?.scenes.map((scene, index) => <div className={'scene-row ' + (index === imageSceneIndex ? 'active' : '')} key={partKey(scene, index)}><b>{index + 1}</b><button type="button" className="scene-name" onClick={() => setImageSceneIndex(index)}>{scene.title}</button><span className={'chip ' + (scene.imageStatus === 'complete' ? 'complete' : scene.imageStatus === 'error' ? 'error' : 'waiting')}>{imageStateText(scene.imageStatus)}</span><button type="button" className="outline compact" disabled={stopping || imageQueuePending} onClick={() => void queueImages([sceneKey(selectedImagePart.id, index)])}>{scene.imageStatus === 'complete' ? 'Tạo lại' : 'Tạo ảnh'}</button></div>)}</div></section><section className="production-preview"><div className="production-heading"><h2>▣ Ảnh kết quả — {selectedImageScene?.title || 'Chọn một cảnh'}</h2><span className={'chip ' + (selectedImageScene?.imageStatus === 'complete' ? 'complete' : selectedImageScene?.imageStatus === 'error' ? 'error' : 'waiting')}>{imageStateText(selectedImageScene?.imageStatus)}</span></div>{selectedImageScene?.imageResults?.[0]?.url ? <div className="preview-empty"><img key={selectedImageScene.imageResults[0].url} className="generated-image" src={selectedImageScene.imageResults[0].url} alt={selectedImageScene.title} onError={() => setImageSyncFeedback('Đã có tệp ảnh nhưng chưa tải được bản xem trước. Bấm Đồng bộ lại ảnh để lấy lại tệp.')} /><b>Kết quả ảnh</b>{selectedImageScene.imageError && <p role="status">{selectedImageScene.imageError}</p>}<small>Prompt đã ghép được lưu cùng cảnh này.</small></div> : <div className="preview-empty"><Image size={56} /><b>Chưa có ảnh</b>{selectedImageScene?.imageError && <p role="alert">{selectedImageScene.imageError}</p>}<p>Giữ hội thoại ChatGPT đã tạo ảnh mở. Chọn đúng cảnh rồi bấm Đồng bộ lại ảnh để nhận tệp, không tạo lại ảnh.</p><button type="button" className="analyze-all" disabled={stopping || imageQueuePending} onClick={createSelectedImage}>{imageQueuePending?'Đang xếp hàng…':'Tạo ảnh cảnh này'}</button><small>Prompt sẽ tự ghép: phong cách chung + prompt riêng của cảnh.</small></div>}<div className="preview-slots">{Array.from({ length: Number(imagesPerScene) }, (_, index) => <button type="button" key={index} disabled><Image size={22} /><span>Ảnh {index + 1}</span></button>)}</div><div className="preview-actions"><button type="button" className="outline" disabled={stopping || imageSyncPending || imageQueuePending} onClick={() => void recoverImage()}>{imageSyncPending?'Đang đồng bộ…':'Đồng bộ lại ảnh'}</button><button type="button" className="outline" disabled={stopping || imageSyncPending || imageQueuePending} onClick={captureResult}>Đồng bộ ngay</button><button type="button" className="analyze-all" disabled={!selectedImageScene?.imageResults?.length}><Check size={15} /> Chọn ảnh này</button><button type="button" className="outline" disabled={stopping || imageQueuePending} onClick={createSelectedImage}><RotateCcw size={15} /> Tạo lại</button><a className="outline" href={selectedImageScene?.imageResults?.[0]?.url} target="_blank" rel="noreferrer"><Download size={15} /> Mở / tải ảnh</a><button type="button" className="danger" disabled><Trash2 size={15} /> Xóa</button></div>{imageSyncFeedback && <p className="notice image-sync-feedback" role="status" aria-live="polite">{imageSyncFeedback}</p>}{selectedImageScene && <details className="scene-source"><summary>Nội dung nguồn của cảnh</summary><p>{selectedImageScene.content}</p><p><b>Góc máy:</b> {selectedImageScene.shot}</p><p><b>Prompt cảnh:</b> {selectedImageScene.prompt || 'Chưa có prompt.'}</p><button type="button" className="outline" onClick={() => copyPrompt(combinedPrompt(selectedImageScene))}><Copy size={14} /> Sao chép prompt đã ghép</button></details>}</section></div> : <div className="image-empty"><Image size={48} /><h2>Chưa có phân cảnh để tạo ảnh</h2><p>Hoàn tất phân tích phân cảnh ở Tab 1. Các phần đã có phân cảnh sẽ tự động xuất hiện tại đây.</p></div>}</section>}
  </main>;
}

export default App;









