/**
 * Client-side certainty classification. A wallet request can have been
 * accepted even when the RPC has not returned a transaction hash.
 * Do NOT label such an unknown submission as a failed payment.
 */
export type TransferOutcome='FAILED'|'PENDING'|'CANCELLED';
export function classifyTransferOutcome(args:{
  submissionStarted:boolean;
  broadcastHash:string|null;
  revertedOnChain:boolean;
  userExplicitlyRejected:boolean;
}):TransferOutcome{
  if(args.broadcastHash){
    return args.revertedOnChain?'FAILED':'PENDING';
  }
  if(args.submissionStarted){
    return args.userExplicitlyRejected?'CANCELLED':'PENDING';
  }
  return 'FAILED';
}
/** Only wallet RPC code 4001 authorizes a definitive user-cancelled label. */
export function isExplicitWalletRejection(error:unknown):boolean{
  let current:unknown=error;
  for(let i=0;i<5;i++){
    if(!current||typeof current!=='object')return false;
    const found=current as {code?:unknown;cause?:unknown};
    if(found.code===4001)return true;
    current=found.cause;
  }
  return false;
}
