/** Public backend capability disclosure.
 * The backend's /api/health/capabilities is intentionally non-secret and read-only.
 * A live server, schema table or HTTP 200 is NEVER transaction signing authorization.
 */
export type PublicFeatureStatus='available'|'unavailable'|'unknown';
export type PublicCapabilityId='identity'|'chat'|'paymentRequests'|'payJourneySync'|
 'settlementReceipts'|'x'|'publicSettlementV2';
export type PublicCapabilityRow={id:PublicCapabilityId;label:string;status:PublicFeatureStatus};

const CAPABILITIES=[
 {id:'identity',label:'Veyra ID backend'},
 {id:'chat',label:'Private chat backend'},
 {id:'paymentRequests',label:'Payment requests'},
 {id:'payJourneySync',label:'Pay journey sync'},
 {id:'settlementReceipts',label:'Settlement receipts'},
 {id:'x',label:'X account linking'},
 {id:'publicSettlementV2',label:'Public Settlement V2'},
] as const satisfies ReadonlyArray<{id:PublicCapabilityId;label:string}>;

function record(value:unknown):Record<string,unknown>|null{
 return value&&typeof value==='object'&&!Array.isArray(value)?
  value as Record<string,unknown>:null;
}
export function parsePublicMainnetCapabilities(raw:unknown):PublicCapabilityRow[]{
 const body=record(raw);
 const trusted=body?.ok===true&&body.environment==='mainnet'&&body.databaseReachable===true;
 return CAPABILITIES.map(({id,label})=>{
  const feature=trusted?record(body?.[id]):null;
  const available=feature?.available;
  const status:PublicFeatureStatus=typeof available==='boolean'?
   available?'available':'unavailable':'unknown';
  return {id,label,status};
 });
}
/** No credentials, no wallet provider, no signing and no backend mutations. */
export async function fetchPublicMainnetCapabilities(signal?:AbortSignal):Promise<PublicCapabilityRow[]>{
 try{
  const response=await fetch('/api/health/capabilities',{
   method:'GET',credentials:'same-origin',cache:'no-store',
   headers:{Accept:'application/json'},...(signal?{signal}:{}),
  });
  if(!response.ok||!response.headers.get('content-type')?.toLowerCase().includes('application/json'))
   return parsePublicMainnetCapabilities(null);
  const data:unknown=await response.json();
  return parsePublicMainnetCapabilities(data);
 }catch{return parsePublicMainnetCapabilities(null);}
}
