import {describe,expect,it} from 'vitest';
import {createGatewayEstimateRequest,parseGatewayEstimate} from '../../server/services/gatewayEstimate';
const owner='0x4C7cb73aC8F8999af21cfc9fF4cF2333a9508Dcb';
const recipient='0x1111111111111111111111111111111111111111';
const salt='0x'+'12'.repeat(32);
const source=26,destination=6;
const create=()=>createGatewayEstimateRequest({
 walletAddress:owner,recipientAddress:recipient,
 sourceDomain:source,destinationDomain:destination,amount:'2.500001',salt,
});
describe('Circle Gateway estimate trust boundary',()=>{
 it('pins all token, domain, wallet, value, salt and caller fields',()=>{
  const v=create();
  expect(v.spec.value).toBe('2500001');
  expect(v.spec.sourceDomain).toBe(26);
  expect(v.spec.destinationDomain).toBe(6);
  expect(v.spec.sourceDepositor.endsWith(owner.toLowerCase().slice(2))).toBe(true);
  expect(v.spec.destinationRecipient.endsWith(recipient.slice(2))).toBe(true);
  expect(v.spec.salt).toBe(salt);
 });
 it('extracts only exact provider fees and block heights',()=>{
  const request=create();
  const response=[{burnIntent:{spec:request.spec,maxFee:'20000',maxBlockHeight:'999999'}}];
  const result=parseGatewayEstimate(response,request);
  expect(result).toEqual({domain:26,maxFee:20000n,maxBlockHeight:999999n});
 });
 it('rejects changed amount, destination, depositor, salt, fee and missing expiry',()=>{
  const request=create();
  for(const [field,value] of [
   ['value','9000000'],['destinationRecipient',request.spec.sourceDepositor],
   ['sourceDepositor',request.spec.destinationRecipient],
   ['salt','0x'+'ff'.repeat(32)],
  ]){
   expect(()=>parseGatewayEstimate([{burnIntent:{
    spec:{...request.spec,[field]:value},maxFee:'2',maxBlockHeight:'1000',
   }}],request)).toThrow('GATEWAY_ESTIMATE_SPEC_CHANGED');
  }
  expect(()=>parseGatewayEstimate([{burnIntent:{
   spec:request.spec,maxFee:'20',maxBlockHeight:'0',
  }}],request)).toThrow('GATEWAY_ESTIMATE_FEE_OR_EXPIRY_MISSING');
  expect(()=>parseGatewayEstimate([{burnIntent:{
   spec:request.spec,maxFee:'300000000000',maxBlockHeight:'500',
  }}],request)).toThrow('GATEWAY_ESTIMATE_OUT_OF_RANGE');
 });
 it('rejects unsupported domains, malformed amount and invalid salt',()=>{
  expect(()=>createGatewayEstimateRequest({
   ...create().input,sourceDomain:1234,
  })).toThrow('GATEWAY_ESTIMATE_DOMAIN_UNSUPPORTED');
  expect(()=>createGatewayEstimateRequest({
   ...create().input,amount:'1e5',
  })).toThrow('GATEWAY_ESTIMATE_ARGUMENT_INVALID');
  expect(()=>createGatewayEstimateRequest({
   ...create().input,salt:'0x1234',
  })).toThrow('GATEWAY_ESTIMATE_ARGUMENT_INVALID');
 });
});
