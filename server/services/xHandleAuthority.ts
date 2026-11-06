/** A current X username is mutable. Never authorize a USDC recipient using
 * only a cached provider handle: compare the public lookup's immutable X ID
 * with the signed OAuth binding on EVERY payee lookup. Fail closed on outage.
 * API: GET https://api.x.com/2/users/by/username/:username (X v2).
 */
export async function lookupCurrentXAccountId(
 handle:string,bearer=process.env.X_BEARER_TOKEN,
 request:typeof fetch=fetch,
):Promise<string|null>{
 if(!/^[A-Za-z0-9_]{1,15}$/.test(handle)||!bearer||bearer.length<12)
  return null;
 const url='https://api.x.com/2/users/by/username/'+encodeURIComponent(handle);
 try{
  const response=await request(url,{headers:{Authorization:'Bearer '+bearer,Accept:'application/json'},
   signal:AbortSignal.timeout(12000),cache:'no-store'});
  if(!response.ok)return null;
  const raw:unknown=await response.json();
  if(!raw||typeof raw!=='object'||Array.isArray(raw)||!('data' in raw))return null;
  const data=(raw as Record<string,unknown>).data;
  if(!data||typeof data!=='object'||Array.isArray(data))return null;
  const entry=data as Record<string,unknown>;
  return typeof entry.id==='string'&&/^\d{1,30}$/.test(entry.id)&&
   typeof entry.username==='string'&&entry.username.toLowerCase()===handle.toLowerCase()?
   entry.id:null;
 }catch{return null;}
}
