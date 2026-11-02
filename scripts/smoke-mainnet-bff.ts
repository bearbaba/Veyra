/**
 * Network-only release smoke. Never signs, reads secrets or moves USDC.
 * Cross-check that the standalone Mainnet BFF is ready before we direct the
 * ONE official wallet website to it.
 */
const origin='https://veyra-seven-beta.vercel.app';
const base='https://veyra-mainnet-v1-bff.onrender.com';
async function probe(path:string,method:'GET'|'POST'){
 const res=await fetch(base+path,{
  method,headers:{Origin:origin,Accept:'application/json',...(method==='POST'?{'Content-Type':'application/json'}:{})},
  ...(method==='POST'?{body:'{}'}:{}),signal:AbortSignal.timeout(25_000),cache:'no-store',
 });
 const type=res.headers.get('content-type')??'';
 if(!type.includes('application/json'))throw Error(path+': backend returned a non-JSON response');
 const data:unknown=await res.json();
 if(!data||typeof data!=='object'||Array.isArray(data))
  throw Error(path+': invalid response shape');
 const v=data as Record<string,unknown>;
 if(res.status!==200||v.ok!==true)
  throw Error(path+': not ready (HTTP '+res.status+', code '+(typeof v.error==='string'?v.error:'unavailable')+')');
 return v;
}
const schema=await probe('/api/health/database','GET');
if(schema.scope!=='database-infrastructure-only'||!Array.isArray(schema.checks)||
 !schema.checks.every((x:unknown)=>!!x&&typeof x==='object'&&'ok' in x&&(x as {ok:unknown}).ok===true))
 throw Error('Mainnet database schema or migration checks incomplete');
const identity=await probe('/api/identity/mainnet-capability','POST');
if(identity.environment!=='mainnet'||identity.chainId!==5042||identity.origin!==origin||
 identity.walletLogin!==true||identity.recipientSnapshots!==true||identity.cookieRestore!==true)
 throw Error('Mainnet identity backend has mismatched authority');
console.log('LIVE MAINNET BFF: schema and identity readiness verified (no wallet signature or money movement).');
