// Kết quả Aprilinne (Claude viết + Claude chấm) mà AI MANAGER gửi sang qua storyReview khi engine = 'aprilinne'.
// Dữ liệu do công cụ CAU_TRUC_APRILINNE xuất (aprilinne/studio.py): mỗi vòng chấm có kịch bản chia hồi → đoạn
// (đoạn gắn tuyến A/B/chung) và bảng điểm đã qua máy kiểm, câu trích gắn sẵn vị trí [hồi, đoạn].

export type Line = 'A' | 'B' | 'C';
export type Paragraph = { text: string; loai: 'loi' | 'hinh'; tuyen: Line | null; tron?: boolean };
export type Act = { so: number; ten: string; doan: Paragraph[] };
export type Evidence = { hoi: number; trich: string; vi_tri: [number, number] | null };
export type Criterion = {
  ma: string; ten: string; diem_cham: number; gioi_han: number | null; vi_sao_gioi_han: string[];
  diem: number; dat: boolean; can: number; bang_chung: Evidence[]; ly_do: string; cach_sua: string;
};
export type GradedRound = {
  vong: number; duyet: boolean; loi_chan: string[]; tieu_chi: Criterion[];
  tuyen: { A: string; B: string; doi_luc: string };
  do_dac: {
    so_chu: number; so_hoi: number; ty_le_B: number; B_bat_dau_o_chu: number | null;
    doan_lien_dai_nhat: { tuyen: string; chu: number } | null; so_lan_chuyen_tuyen: number;
    so_loi_chao: number; hoi_co_keu_goi?: number[]; hoi_co_ngoai_truyen?: number[];
  };
  hoi_bang: { hoi: number; ten: string; chu: number; A: number; B: number; ngoai_truyen: number }[];
  su_that: { trich: string; ghi_chu: string }[];
  khong_tim_thay: { muc: string; trich: string }[];
  kich_ban: Act[];
};
export type AprilinneReport = {
  engine: 'aprilinne'; version: number; ten: string; che_do: 'video_dai' | 'series'; che_do_ten: string;
  buoc: string; vong: number; tot_nhat: number | null; tieu_chi_ma: string[]; nguong: { tru_cot: number; ho_tro: number };
  loi_cuoi: string; dan_y: Record<string, unknown> | null; vong_cham: GradedRound[];
};

export function readAprilinne(value: unknown): AprilinneReport | null {
  if (!value || typeof value !== 'object') return null;
  const v = value as Partial<AprilinneReport>;
  if (v.engine !== 'aprilinne' || !Array.isArray(v.vong_cham)) return null;
  return {
    engine: 'aprilinne', version: Number(v.version) || 1, ten: String(v.ten || ''),
    che_do: v.che_do === 'series' ? 'series' : 'video_dai', che_do_ten: String(v.che_do_ten || ''),
    buoc: String(v.buoc || ''), vong: Number(v.vong) || 0, tot_nhat: typeof v.tot_nhat === 'number' ? v.tot_nhat : null,
    tieu_chi_ma: Array.isArray(v.tieu_chi_ma) ? v.tieu_chi_ma.map(String) : [],
    nguong: v.nguong && typeof v.nguong === 'object' ? v.nguong : { tru_cot: 8, ho_tro: 7 },
    loi_cuoi: String(v.loi_cuoi || ''), dan_y: v.dan_y && typeof v.dan_y === 'object' ? v.dan_y : null,
    vong_cham: v.vong_cham.filter(r => r && Array.isArray(r.tieu_chi) && Array.isArray(r.kich_ban)),
  };
}

const STEP: Record<string, string> = {
  lay_transcript: 'Đang lấy transcript', dan_y: 'Claude đang lập dàn ý hai tuyến', viet: 'Claude đang viết kịch bản',
  bien_tap: 'Claude đang biên tập', cham: 'Người chấm (Claude, độc lập) đang chấm', sua: 'Claude đang sửa theo bảng điểm',
  xong: 'Đã xong',
};
export function stepLabel(r: AprilinneReport) {
  const s = STEP[r.buoc] || r.buoc;
  return r.buoc === 'xong' || !r.vong ? s : `${s} · vòng ${r.vong}`;
}

/** Vòng sẽ hiện mặc định: bản tốt nhất, không có thì vòng cuối. */
export function defaultRound(r: AprilinneReport) {
  return r.vong_cham.find(x => x.vong === r.tot_nhat) || r.vong_cham[r.vong_cham.length - 1] || null;
}

/** Tóm tắt một vòng cho nút chọn vòng: "duyệt" hoặc các mã trượt kèm điểm. */
export function roundSummary(g: GradedRound) {
  if (g.duyet) return 'duyệt';
  const fail = g.tieu_chi.filter(c => !c.dat).map(c => `${c.ma} ${c.diem}`);
  return 'trượt ' + (fail.join(', ') || (g.loi_chan.length ? 'lỗi chặn' : ''));
}

export const minutes = (words: number) => Math.round(words / 160);

/** Vị trí đầu tiên của câu trích trong đoạn, bỏ qua khác biệt dấu câu/hoa thường: [start, end) trên chuỗi gốc, hoặc null. */
export function findQuote(text: string, quote: string): [number, number] | null {
  const tokens: { w: string; s: number; e: number }[] = [];
  const re = /[\p{L}\p{N}]+/gu;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) tokens.push({ w: m[0].toLocaleLowerCase('vi'), s: m.index, e: m.index + m[0].length });
  const q = (quote.match(/[\p{L}\p{N}]+/gu) || []).map(w => w.toLocaleLowerCase('vi'));
  if (!q.length) return null;
  for (let i = 0; i + q.length <= tokens.length; i++) {
    if (q.every((w, j) => tokens[i + j].w === w)) return [tokens[i].s, tokens[i + q.length - 1].e];
  }
  return null;
}
