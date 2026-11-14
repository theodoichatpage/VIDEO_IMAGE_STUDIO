import { describe, expect, it } from 'vitest';
import { defaultRound, findQuote, readAprilinne, roundSummary } from './aprilinneData';

const round = (vong: number, duyet: boolean) => ({ vong, duyet, loi_chan: [], tuyen: { A: '', B: '', doi_luc: '' }, do_dac: {} as never, hoi_bang: [], su_that: [], khong_tim_thay: [], kich_ban: [],
  tieu_chi: [{ ma: 'H2', ten: '', diem_cham: 6, gioi_han: null, vi_sao_gioi_han: [], diem: 6, dat: duyet, can: 7, bang_chung: [], ly_do: '', cach_sua: '' }] });

describe('Aprilinne review', () => {
  it('reads only the Claude engine report', () => {
    expect(readAprilinne({ stage: 'done', rows: [] })).toBeNull();
    const r = readAprilinne({ engine: 'aprilinne', che_do: 'series', tot_nhat: 1, vong_cham: [round(1, false), round(2, true)] });
    expect(r?.che_do).toBe('series');
    expect(defaultRound(r!)?.vong).toBe(1);
    expect(roundSummary(r!.vong_cham[0])).toBe('trượt H2 6');
    expect(roundSummary(r!.vong_cham[1])).toBe('duyệt');
  });
  it('finds a quote despite punctuation and case', () => {
    const text = 'Thế nhưng, khổ một cái: giặc chỉ việc VÂY. Hết.';
    const span = findQuote(text, 'khổ một cái giặc chỉ việc vây');
    expect(span && text.slice(span[0], span[1])).toBe('khổ một cái: giặc chỉ việc VÂY');
    expect(findQuote(text, 'không có')).toBeNull();
  });
});
