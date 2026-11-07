import type { MindmapBranch, ScriptSection, StoryPlan } from './transcriptWorkspace';
export const buildMindmapPrompt=(transcript:string,language='vi')=>`Bạn là biên tập viên kịch bản. Phân tích transcript sau thành mindmap nội dung theo đúng thứ tự kể chuyện. Chỉ trả MỘT JSON hợp lệ, không markdown, dạng {"branches":[{"id":"1","title":"Tên phần","summary":"Tóm tắt","content":"Nguyên văn transcript thuộc phần","children":[{"id":"1.1","title":"Ý nhỏ"}]}]}. Mỗi đoạn transcript chỉ thuộc đúng một branch, không bỏ sót, không trùng lặp. Ngôn ngữ: ${language}. TRANSCRIPT:\n${transcript}`;
// Fixed channel rules, kept in code so many videos come out the same way.
export const CALL_TO_ACTION='Lời kêu gọi theo giọng của kênh, tự nhiên như nói với bạn bè, ví dụ: "Nếu đây là lần đầu bạn xem video của kênh, hãy bấm theo dõi và thích video để cùng đồng hành khám phá những câu chuyện lịch sử thú vị".';
const roleRules=(index:number,total:number)=>[
 index===0?'Đây là PHẦN MỞ ĐẦU: câu đầu tiên chính là hook, khớp với tiêu đề; trong 20 giây đầu nêu bối cảnh, câu hỏi lớn, cái giá hoặc phần thưởng và lời hứa; sau đoạn mở đầu chèn một '+CALL_TO_ACTION:'',
 index===total-1?'Đây là PHẦN KẾT: hé lộ phần thưởng lớn, kết thúc ở cao trào, rồi kết bằng một '+CALL_TO_ACTION+' và mời bình luận.':'',
 index>0&&index<total-1?'Giữ nhịp: mở phần bằng một điểm chuyển hoặc câu hỏi mới, kết phần bằng một móc nối sang phần sau.':'',
].filter(Boolean).join(' ');
export const buildRewritePrompt=(section:ScriptSection,stylePrompt:string,context='',plan?:StoryPlan,index=0,total=1)=>{
 const length=section.sourceText.length;
 const outline=plan?`\nDÀN Ý APRILYNNE CỦA CẢ VIDEO (viết đúng vai trò của phần này trong dàn ý):\n${JSON.stringify({title:plan.title,hook:plan.hook,question:plan.question,promise:plan.promise,tracks:plan.tracks,turns:plan.turns,payoff:plan.payoff,ending:plan.ending,sources:plan.sources})}\nVAI TRÒ PHẦN NÀY (${index+1}/${total}): ${plan.roles[index]||'tiếp nối mạch kể'}\n${roleRules(index,total)}\nĐan xen hai tuyến truyện khi phần này có chất liệu; khi nói tới sử liệu thì kể công tìm hiểu bằng giọng tâm sự, chỉ dẫn nguồn có thật.`:'';
 return `Bạn là biên tập viên viết lại kịch bản YouTube. Chỉ viết lại PHẦN HIỆN TẠI, không viết các phần khác. Giữ đủ sự kiện và ý nghĩa, không bịa dữ kiện.\nĐỘ DÀI: khoảng ${Math.round(length*0.9)}–${Math.round(length*1.3)} ký tự, gần bằng phần nguồn; không kéo dài, cắt chi tiết thừa và đoạn gây chán.\nPHONG CÁCH CÁ NHÂN:\n${stylePrompt}${outline}\nNGỮ CẢNH LIÊN KẾT NGẮN:\n${context}\nPHẦN HIỆN TẠI - ${section.title}:\n${section.sourceText}\nChỉ trả nội dung kịch bản đã viết lại, không markdown.`;
};
export const mindmapCommand=(transcript:string,language?:string)=>({kind:'transcript-mindmap',prompt:buildMindmapPrompt(transcript,language)});
export const rewriteCommand=(section:ScriptSection,style:string,context?:string)=>({kind:'transcript-rewrite',sectionId:section.id,prompt:buildRewritePrompt(section,style,context)});
export type PendingTranscriptAi={kind:'mindmap'|'rewrite';sectionId?:string;previousBranches?:MindmapBranch[]};
