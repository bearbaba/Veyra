import {afterEach,describe,expect,it,vi} from 'vitest';
import {readFileSync} from 'node:fs';
import {parseDirectPayReceiptRequest,mainnetRpcUrl,visiblePayReceipt,type VerifiedPayRow} from '../../server/services/mainnetPayReceiptService';
import {listVerifiedMainnetPayReceipts,saveVerifiedMainnetPayReceipt} from '../lib/api/mainnetPayReceipts';
const hash='0x'+'a'.repeat(64);
const address='0x1111111111111111111111111111111111111111';
const read=(path:string)=>readFileSync(new URL('../../'+path,import.meta.url),'utf8');
const json=(status:number,value:unknown):Response=>({ok:status>=200&&status<300,status,
 headers:{get:()=> 'application/json'},json:()=>Promise.resolve(value)}) as unknown as Response;
afterEach(()=>vi.unstubAllGlobals());
describe('Mainnet Direct Pay persistent receipt input boundaries',()=>{
 it('accepts exact hash and private note but refuses malformed or oversized metadata',()=>{
  expect(parseDirectPayReceiptRequest({hash:hash.toUpperCase().replace('0X','0x'),note:'Dinner'}))
   .toEqual({hash,note:'Dinner'});
  for(const value of [{hash:'0x1'},{hash},null,[],{hash,note:'x'.repeat(121)},
    {hash,note:17},{hash,snapshotId:'fake'}]){
   // A valid hash alone is deliberately allowed; no untrusted names are accepted.
   if(value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).length===1&&'hash' in value)
    expect(parseDirectPayReceiptRequest(value).hash).toBe(hash);
   else expect(()=>parseDirectPayReceiptRequest(value)).toThrow();
  }
 });
 it('rejects Testnet, local and plaintext RPC endpoints before any network call',()=>{
  expect(mainnetRpcUrl({ARC_MAINNET_RPC_URL:'https://rpc.arc.network'})).toBe('https://rpc.arc.network');
  for(const url of ['http://rpc.arc.network','https://rpc.testnet.arc.network',
    'https://localhost:443','https://127.0.0.1/rpc','https://192.168.1.5','https://private:pass@rpc.arc.network']){
   expect(()=>mainnetRpcUrl({ARC_MAINNET_RPC_URL:url})).toThrow('INVALID_MAINNET_RECEIPT_RPC');
  }
  expect(()=>mainnetRpcUrl({})).toThrow('MAINNET_RECEIPT_RPC_NOT_CONFIGURED');
 });
 it('returns sender-only notes without exposing them to the receiver',()=>{
  const row={txHash:hash,chainId:5042,senderAddress:address,recipientAddress:address,
   senderUserId:'usr_sender',recipientUserId:'usr_receiver',recipientLabel:'@alice.veyra',
   amountRaw:'500000',feeWei:'999',blockNumber:123,createdAt:new Date('2026-11-02'),
   verifiedAt:new Date('2026-11-02'),senderPrivateNote:'Dinner'} as unknown as VerifiedPayRow;
  expect(visiblePayReceipt(row,'usr_sender')).toMatchObject({direction:'sent',privateNote:'Dinner'});
  const receiver=visiblePayReceipt(row,'usr_receiver');
  expect(receiver.direction).toBe('received');
  expect(receiver).not.toHaveProperty('privateNote');
 });
 it('server writes are owner scoped, idempotent, read-only from chain and two-sided',()=>{
  const server=read('server/services/mainnetPayReceiptService.ts');
  const bff=read('server/bff.ts');
  const db=read('server/db/schema/mainnetDirectPay.ts');
  const migration=read('server/db/migrations/0020_mainnet_direct_pay_receipts.sql');
  expect(bff).toContain("app.post('/api/mainnet/pay/receipt/verify'");
  expect(bff).toContain("app.get('/api/mainnet/pay/receipts'");
  expect(bff).toContain('getAuthenticatedVeyraUserId(req)');
  expect(bff).toContain('evaluateMainnetIdentityAuthority(runtimeConfig,req.header(\'origin\'))');
  expect(server).toContain('readCanonicalMainnetPayProof');
  expect(server).toContain('verifyCanonicalDirectPay');
  expect(server).toContain("sender?.userId!==userId&&receiver?.userId!==userId");
  expect(server).toContain("eq(mainnetDirectPayReceipts.recipientUserId,userId)");
  expect(server).toContain('onConflictDoNothing()');
  expect(server).toContain('SENDER_REQUIRED_FOR_METADATA');
  expect(db).toContain("senderPrivateNote:text('sender_private_note')");
  expect(migration).toContain('CHECK (chain_id=5042)');
 });
});
describe('Mainnet signed history browser client',()=>{
 it('refuses an HTML fallback and mismatched receipt hash',async()=>{
  vi.stubGlobal('fetch',vi.fn(()=>Promise.resolve({
   ...json(200,{ok:true,receipt:{chainId:5042,txHash:hash}}),
   headers:{get:()=> 'text/html'},
  })));
  await expect(saveVerifiedMainnetPayReceipt('signed.session',{hash})).rejects.toThrow('not configured');
  vi.stubGlobal('fetch',vi.fn(()=>Promise.resolve(json(200,{ok:true,receipt:{chainId:5042,txHash:'0x'+'b'.repeat(64)}}))));
  await expect(saveVerifiedMainnetPayReceipt('signed.session',{hash})).rejects.toThrow('does not match');
 });
 it('passes bearer session and refuses invalid list evidence',async()=>{
  const mocked=vi.fn((_path:string,_opts?:RequestInit)=>Promise.resolve(json(200,{ok:true,receipts:[{
   txHash:hash,chainId:5042,amountRaw:'250000',direction:'received',
   senderAddress:address,recipientAddress:address,
  },{txHash:'invalid',chainId:5042,amountRaw:'250000',direction:'received'}]})));
  vi.stubGlobal('fetch',mocked);
  const values=await listVerifiedMainnetPayReceipts('signed.session');
  expect(values).toHaveLength(1);
  expect(values[0]?.txHash).toBe(hash);
  expect(mocked.mock.calls[0]?.[0]).toBe('/api/mainnet/pay/receipts');
  expect(mocked.mock.calls[0]?.[1]?.headers).toEqual({Authorization:'Bearer signed.session'});
 });
});
