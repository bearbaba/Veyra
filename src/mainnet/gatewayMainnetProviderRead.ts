/** Official read-only Gateway API, no transfer POST, wallet signature or retry.
 * HTTP schema: GET /v1/transfer/{uuid}, GET /v1/transferSpec/{hash}.
 */
export async function fetchGatewayForwardingProof(transferId:string,
 request:typeof fetch=fetch):Promise<unknown>{
 if(!/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(transferId))
  throw Error('Circle transfer reference is not a valid UUID; outcome remains pending.');
 const get=async(path:string):Promise<unknown>=>{
  const response=await request('https://gateway-api.circle.com/v1/'+path,{
   method:'GET',headers:{Accept:'application/json'},cache:'no-store',
   signal:AbortSignal.timeout(12000),
  });
  if(!response.ok)throw Error('Circle Gateway read API unavailable ('+response.status+').');
  const data:unknown=await response.json();
  return data;
 };
 const transfer=await get('transfer/'+encodeURIComponent(transferId));
 if(!transfer||typeof transfer!=='object'||Array.isArray(transfer))
  throw Error('Circle transfer response malformed.');
 const entry=transfer as Record<string,unknown>;
 if(entry.status!=='finalized')return {transfer,spec:null};
 const intents=entry.burnIntents;
 if(!Array.isArray(intents)||intents.length<1||intents.length>3)
  throw Error('Circle transfer has unsupported or ambiguous burn-intent count.');
 const hashes:string[]=[];
 for(const intent of intents){
  if(!intent||typeof intent!=='object'||Array.isArray(intent))
   throw Error('Circle burn intent is malformed.');
  const hash=(intent as Record<string,unknown>).transferSpecHash;
  if(typeof hash!=='string'||!/^0x[0-9a-fA-F]{64}$/.test(hash))
   throw Error('Circle burn intent has no valid TransferSpec hash.');
  if(hashes.some(x=>x.toLowerCase()===hash.toLowerCase()))
   throw Error('Duplicate Circle transfer specification hash.');
  hashes.push(hash);
 }
 const specs=await Promise.all(hashes.map(async hash=>{
  const spec=await get('transferSpec/'+encodeURIComponent(hash));
  if(!spec||typeof spec!=='object'||Array.isArray(spec))
   throw Error('Circle transfer specification is malformed.');
  return {...spec,transferSpecHash:hash};
 }));
 return {transfer,spec:specs.length===1?specs[0]:null,specs};
}

