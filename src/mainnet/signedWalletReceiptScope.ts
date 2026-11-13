/** Never show server-held private payment receipts under another connected wallet.
 * A still-valid token is not evidence that the currently connected connector
 * is the wallet that authenticated that Veyra ID session.
 */
const WALLET=/^0x[0-9a-f]{40}$/i;
export function isMainnetSessionForWallet(
 session:{walletKey:string}|null|undefined,
 address:string|null|undefined,
 connectorUid:string|null|undefined,
):boolean{
 return !!session&&typeof session.walletKey==='string'&&!!address&&WALLET.test(address)&&
  !!connectorUid&&session.walletKey===address.toLowerCase()+':'+connectorUid;
}
export function scopedMainnetReceipts<T extends {senderAddress:string;recipientAddress:string}>(
 receipts:readonly T[],
 address:string|null|undefined,
):T[]{
 if(!address||!WALLET.test(address))return [];
 const owner=address.toLowerCase();
 return receipts.filter(row=>
  typeof row.senderAddress==='string'&&typeof row.recipientAddress==='string'&&
  (row.senderAddress.toLowerCase()===owner||row.recipientAddress.toLowerCase()===owner));
}
