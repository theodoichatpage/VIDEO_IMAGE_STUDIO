import { createRoot } from 'react-dom/client';
import { useEffect, useState } from 'react';
import AnalysisTab from './AnalysisTab';
import { readAprilinne, type AprilinneReport } from './aprilinneData';

// Trang xem thử khi phát triển: đọc demo-local/<tên>.json (do `python -m aprilinne studio <tên>` xuất) và hiện thẻ Phân tích.
function Preview() {
  const name = new URLSearchParams(location.search).get('du_lieu') || 'le_loi';
  const [report, setReport] = useState<AprilinneReport | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    fetch('/demo-local/' + name + '.json').then(r => r.json()).then(d => setReport(readAprilinne(d))).catch(e => setError(String(e)));
  }, [name]);
  if (error) return <p>Không đọc được demo-local/{name}.json: {error}</p>;
  if (!report) return <p>Đang tải…</p>;
  return <div className="app" style={{ flex: 1, display: 'flex', minWidth: 0 }}>
    <AnalysisTab projectId="preview" projectName={'Xem thử — ' + report.ten} active managerStory={null} aprilinne={report} onTransfer={() => ''}/>
  </div>;
}
createRoot(document.getElementById('root')!).render(<Preview/>);
