import {validateMindmapPayload,type MindmapBranch} from './transcriptWorkspace';

// These are addressable source units, not the final script parts. AI chooses
// semantic boundaries; retaining the original slices avoids retranscribing text.
export function transcriptUnits(source:string):string[]{
 if(!source.trim())return [];
 return source.match(/[\s\S]*?(?:[.!?…。！？]+[”"'’\)\]]*(?=\s|$)|\n+|$)/gu)?.filter(Boolean)||[source];
}

export function buildPartitionPrompt(source:string,language='vi'):string{
 const units=transcriptUnits(source);
 return `Chia transcript thành các phần liền mạch để viết lại lần lượt. Không tạo mindmap, không phân tích phân cảnh, không viết lại và không chép lại transcript trong câu trả lời. Chọn số phần hợp lý theo ý/sự kiện, không cố định số phần. Mỗi phần nên khoảng 2.000–4.000 ký tự nếu mạch kể cho phép; tuyệt đối không cắt giữa một ý hoặc sự kiện đang liền mạch.\nTranscript được đánh số ${units.length} đoạn nguồn. Chỉ trả MỘT JSON: {"branches":[{"title":"Tên ngắn của phần","end":1}]}. end là số thứ tự đoạn nguồn CUỐI của phần, số nguyên. Phần đầu bắt đầu ở đoạn 1; mỗi phần tiếp theo bắt đầu ngay sau end của phần trước. Các end tăng dần, end cuối phải bằng ${units.length}. Bao phủ toàn bộ transcript theo đúng thứ tự. Không thêm content, summary, children hoặc giải thích. Ngôn ngữ tiêu đề: ${language}.\nTRANSCRIPT:\n${units.map((unit,i)=>`[${i+1}] ${unit}`).join('\n')}`;
}

export function partitionBranches(value:unknown,source:string):MindmapBranch[]{
 const raw=(value as {branches?:unknown})?.branches;
 if(!Array.isArray(raw)||!raw.length)throw new Error('ChatGPT chưa trả danh sách phần hợp lệ.');
 // Compatibility for a result already running before this UI update.
 if(raw.every(x=>x&&typeof x.content==='string'&&!('end' in x)))return validateMindmapPayload(value).map((part,i)=>({...part,content:raw[i].content}));
 const units=transcriptUnits(source);let start=0;
 const parts=raw.map((item,index)=>{
  const end=item?.end,title=typeof item?.title==='string'?item.title.trim():'';
  if(!title||!Number.isInteger(end)||end<=start||end>units.length)throw new Error('Mốc chia phần không hợp lệ. Kịch bản gốc vẫn được giữ nguyên; hãy chia lại.');
  const content=units.slice(start,end).join('');if(!content.trim())throw new Error('Phần được chia chỉ có khoảng trắng. Hãy chia lại.');start=end;
  return{id:`part-${index+1}`,title,content,summary:content.replace(/\s+/g,' ').trim().slice(0,100),children:[]};
 });
 if(start!==units.length||parts.map(x=>x.content).join('')!==source)throw new Error('Các phần chưa bao phủ toàn bộ transcript. Chưa thay thế kết quả cũ.');
 return parts;
}
