import {it,expect} from 'vitest';
import {makeHandoff} from './analysisHandoff';
import {emptyAnalysis} from './analysisWorkspace';
it('copies project metadata and script without sharing mutable objects',()=>{const state={...emptyAnalysis(),script:'S',direction:'D',routes:'R',research:'N',parts:[{id:'1',title:'A',text:'T',status:'done' as const}]};const h=makeHandoff(state,'Phong cách');state.parts[0].text='changed';expect(h.script).toBe('S');expect(h.parts[0].text).toBe('T');expect(h.direction).toBe('D');expect(h.routes).toBe('R');expect(h.research).toBe('N');expect(h.imageStyle).toBe('Phong cách')});
