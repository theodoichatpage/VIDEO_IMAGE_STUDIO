import { FileText } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { emptyAnalysis, loadAnalysis } from './analysisWorkspace';
import { loadTranscriptWorkspace, preparedAnalysisSource } from './transcriptWorkspace';
import { acceptResponse, approvedRun, criteriaWithSource, emptyRun, promptFor, reviewPartsFromScript, reviewQuality, restoreRun, scriptOf, threshold, type Mode, type Run } from './automaticAnalysis';
import './analysisTab.css';
import { readManagerTranscript, readManagerTranscriptState } from './managerTranscript';

type Props = {
  projectId: string; projectName: string; connected: boolean; otherWork: boolean; bridgeJob?: string;
  active: boolean; ready: boolean; enabled?: boolean; workEpoch?: number;
  onCheckpoint: (run: Run) => Promise<void>;
  managerReview?: { id: string; source: 'transcript' | 'script' };
  managerScript?: string;
  onTransfer: (draft: ReturnType<typeof emptyAnalysis>, automatic: boolean, managed?: boolean) => string;
};

const send = (type: string, data = {}) => window.postMessage({ source: 'vis-web', type, ...data }, location.origin);
const labels: Record<Mode, string> = {
  idle: 'Sẵn sàng', running: 'Đang xử lý', paused: 'Đã tạm dừng', stopped: 'Đã dừng', error: 'Gặp lỗi',
  limited: 'Lỗi: đã hết số vòng sửa tự động · còn tiêu chí dưới 8/10, chờ xử lý',
  missing: 'Các tiêu chuẩn chấm được đã đạt · còn tiêu chuẩn chưa đủ dữ liệu',
  passed: 'Mọi tiêu chuẩn chấm được từ kịch bản đã đạt', transferred: 'Đã chuyển bản thảo sang Phân tách',
};

function progress(run: Run) {
  if (run.mode !== 'running') return labels[run.mode];
  if (run.phase === 'plan') return 'Đang đọc toàn bộ nguồn và lập cấu trúc';
  if (run.phase === 'review') return 'Đang đối chiếu toàn bộ kịch bản';
  const part = `phần ${run.index + 1}/${run.parts.length} · ${run.parts[run.index]?.title}`;
  return run.phase === 'write' ? 'Đang viết ' + part : `Đang sửa lần ${run.rounds + 1}/${run.limit} · ${part}`;
}

export default function AnalysisTab({ projectId, projectName, connected, otherWork, bridgeJob, active, ready, enabled = true, workEpoch = 0, managerReview, managerScript, onCheckpoint, onTransfer }: Props) {
  const key = 'vis-automatic-analysis-v2-' + projectId;
  // The browser keeps about 5 MB per site. A long script is stored once (the original text of a prepared part equals its text) and the latest state also lives in memory.
  const latest = useRef<Run | null>(null);
  const slim = (value: Run): Run => ({ ...value, parts: value.parts.map(part => part.source === part.text ? { ...part, source: '' } : part) });
  const full = (value: Run): Run => ({ ...value, parts: value.parts.map(part => part.source ? part : { ...part, source: part.text }) });
  const read = (): Run => {
    if (latest.current) return latest.current;
    try {
      const raw = localStorage.getItem(key);
      if (raw) return full(restoreRun(JSON.parse(raw), projectId, workEpoch));
      const legacy = loadAnalysis(projectId);
      return { ...emptyRun(), input: legacy.input || legacy.script || '' };
    } catch { return emptyRun(); }
  };
  const [run, setRun] = useState(read);
  const [error, setError] = useState('');
  const live = useRef({ connected, otherWork, bridgeJob, onTransfer, onCheckpoint });
  live.current = { connected, otherWork, bridgeJob, onTransfer, onCheckpoint };
  const checkpointing = useRef(false);
  const [tick, setTick] = useState(0);
  useEffect(() => { const timer = setInterval(() => setTick(value => value + 1), 2000); return () => clearInterval(timer); }, []);

  const save = (next: Run) => {
    latest.current = next;
    const text = JSON.stringify(slim(next));
    try { localStorage.setItem(key, text); setError(''); } catch {
      // Out of room: drop the old copies of this analysis, then try once more.
      try {
        for (let i = localStorage.length - 1; i >= 0; i--) { const name = localStorage.key(i) || ''; if (name.startsWith(key + '-')) localStorage.removeItem(name); }
        localStorage.setItem(key, text); setError('');
      } catch { setError('Bộ nhớ trình duyệt đầy: kết quả chỉ giữ trong tab này, đừng tải lại trang.'); }
    }
    setRun(next);
  };
  const change = (action: (current: Run) => void | Promise<void>) => {
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
    const sync = (event: StorageEvent) => { if (event.key === key) { latest.current = null; setRun(read()); } };
    const receive = (event: MessageEvent) => {
      if (event.source !== window) return;
      const data = event.data;
      if (data?.source === 'vis-web' && data.type === 'studio-stop-all-local') { change(current => stop(current, true)); return; }
      if (data?.source !== 'vis-extension' || data.type !== 'studio-transcript-ai-result' || data.kind !== 'rewrite') return;
      change(current => {
        const pending = current.pending;
        if (!pending || pending.id !== data.jobId || data.sectionId !== (pending.sectionId || 'automatic-analysis')) return;
        if (['accepted', 'sent'].includes(data.state)) {
          save({ ...current, pending: { ...pending, deadline: Date.now() + 600_000 } });
          return;
        }
        if (!['completed', 'error'].includes(data.state)) return;
        let next: Run;
        try {
          if (data.state === 'error') {
            const message = String(data.message || data.text || 'ChatGPT không xử lý được tác vụ.');
            if (/đang (xử lý|bận)|tác vụ khác|chưa kết nối|mất kết nối|chưa sẵn sàng|không tìm thấy.*ChatGPT/i.test(message)) {
              save({ ...current, pending: undefined, notice: 'Đang xếp hàng · chờ ChatGPT sẵn sàng.' });
              send('studio-transcript-ack', { jobId: data.jobId }); return;
            }
            throw new Error(message);
          }
          next = { ...acceptResponse(current, data.text), needsSave: true, revision: (current.revision || 0) + 1, invalid: 0, lastInvalid: undefined };
        } catch (caught) {
          const reason = caught instanceof Error ? caught.message : 'Phản hồi không hợp lệ.';
          // A reply that fails the strict check (a quote not word for word, a missing fix) is asked again twice, with the reason, before stopping.
          const tries = (current.invalid || 0) + 1;
          next = (data.state !== 'error' || /quá thời gian|timeout|không nhận được phản hồi/i.test(reason)) && tries <= 2 && current.mode === 'running'
            ? { ...current, pending: undefined, invalid: tries, lastInvalid: reason, notice: 'ChatGPT trả kết quả chưa hợp lệ (' + reason + ') · gửi lại lần ' + tries + '/2' }
            : { ...current, pending: undefined, mode: 'error', notice: reason };
        }
        save(next);
        send('studio-transcript-ack', { jobId: data.jobId });
      });
    };
    const recover = () => change(current => {
      if (!current.pending || !live.current.connected) return;
      if (current.mode === 'running' && current.pending.deadline <= Date.now()) {
        // A long repair (whole part, sources looked up on the web) can take more than 10 minutes: wait twice more, reading the reply each time, before stopping.
        const extended = current.pending.extended || 0;
        if (extended < 2) save({ ...current, pending: { ...current.pending, deadline: Date.now() + 600_000, extended: extended + 1 }, notice: 'ChatGPT trả lời lâu · chờ thêm (' + (extended + 1) + '/2)' });
        else save({ ...current, mode: 'error', notice: 'Quá thời gian chờ. Tiếp tục để đồng bộ lệnh hiện tại hoặc Dừng để gửi lại công đoạn này.' });
      }
      if (live.current.connected) send('studio-capture-result', { jobId: current.pending.id });
    });
    window.addEventListener('message', receive);
    window.addEventListener('storage', sync);
    const timer = window.setInterval(recover, 8000);
    return () => { clearInterval(timer); window.removeEventListener('message', receive); window.removeEventListener('storage', sync); };
  }, [key]);

  const disconnectedAt = useRef<number | undefined>(undefined);
  useEffect(() => {
    if (!connected && disconnectedAt.current === undefined) disconnectedAt.current = Date.now();
    if (connected && disconnectedAt.current !== undefined) {
      const elapsed = Date.now() - disconnectedAt.current; disconnectedAt.current = undefined;
      change(current => { if (current.pending) {
        save({ ...current, pending: { ...current.pending, deadline: current.pending.deadline + elapsed } });
        send('studio-capture-result', { jobId: current.pending.id });
      } });
    }
  }, [connected]);

  const transfer = (current: Run, automatic: boolean) => {
    if (!approvedRun(current) || current.needsSave) return;
    const plan = current.plan;
    const handoff = {
      ...emptyAnalysis(), input: current.source, script: scriptOf(current), status: 'transferred' as const,
      title: plan?.title || '', cover: plan?.cover || '', openingScene: plan?.opening || '',
      direction: [plan?.question, plan?.promise].filter(Boolean).join('\n'),
      routes: plan?.tracks.join('\n') || '', research: plan?.sourceNote || '',
      outline: [plan?.transitions, plan?.payoff, plan?.ending].filter(Boolean).join('\n'),
      parts: current.parts.map((part, i) => ({ id: String(i + 1), title: part.title, text: part.text, status: 'done' as const })),
    };
    const notice = live.current.onTransfer(handoff, automatic, Boolean(current.managerReviewId));
    save({ ...current, mode: 'transferred', notice });
  };

  useEffect(() => {
    if (!enabled || !ready || checkpointing.current) return;
    if (run.needsSave && !run.pending && !otherWork && ['running', 'passed', 'limited'].includes(run.mode)) {
      checkpointing.current = true;
      change(async current => {
        try {
          if (!current.needsSave || !['running', 'passed', 'limited'].includes(current.mode)) return;
          await live.current.onCheckpoint(current);
          save({ ...current, needsSave: false, mode: current.restoreTransferred ? 'transferred' : current.mode, restoreTransferred: undefined });
        } catch (caught) {
          const message = caught instanceof Error ? caught.message : 'lỗi máy chủ';
          save(/tác vụ khác/i.test(message) ? { ...current, notice: 'Đang xếp hàng · chờ tác vụ hiện tại trước khi lưu.' }
            : { ...current, mode: 'error', notice: 'Chưa lưu dự án: ' + message });
        } finally { checkpointing.current = false; }
      });
      return;
    }
    if (run.mode === 'passed' && !run.needsSave) { change(current => {
      if (current.mode !== 'passed' || current.needsSave) return;
      try { transfer(current, true); } catch (caught) {
        save({ ...current, mode: 'error', notice: caught instanceof Error ? caught.message : 'Chưa chuyển được kịch bản.' });
      }
    }); return; }
    if (run.mode !== 'running' || run.needsSave || run.pending || !connected || otherWork || bridgeJob) return;
    const timer = window.setTimeout(() => change(current => {
      if (current.mode !== 'running' || current.pending || current.needsSave || !live.current.connected || live.current.otherWork || live.current.bridgeJob) return;
      const legacyPending = loadAnalysis(projectId).pending;
      const transcriptPending = JSON.parse(localStorage.getItem('vis-transcript-pending-' + projectId) || 'null');
      if (transcriptPending?.expires > Date.now() || (legacyPending && legacyPending.expires > Date.now())) return;
      const id = 'transcript-' + crypto.randomUUID();
      const sectionId = `automatic-analysis:${current.phase}:${current.index + 1}`;
      save({ ...current, pending: { id, sectionId, deadline: Date.now() + 25_000 }, notice: '' });
      send('studio-transcript-ai', { pairCode: projectId, command: { id, type: 'transcript_rewrite', kind: 'rewrite', sectionId, prompt: promptFor(current) + (current.lastInvalid ? ' LƯU Ý: lần trả lời trước bị từ chối vì: ' + current.lastInvalid + ' Trả đúng JSON, evidence trích NGUYÊN VĂN từ đoạn script đã gửi của đúng phần đó, và có fix khi điểm dưới 8.' : '') } });
    }), 400);
    return () => clearTimeout(timer);
  }, [run, connected, otherWork, bridgeJob, projectId, enabled, ready, tick]);

  const readSource = () => preparedAnalysisSource(loadTranscriptWorkspace(projectId));
  const [sourceInfo, setSourceInfo] = useState(readSource);
  useEffect(() => {
    const sync = () => setSourceInfo(readSource());
    const onWorkspace = (event: Event) => { if ((event as CustomEvent).detail?.projectId === projectId) sync(); };
    sync();
    window.addEventListener('storage', sync);
    window.addEventListener('vis-transcript-workspace-updated', onWorkspace);
    return () => { window.removeEventListener('storage', sync); window.removeEventListener('vis-transcript-workspace-updated', onWorkspace); };
  }, [active, projectId]);

  useEffect(() => {
    if (!enabled || !ready || !sourceInfo.text) return;
    change(current => {
      if (current.source === sourceInfo.text || current.pending || !['idle', 'transferred', 'limited', 'error', 'stopped'].includes(current.mode)) return;
      if (current.source && current.source !== sourceInfo.text) localStorage.setItem(key + '-previous', JSON.stringify(current));
      const command = readManagerTranscript(); const pipeline = readManagerTranscriptState();
      const managerReviewId = command?.sessionId === projectId && command.rewrite && command.id === pipeline?.id ? command.id : undefined;
      save({ ...emptyRun(), runId: crypto.randomUUID(), revision: 1, needsSave: true, workEpoch,
        source: sourceInfo.text, style: sourceInfo.style, parts: sourceInfo.parts, phase: 'review', mode: 'running', managerReviewId, pipelineId: managerReviewId });
    });
  }, [sourceInfo.text, sourceInfo.style, enabled, ready, projectId, workEpoch, run.mode]);

  useEffect(() => {
    if (!enabled || !ready || !managerReview || run.managerReviewId === managerReview.id) return;
    change(current => {
      if (current.managerReviewId === managerReview.id) return;
      if (current.mode === 'running' || current.pending) { save({ ...current, managerReviewId: managerReview.id }); return; }
      const prepared = readSource();
      const workspace = loadTranscriptWorkspace(projectId);
      const source = managerReview.source === 'script' ? managerScript?.trim() : prepared.text || workspace.transcript?.text.trim();
      if (!source) return;
      if (current.mode === 'transferred' && !current.needsSave && approvedRun(current) && (source === current.source || source === scriptOf(current))) {
        save({ ...current, managerReviewId: managerReview.id }); return;
      }
      const parts = managerReview.source === 'transcript' && prepared.text ? prepared.parts : reviewPartsFromScript(source);
      if (current.parts.length) localStorage.setItem(key + '-previous', JSON.stringify(current));
      save({ ...emptyRun(), runId: crypto.randomUUID(), revision: 1, needsSave: true, workEpoch, source, style: prepared.style, parts, phase: 'review', mode: 'running', managerReviewId: managerReview.id });
    });
  }, [managerReview, managerScript, connected, otherWork, run.mode, run.pending, projectId, ready, enabled]);

  const resume = () => change(current => {
    if (!['paused', 'stopped', 'error'].includes(current.mode)) return;
    save({ ...current, workEpoch, mode: 'running', notice: '', pending: current.pending && { ...current.pending, deadline: Date.now() + 600_000 } });
    if (current.pending) send('studio-capture-result', { jobId: current.pending.id });
  });
  // A run AI MANAGER asked for carries on by itself after an error (a lost or slow ChatGPT reply): one minute later the step is sent again, up to 5 times.
  const autoResumes = useRef<Record<string, number>>({});
  useEffect(() => {
    if (!enabled || run.mode !== 'error' || !managerReview || run.managerReviewId !== managerReview.id || !connected) return;
    const used = autoResumes.current[managerReview.id] || 0;
    if (used >= 5) return;
    const timer = window.setTimeout(() => change(current => {
      if (current.mode !== 'error' || current.managerReviewId !== managerReview.id) return;
      autoResumes.current[managerReview.id] = used + 1;
      if (current.pending) send('studio-transcript-ack', { jobId: current.pending.id });
      save({ ...current, workEpoch, mode: 'running', pending: undefined, notice: 'Tự chạy tiếp sau lỗi (' + (used + 1) + '/5)' });
    }), 60_000);
    return () => clearTimeout(timer);
  }, [run.mode, run.managerReviewId, managerReview, connected, enabled]);

  const working = run.mode === 'running' || !!run.pending;
  const canResume = ['paused', 'stopped', 'error'].includes(run.mode);
  const hasCurrentReview = !working && ['missing', 'passed', 'limited', 'transferred'].includes(run.mode);
  const quality = reviewQuality(run.rows);
  const canRepairAll = run.rows.length > 0 && quality.needsWork > 0;
  const repairAll = () => change(current => {
    if (current.pending || !['missing', 'passed', 'limited', 'transferred'].includes(current.mode)) return;
    const repairParts = [...new Set(current.rows.filter(row => row.score !== null && row.score < threshold && row.part !== null)
      .map(row => row.part! - 1))].sort((a, b) => a - b);
    if (!repairParts.length) return;
    save({ ...current, phase: 'repair', mode: 'running', index: repairParts[0], repairParts,
      manualCriterion: undefined, manualBatch: true, notice: '' });
  });
  const visibleCriteria = criteriaWithSource;
  const middle = Math.ceil(visibleCriteria.length / 2);
  return <section className="workspace auto-analysis">
    <section className="panel">
      <div className="panel-heading"><FileText/><div><h1>Công thức Aprilynne</h1><p>Dự án: {projectName}</p></div></div>
      {canResume && <div className="analysis-controls"><button className="outline" onClick={resume}>Tiếp tục</button></div>}
      <p className="script-meta" role="status">{run.mode === 'running' && !run.pending ? run.needsSave ? 'Đang lưu kịch bản và kết quả vào dự án' : !connected ? 'Đang xếp hàng · chờ kết nối ChatGPT' : otherWork || bridgeJob ? 'Đang xếp hàng · chờ tác vụ ChatGPT hiện tại hoàn tất' : progress(run) : run.mode === 'idle' ? 'Đang chờ bản viết lại từ Get Transcript' : progress(run)}{run.rounds > 0 && ` · Đã sửa ${run.rounds}/${run.limit} lượt`}{run.notice && ' · ' + run.notice}</p>
      {error && <p role="alert">{error}</p>}
      {run.rows.length > 0 && <p>Điểm tham khảo dựa trên kịch bản. Các mục cần ảnh bìa hoặc video thực tế được đánh dấu riêng.</p>}
      {run.rows.length > 0 && (run.phase === 'repair' || run.phase === 'review') && ['running', 'paused', 'stopped', 'error'].includes(run.mode)
        && <p>Đang hiển thị báo cáo của lần chấm trước. Studio sẽ cập nhật sau khi chấm lại bản sửa.</p>}

      <section className="auto-quality" aria-label="Chất lượng kịch bản">
        <strong>Ngưỡng đạt {threshold}/10 · Đang đạt {quality.passed}/{criteriaWithSource.length} · {hasCurrentReview
          ? quality.needsWork ? 'Chưa đạt' : quality.unscored ? 'Đạt tiêu chí kịch bản · mục hình ảnh chờ bước sau' : 'Đạt'
          : run.rows.length ? 'Kết quả lần chấm trước' : 'Chưa chấm'}</strong>
        <meter min={0} max={criteriaWithSource.length} value={quality.passed} aria-label="Số tiêu chí đạt từ 8 điểm"/>
        {run.rows.length > 0 && <small>{quality.passed}/{criteriaWithSource.length} đạt · {quality.needsWork} cần sửa · {quality.unscored} chưa đủ dữ liệu</small>}
      </section>
      <div className="auto-review-columns">
        {[visibleCriteria.slice(0, middle), visibleCriteria.slice(middle)].map((column, index) =>
          <div className="auto-review-scroll" key={index}><table className="auto-review" aria-label={`Tiêu chí Aprilynne, bảng ${index + 1}`}>
            <thead><tr><th scope="col">Tiêu chí</th><th scope="col">Điểm / Thao tác</th></tr></thead>
            <tbody>{column.map(criterion => {
              const row = run.rows.find(item => item.id === criterion.id);
              const score = row?.score;
              return <tr key={criterion.id}>
                <th scope="row"><details><summary>{criterion.name}{criterion.timing && ' (' + criterion.timing + ')'}</summary>
                  {row ? <>{row.evidence && <blockquote>{row.evidence}</blockquote>}<p>{row.reason}</p>{row.fix && <p>{row.fix}</p>}</>
                    : <blockquote>{criterion.excerpt.replace(/^\[\d+:\d+\]\s*/gm, '')}</blockquote>}
                </details></th>
                <td>{typeof score === 'number' ? <strong className={score >= threshold ? 'score-pass' : 'score-low'}>{score.toFixed(1)}</strong>
                  : <span title={criterion.visual || score === null ? 'Chưa đủ dữ liệu' : 'Chưa chấm'}>—</span>}</td>
              </tr>;
            })}</tbody>
          </table></div>)}
      </div>
      {canRepairAll && <div className="analysis-controls">
        <button className="analyze-all split-button" disabled={working} onClick={repairAll}>Viết lại tất cả phần chưa đạt</button>
      </div>}
    </section>
  </section>;
}
