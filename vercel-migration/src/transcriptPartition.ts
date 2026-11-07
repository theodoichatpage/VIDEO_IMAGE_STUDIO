import {validateMindmapPayload,type MindmapBranch,type StoryPlan} from './transcriptWorkspace';

// These are addressable source units, not the final script parts. AI chooses
// semantic boundaries; retaining the original slices avoids retranscribing text.
export function transcriptUnits(source:string):string[]{
 if(!source.trim())return [];
 return source.match(/[\s\S]*?(?:[.!?…。！？]+[”"'’\)\]]*(?=\s|$)|\n+|$)/gu)?.filter(Boolean)||[source];
}

export function buildPartitionPrompt(source:string,language='vi'):string{
 const units=transcriptUnits(source);
 return `Chia transcript thành các phần liền mạch để viết lại lần lượt. Không tạo mindmap, không phân tích phân cảnh, không viết lại và không chép lại transcript trong câu trả lời. Chọn số phần hợp lý theo ý/sự kiện, không cố định số phần. Mỗi phần nên khoảng 2.000–4.000 ký tự nếu mạch kể cho phép; tuyệt đối không cắt giữa một ý hoặc sự kiện đang liền mạch.\nTranscript được đánh số ${units.length} đoạn nguồn. Đồng thời lập DÀN Ý cho video sẽ được viết lại từ transcript này theo công thức Aprilynne: title là tiêu đề YouTube chuẩn SEO, gây tò mò, tối đa 70 ký tự, đúng sự thật; hook là câu mở đầu khớp tiêu đề; question là câu hỏi lớn xuyên suốt; promise là lời hứa với người xem trong 20 giây đầu; tracks là hai tuyến truyện đối lập nhau về quy mô hoặc toan tính (tuyến chính và một ngoại truyện về đời tư hoặc sự kiện ít ai biết, có thật); turns là các điểm chuyển nhịp khoảng 2–4 phút một lần; payoff là phần thưởng lớn được hé lộ gần cuối; ending là kết thúc ở cao trào; sources là các sử liệu, tài liệu có thật nên dẫn để thể hiện công sức tìm hiểu; cover là ảnh bìa: nhân vật chính ở giữa, hai bên là hai kết quả đối lập. Mỗi phần có role là vai trò của phần đó trong dàn ý. Chỉ trả MỘT JSON: {"plan":{"title":"...","hook":"...","question":"...","promise":"...","tracks":["...","..."],"turns":"...","payoff":"...","ending":"...","sources":"...","cover":"..."},"branches":[{"title":"Tên ngắn của phần","end":1,"role":"vai trò trong dàn ý"}]}. end là số thứ tự đoạn nguồn CUỐI của phần, số nguyên. Phần đầu bắt đầu ở đoạn 1; mỗi phần tiếp theo bắt đầu ngay sau end của phần trước. Các end tăng dần, end cuối phải bằng ${units.length}. Bao phủ toàn bộ transcript theo đúng thứ tự. Không thêm content, summary, children hoặc giải thích. Ngôn ngữ tiêu đề: ${language}.\nTRANSCRIPT:\n${units.map((unit,i)=>`[${i+1}] ${unit}`).join('\n')}`;
}

const PLAN_FIELDS=['title','hook','question','promise','turns','payoff','ending','sources','cover'] as const;
// The outline asked for with the split; a reply without it still gives the parts (the outline is then simply missing).
export function parsePlan(value:unknown):StoryPlan|undefined{
 const root=value as {plan?:Record<string,unknown>;branches?:{role?:unknown}[]};const p=root?.plan;
 if(!p||typeof p!=='object'||typeof p.title!=='string'||!p.title.trim())return undefined;
 const text=(v:unknown)=>typeof v==='string'?v.trim().slice(0,1500):'';
 return {...Object.fromEntries(PLAN_FIELDS.map(k=>[k,text(p[k])])) as Omit<StoryPlan,'tracks'|'roles'>,
  tracks:Array.isArray(p.tracks)?p.tracks.map(text).filter(Boolean).slice(0,3):[],
  roles:Array.isArray(root.branches)?root.branches.map(b=>text(b?.role)):[]};
}
export function partitionBranches(value:unknown,source:string,units=transcriptUnits(source)):MindmapBranch[]{
 const raw=(value as {branches?:unknown})?.branches;
 if(!Array.isArray(raw)||!raw.length)throw new Error('ChatGPT chưa trả danh sách phần hợp lệ.');
 // Compatibility for a result already running before this UI update.
 if(raw.every(x=>x&&typeof x.content==='string'&&!('end' in x)))return validateMindmapPayload(value).map((part,i)=>({...part,content:raw[i].content}));
 let start=0;
 const parts=raw.map((item,index)=>{
  const end=item?.end,title=typeof item?.title==='string'?item.title.trim():'';
  if(!title||!Number.isInteger(end)||end<=start||end>units.length)throw new Error('Mốc chia phần không hợp lệ. Kịch bản gốc vẫn được giữ nguyên; hãy chia lại.');
  const content=units.slice(start,end).join('');if(!content.trim())throw new Error('Phần được chia chỉ có khoảng trắng. Hãy chia lại.');start=end;
  return{id:`part-${index+1}`,title,content,summary:content.replace(/\s+/g,' ').trim().slice(0,100),children:[]};
 });
 if(start!==units.length||parts.map(x=>x.content).join('')!==source)throw new Error('Các phần chưa bao phủ toàn bộ transcript. Chưa thay thế kết quả cũ.');
 return parts;
}
