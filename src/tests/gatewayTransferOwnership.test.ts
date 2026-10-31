import {describe,expect,it} from 'vitest';
import {parseOwnedGatewayTransferStatus} from '../../server/services/gatewayTransferOwnership';

const wallet='0x1111111111111111111111111111111111111111';
const other='0x2222222222222222222222222222222222222222';
const id='a1b2c3d4-e5f6-7890-abcd-ef1234567890';
const padded='0x'+'0'.repeat(24)+wallet.slice(2);
const tx='0x'+'ab'.repeat(32);

describe('Gateway status cannot be queried by another Veyra identity',()=>{
 it('exposes only limited status with exact Circle source depositor evidence',()=>{
  const status=parseOwnedGatewayTransferStatus({
   transferId:id,status:'confirmed',burnIntent:{spec:{sourceDepositor:padded}},
   forwardTxHash:tx,recipientAddress:other,
  },wallet,id);
  expect(status).toEqual({providerStatus:'confirmed',destinationTxHash:tx});
  expect(status).not.toHaveProperty('settlementVerified');
  // A generic source txHash must never be labeled a destination mint.
  const sourceOnly=parseOwnedGatewayTransferStatus({
   transferId:id,status:'confirmed',sourceDepositor:wallet,txHash:tx,
  },wallet,id);
  expect(sourceOnly.destinationTxHash).toBeUndefined();
 });
 it('rejects arbitrary valid transferId without depositor proof or a foreign owner',()=>{
  expect(()=>parseOwnedGatewayTransferStatus({transferId:id,status:'confirmed'},wallet,id))
   .toThrow('GATEWAY_STATUS_UNVERIFIED_OWNER');
  expect(()=>parseOwnedGatewayTransferStatus({
   transferId:id,status:'confirmed',sourceDepositor:other,
  },wallet,id)).toThrow('GATEWAY_STATUS_UNVERIFIED_OWNER');
  expect(()=>parseOwnedGatewayTransferStatus({
   transferId:id,status:'confirmed',sourceDepositor:wallet,
   burnIntent:{spec:{sourceDepositor:other}},
  },wallet,id)).toThrow('GATEWAY_STATUS_UNVERIFIED_OWNER');
 });
 it('rejects altered transfer IDs, non-padded bytes32, malformed statuses',()=>{
  const valid={transferId:id,sourceDepositor:wallet,status:'pending'};
  expect(()=>parseOwnedGatewayTransferStatus(valid,wallet,'other-transfer-id'))
   .toThrow('GATEWAY_STATUS_TRANSFER_ID_MISMATCH');
  expect(()=>parseOwnedGatewayTransferStatus({
   ...valid,sourceDepositor:'0x'+'ff'.repeat(12)+wallet.slice(2),
  },wallet,id)).toThrow('GATEWAY_STATUS_UNVERIFIED_OWNER');
  expect(()=>parseOwnedGatewayTransferStatus({...valid,status:'CONFIRMED<svg>'},wallet,id))
   .toThrow('GATEWAY_STATUS_MALFORMED');
 });
});
