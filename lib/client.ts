export type Item=Record<string, any>;
export async function api(path:string,body?:unknown){const r=await fetch('/api/'+path,{method:body===undefined?'GET':'POST',headers:body===undefined||body instanceof FormData?{}:{'Content-Type':'application/json'},body:body===undefined?undefined:body instanceof FormData?body:JSON.stringify(body)});const data=await r.json() as Item;if(!r.ok)throw new Error(data.error||'请求失败');return data;}
export const time=(n:number)=>n?new Date(n).toLocaleString('zh-CN',{hour12:false}):'—';
export const shortId=(s:string)=>s?.startsWith('STU-')?s.slice(0,12):s?.slice(0,8)||'—';
export const statusText:Record<string,string>={pending:'待评分',processing:'评分中',completed:'已完成',failed:'失败',blocked:'待配置'};
