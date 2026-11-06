import original from './aprilynne-transcript.txt?raw';
import type {AnalysisState} from './analysisWorkspace';
export const originalTranscript=original;
export const criteria=[
 {name:'Câu đầu khớp tiêu đề',start:'0:52',end:'0:57'},
 {name:'Cảnh đầu khớp ảnh bìa',start:'0:54',end:'0:57'},
 {name:'Bối cảnh mở đầu',start:'2:33',end:'2:48'},
 {name:'Phần thưởng hoặc cái giá phải trả',start:'2:40',end:'2:48'},
 {name:'Khoảng trống tò mò',start:'2:45',end:'2:48'},
 {name:'Đáp ứng rồi vượt kỳ vọng',start:'3:34',end:'3:56'},
 {name:'Thể hiện công sức thực tế',start:'5:05',end:'5:37'},
 {name:'Bắt đầu nội dung chính sớm',start:'6:18',end:'7:03'},
 {name:'Đa dạng hình ảnh',start:'7:16',end:'7:35'},
 {name:'Tương phản',start:'8:47',end:'9:32'},
 {name:'Luân phiên nhịp độ và năng lượng',start:'10:20',end:'11:19'},
 {name:'Phần thưởng lớn và kết thúc cao trào',start:'11:57',end:'12:06'},
 {name:'Kiểm tra và cắt đoạn gây chán',start:'13:36',end:'14:04'},
];
const sec=(value:string)=>{const [m,s]=value.split(':').map(Number);return m*60+s};
export function originalExcerpt(start:string,end:string){return original.split('\n').filter(line=>{const m=line.match(/^\[(\d+:\d+)\]/);return m&&sec(m[1])>=sec(start)&&sec(m[1])<sec(end)}).join('\n')}
export type Stage='research'|'directions'|'routes'|'outline'|'write'|'review';
export function makeAnalysisPrompt(stage:Stage,s:AnalysisState,style:string,part=''){
 const instructions:Record<Stage,string>={research:'Nghiên cứu nếu phiên ChatGPT có tìm web. Liệt kê thông tin đầu vào, phát hiện có nguồn và URL thật, điểm chưa xác minh, mâu thuẫn; không bịa nguồn. Nếu không tìm web được, nói rõ.',directions:'Đề xuất 3 hướng, mỗi hướng có góc kể, tiêu đề, mô tả ảnh bìa, kỳ vọng, câu đầu, cảnh đầu, câu hỏi chính, phần vượt kỳ vọng và điểm cần kiểm chứng.',routes:'Đề xuất hai tuyến có liên hệ: tuyến A, B, tương phản, liên hệ, câu hỏi, điểm giao và cách giải đáp. Nếu thiếu căn cứ hãy nói rõ, không bịa nhân vật.',outline:'Lập dàn ý linh hoạt theo độ dài, có mở đầu, lời hứa, hai tuyến, điểm giao, câu hỏi mở và giải đáp, nguồn, kết và độ dài từng phần. Không cố định số phần.',write:`Viết riêng phần sau: ${part}. Không coi đây là video độc lập; nối với các phần đã viết, giữ nhất quán lời hứa, hai tuyến và dữ kiện. Chỉ trả văn bản của phần này.`,review:'Đối chiếu toàn video với 13 tiêu chí theo đúng thứ tự từ 0 đến 12. Chỉ trả JSON dạng {\"rows\":[{\"criterion\":0,\"status\":\"Phù hợp\",\"evidence\":\"trích nguyên văn kịch bản\",\"reason\":\"lý do\",\"suggestion\":\"gợi ý\"}]}. Status chỉ được là Phù hợp, Cần xem lại, Chưa thấy, Chưa đủ dữ liệu. Không có ảnh bìa hay cảnh đầu thì báo Chưa đủ dữ liệu. Không tự sửa kịch bản.'};
 return `Bạn là biên tập viên YouTube. ${instructions[stage]}\nKhông bịa dữ kiện, nguồn, URL, quyền sử dụng hoặc công sức nghiên cứu. Phân biệt nguồn đầu vào, tìm được và chưa xác minh. Thời lượng chỉ là ước tính; không hứa tỷ lệ giữ chân. Áp dụng tiêu chí sau linh hoạt, không coi các mốc thời gian là bảo đảm:\n${criteria.map(x=>`- ${x.name} (${x.start}–${x.end})`).join('\n')}\nCác tuyến tương phản là hướng vận dụng của Studio, không phải nguyên văn Aprilynne. Ảnh AI và tư liệu thật phải phân biệt; ghi nguồn không đồng nghĩa có quyền sử dụng.\nĐẦU VÀO (${s.source}):\n${s.input}\nYÊU CẦU: ${s.requirements}\nĐỘ DÀI DỰ KIẾN: ${s.duration}\nPHONG CÁCH CÁ NHÂN: ${style}\nNGHIÊN CỨU VÀ NGUỒN: ${s.research}\nTIÊU ĐỀ: ${s.title}\nẢNH BÌA: ${s.cover}\nCẢNH ĐẦU: ${s.openingScene}\nHƯỚNG ĐÃ CHỌN: ${s.direction}\nHAI TUYẾN: ${s.routes}\nDÀN Ý: ${s.outline}\nKỊCH BẢN ĐANG CÓ: ${s.script}\nCÁC PHẦN ĐÃ VIẾT: ${s.parts.filter(x=>x.status==='done').map(x=>x.title+'\n'+x.text).join('\n\n')}\n${stage==='write'?'Không lặp lại phần đã viết.':''}`;
}
