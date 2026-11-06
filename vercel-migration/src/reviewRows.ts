import {criteria} from './analysisPrompts';
type Status='Phù hợp'|'Cần xem lại'|'Chưa thấy'|'Chưa đủ dữ liệu';
export type ReviewRow={criterion:number;status:Status;evidence:string;reason:string;suggestion:string};
export function parseReviewRows(raw:string,script:string):ReviewRow[]{
 let value:unknown;try{value=JSON.parse(raw.replace(/^```(?:json)?\s*/i,'').replace(/\s*```$/,''))}catch{return criteria.map((_,i)=>({criterion:i,status:'Chưa đủ dữ liệu',evidence:'',reason:'Chưa có kết quả theo từng tiêu chí.',suggestion:''}))}
 const entries=Array.isArray((value as any)?.rows)?(value as any).rows:[];
 return criteria.map((_,i)=>{const matches=entries.filter((x:any)=>x?.criterion===i);const x=matches.length===1?matches[0]:null;const evidence=typeof x?.evidence==='string'?x.evidence.trim():'';const allowed=['Phù hợp','Cần xem lại','Chưa thấy','Chưa đủ dữ liệu'];const validEvidence=!!evidence&&script.includes(evidence);const status:Status=allowed.includes(x?.status)&&((x.status==='Chưa thấy'||x.status==='Chưa đủ dữ liệu')||validEvidence)?x.status:'Chưa đủ dữ liệu';return {criterion:i,status,evidence:validEvidence?evidence:'',reason:typeof x?.reason==='string'?x.reason:'',suggestion:typeof x?.suggestion==='string'?x.suggestion:''}});
}
