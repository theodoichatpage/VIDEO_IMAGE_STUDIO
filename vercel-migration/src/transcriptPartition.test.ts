import {describe,expect,it} from 'vitest';
import {buildPartitionPrompt,partitionBranches,transcriptUnits} from './transcriptPartition';
describe('compact transcript partition',()=>{
 const source='  Mở đầu câu chuyện.\n\nMột sự kiện tiếp nối!  Kết thúc câu chuyện.\n';
 it('keeps every source character, including whitespace and Unicode',()=>{
  expect(transcriptUnits(source).join('')).toBe(source);
  expect(transcriptUnits('Đoạn không có dấu kết câu')).toEqual(['Đoạn không có dấu kết câu']);
 });
 it('reconstructs ordered parts from small boundary responses',()=>{
  const units=transcriptUnits(source);
  const parts=partitionBranches({branches:[{title:'Mở đầu',end:1},{title:'Kết thúc',end:units.length}]},source);
  expect(parts.map(p=>p.content).join('')).toBe(source);
  expect(parts[0].content).toBe(units[0]);expect(parts[1].id).toBe('part-2');
 });
 it('rejects gaps, repeated boundaries, out-of-range and incomplete coverage',()=>{
  const n=transcriptUnits(source).length;
  for(const ends of [[1],[n+1],[1,1,n],[n,1],['2',n]])expect(()=>partitionBranches({branches:ends.map(end=>({title:'Phần',end}))},source)).toThrow();
 });
 it('requires nonempty titles and at least one result',()=>{
  expect(()=>partitionBranches({branches:[]},source)).toThrow();
  expect(()=>partitionBranches({branches:[{title:'',end:transcriptUnits(source).length}]},source)).toThrow();
 });
 it('requests semantic ranges instead of a mindmap or repeated source content',()=>{
  const prompt=buildPartitionPrompt(source);
  expect(prompt).toContain('Không tạo mindmap');expect(prompt).toContain('không cố định số phần');
  expect(prompt).toContain('"end"');expect(prompt).not.toContain('"children"');
  expect(prompt).toContain('[1]');expect(prompt).toContain('không chép lại');
 });
 it('accepts an in-flight legacy result without dropping existing content',()=>{
  expect(partitionBranches({branches:[{id:'old',title:'Đã chia',content:source}]},source)[0].content).toBe(source);
 });
 it('restores 25 parts spanning 562 source units as in the reported result',()=>{
  const source=Array.from({length:562},(_,i)=>`Câu nguồn số ${i+1}.`).join(' ');
  expect(transcriptUnits(source)).toHaveLength(562);
  const branches=Array.from({length:25},(_,i)=>({title:`Phần ${i+1}`,end:Math.floor((i+1)*562/25)}));
  const result=partitionBranches({branches},source);
  expect(result).toHaveLength(25);expect(result.map(x=>x.content).join('')).toBe(source);
 });

});
