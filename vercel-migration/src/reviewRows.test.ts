import {it,expect} from 'vitest';
import {parseReviewRows} from './reviewRows';
it('accepts only real script evidence and known statuses',()=>{const rows=parseReviewRows(JSON.stringify({rows:[{criterion:0,status:'Phù hợp',evidence:'không tồn tại',reason:'x',suggestion:'y'},{criterion:1,status:'Sai',evidence:'thật',reason:'',suggestion:''}]}),'thật');expect(rows[0].status).toBe('Chưa đủ dữ liệu');expect(rows[1].status).toBe('Chưa đủ dữ liệu');expect(rows).toHaveLength(14)});
it('preserves legacy plain text and does not invent assessments',()=>{expect(parseReviewRows('nhận xét cũ','abc').every(row=>row.status==='Chưa đủ dữ liệu')).toBe(true)});
