import { FileText, Play } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { emptyAnalysis, loadAnalysis } from './analysisWorkspace';
import { loadTranscriptWorkspace, preparedAnalysisSource } from './transcriptWorkspace';
import { acceptResponse, complete, criteriaWithSource, emptyRun, promptFor, reviewQuality, scriptOf, threshold, type Mode, type Run } from './automaticAnalysis';
import './analysisTab.css';

type Props = {
  projectId: string; projectName: string; connected: boolean; otherWork: boolean; bridgeJob?: string;
  active: boolean;
  onTransfer: (draft: ReturnType<typeof emptyAnalysis>, automatic: boolean) => string;
};

const send = (type: string, data = {}) => window.postMessage({ source: 'vis-web', type, ...data }, location.origin);
const labels: Record<Mode, string> = {
  idle: 'Sẵn sàng', running: 'Đang xử lý', paused: 'Đã tạm dừng', stopped: 'Đã dừng', error: 'Gặp lỗi',
  limited: 'Chưa đạt · vẫn còn tiêu chuẩn dưới 8/10',
  missing: 'Các tiêu chuẩn chấm được đã đạt · còn tiêu chuẩn chưa đủ dữ liệu',
  passed: 'Tất cả tiêu chuẩn đã đạt', transferred: 'Đã chuyển bản thảo sang Phân tách',
};

function progress(run: Run) {
  if (run.mode !== 'running') return labels[run.mode];
  if (run.phase === 'plan') return 'Đang đọc toàn bộ nguồn và lập cấu trúc';
  if (run.phase === 'review') return 'Đang đối chiếu toàn bộ kịch bản';
  const part = `phần ${run.index + 1}/${run.parts.length} · ${run.parts[run.index]?.title}`;
  return run.phase === 'write' ? 'Đang viết ' + part : `Đang sửa lần ${run.rounds + 1}/${run.limit} · ${part}`;
}

export default function AnalysisTab({ projectId, projectName, connected, otherWork, bridgeJob, active, onTransfer }: Props) {
  const key = 'vis-automatic-analysis-v2-' + projectId;
  const read = (): Run => {
    try {
      const raw = localStorage.getItem(key);
      if (raw) return JSON.parse(raw);
      const legacy = loadAnalysis(projectId);
      return { ...emptyRun(), input: legacy.input || legacy.script || '' };
    } catch { return emptyRun(); }
  };
  const [run, setRun] = useState(read);
  const [error, setError] = useState('');
  const [scope, setScope] = useState<number | null>(null);
  const [edited, setEdited] = useState<string | null>(null);
  const live = useRef({ connected, otherWork, bridgeJob, onTransfer });
  live.current = { connected, otherWork, bridgeJob, onTransfer };

  const save = (next: Run) => {
    localStorage.setItem(key, JSON.stringify(next));
    setRun(next);
    setError('');
  };
  const change = (action: (current: Run) => void) => {
    if (!navigator.locks) { setError('Hãy dùng Chrome hoặc Edge qua HTTPS để chạy một tác vụ tại một thời điểm.'); return; }
    void navigator.locks.request(key, () => action(read())).catch(caught => setError(caught instanceof Error ? caught.message : 'Không lưu được trạng thái.'));
  };
  const stop = (current: Run, localOnly = false) => {
    if (!current.pending && !['running', 'paused'].includes(current.mode)) return;
    save({ ...current, mode: 'stopped', pending: undefined, notice: 'Các phần đã hoàn thành được giữ lại.' });
    if (!localOnly && current.pending) {
      if (!live.current.otherWork && (!live.current.bridgeJob || live.current.bridgeJob === current.pending.id)) {
        send('studio-stop', { cancelledJobIds: [current.pending.id] });
      }
      send('studio-transcript-ack', { jobId: current.pending.id });
    }
  };

  useEffect(() => {
    const sync = (event: StorageEvent) => { if (event.key === key) setRun(read()); };
    const receive = (event: MessageEvent) => {
      if (event.source !== window) return;
      const data = event.data;
      if (data?.source === 'vis-web' && data.type === 'studio-stop-all-local') { change(current => stop(current, true)); return; }
      if (data?.source !== 'vis-extension' || data.type !== 'studio-transcript-ai-result' || data.kind !== 'rewrite' || data.sectionId !== 'automatic-analysis') return;
      change(current => {
        if (current.pending?.id !== data.jobId) return;
        if (['accepted', 'sent'].includes(data.state)) {
          save({ ...current, pending: { id: data.jobId, deadline: Date.now() + 600_000 } });
          return;
        }
        if (!['completed', 'error'].includes(data.state)) return;
        let next: Run;
        try {
          if (data.state === 'error') throw new Error(String(data.message || data.text || 'ChatGPT không xử lý được tác vụ.'));
          next = acceptResponse(current, data.text);
        } catch (caught) {
          next = { ...current, pending: undefined, mode: 'error', notice: caught instanceof Error ? caught.message : 'Phản hồi không hợp lệ.' };
        }
        save(next);
        send('studio-transcript-ack', { jobId: data.jobId });
      });
    };
    const recover = () => change(current => {
      if (!current.pending) return;
      if (current.mode === 'running' && current.pending.deadline <= Date.now()) {
        save({ ...current, mode: 'error', notice: 'Quá thời gian chờ. Tiếp tục để đồng bộ lệnh hiện tại hoặc Dừng để gửi lại công đoạn này.' });
      }
      if (live.current.connected) send('studio-capture-result', { jobId: current.pending.id });
    });
    window.addEventListener('message', receive);
    window.addEventListener('storage', sync);
    const timer = window.setInterval(recover, 8000);
    return () => { clearInterval(timer); window.removeEventListener('message', receive); window.removeEventListener('storage', sync); };
  }, [key]);

  const previouslyConnected = useRef(connected);
  useEffect(() => {
    if (previouslyConnected.current && !connected) change(current => {
      if (current.mode === 'running') save({ ...current, mode: 'error', notice: 'Mất kết nối ChatGPT. Kết nối lại và bấm Tiếp tục.' });
    });
    previouslyConnected.current = connected;
  }, [connected]);

  const transfer = (current: Run, automatic: boolean) => {
    if (!complete(current) || reviewQuality(current.rows).needsWork > 0) return;
    const plan = current.plan;
    const handoff = {
      ...emptyAnalysis(), input: current.source, script: scriptOf(current), status: 'transferred' as const,
      title: plan?.title || '', cover: plan?.cover || '', openingScene: plan?.opening || '',
      direction: [plan?.question, plan?.promise].filter(Boolean).join('\n'),
      routes: plan?.tracks.join('\n') || '', research: plan?.sourceNote || '',
      outline: [plan?.transitions, plan?.payoff, plan?.ending].filter(Boolean).join('\n'),
      parts: current.parts.map((part, i) => ({ id: String(i + 1), title: part.title, text: part.text, status: 'done' as const })),
    };
    const notice = live.current.onTransfer(handoff, automatic);
    save({ ...current, mode: 'transferred', notice });
  };

  useEffect(() => {
    if (run.mode === 'passed') { change(current => { if (current.mode === 'passed') transfer(current, true); }); return; }
    if (run.mode !== 'running' || run.pending || !connected || otherWork) return;
    const timer = window.setTimeout(() => change(current => {
      if (current.mode !== 'running' || current.pending || !live.current.connected || live.current.otherWork) return;
      const legacyPending = loadAnalysis(projectId).pending;
      const transcriptPending = JSON.parse(localStorage.getItem('vis-transcript-pending-' + projectId) || 'null');
      if (transcriptPending?.expires > Date.now() || (legacyPending && legacyPending.expires > Date.now())) {
        save({ ...current, mode: 'error', notice: 'Get Transcript hoặc một tác vụ Phân tích cũ đang chờ. Hãy hoàn tất tác vụ đó rồi tiếp tục.' });
        return;
      }
      const id = 'transcript-' + crypto.randomUUID();
      const prompt = promptFor(current);
      save({ ...current, pending: { id, deadline: Date.now() + 25_000 }, notice: '' });
      send('studio-transcript-ai', { pairCode: projectId, command: { id, type: 'transcript_rewrite', kind: 'rewrite', sectionId: 'automatic-analysis', prompt } });
    }), 400);
    return () => clearTimeout(timer);
  }, [run, connected, otherWork, projectId]);

  const readSource = () => preparedAnalysisSource(loadTranscriptWorkspace(projectId));
  const [sourceInfo, setSourceInfo] = useState(readSource);
  useEffect(() => {
    if (!active) return;
    setSourceInfo(readSource());
    const sync = (event: StorageEvent) => {
      if (event.key === 'vis-transcript-workspace-' + projectId) setSourceInfo(readSource());
    };
    window.addEventListener('storage', sync);
    return () => window.removeEventListener('storage', sync);
  }, [active, projectId]);

  const start = () => change(current => {
    if (current.mode === 'running' || current.pending) return;
    const prepared = readSource();
    setSourceInfo(prepared);
    const { text: source, style } = prepared;
    if (!source) { setError('Hãy chuẩn bị bản viết lại trong Get Transcript.'); return; }
    if (!live.current.connected || live.current.otherWork) { setError('Kết nối ChatGPT và chờ tác vụ hiện tại hoàn tất.'); return; }
    if (current.parts.some(part => part.text)) {
      if (!window.confirm('Chạy lại từ đầu? Kịch bản và báo cáo hiện tại sẽ được lưu trong lịch sử.')) return;
      localStorage.setItem(key + '-history-' + crypto.randomUUID(), JSON.stringify(current));
      localStorage.setItem(key + '-previous', JSON.stringify(current));
    }
    save({ ...emptyRun(), input: current.input, source, style, mode: 'running', phase: 'review', parts: prepared.parts });
    setScope(null);
    setEdited(null);
  });

  const resume = () => change(current => {
    if (!['paused', 'stopped', 'error'].includes(current.mode)) return;
    if (!live.current.connected) { setError('Kết nối lại đúng hội thoại ChatGPT để tiếp tục.'); return; }
    save({ ...current, mode: 'running', notice: '', pending: current.pending && { ...current.pending, deadline: Date.now() + 600_000 } });
    if (current.pending) send('studio-capture-result', { jobId: current.pending.id });
  });

  const working = run.mode === 'running' || !!run.pending;
  const canResume = ['paused', 'stopped', 'error'].includes(run.mode);
  const all = scriptOf(run);
  const viewed = scope === null ? all : run.parts[scope]?.text || '';
  const editIndex = scope ?? (run.parts.length === 1 ? 0 : null);
  const download = () => {
    const url = URL.createObjectURL(new Blob([all], { type: 'text/plain;charset=utf-8' }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'kich-ban-hoan-chinh.txt';
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const hasCurrentReview = !working && ['missing', 'passed', 'limited', 'transferred'].includes(run.mode);
  const quality = reviewQuality(run.rows);
  const canTransfer = complete(run) && hasCurrentReview && quality.needsWork === 0 && ['missing', 'passed'].includes(run.mode);
  const repairCriterion = (id: number) => change(current => {
    if (current.pending || !['missing', 'passed', 'limited', 'transferred'].includes(current.mode)) return;
    const row = current.rows.find(item => item.id === id);
    if (!row || row.score === null || row.score >= threshold || row.part === null || !current.parts[row.part - 1]?.text) return;
    if (!live.current.connected || live.current.otherWork) { setError('Kết nối ChatGPT và chờ tác vụ hiện tại hoàn tất.'); return; }
    save({ ...current, phase: 'repair', mode: 'running', index: row.part - 1, repairParts: [row.part - 1],
      manualCriterion: id, notice: 'Sửa phần ' + row.part + ' theo tiêu chí đã chọn.' });
  });

  return <section className="workspace auto-analysis">
    <section className="panel">
      <div className="panel-heading"><FileText/><div><h1>Công thức Aprilynne</h1><p>Dự án: {projectName}</p></div></div>
      {(sourceInfo.text || working || canResume || canTransfer) && <div className="analysis-controls">
        {(sourceInfo.text || working) && <button className="analyze-all split-button" disabled={working} onClick={start}><Play size={16}/> Đối chiếu theo Aprilynne</button>
        }
        {run.mode === 'running' && <button className="outline" onClick={() => change(current => {
          if (current.mode === 'running') save({ ...current, mode: 'paused', notice: 'Studio sẽ lưu phản hồi đang chờ rồi tạm dừng.' });
        })}>Tạm dừng</button>}
        {canResume && <button className="outline" onClick={resume}>Tiếp tục</button>}
        {(working || run.mode === 'paused') && <button className="danger" onClick={() => change(current => stop(current))}>Dừng</button>}
        {canTransfer && <button className="outline" onClick={() => change(current => {
          if (['missing', 'passed'].includes(current.mode) && reviewQuality(current.rows).needsWork === 0) transfer(current, false);
        })}>Chuyển sang Phân tách</button>}
      </div>}
      <p className="script-meta" role="status">{run.mode === 'idle' && !sourceInfo.text ? 'Đang chờ bản viết lại từ Get Transcript' : progress(run)}{run.rounds > 0 && ` · Đã sửa ${run.rounds}/${run.limit} lượt`}{run.notice && ' · ' + run.notice}</p>
      {error && <p role="alert">{error}</p>}
      {run.rows.length > 0 && <p>Điểm tham khảo dựa trên kịch bản. Các mục cần ảnh bìa hoặc video thực tế được đánh dấu riêng.</p>}
      {run.rows.length > 0 && (run.phase === 'repair' || run.phase === 'review') && ['running', 'paused', 'stopped', 'error'].includes(run.mode)
        && <p>Đang hiển thị báo cáo của lần chấm trước. Studio sẽ cập nhật sau khi chấm lại bản sửa.</p>}

      <section className="auto-quality" aria-label="Chất lượng kịch bản">
        <strong>Chất lượng kịch bản · {hasCurrentReview
          ? quality.needsWork ? 'Chưa đạt' : quality.unscored ? 'Đạt các mục đã chấm · cần duyệt mục còn thiếu' : 'Đạt'
          : run.rows.length ? 'Kết quả lần chấm trước' : 'Chưa chấm'}</strong>
        <meter min={0} max={criteriaWithSource.length} value={quality.passed} aria-label="Số tiêu chí đạt từ 8 điểm"/>
        {run.rows.length > 0 && <small>{quality.passed}/{criteriaWithSource.length} đạt · {quality.needsWork} cần sửa · {quality.unscored} chưa đủ dữ liệu</small>}
      </section>
      <div className="auto-review-columns">
        <div className="auto-review-scroll"><table className="auto-review" aria-label="Đối chiếu Aprilynne">
          <thead><tr><th scope="col">Tiêu chí đối chiếu</th><th scope="col">Điểm</th><th scope="col">Thao tác</th></tr></thead>
          <tbody>{criteriaWithSource.map((criterion, index) => {
            const row = run.rows.find(item => item.id === criterion.id);
            const score = row?.score;
            return <tr key={criterion.id}>
              <th scope="row">
                {(index === 0 || criteriaWithSource[index - 1].group !== criterion.group) && <small className="auto-group">{criterion.group}</small>}
                {criterion.name}{criterion.timing && ' (' + criterion.timing + ')'}
                {criterion.visual && <small>Cần hình ảnh/video</small>}
                <details><summary>Trích đoạn gốc</summary><blockquote>{criterion.excerpt.replace(/^\[\d+:\d+\]\s*/gm, '')}</blockquote></details>
              </th>
              <td>{typeof score === 'number' ? <strong>{score}/10 · {score >= threshold ? 'Đạt' : 'Cần sửa'}</strong>
                : criterion.visual || score === null ? 'Chưa đủ dữ liệu' : '—'}</td>
              <td>{hasCurrentReview && row && typeof score === 'number' && score < threshold && row.part !== null &&
                <button className="outline" aria-label={`Sửa lại phần ${row.part} theo tiêu chí ${criterion.name}`} onClick={() => repairCriterion(row.id)}>Sửa lại</button>}</td>
            </tr>;
          })}</tbody>
        </table></div>
        <div className="auto-review-scroll"><table className="auto-review" aria-label="Dẫn chứng và cách sửa">
          <thead><tr><th scope="col">Tiêu chí</th><th scope="col">Dẫn chứng và cách sửa</th></tr></thead>
          <tbody>{run.rows.length ? run.rows.map(row => <tr key={row.id}>
            <th scope="row">{criteriaWithSource[row.id]?.name}</th>
            <td>{row.part !== null && <strong>Phần {row.part}</strong>}
              {row.evidence && <blockquote>{row.evidence}</blockquote>}
              <div>{row.reason}</div>
              {row.fix && <div><strong>Cách sửa: </strong>{row.fix}</div>}
            </td>
          </tr>) : <tr><td colSpan={2}>Dẫn chứng và cách sửa sẽ xuất hiện sau khi đối chiếu.</td></tr>}</tbody>
        </table></div>
      </div>
      {all && <details className="auto-script"><summary>{scope === null ? 'Kịch bản hoàn chỉnh' : 'Kịch bản phần ' + (scope + 1)}</summary>
        {run.parts.length > 1 && <label>Phần kịch bản <select value={scope ?? 'all'} onChange={event => { setScope(event.target.value === 'all' ? null : Number(event.target.value)); setEdited(null); }}>
          <option value="all">Toàn video</option>{run.parts.map((part, i) => <option key={i} value={i}>Phần {i + 1} · {part.title}</option>)}</select></label>}
        <textarea className="screenplay" aria-label="Kịch bản mới" readOnly={edited === null} value={edited ?? viewed} onChange={event => setEdited(event.target.value)}/>
        <div className="flow-actions">
          <button className="outline" disabled={!all} onClick={() => void navigator.clipboard.writeText(all).catch(() => setError('Không sao chép được kịch bản.'))}>Sao chép toàn bộ</button>
          <button className="outline" disabled={!all} onClick={download}>Tải toàn bộ (.txt)</button>
          {edited === null ? <button className="outline" disabled={working || editIndex === null || !viewed} onClick={() => setEdited(viewed)}>Chỉnh sửa phần đang xem</button>
          : <><button className="outline" disabled={!edited.trim()} onClick={() => change(current => {
            if (editIndex === null || current.pending || current.mode === 'running' || !edited.trim()) return;
            const parts = current.parts.map((part, i) => i === editIndex ? { ...part, text: edited.trim() } : part);
            const ready = complete({ ...current, parts });
            save({ ...current, parts, rows: [], repairParts: [], phase: ready ? 'review' : current.phase,
              mode: ready && live.current.connected ? 'running' : 'paused', notice: 'Đã lưu phần chỉnh sửa.' });
            setEdited(null);
          })}>Lưu và kiểm tra lại</button><button className="outline" onClick={() => setEdited(null)}>Hủy chỉnh sửa</button></>}
        </div>
      </details>}
    </section>
  </section>;
}
