import { useEffect, useRef, useState } from 'react';
import { analysisPrompt, betterDraft, passed, passingScore, readDraft, readReview, rubric, type Draft, type Phase, type Reviewed } from './automaticAnalysis';
import { loadTranscriptWorkspace } from './transcriptWorkspace';
import './automaticAnalysis.css';

type Mode = 'idle' | 'running' | 'paused' | 'stopped' | 'error' | 'exhausted' | 'transferred';
type Pending = { id: string; expires: number };
type Run = {
  input: string; source: string; style: string; limit: number; repairs: number;
  mode: Mode; phase: Phase; pending?: Pending; draft?: Draft; best?: Reviewed; report?: Reviewed; message: string;
};
type Props = {
  projectId: string; connected: boolean; otherWork: boolean;
  imported?: { text: string; id: string };
  onTransfer: (script: string) => Promise<string>;
};
const status: Record<Phase, string> = {
  write: 'Đang viết lại kịch bản', review: 'Đang đánh giá toàn bộ kịch bản',
  revise: 'Đang sửa các đoạn chưa đạt', handoff: 'Đã đạt · Đang chuyển sang Phân tách',
};
const modes: Record<Mode, string> = {
  idle: 'Sẵn sàng', running: '', paused: 'Đã tạm dừng', stopped: 'Đã dừng', error: 'Gặp lỗi',
  exhausted: 'Đã hết lượt sửa tự động', transferred: 'Đã chuyển sang Phân tách',
};
const post = (type: string, payload = {}) => window.postMessage({ source: 'vis-web', type, ...payload }, window.location.origin);

function load(projectId: string, key: string): Run {
  const empty: Run = { input: '', source: '', style: '', limit: 3, repairs: 0, mode: 'idle', phase: 'write', message: '' };
  try {
    const saved = localStorage.getItem(key);
    if (saved) return JSON.parse(saved);
    const legacy = JSON.parse(localStorage.getItem('vis-analysis-workspace-' + projectId) || 'null');
    return { ...empty, input: legacy?.input || legacy?.script || '' };
  } catch { return empty; }
}

export default function AnalysisTab({ projectId, connected, otherWork, imported, onTransfer }: Props) {
  const key = 'vis-automatic-analysis-' + projectId;
  const [run, setRun] = useState(() => load(projectId, key));
  const [error, setError] = useState('');
  const [transferring, setTransferring] = useState(false);
  const live = useRef({ connected, otherWork, onTransfer });
  live.current = { connected, otherWork, onTransfer };

  const save = (next: Run) => {
    localStorage.setItem(key, JSON.stringify(next));
    setRun(next);
    setError('');
  };
  const exclusive = (action: (current: Run) => void | Promise<void>) => {
    if (!navigator.locks) {
      setError('Trình duyệt này thiếu hỗ trợ khóa tác vụ. Hãy mở Studio trên Chrome hoặc Edge qua HTTPS.');
      return;
    }
    void navigator.locks.request(key, () => action(load(projectId, key))).catch(caught => {
      setError(caught instanceof Error ? caught.message : 'Không thể lưu trạng thái phân tích.');
    });
  };

  const transfer = async (current: Run) => {
    const script = current.draft?.script;
    if (!script) return;
    setTransferring(true);
    try {
      const message = await live.current.onTransfer(script);
      save({ ...current, mode: 'transferred', message });
    } catch (caught) {
      save({ ...current, mode: 'error', message: caught instanceof Error ? caught.message : 'Không chuyển được kịch bản.' });
    } finally { setTransferring(false); }
  };

  useEffect(() => {
    const update = (event: StorageEvent) => { if (event.key === key) setRun(load(projectId, key)); };
    const receive = (event: MessageEvent) => {
      if (event.source !== window) return;
      const data = event.data;
      if (data?.source === 'vis-web' && data.type === 'studio-stop-all-local') {
        exclusive(current => {
          if (current.pending || current.mode === 'running' || current.mode === 'paused') {
            save({ ...current, pending: undefined, mode: 'stopped', message: '' });
          }
        });
        return;
      }
      if (data?.source !== 'vis-extension' || data.type !== 'studio-transcript-ai-result' || data.kind !== 'rewrite' || data.sectionId !== 'automatic-analysis') return;
      exclusive(current => {
        if (current.pending?.id !== data.jobId) return;
        if (data.state === 'accepted' || data.state === 'sent') {
          save({ ...current, pending: { id: data.jobId, expires: Date.now() + 600_000 }, message: '' });
          return;
        }
        if (data.state !== 'completed' && data.state !== 'error') return;
        let next: Run = { ...current, pending: undefined, message: '', mode: current.mode === 'running' ? 'running' : 'paused' };
        try {
          if (data.state === 'error') throw new Error(String(data.message || 'ChatGPT không xử lý được tác vụ.'));
          if (current.phase === 'review' && current.draft) {
            const rows = readReview(data.text);
            const report = { ...current.draft, rows };
            const best = betterDraft(current.best, report);
            next = { ...next, best, report };
            if (passed(rows)) next.phase = 'handoff';
            else if (current.repairs >= current.limit) next = { ...next, draft: best, report: best, phase: 'revise', mode: 'exhausted' };
            else next.phase = 'revise';
          } else {
            next = { ...next, draft: readDraft(data.text), report: undefined, phase: 'review',
              repairs: current.repairs + (current.phase === 'revise' ? 1 : 0) };
          }
        } catch (caught) {
          next = { ...next, mode: 'error', message: caught instanceof Error ? caught.message : 'Phản hồi không hợp lệ.' };
        }
        save(next);
        post('studio-transcript-ack', { jobId: data.jobId });
      });
    };
    const recover = () => exclusive(current => {
      if (!current.pending) return;
      if (current.pending.expires <= Date.now() && current.mode === 'running') {
        save({ ...current, mode: 'error', message: 'Chưa nhận được phản hồi. Mở đúng hội thoại ChatGPT và chọn Tiếp tục để đồng bộ tác vụ đang chờ, hoặc chọn Dừng.' });
      }
      if (live.current.connected) post('studio-capture-result', { jobId: current.pending.id });
    });
    window.addEventListener('message', receive);
    window.addEventListener('storage', update);
    const timer = window.setInterval(recover, 8000);
    return () => {
      clearInterval(timer);
      window.removeEventListener('message', receive);
      window.removeEventListener('storage', update);
    };
  }, [projectId, key]);

  useEffect(() => {
    if (run.mode !== 'running' || run.pending || (run.phase !== 'handoff' && (!connected || otherWork))) return;
    const timer = window.setTimeout(() => exclusive(async current => {
      if (current.mode !== 'running' || current.pending) return;
      if (current.phase === 'handoff') { await transfer(current); return; }
      if (!live.current.connected || live.current.otherWork) return;
      if (localStorage.getItem('vis-transcript-pending-' + projectId)) {
        save({ ...current, mode: 'error', message: 'Kiểm tra kết nối ChatGPT và hoàn tất tác vụ khác trước khi tiếp tục.' });
        return;
      }
      const id = 'transcript-' + crypto.randomUUID();
      const prompt = analysisPrompt(current.phase, current.source, current.style, current.phase === 'revise' ? current.best : current.draft, current.best);
      save({ ...current, pending: { id, expires: Date.now() + 15_000 }, message: 'Đang gửi tới tiện ích ChatGPT…' });
      post('studio-transcript-ai', { pairCode: projectId, command: { id, type: 'transcript_rewrite', kind: 'rewrite', sectionId: 'automatic-analysis', prompt } });
    }), 400);
    return () => clearTimeout(timer);
  }, [run, projectId, key, connected, otherWork]);

  useEffect(() => {
    if (!imported) return;
    exclusive(current => {
      if (current.mode === 'running' || current.pending) { setError('Dừng tác vụ trước khi đổi nội dung đầu vào.'); return; }
      if (current.input && current.input !== imported.text && !window.confirm('Thay nội dung đầu vào của tab Phân tích?')) return;
      save({ ...current, input: imported.text });
    });
  }, [imported?.id]);

  const workspace = () => {
    const scoped = loadTranscriptWorkspace(projectId);
    const legacy = loadTranscriptWorkspace('default');
    return { transcript: scoped.transcript?.text || legacy.transcript?.text || '',
      style: legacy.stylePrompt || scoped.stylePrompt || localStorage.getItem('vis-transcript-style') || '' };
  };
  const start = () => exclusive(current => {
    if (current.mode === 'running' || current.pending) return;
    const { transcript, style } = workspace();
    const source = current.input.trim() || transcript.trim();
    if (!source) { setError('Hãy lấy transcript hoặc dán kịch bản.'); return; }
    if (!live.current.connected || live.current.otherWork) { setError('Hãy kết nối ChatGPT và chờ tác vụ hiện tại hoàn tất.'); return; }
    if (current.draft && !window.confirm('Bắt đầu lượt mới và thay bản đang hiển thị trong Phân tích?')) return;
    save({ input: current.input, source, style, limit: current.limit, repairs: 0, mode: 'running', phase: 'write',
      message: 'Đang đọc nguồn và nạp phong cách cá nhân…' });
  });
  const resume = () => exclusive(current => {
    if (!['paused', 'error', 'stopped', 'exhausted'].includes(current.mode)) return;
    if (current.mode === 'exhausted' && current.repairs >= current.limit) {
      setError('Tăng giới hạn số lượt sửa trước khi tiếp tục.'); return;
    }
    if (current.pending && !live.current.connected) { setError('Hãy kết nối lại đúng hội thoại ChatGPT.'); return; }
    save({ ...current, mode: 'running', message: '', pending: current.pending && { ...current.pending, expires: Date.now() + 600_000 } });
    if (current.pending) post('studio-capture-result', { jobId: current.pending.id });
  });
  const stop = () => exclusive(current => {
    save({ ...current, mode: 'stopped', pending: undefined, message: 'Đã dừng quy trình. Bản đang có được giữ lại.' });
    if (current.pending) post('studio-stop', { cancelledJobIds: [current.pending.id] });
  });
  const canResume = ['paused', 'error', 'stopped', 'exhausted'].includes(run.mode);
  const working = run.mode === 'running';
  const shown = run.draft;

  return <section className="automatic-analysis panel">
    <header><h1>Phân tích kịch bản tự động</h1><p>Viết lại theo phong cách đã lưu, chấm theo rubric Aprilynne và tự sửa trước khi phân tách.</p></header>
    <label>Nội dung đầu vào<textarea value={run.input} disabled={working || !!run.pending}
      placeholder="Dán kịch bản hoặc để trống để dùng transcript đã lấy trong Studio"
      onChange={event => { const input = event.target.value; setRun({ ...run, input }); exclusive(current => save({ ...current, input })); }}/></label>
    <div className="automatic-actions">
      <button className="outline" disabled={working || !!run.pending} onClick={() => exclusive(current => {
        const { transcript } = workspace();
        if (transcript) save({ ...current, input: transcript }); else setError('Chưa có nội dung ở Get Transcript.');
      })}>Lấy từ Get Transcript</button>
      <label>Giới hạn lượt sửa <select value={run.limit} disabled={working || !!run.pending}
        onChange={event => { const limit = Number(event.target.value); exclusive(current => save({ ...current, limit })); }}>
        {[0,1,2,3,4,5,6,7,8,9,10].map(limit => <option key={limit}>{limit}</option>)}</select></label>
    </div>
    <div className="automatic-actions">
      <button className="analyze-all" disabled={working || !!run.pending || transferring} onClick={start}>Bắt đầu phân tích tự động</button>
      <button className="outline" disabled={!working || transferring} onClick={() => exclusive(current => {
        if (current.mode === 'running') save({ ...current, mode: 'paused', message: current.pending ? 'Tác vụ hiện tại vẫn nhận kết quả trước khi tạm dừng.' : '' });
      })}>Tạm dừng</button>
      <button className="outline" disabled={!canResume || transferring} onClick={resume}>Tiếp tục</button>
      <button className="danger" disabled={(!working && !run.pending && run.mode !== 'paused') || transferring} onClick={stop}>Dừng</button>
    </div>
    <p className="notice" role="status">{working ? (!connected && run.phase !== 'handoff' ? 'Đang chờ kết nối ChatGPT' : otherWork && !run.pending && run.phase !== 'handoff' ? 'Đang chờ tác vụ khác' : status[run.phase]) : modes[run.mode]} · Đã sửa {run.repairs}/{run.limit} lượt{run.message && ' · ' + run.message}</p>
    {error && <p role="alert" className="transcript-error">{error}</p>}
    <h2>Kịch bản hoàn chỉnh</h2>
    {shown?.tracks.length ? <ul>{shown.tracks.map(track => <li key={track}>{track}</li>)}</ul> : null}
    <textarea aria-label="Kịch bản hoàn chỉnh" readOnly value={shown?.script || ''}/>
    {run.mode === 'exhausted' && shown && <button className="outline" disabled={transferring} onClick={() => {
      if (window.confirm('Kịch bản còn tiêu chí dưới 8/10. Duyệt thủ công và chuyển sang Phân tách?')) {
        exclusive(current => current.mode === 'exhausted' ? transfer({ ...current, phase: 'handoff' }) : undefined);
      }
    }}>Duyệt thủ công và chuyển sang Phân tách</button>}
    <h2>Báo cáo chất lượng</h2>
    <p>Điểm dựa trên nội dung kịch bản. Chuẩn đạt là từng tiêu chí từ {passingScore}/10.</p>
    {run.report ? <div className="automatic-report"><table><thead><tr><th>Tiêu chí</th><th>Điểm</th><th>Lý do</th><th>Vị trí và cách sửa</th></tr></thead>
      <tbody>{run.report.rows.map(row => <tr key={row.id}><th scope="row">{rubric[row.id]}</th>
        <td className={row.score < passingScore ? 'automatic-low' : ''}>{row.score}/10</td><td>{row.reason}</td><td>{[row.location, row.fix].filter(Boolean).join(' · ')}</td></tr>)}</tbody></table></div>
      : <p>{working && shown ? 'Đang chờ điểm cho bản hiện tại.' : 'Chưa có báo cáo.'}</p>}
  </section>;
}
