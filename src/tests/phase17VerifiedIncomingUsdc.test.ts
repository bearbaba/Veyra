import {describe,expect,it,vi} from 'vitest';
import {readFileSync} from 'node:fs';
import {ARC_CHAIN_ID,ARC_USDC,TRANSFER_TOPIC,IncomingUsdcError,
  parseQuantity,recipientTopic,reconcileIncomingUsdc,validateIncomingTransfer,
} from '../../server/services/incomingUsdcService';
import type {DbClient} from '../../server/db/client';

const file=(path:string)=>readFileSync(new URL('../../'+path,import.meta.url),'utf8');
const addr='0x1234567890abcdef1234567890abcdef12345678';
const sender='0xabcdefabcdefabcdefabcdefabcdefabcdefabcd';
const hex32=(n:number)=>'0x'+n.toString(16).padStart(64,'0');
const txHash='0x'+'11'.repeat(32);
const blockHash='0x'+'22'.repeat(32);
const log={address:ARC_USDC,topics:[TRANSFER_TOPIC,recipientTopic(sender),recipientTopic(addr)],
  data:hex32(2500000),transactionHash:txHash,blockNumber:'0xe7',blockHash,
  logIndex:'0x1',removed:false};
const receipt={transactionHash:txHash,status:'0x1',blockNumber:'0xe7',blockHash,logs:[log]};
const env={ARC_TESTNET_RPC_URL:'https://testnet-rpc-fixture.example/rpc'} as NodeJS.ProcessEnv;
const owner='usr_abcdefghijk123456',walletId='wlt_abcdefghijk123456';

function fixture(options:{wrongChain?:boolean;receipt?:Record<string,unknown>;log?:Record<string,unknown>;
  canonical?:Record<string,unknown>;badId?:boolean}={}){
  const events:Record<string,unknown>[]=[];
  let cursor:number|undefined,added=0,alertCount=0;
  const wallet={walletId,walletAddress:addr};
  const db={
    select:()=>({
      from:()=>({
        innerJoin:()=>({where:()=>({limit:()=>Promise.resolve([wallet])})}),
        where:()=>({limit:()=>Promise.resolve(cursor===undefined?[]:[{lastVerifiedBlock:cursor}])}),
      }),
    }),
    transaction:(fn:(tx:unknown)=>Promise<number>)=>{
      const tx={
        insert:()=>({
          values:(value:Record<string,unknown>)=>({
            onConflictDoNothing:()=>({
              returning:()=>{
                if('incomingId' in value){
                  if(events.some(item=>item.txHash===value.txHash&&item.logIndex===value.logIndex))return Promise.resolve([]);
                  events.push(value);added++;return Promise.resolve([{incomingId:value.incomingId}]);
                }
                if('notificationId' in value)alertCount++;
                return Promise.resolve([]);
              },
            }),
            onConflictDoUpdate:()=>{cursor=Number(value.lastVerifiedBlock);return Promise.resolve();},
          }),
        }),
      };
      return fn(tx);
    },
  } as unknown as DbClient;
  const fetchImpl=vi.fn((_url:string,init?:RequestInit)=>{
    const body=JSON.parse(typeof init?.body==='string'?init.body:'{}') as {id:number;method:string;params:unknown[]};
    const responses:Record<string,unknown>={
      eth_chainId:'0x'+(options.wrongChain?1:ARC_CHAIN_ID).toString(16),
      eth_blockNumber:'0x100',
      eth_getLogs:[options.log??log],
      eth_getTransactionReceipt:options.receipt??receipt,
      eth_getBlockByNumber:options.canonical??{hash:blockHash,number:'0xe7'},
    };
    const reply={jsonrpc:'2.0',id:options.badId?body.id+1:body.id,result:responses[body.method]};
    return Promise.resolve({ok:true,json:()=>Promise.resolve(reply)} as Response);
  }) as unknown as typeof fetch;
  return {db,fetchImpl,fetchCalls:fetchImpl,events,get cursor(){return cursor;},
    get added(){return added;},get alertCount(){return alertCount;}};
}

describe('Phase 17: verified Arc Testnet inbound USDC, no browser payment claims',()=>{
  it('encodes the recipient topic and rejects malformed RPC quantities and forged logs',()=>{
    expect(recipientTopic(addr)).toBe('0x'+'0'.repeat(24)+addr.slice(2));
    expect(parseQuantity('0xe7')).toBe(231);
    for(const invalid of ['231','0x01','0xfffffffffffffffffffffff',null]){
      expect(()=>parseQuantity(invalid)).toThrow(IncomingUsdcError);
    }
    const valid=validateIncomingTransfer(log,addr,232);
    expect(valid.amountBaseUnits).toBe('2500000');
    expect(valid.recipient).toBe(addr);
    expect(()=>validateIncomingTransfer(log,sender,232)).toThrow();
    expect(()=>validateIncomingTransfer(log,addr,230)).toThrow();
    expect(()=>validateIncomingTransfer({...log,address:sender},addr,232)).toThrow();
    expect(()=>validateIncomingTransfer({...log,removed:true},addr,232)).toThrow();
    expect(()=>validateIncomingTransfer({...log,data:hex32(0)},addr,232)).toThrow();
  });
  it('rejects wrong chain ID or receipt/canonical-block disagreement, without changing a cursor',async()=>{
    for(const variants of [
      {wrongChain:true},
      {receipt:{...receipt,status:'0x0'}},
      {receipt:{...receipt,blockHash:'0x'+'33'.repeat(32)}},
      {receipt:{...receipt,logs:[]}},
      {canonical:{hash:'0x'+'44'.repeat(32),number:'0xe7'}},
      {badId:true},
    ]){
      const ctx=fixture(variants);
      await expect(reconcileIncomingUsdc(ctx.db,owner,env,ctx.fetchImpl)).rejects.toThrow(IncomingUsdcError);
      expect(ctx.events).toHaveLength(0);
      expect(ctx.cursor).toBeUndefined();
      expect(ctx.alertCount).toBe(0);
    }
  });
  it('only persists chain-verified funds once and advances a bounded durable cursor',async()=>{
    const ctx=fixture();
    const result=await reconcileIncomingUsdc(ctx.db,owner,env,ctx.fetchImpl);
    expect(result).toMatchObject({ok:true,newNotifications:1,scope:'arc-testnet-usdc'});
    expect(ctx.events).toHaveLength(1);
    expect(ctx.events[0]).toMatchObject({ownerUserId:owner,walletId,amountBaseUnits:'2500000',
      tokenAddress:ARC_USDC,recipientAddress:addr,txHash});
    expect(ctx.cursor).toBe(232);
    expect(ctx.alertCount).toBe(1);
    const calls=(ctx.fetchCalls as unknown as ReturnType<typeof vi.fn>).mock.calls
      .map((entry:unknown[])=>{
        const body=(entry[1] as RequestInit).body;
        return JSON.parse(typeof body==='string'?body:'{}') as {method:string;params:unknown[]};
      });
    const filters=calls.find(item=>item.method==='eth_getLogs');
    expect(filters?.params[0]).toMatchObject({address:ARC_USDC,topics:[TRANSFER_TOPIC,null,recipientTopic(addr)]});
    // A second scan of the same finalized range is a no-op.
    expect((await reconcileIncomingUsdc(ctx.db,owner,env,ctx.fetchImpl)).newNotifications).toBe(0);
    expect(ctx.alertCount).toBe(1);
  });
  it('does not request chain data if owner has no Arc active wallet; rejects unsafe RPC URLs',async()=>{
    const ctx=fixture();
    const noWallet={
      select:()=>({from:()=>({innerJoin:()=>({where:()=>({limit:()=>Promise.resolve([])})})})}),
    } as unknown as DbClient;
    expect((await reconcileIncomingUsdc(noWallet,owner,env,ctx.fetchImpl)).checked).toBe(0);
    expect(ctx.fetchCalls).not.toHaveBeenCalled();
    await expect(reconcileIncomingUsdc(noWallet,owner,
      {ARC_TESTNET_RPC_URL:'http://untrusted.example/rpc'},ctx.fetchImpl)).rejects.toThrow();
  });
  it('exposes only a signed, rate-limited sync endpoint without user-supplied tx claims',()=>{
    const bff=file('server/bff.ts');
    const sql=file('server/db/migrations/0017_phase17_incoming_usdc.sql');
    const service=file('server/services/incomingUsdcService.ts');
    expect(bff).toContain("app.post('/api/notifications/sync-incoming',INCOMING_SYNC_RATE");
    expect(bff).toContain('const owner=getAuthenticatedVeyraUserId(req)');
    expect(bff).toContain('res.json(await reconcileIncomingUsdc(db,owner))');
    expect(bff).not.toContain("app.post('/api/notifications/create'");
    expect(service).toContain("eq(walletBindings.status,'ACTIVE')");
    expect(service).toContain("eq(veyraUsers.status,'ACTIVE')");
    expect(service).toContain('CONFIRMATIONS=24');
    expect(service).toContain('receipt.status');
    expect(service).toContain("kind:'PAYMENT_RECEIVED'");
    expect(sql).toContain('UNIQUE(chain_id,tx_hash,log_index)');
    expect(sql).toContain('incoming_usdc_cursors');
  });
});
