import { useEffect, useMemo, useRef, useState } from 'react';
import { defaultRound, findQuote, minutes, roundSummary, stepLabel, type AprilinneReport, type Criterion, type GradedRound, type Line } from './aprilinneData';
import './aprilinneReview.css';

// Thẻ Phân tích, chế độ Video dài: kịch bản Claude viết (tô màu theo tuyến A/B) đặt cạnh bảng điểm của người chấm độc lập.
// Bấm vào một câu trích là kịch bản cuộn tới đúng đoạn đó.

const LINE_LABEL: Record<Line, string> = { A: 'Tuyến A', B: 'Tuyến B', C: 'Chung' };

function Scorecard({ round, onQuote }: { round: GradedRound; onQuote: (pos: [number, number], quote: string) => void }) {
  const [open, setOpen] = useState<string | null>(() => round.tieu_chi.find(c => !c.dat)?.ma ?? null);
  useEffect(() => { setOpen(round.tieu_chi.find(c => !c.dat)?.ma ?? null); }, [round]);
  const row = (c: Criterion) => <li key={c.ma} className={'apl-crit' + (c.dat ? '' : ' fail') + (open === c.ma ? ' open' : '')}>
    <button className="apl-crit-head" onClick={() => setOpen(open === c.ma ? null : c.ma)} aria-expanded={open === c.ma}>
      <span className="apl-code">{c.ma}</span>
      <span className="apl-name">{c.ten}</span>
      <span className="apl-score" title={c.gioi_han != null ? `Người chấm cho ${c.diem_cham}, máy giới hạn ${c.gioi_han}` : `Người chấm cho ${c.diem_cham}`}>
        <strong>{c.diem}</strong>/10{c.gioi_han != null && <small> (chấm {c.diem_cham})</small>}
      </span>
      <span className={'apl-pill ' + (c.dat ? 'ok' : 'bad')}>{c.dat ? 'đạt' : 'trượt'} · cần {c.can}</span>
    </button>
    {open === c.ma && <div className="apl-crit-body">
      {c.vi_sao_gioi_han.map((w, i) => <p key={i} className="apl-cap">Máy giới hạn: {w}</p>)}
      {c.ly_do && <p>{c.ly_do}</p>}
      {c.bang_chung.length > 0 && <ul className="apl-evidence">{c.bang_chung.map((e, i) =>
        <li key={i}><button disabled={!e.vi_tri} onClick={() => e.vi_tri && onQuote(e.vi_tri, e.trich)} title="Xem trong kịch bản">
          <small>Hồi {e.hoi}</small> “{e.trich}”</button></li>)}</ul>}
      {c.cach_sua && <p className="apl-fix"><strong>Cách sửa:</strong> {c.cach_sua}</p>}
    </div>}
  </li>;
  const core = round.tieu_chi.filter(c => c.ma.startsWith('T'));
  const support = round.tieu_chi.filter(c => !c.ma.startsWith('T'));
  return <div className="apl-score-card">
    <h3>Trụ cột <small>(trượt một là không duyệt)</small></h3>
    <ul>{core.map(row)}</ul>
    <h3>Hỗ trợ</h3>
    <ul>{support.map(row)}</ul>
  </div>;
}

function Script({ round, focus }: { round: GradedRound; focus: { pos: [number, number]; quote: string; at: number } | null }) {
  const box = useRef<HTMLDivElement>(null);
  const [filter, setFilter] = useState<'all' | Line>('all');
  useEffect(() => {
    if (!focus || !box.current) return;
    const el = box.current.querySelector<HTMLElement>(`[data-pos="${focus.pos[0]}-${focus.pos[1]}"]`);
    if (el) { setFilter('all'); el.scrollIntoView({ block: 'center', behavior: 'smooth' }); }
  }, [focus]);
  return <div className="apl-script">
    <div className="apl-script-bar">
      <strong>Kịch bản</strong>
      <span className="apl-legend">{(['A', 'B', 'C'] as Line[]).map(l =>
        <button key={l} className={'line-' + l + (filter === l ? ' on' : '')} onClick={() => setFilter(filter === l ? 'all' : l)}>{LINE_LABEL[l]}</button>)}</span>
    </div>
    <div className="apl-script-body" ref={box}>
      {round.kich_ban.map(act => <section key={act.so} className="apl-act">
        <h4>Hồi {act.so}{act.ten && ' — ' + act.ten}</h4>
        {act.doan.map((p, i) => {
          const pos = `${act.so}-${i}`;
          const hit = focus && focus.pos[0] === act.so && focus.pos[1] === i;
          if (p.loai === 'hinh') return <p key={i} data-pos={pos} className="apl-image">{p.text}</p>;
          const line = p.tuyen || 'C';
          const dim = filter !== 'all' && filter !== line;
          let body: React.ReactNode = p.text;
          if (hit) {
            const span = findQuote(p.text, focus!.quote);
            if (span) body = <>{p.text.slice(0, span[0])}<mark>{p.text.slice(span[0], span[1])}</mark>{p.text.slice(span[1])}</>;
          }
          return <p key={hit ? i + '-' + focus!.at : i} data-pos={pos} className={'apl-para line-' + line + (hit ? ' hit' : '') + (dim ? ' dim' : '')}
            title={LINE_LABEL[line] + (p.tron ? ' (đoạn có đổi tuyến ở giữa)' : '')}>{body}</p>;
        })}
      </section>)}
    </div>
  </div>;
}

function LongVideo({ report }: { report: AprilinneReport }) {
  const [vong, setVong] = useState<number | null>(() => defaultRound(report)?.vong ?? null);
  useEffect(() => { setVong(v => report.vong_cham.some(r => r.vong === v) ? v : defaultRound(report)?.vong ?? null); }, [report]);
  const round = useMemo(() => report.vong_cham.find(r => r.vong === vong) || defaultRound(report), [report, vong]);
  const [focus, setFocus] = useState<{ pos: [number, number]; quote: string; at: number } | null>(null);
  if (!round) return <p className="script-meta" role="status">{stepLabel(report)} · chưa có vòng chấm nào.</p>;
  const m = round.do_dac;
  return <div className="apl-long">
    <div className="apl-status">
      <span className={'apl-verdict ' + (round.duyet ? 'ok' : 'bad')}>{round.duyet ? 'DUYỆT' : 'CHƯA ĐẠT'}</span>
      <span className="apl-rounds" role="tablist" aria-label="Vòng chấm">{report.vong_cham.map(r =>
        <button key={r.vong} role="tab" aria-selected={r.vong === round.vong} className={(r.vong === round.vong ? 'on ' : '') + (r.duyet ? 'ok' : 'bad')} onClick={() => setVong(r.vong)}>
          Vòng {r.vong}{r.vong === report.tot_nhat ? ' ★' : ''} · {roundSummary(r)}</button>)}</span>
      <span className="apl-step">{stepLabel(report)}</span>
    </div>
    {round.loi_chan.length > 0 && <p role="alert">Lỗi chặn: {round.loi_chan.join('; ')}</p>}
    <div className="apl-metrics">
      <span><strong>{m.so_chu.toLocaleString('vi')}</strong> chữ ≈ {minutes(m.so_chu)} phút</span>
      <span><strong>{m.so_hoi}</strong> hồi</span>
      <span>Tuyến B <strong>{Math.round(m.ty_le_B * 100)}%</strong></span>
      <span>Đổi tuyến <strong>{m.so_lan_chuyen_tuyen}</strong> lần</span>
      {m.doan_lien_dai_nhat && <span>Đoạn liền dài nhất <strong>{m.doan_lien_dai_nhat.chu}</strong> chữ (tuyến {m.doan_lien_dai_nhat.tuyen})</span>}
      {m.hoi_co_keu_goi && <span>Kêu gọi ở hồi <strong>{m.hoi_co_keu_goi.join(', ') || '—'}</strong></span>}
    </div>
    <div className="apl-grid">
      <aside className="apl-side">
        <div className="apl-lines">
          <p className="line-A"><strong>Tuyến A</strong> {round.tuyen.A || '—'}</p>
          <p className="line-B"><strong>Tuyến B</strong> {round.tuyen.B || '—'}</p>
          {round.tuyen.doi_luc && <p className="apl-muted"><strong>Đối lực:</strong> {round.tuyen.doi_luc}</p>}
        </div>
        <Scorecard round={round} onQuote={(pos, quote) => setFocus({ pos, quote, at: Date.now() })}/>
        <details className="apl-acts" open>
          <summary>Hai tuyến theo từng hồi</summary>
          <table><thead><tr><th>Hồi</th><th>Tỷ lệ A / B</th><th>Chữ</th><th title="Ngoại truyện nằm trong tuyến B">NT</th></tr></thead>
            <tbody>{round.hoi_bang.map(h => <tr key={h.hoi}>
              <td>{h.hoi}</td>
              <td><span className="apl-bar" title={`A ${h.A} chữ · B ${h.B} chữ`}><i className="line-A" style={{ flex: h.A || 0.001 }}/><i className="line-B" style={{ flex: h.B || 0.001 }}/><i className="line-C" style={{ flex: Math.max(0, h.chu - h.A - h.B) || 0.001 }}/></span></td>
              <td>{h.chu}</td><td>{h.ngoai_truyen ? '✓' : '—'}</td></tr>)}</tbody></table>
        </details>
        {round.su_that.length > 0 && <details className="apl-facts">
          <summary>Ghi chú sự thật ({round.su_that.length}) · không chặn duyệt</summary>
          <ul>{round.su_that.map((f, i) => <li key={i}>“{f.trich}” — {f.ghi_chu}</li>)}</ul>
        </details>}
        {round.khong_tim_thay.length > 0 && <details className="apl-facts">
          <summary>Câu trích người chấm đưa sai, đã loại ({round.khong_tim_thay.length})</summary>
          <ul>{round.khong_tim_thay.map((f, i) => <li key={i}>[{f.muc}] “{f.trich}”</li>)}</ul>
        </details>}
      </aside>
      <Script round={round} focus={focus}/>
    </div>
  </div>;
}

export default function AprilinneReview({ report, projectName }: { report: AprilinneReport; projectName: string }) {
  const [mode, setMode] = useState<'video_dai' | 'series'>(report.che_do);
  useEffect(() => setMode(report.che_do), [report.che_do]);
  return <section className="workspace auto-analysis apl">
    <section className="panel">
      <div className="apl-head">
        <div><h1>Kịch bản Aprilinne <small>Claude viết · Claude chấm độc lập</small></h1><p>Dự án: {projectName}</p></div>
        <div className="apl-modes" role="tablist" aria-label="Chế độ">
          {(['video_dai', 'series'] as const).map(m => <button key={m} role="tab" aria-selected={mode === m} className={mode === m ? 'on' : ''} onClick={() => setMode(m)}>
            {m === 'video_dai' ? 'Video dài' : 'Series'}{report.che_do === m ? ' · dự án này' : ''}</button>)}
        </div>
      </div>
      {mode === report.che_do
        ? mode === 'video_dai' ? <LongVideo report={report}/> : <p className="script-meta" role="status">Giao diện Series đang làm. {stepLabel(report)}.</p>
        : <p className="script-meta" role="status">Dự án này chạy chế độ {report.che_do === 'video_dai' ? 'Video dài' : 'Series'}. Chế độ được chọn khi tạo dự án trên AI MANAGER.</p>}
    </section>
  </section>;
}
