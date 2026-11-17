/** Same-origin wallet-signing gate shared by Pay and Exchange.
 *
 * Browser storage is not transactional. Two tabs can observe an empty
 * local journal at the same time, so both financial paths MUST hold the
 * same Web Lock through recovery-journal reservation and wallet request.
 * Browsers without Web Locks are read-only for financial Mainnet actions.
 *
 * This is a local concurrency barrier, NOT a substitute for server-side
 * idempotency, chain receipts, or wallet verification on every request.
 */
const WALLET=/^0x[0-9a-f]{40}$/i;
export const mainnetWalletLockName=(wallet:string)=>
 'veyra:mainnet:wallet-sign:v1:'+wallet.toLowerCase();

export class MainnetWalletLockError extends Error{
 constructor(public readonly code:'INVALID_WALLET'|'LOCK_UNAVAILABLE'|'WALLET_BUSY',message:string){
  super(message);this.name='MainnetWalletLockError';
 }
}

export async function withMainnetWalletSigningLock<T>(
 wallet:string,action:()=>Promise<T>,
):Promise<T>{
 if(!WALLET.test(wallet))
  throw new MainnetWalletLockError('INVALID_WALLET','Invalid connected wallet.');
 if(typeof navigator==='undefined'||!navigator.locks?.request)
  throw new MainnetWalletLockError('LOCK_UNAVAILABLE',
   'This browser cannot safely coordinate Mainnet signing between tabs. Use a supported, updated browser.');
 return navigator.locks.request(mainnetWalletLockName(wallet),{mode:'exclusive',ifAvailable:true},
  async lock=>{
   if(!lock)throw new MainnetWalletLockError('WALLET_BUSY',
    'A wallet operation is already active in another Veyra tab. Check its result before trying again.');
   return action();
  });
}
