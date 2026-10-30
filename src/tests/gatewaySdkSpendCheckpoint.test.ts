import {describe,expect,it} from 'vitest';
import {gatewaySpendKey,prepareGatewaySpendCheckpoint,readGatewaySpendCheckpoint}
 from '../core/gateway/gatewaySdkSpend';

const owner='0x1111111111111111111111111111111111111111';
const recipient='0x2222222222222222222222222222222222222222';
const identity='usr_owner_bound_test_only';
const input={owner,recipient,identity,amount:'1.25',sourceChainId:5042002,
 destinationChainId:84532};
const memory=new Map<string,string>();
const store={
 getItem(key:string){return memory.get(key)??null;},
 setItem(key:string,value:string){memory.set(key,value);},
};
describe('Gateway user-scoped pending send checkpoint',()=>{
 it('persists unresolved outcome and cannot cross wallet/identity boundaries',()=>{
  memory.clear();
  const pending=prepareGatewaySpendCheckpoint(input,12345);
  expect(pending.state).toBe('SUBMISSION_UNKNOWN');
  const key=gatewaySpendKey(owner,identity);
  store.setItem(key,JSON.stringify(pending));
  expect(readGatewaySpendCheckpoint(store,owner,identity)).toEqual(pending);
  expect(readGatewaySpendCheckpoint(store,owner,'usr_other')).toBeNull();
  expect(readGatewaySpendCheckpoint(store,recipient,identity)).toBeNull();
 });
 it('rejects invalid owner, amount, unsupported network and corrupted state',()=>{
  expect(()=>prepareGatewaySpendCheckpoint({...input,amount:'1.0000001'})).toThrow();
  expect(()=>prepareGatewaySpendCheckpoint({...input,amount:'0'})).toThrow();
  expect(()=>prepareGatewaySpendCheckpoint({...input,sourceChainId:1})).toThrow();
  expect(()=>prepareGatewaySpendCheckpoint({...input,recipient:'invalid'})).toThrow();
  const key=gatewaySpendKey(owner,identity);
  store.setItem(key,JSON.stringify({...prepareGatewaySpendCheckpoint(input),
    state:'VERIFIED'}));
  expect(readGatewaySpendCheckpoint(store,owner,identity)).toBeNull();
  store.setItem(key,'not json');
  expect(readGatewaySpendCheckpoint(store,owner,identity)).toBeNull();
 });
});
