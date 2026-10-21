import {describe,expect,it} from 'vitest';
import {imageKey,mergeLibrary,removeSelection} from './imageSeparationState';

describe('image separation selection state',()=>{
 it('deduplicates uploaded files by stable file metadata',()=>{
  const a={name:'a.png',url:'blob:1',file:new File(['x'],'a.png',{type:'image/png',lastModified:10}),local:true};
  const b={name:'a.png',url:'blob:2',file:new File(['x'],'a.png',{type:'image/png',lastModified:10}),local:true};
  expect(imageKey(a)).toBe(imageKey(b));
  expect(mergeLibrary([a],[b])).toHaveLength(1);
 });
 it('keeps library intact when an image is removed from selection',()=>{
  const a={name:'a.png',url:'blob:1'};
  const b={name:'b.png',url:'blob:2'};
  const library=[a,b];
  expect(removeSelection([a,b],a)).toEqual([b]);
  expect(library).toEqual([a,b]);
 });
});
