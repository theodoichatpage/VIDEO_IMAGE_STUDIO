import {useState} from 'react';
import {loadAnalysis,saveAnalysis,type AnalysisState} from './analysisWorkspace';
import {loadTranscriptWorkspace,saveTranscriptWorkspace} from './transcriptWorkspace';
import './analysisTab.css';
type Props={projectId:string;onTransfer:(text:string)=>boolean};
export default function AnalysisTab({projectId,onTransfer}:Props){
 const [state,setState]=useState(()=>loadAnalysis(projectId));
 const [style,setStyle]=useState(()=>loadTranscriptWorkspace(projectId).stylePrompt);
 const [error,setError]=useState('');
 const patch=(value:Partial<AnalysisState>)=>{const next={...state,...value,status:'draft' as const};try{saveAnalysis(projectId,next);setState(next);setError('')}catch{setError('Không lưu được. Hãy kiểm tra dung lượng lưu trữ của trình duyệt.')}};
 const updateStyle=(value:string)=>{try{const ws=loadTranscriptWorkspace(projectId);saveTranscriptWorkspace(projectId,{...ws,stylePrompt:value});localStorage.setItem('vis-transcript-style',value);setStyle(value);setError('')}catch{setError('Không lưu được phong cách viết.')}};
 const getTranscript=()=>{const text=loadTranscriptWorkspace(projectId).transcript?.text||'';if(!text){setError('Chưa có transcript trong dự án. Hãy lấy transcript ở tab Get Transcript.');return}if((state.input||state.script)&&!window.confirm('Thao tác này thay nội dung đầu vào và bản thảo trong tab Phân tích. Tiếp tục?'))return;patch({source:'transcript',input:text,script:text})};
 const transfer=()=>{if(onTransfer(state.script)){const next={...state,status:'transferred' as const};try{saveAnalysis(projectId,next);setState(next)}catch{setError('Không lưu được trạng thái chuyển.')}}};
 return <section className="analysis-foundation"><h1>Phân tích nội dung</h1><p>Chuẩn bị nội dung và kịch bản cho dự án đang chọn.</p>
 <div className="analysis-card"><label>Nguồn nội dung<select value={state.source} onChange={e=>patch({source:e.target.value as AnalysisState['source']})}><option value="transcript">Transcript từ Get Transcript</option><option value="script">Kịch bản tự nhập</option><option value="topic">Chủ đề mới</option></select></label>
 {state.source==='transcript'&&<button type="button" onClick={getTranscript}>Lấy transcript của dự án</button>}
 <label>{state.source==='topic'?'Chủ đề':'Nội dung đầu vào'}<textarea value={state.input} onChange={e=>patch({input:e.target.value})} placeholder="Nhập hoặc dán nội dung..."/></label>
 {state.source==='script'&&<label>Cách xử lý<select value={state.mode} onChange={e=>patch({mode:e.target.value as AnalysisState['mode']})}><option value="keep">Giữ nguyên và chuyển sang Phân tách</option><option value="review">Kiểm tra và đưa gợi ý</option><option value="rewrite">Viết lại hoặc xây dựng lại</option></select></label>}
 <label>Yêu cầu bổ sung<textarea value={state.requirements} onChange={e=>patch({requirements:e.target.value})}/></label>
 <label>Phong cách viết cá nhân<textarea value={style} onChange={e=>updateStyle(e.target.value)} placeholder="Phong cách dùng chung với Get Transcript"/></label>
 <label>Kịch bản đang chỉnh sửa<textarea value={state.script} onChange={e=>patch({script:e.target.value})} placeholder="Nhập hoặc dán kịch bản hoàn chỉnh tại đây..."/></label>
 {state.source==='script'&&<button type="button" onClick={()=>{if(state.script&&state.script!==state.input&&!confirm('Thay bản thảo đang chỉnh sửa bằng nội dung đầu vào?'))return;patch({script:state.input})}}>Đưa nội dung đầu vào vào bản thảo</button>}
 {(state.source==='topic'||(state.source==='script'&&state.mode!=='keep'))&&<p>Chức năng tự động kiểm tra và viết lại sẽ được bổ sung sau. Bạn có thể chỉnh sửa bản thảo thủ công.</p>}
 <button className="analyze-all" type="button" disabled={!state.script.trim()} onClick={transfer}>Chuyển kịch bản sang Phân tách →</button><p>Trạng thái: {state.status==='transferred'?'Đã chuyển':'Đang chuẩn bị'}</p>{error&&<p role="alert">{error}</p>}</div></section>
}
