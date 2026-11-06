import { useEffect, useRef, useState } from 'react';
import { emptyAnalysis, loadAnalysis } from './analysisWorkspace';
import { loadTranscriptWorkspace, assembleRewrittenScript } from './transcriptWorkspace';
import { acceptResponse, complete, criteriaWithSource, emptyRun, promptFor, scriptOf, threshold, type Mode, type Run } from './automaticAnalysis';
import './analysisTab.css';

type Props = {
  projectId: string; projectName: string; connected: boolean; otherWork: boolean; bridgeJob?: string;
  imported?: { text: string; id: string };
  onTransfer: (draft: ReturnType<typeof emptyAnalysis>, automatic: boolean) => string;
};

const send = (type: string, data = {}) => window.postMessage({ source: 'vis-web', type, ...data }, location.origin);
const labels: Record<Mode, string> = {
  idle: 'Sẵn sàng', running: 'Đang xử lý', paused: 'Đã tạm dừng', stopped: 'Đã dừng', error: 'Gặp lỗi',
  limited: 'Đã hết lượt sửa · vẫn còn tiêu chuẩn dưới 8/10',
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

export default function AnalysisTab({ projectId, projectName, connected, otherWork, bridgeJob, imported, onTransfer }: Props) {
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
  const [input, setInputDraft] = useState(run.input);
  const [error, setError] = useState('');
  useEffect(() => setInputDraft(run.input), [run.input]);
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
    if (!complete(current)) return;
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

  useEffect(() => {
    if (!imported) return;
    change(current => {
      if (current.mode === 'running' || current.pending) { setError('Dừng tác vụ trước khi đổi nguồn.'); return; }
      if (current.input && current.input !== imported.text && !window.confirm('Dùng nội dung mới làm đầu vào cho lượt tiếp theo?')) return;
      save({ ...current, input: imported.text });
    });
  }, [imported?.id]);

  const transcript = () => {
    const workspace = loadTranscriptWorkspace(projectId);
    return { style: workspace.stylePrompt, raw: workspace.transcript?.text || '',
      rewritten: workspace.sections.length && workspace.sections.every(part => part.status === 'done' && part.rewrittenText.trim()) ? assembleRewrittenScript(workspace.sections) : '' };
  };
  const start = () => change(current => {
    if (current.mode === 'running' || current.pending) return;
    const { raw, rewritten, style } = transcript();
    const source = current.input.trim() || raw.trim() || rewritten.trim();
    if (!source) { setError('Hãy lấy transcript hoặc dán kịch bản.'); return; }
    if (!live.current.connected || live.current.otherWork) { setError('Kết nối ChatGPT và chờ tác vụ hiện tại hoàn tất.'); return; }
    if (current.parts.some(part => part.text)) {
      if (!window.confirm('Chạy lại từ đầu? Kịch bản và báo cáo hiện tại sẽ được lưu trong lịch sử.')) return;
      localStorage.setItem(key + '-history-' + crypto.randomUUID(), JSON.stringify(current));
      localStorage.setItem(key + '-previous', JSON.stringify(current));
    }
    save({ ...emptyRun(), input: current.input, source, style, limit: current.limit, mode: 'running' });
    setScope(null);
    setEdited(null);
  });

  const resume = () => change(current => {
    if (!['paused', 'stopped', 'error', 'limited'].includes(current.mode)) return;
    if (!live.current.connected) { setError('Kết nối lại đúng hội thoại ChatGPT để tiếp tục.'); return; }
    if (current.phase === 'repair' && current.mode === 'limited' && current.limit <= current.rounds) {
      setError('Tăng giới hạn lượt sửa hoặc chỉnh kịch bản rồi kiểm tra lại.'); return;
    }
    save({ ...current, mode: 'running', notice: '', pending: current.pending && { ...current.pending, deadline: Date.now() + 600_000 } });
    if (current.pending) send('studio-capture-result', { jobId: current.pending.id });
  });

  const working = run.mode === 'running' || !!run.pending;
  const all = scriptOf(run);
  const viewed = scope === null ? all : run.parts[scope]?.text || '';
  const editIndex = scope ?? (run.parts.length === 1 ? 0 : null);
  const setInput = (value: string) => {
    setInputDraft(value);
    change(current => {
      if (current.mode !== 'running' && !current.pending) save({ ...current, input: value });
    });
  };
  const importSource = (variant: 'raw' | 'rewritten') => {
    const text = transcript()[variant];
    if (text) setInput(text);
    else setError(variant === 'raw' ? 'Dự án này chưa có transcript.' : 'Get Transcript chưa có kịch bản viết lại hoàn chỉnh.');
  };
  const download = () => {
    const url = URL.createObjectURL(new Blob([all], { type: 'text/plain;charset=utf-8' }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'kich-ban-hoan-chinh.txt';
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const canTransfer = complete(run) && !working && ['missing', 'passed', 'limited'].includes(run.mode);

  return <section className="analysis-foundation auto-analysis">
    <header className="flow-panel">
      <h1>{projectName} · Phân tích kịch bản</h1>
      <label>Nguồn kịch bản <textarea value={input} disabled={working} onChange={event => setInput(event.target.value)}
        placeholder="Dán kịch bản hoặc để trống để dùng transcript của dự án"/></label>
      <div className="flow-actions">
        <button className="outline" disabled={working} onClick={() => importSource('raw')}>Lấy transcript</button>
        <button className="outline" disabled={working} onClick={() => importSource('rewritten')}>Lấy bản viết lại từ Get Transcript</button>
        <label>Giới hạn lượt sửa <select disabled={working} value={run.limit} onChange={event => {
          const limit = Number(event.target.value); change(current => { if (!current.pending && current.mode !== 'running') save({ ...current, limit }); });
        }}>{Array.from({ length: 11 }, (_, i) => <option key={i}>{i}</option>)}</select></label>
      </div>
      <div className="flow-actions">
        <button className="analyze-all" disabled={working} onClick={start}>Viết lại &amp; kiểm tra tự động</button>
        <button className="outline" disabled={run.mode !== 'running'} onClick={() => change(current => {
          if (current.mode === 'running') save({ ...current, mode: 'paused', notice: 'Nếu đang nhận phản hồi, Studio sẽ lưu phần đó trước khi tạm dừng.' });
        })}>Tạm dừng</button>
        <button className="outline" disabled={!['paused', 'stopped', 'error', 'limited'].includes(run.mode)} onClick={resume}>Tiếp tục</button>
        <button className="danger" disabled={!working && run.mode !== 'paused'} onClick={() => change(current => stop(current))}>Dừng</button>
      </div>
      <p className="notice" role="status">{progress(run)} · Đã sửa {run.rounds}/{run.limit} lượt{run.notice && ' · ' + run.notice}</p>
      {error && <p role="alert">{error}</p>}
    </header>
    <section className="flow-panel">
      <div className="flow-actions">
        <h2>Kịch bản và đối chiếu</h2>
        <label>Phạm vi <select value={scope ?? 'all'} onChange={event => { setScope(event.target.value === 'all' ? null : Number(event.target.value)); setEdited(null); }}>
          <option value="all">Toàn video</option>{run.parts.map((part, i) => <option key={i} value={i}>Phần {i + 1} · {part.title}</option>)}</select></label>
        {canTransfer && <button className="outline" onClick={() => change(current => {
          if (current.mode === 'limited' && !window.confirm('Một số tiêu chuẩn còn dưới 8/10. Chuyển bản hiện tại sang Phân tách?')) return;
          if (['missing', 'passed', 'limited'].includes(current.mode)) transfer(current, false);
        })}>Chuyển thủ công sang Phân tách</button>}
      </div>
      <p>Điểm tham khảo dựa trên kịch bản. Các mục cần ảnh bìa hoặc video thực tế được đánh dấu riêng.</p>
      {run.rows.length > 0 && (run.phase === 'repair' || run.phase === 'review') && ['running', 'paused', 'stopped', 'error'].includes(run.mode)
        && <p>Đang hiển thị báo cáo của lần chấm trước. Studio sẽ cập nhật sau khi chấm lại bản sửa.</p>}
      <div className="auto-output">
      {run.plan ? <details><summary>Đề xuất về tiêu đề, hai hoặc ba tuyến và cấu trúc</summary>
        <p>{run.plan.title} · {run.plan.question}</p><ul>{run.plan.tracks.map(track => <li key={track}>{track}</li>)}</ul>
        <p>{[run.plan.promise, run.plan.opening, run.plan.transitions, run.plan.payoff, run.plan.ending, run.plan.cover, run.plan.sourceNote].join(' · ')}</p>
      </details> : <p>Kế hoạch tự động sẽ xuất hiện sau khi Studio đọc nguồn.</p>}
      <details open className="auto-script"><summary>{scope === null ? 'Kịch bản hoàn chỉnh' : 'Kịch bản phần ' + (scope + 1)}</summary>
        <textarea aria-label="Kịch bản mới" readOnly={edited === null} value={edited ?? viewed} onChange={event => setEdited(event.target.value)}/>
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
      </details>
      </div>
      <div className="auto-review-scroll"><table className="auto-review">
        <thead><tr><th scope="col">Công thức Aprilynne</th><th scope="col">Điểm, dẫn chứng và cách sửa</th></tr></thead>
        <tbody>{criteriaWithSource.map((criterion, index) => {
          const row = run.rows.find(item => item.id === criterion.id);
          const inScope = scope === null || row?.part === scope + 1;
          return <tr key={criterion.id}>
            <th scope="row">
              {(index === 0 || criteriaWithSource[index - 1].group !== criterion.group) && <small className="auto-group">{criterion.group}</small>}
              {criterion.name} <small>{criterion.start}–{criterion.end} · {criterion.visual ? 'Cần hình ảnh/video' : 'Kiểm tra từ kịch bản'}</small>
              <details><summary>Trích đoạn gốc</summary><blockquote>{criterion.excerpt}</blockquote></details>
            </th>
            <td>{criterion.visual ? <><b>Chưa đủ dữ liệu</b><div>{row?.reason || 'Cần tài sản thực tế để đối chiếu.'}</div></>
              : row && inScope ? <><b>{row.score}/10 · {(row.score ?? 0) >= threshold ? 'Đạt' : 'Cần sửa'}</b> · Phần {row.part}
                <blockquote>{row.evidence}</blockquote><div>{row.reason}</div>{row.fix && <div><strong>Cách sửa </strong>{row.fix}</div>}</>
              : row ? <span>Dẫn chứng của tiêu chuẩn này nằm ở phần {row.part} trong báo cáo toàn video.</span>
              : <span>Chưa có kết quả đối chiếu.</span>}</td>
          </tr>;
        })}</tbody>
      </table></div>
      <details><summary>Bản thảo và báo cáo trước đây</summary>
        <pre>{(() => {
          const previous = localStorage.getItem(key + '-previous');
          const legacy = loadAnalysis(projectId);
          return previous ? scriptOf(JSON.parse(previous)) + '\n\n' + JSON.stringify(JSON.parse(previous).rows, null, 2)
            : [legacy.script, legacy.review].filter(Boolean).join('\n\n') || 'Chưa có bản cũ.';
        })()}</pre>
      </details>
    </section>
  </section>;
}
