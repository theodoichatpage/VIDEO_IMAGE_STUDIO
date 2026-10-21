const decode=s=>s.replace(/&amp;/g,'&').replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/&lt;/g,'<').replace(/&gt;/g,'>');
const videoId=input=>{try{const u=new URL(input);if(u.hostname==='youtu.be')return u.pathname.slice(1).split('/')[0];if(u.hostname.includes('youtube.com'))return u.searchParams.get('v')||u.pathname.match(/\/(?:shorts|embed)\/([^/?]+)/)?.[1]||'';}catch{}return /^[\w-]{11}$/.test(input)?input:''};
const jsonFromHtml=(html,key)=>{const p=html.indexOf(key);if(p<0)return null;const start=html.indexOf('{',p);if(start<0)return null;let depth=0,str=false,esc=false;for(let i=start;i<html.length;i++){const c=html[i];if(str){if(esc)esc=false;else if(c==='\\')esc=true;else if(c==='"')str=false;continue}if(c==='"'){str=true;continue}if(c==='{')depth++;if(c==='}'&&--depth===0){try{return JSON.parse(html.slice(start,i+1))}catch{return null}}}return null};
const flattenText=x=>Array.isArray(x)?x.map(flattenText).join(''):x&&typeof x==='object'?(x.simpleText||x.runs?.map(r=>r.text||'').join('')||''):String(x||'');
export default async function handler(req,res){
 if(req.method!=='POST')return res.status(405).json({error:'Method not allowed'});
 try{
  const id=videoId(String(req.body?.url||''));if(!id)return res.status(400).json({error:'URL YouTube không hợp lệ.'});
  const page=await fetch(`https://www.youtube.com/watch?v=${id}&hl=en`,{headers:{'user-agent':'Mozilla/5.0'}});if(!page.ok)throw new Error('YouTube không phản hồi.');const html=await page.text();
  const player=jsonFromHtml(html,'ytInitialPlayerResponse');const details=player?.videoDetails||{};const tracks=player?.captions?.playerCaptionsTracklistRenderer?.captionTracks||[];
  if(!tracks.length)return res.status(404).json({error:'Video này không có transcript/phụ đề khả dụng.'});
  const requested=String(req.body?.language||'').toLowerCase();let track=tracks.find(t=>String(t.languageCode).toLowerCase()===requested&&!String(t.kind||'').includes('asr'))||tracks.find(t=>String(t.languageCode).toLowerCase()===requested)||tracks.find(t=>!String(t.kind||'').includes('asr'))||tracks[0];
  let base=String(track.baseUrl||'');if(!base)throw new Error('Không tìm thấy đường dẫn phụ đề.');base+=(base.includes('?')?'&':'?')+'fmt=json3';
  const caption=await fetch(base,{headers:{'user-agent':'Mozilla/5.0'}});if(!caption.ok)throw new Error('Không tải được phụ đề từ YouTube.');const data=await caption.json();
  const segments=(data.events||[]).map(e=>({start:Number(e.tStartMs||0)/1000,duration:Number(e.dDurationMs||0)/1000,text:decode((e.segs||[]).map(s=>s.utf8||'').join('').replace(/\n/g,' ').trim())})).filter(x=>x.text);
  if(!segments.length)return res.status(404).json({error:'YouTube trả về transcript rỗng.'});
  return res.status(200).json({videoId:id,title:details.title||'',thumbnail:details.thumbnail?.thumbnails?.slice(-1)?.[0]?.url||`https://i.ytimg.com/vi/${id}/hqdefault.jpg`,language:track.languageCode||'',captionType:track.kind==='asr'?'auto':'manual',languageName:flattenText(track.name),segments,text:segments.map(x=>x.text).join(' ').replace(/\s+/g,' ').trim()});
 }catch(e){return res.status(500).json({error:e instanceof Error?e.message:'Không lấy được transcript.'})}
}
