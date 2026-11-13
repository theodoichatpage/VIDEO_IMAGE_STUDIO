import { FileText } from 'lucide-react';
import { useEffect, useState } from 'react';
import { emptyAnalysis } from './analysisWorkspace';
import { loadTranscriptWorkspace, preparedAnalysisSource } from './transcriptWorkspace';
import { criteriaWithSource, managerStoryStatus, readAnalysisRun, reviewQuality, type ManagerStory } from './automaticAnalysis';
import './analysisTab.css';

// One route: AI MANAGER runs the Aprilynne line (outline → rewrite in the saved style → grade → rewrite what is weak → grade;
// approved at 8 of 12 criteria scoring 8). This tab only shows it; Studio grades nothing on its own.
type Props = {
  projectId: string; projectName: string; active: boolean;
  managerStory?: ManagerStory | null;
  onTransfer: (draft: ReturnType<typeof emptyAnalysis>, automatic: boolean, managed?: boolean) => string;
};

const CLEAN_LABELS: Record<string, string> = { note: 'ghi chú biên tập trong lời đọc', greeting: 'lời chào lặp', lets_go: '"Vào video thôi" lặp', call: 'kêu gọi đăng ký ở giữa', duplicate: 'câu lặp', retold: 'đoạn kể lại', catchphrase: 'câu cửa miệng quá nhiều', hedge: 'câu rào đón lặp', opening: 'phần mở lại bằng "Các bác ạ"', questions: 'quá nhiều câu hỏi' };
const send = (type: string, data = {}) => window.postMessage({ source: 'vis-web', type, ...data }, location.origin);

export default function AnalysisTab({ projectId, projectName, active, managerStory, onTransfer }: Props) {
  // A review this tab ran before (older Studio) may still be marked running with a ChatGPT job: stop it once so nothing waits on it.
  useEffect(() => {
    const key = 'vis-automatic-analysis-v2-' + projectId;
    const old = readAnalysisRun(projectId);
    if (!old || !(old.mode === 'running' || old.pending)) return;
    if (old.pending?.id) send('studio-transcript-ack', { jobId: old.pending.id });
    try { localStorage.setItem(key, JSON.stringify({ ...old, mode: 'stopped', pending: undefined, notice: 'AI MANAGER chạy phần chấm Aprilynne' })); } catch { /* storage full: nothing else depends on it */ }
  }, [projectId]);

  const [prepared, setPrepared] = useState(() => preparedAnalysisSource(loadTranscriptWorkspace(projectId)));
  useEffect(() => { setPrepared(preparedAnalysisSource(loadTranscriptWorkspace(projectId))); }, [projectId, active]);
  const [notice, setNotice] = useState('');
  const transfer = () => {
    if (!prepared.text) return;
    const draft = { ...emptyAnalysis(), input: prepared.text, script: prepared.text, status: 'transferred' as const,
      parts: prepared.parts.map((part, i) => ({ id: String(i + 1), title: part.title, text: part.text, status: 'done' as const })) };
    try { setNotice(onTransfer(draft, false)); } catch (caught) { setNotice(caught instanceof Error ? caught.message : 'Chưa chuyển được kịch bản.'); }
  };

  const story = managerStory;
  const gradable = criteriaWithSource.filter(c => !c.visual).length;
  const quality = reviewQuality(story?.rows || []);
  const middle = Math.ceil(criteriaWithSource.length / 2);
  return <section className="workspace auto-analysis">
    <section className="panel">
      <div className="panel-heading"><FileText/><div><h1>Công thức Aprilynne</h1><p>Dự án: {projectName}</p></div></div>
      {story ? <>
        <p className="script-meta" role="status">{managerStoryStatus(story)}{story.error && ['plan', 'write', 'review', 'repair'].includes(story.stage) ? ' · lần trước: ' + story.error : ''}</p>
        {story.title && <p>Tiêu đề: {story.title} · {story.sections} phần</p>}
        {story.history.length > 0 && <p>Điểm qua các lượt chấm: {story.history.map(h => h.passed + '/' + gradable).join(' → ')}</p>}
        <p>Kiểm tra liền mạch bằng máy: {story.clean.length ? <strong className="score-low">{story.clean.length} lỗi · {Object.entries(story.clean.reduce<Record<string, number>>((a, x) => ({ ...a, [x.kind]: (a[x.kind] || 0) + 1 }), {})).map(([k, n]) => (CLEAN_LABELS[k] || k) + ' ' + n).join(', ')}</strong> : <strong className="score-pass">sạch</strong>} · duyệt cần sạch và đạt {story.needed}/{gradable}</p>
        {story.clean.length > 0 && <details><summary>Chi tiết lỗi liền mạch</summary><ul>{story.clean.map((x, i) => <li key={i}>Phần {x.part}: {x.detail}</li>)}</ul></details>}
        {story.facts.length > 0 && <details><summary>Khẳng định cần sửa cho đúng sự thật ({story.facts.length})</summary><ul>{story.facts.map((x, i) => <li key={i}>{x.part ? 'Phần ' + x.part + ': ' : ''}{x.claim} → {x.fix}</li>)}</ul></details>}
        {story.notes.length > 0 && <details><summary>Ghi chú biên tập đã gỡ khỏi lời đọc ({story.notes.length})</summary><ul>{story.notes.map((x, i) => <li key={i}>{x.part ? 'Phần ' + x.part + ': ' : ''}{x.note}</li>)}</ul></details>}
        <section className="auto-quality" aria-label="Chất lượng kịch bản">
          <strong>Duyệt khi {story.needed}/{gradable} tiêu chí đạt từ {story.threshold} điểm · Đang đạt {quality.passed}/{gradable} · {story.rows.length
            ? quality.passed >= story.needed ? 'Đã duyệt' : 'Chưa đạt, đang viết lại phần chưa chặt' : 'Chưa chấm'}</strong>
          <meter min={0} max={gradable} value={quality.passed} aria-label="Số tiêu chí đạt từ 8 điểm"/>
          {story.rows.length > 0 && <small>{quality.passed}/{gradable} đạt · {quality.needsWork} dưới 8 · {quality.unscored} mục chờ ảnh bìa/bản dựng (chấm ở bước sau)</small>}
        </section>
      </> : <>
        <p className="script-meta" role="status">Phần chấm Aprilynne do AI MANAGER chạy (dàn ý → viết lại theo văn phong → chấm → viết lại phần chưa chặt → chấm lại). Dự án này chưa có kết quả từ AI MANAGER.</p>
        {prepared.text && <div className="analysis-controls">
          <button className="outline" onClick={transfer}>Chuyển kịch bản đã viết lại sang Phân tách (không chấm)</button>
        </div>}
        {notice && <p role="status">{notice}</p>}
      </>}
      <div className="auto-review-columns">
        {[criteriaWithSource.slice(0, middle), criteriaWithSource.slice(middle)].map((column, index) =>
          <div className="auto-review-scroll" key={index}><table className="auto-review" aria-label={`Tiêu chí Aprilynne, bảng ${index + 1}`}>
            <thead><tr><th scope="col">Tiêu chí</th><th scope="col">Điểm</th></tr></thead>
            <tbody>{column.map(criterion => {
              const row = story?.rows.find(item => item.id === criterion.id);
              const score = row?.score;
              return <tr key={criterion.id}>
                <th scope="row"><details><summary>{criterion.name}{criterion.timing && ' (' + criterion.timing + ')'}</summary>
                  {row ? <>{row.evidence && <blockquote>{row.evidence}</blockquote>}<p>{row.reason}</p>{row.fix && <p>Cách sửa{row.part ? ' (phần ' + row.part + ')' : ''}: {row.fix}</p>}
                    {(story?.findings || []).filter(f => f.id === row.id).map((f, i) => <p key={i}>Cũng cần sửa phần {f.part} ({f.score?.toFixed(1)}): {f.fix}</p>)}</>
                    : <blockquote>{criterion.excerpt.replace(/^\[\d+:\d+\]\s*/gm, '')}</blockquote>}
                </details></th>
                <td>{typeof score === 'number' ? <strong className={score >= (story?.threshold ?? 8) ? 'score-pass' : 'score-low'}>{score.toFixed(1)}</strong>
                  : <span title={criterion.visual ? 'Chấm ở bước ảnh bìa/bản dựng' : 'Chưa chấm'}>—</span>}</td>
              </tr>;
            })}</tbody>
          </table></div>)}
      </div>
    </section>
  </section>;
}
