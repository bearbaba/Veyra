/**
 * A Circle forwarding transfer ID is NOT proof that an authenticated caller
 * owns that transfer. Never reveal another wallet's status just because the
 * caller is a valid Veyra user. Circle owner evidence must accompany it.
 *
 * Fail closed when the public status endpoint omits ownership fields.
 * Provider "confirmed" also does not independently verify destination mint.
 */
import {getAddress,isAddress} from 'viem';

export class GatewayTransferOwnerError extends Error {
 constructor(readonly code:string){super(code);}
}
const asObject=(value:unknown):Record<string,unknown>|null=>
 value&&typeof value==='object'&&!Array.isArray(value)
  ?value as Record<string,unknown>:null;

function asAddress(value:unknown):string|null {
 if(typeof value!=='string')return null;
 if(/^0x[0-9a-fA-F]{64}$/.test(value)){
  if(!/^0{24}$/i.test(value.slice(2,26)))return null;
  value='0x'+value.slice(-40);
 }
 return isAddress(value)?getAddress(value).toLowerCase():null;
}

/** Extracts a non-sensitive transfer summary only if Circle proves owner. */
export function parseOwnedGatewayTransferStatus(raw:unknown,owner:string,
 transferId:string):{providerStatus:string;destinationTxHash?:string}{
 if(!isAddress(owner)||!/^[a-zA-Z0-9-]{10,80}$/.test(transferId))
  throw new GatewayTransferOwnerError('GATEWAY_STATUS_INVALID_REQUEST');
 const top=asObject(raw);
 if(!top)throw new GatewayTransferOwnerError('GATEWAY_STATUS_UNVERIFIED_OWNER');
 const transfer=asObject(top.transfer)??top;
 const evidence=[
  transfer.sourceDepositor,
  asObject(transfer.spec)?.sourceDepositor,
  asObject(asObject(transfer.burnIntent)?.spec)?.sourceDepositor,
 ];
 const verified=evidence.map(asAddress).filter((v):v is string=>v!==null);
 if(verified.length===0||verified.some(v=>v!==getAddress(owner).toLowerCase()))
  throw new GatewayTransferOwnerError('GATEWAY_STATUS_UNVERIFIED_OWNER');
 // A supplied path must not conceal conflicting ownership evidence.
 if(evidence.some(v=>v!==undefined&&asAddress(v)===null))
  throw new GatewayTransferOwnerError('GATEWAY_STATUS_UNVERIFIED_OWNER');
 const actualId=typeof transfer.transferId==='string'?transfer.transferId:
  typeof top.transferId==='string'?top.transferId:null;
 if(actualId!==transferId)
  throw new GatewayTransferOwnerError('GATEWAY_STATUS_TRANSFER_ID_MISMATCH');
 const state=typeof transfer.status==='string'?transfer.status:
  typeof transfer.state==='string'?transfer.state:null;
 if(!state||!/^[a-zA-Z0-9_-]{1,32}$/.test(state))
  throw new GatewayTransferOwnerError('GATEWAY_STATUS_MALFORMED');
 const tx=typeof transfer.forwardTxHash==='string'?transfer.forwardTxHash:
  typeof transfer.txHash==='string'?transfer.txHash:undefined;
 const destinationTxHash=tx&&/^0x[0-9a-fA-F]{64}$/.test(tx)?tx:undefined;
 return {providerStatus:state,...(destinationTxHash?{destinationTxHash}:{})};
}
