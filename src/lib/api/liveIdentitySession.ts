/** Single in-memory, wallet-bound signed identity session for the full Veyra app.
 * All authenticated API calls use this session instead of browser storage.
 * Never persists or logs bearer tokens. Wallet/network/connector changes revoke
 * previous permissions synchronously, before child route effects run.
 */
let activeWalletKey='';
let signed:{walletKey:string;token:string}|null=null;
export function bindCurrentIdentityWallet(walletKey:string):void{
  if(activeWalletKey!==walletKey){activeWalletKey=walletKey;signed=null;}
}
export function clearSignedIdentitySession():void{signed=null;}
export function setSignedIdentitySession(token:string,walletKey:string):void{
  if(walletKey!==activeWalletKey||!walletKey.split(':')[0]||typeof token!=='string'||token.length<8||token.length>8192)
    throw new Error('Wallet changed during identity sign-in. Connect and sign again.');
  signed={token,walletKey};
}
export function activeSignedIdentityToken():string|null{
  return signed?.walletKey===activeWalletKey?signed.token:null;
}
