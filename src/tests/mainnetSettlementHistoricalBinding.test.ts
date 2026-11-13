import {describe,it,expect,vi} from 'vitest';
import {readFileSync} from 'node:fs';
import {
 settlementBindingCoveredPayment,settlementBindingAtPayment,
 type SettlementBindingWindow,
} from '../../server/services/mainnetSettlementReceiptService';

const wallet='0x1111111111111111111111111111111111111111';
const paidAt=new Date('2026-11-04T02:00:00.000Z');
const oldOwner: SettlementBindingWindow={
 issuedAt:new Date('2026-11-01T00:00:00.000Z'),
 verifiedAt:new Date('2026-11-01T00:01:00.000Z'),
 revokedAt:null,status:'ACTIVE',
};
describe('Mainnet Settlement historical identity ownership',()=>{
 it('accepts a binding proved BEFORE the original block time',()=>{
  expect(settlementBindingCoveredPayment(oldOwner,paidAt)).toBe(true);
  expect(settlementBindingCoveredPayment({
   ...oldOwner,status:'REVOKED',revokedAt:new Date('2026-11-04T03:00:00Z'),
  },paidAt)).toBe(true);
 });
 it('refuses any binding created or verified AFTER the paid-at block',()=>{
  expect(settlementBindingCoveredPayment({...oldOwner,
   issuedAt:new Date('2026-11-04T02:01:00Z')},paidAt)).toBe(false);
  expect(settlementBindingCoveredPayment({...oldOwner,
   verifiedAt:new Date('2026-11-04T02:01:00Z')},paidAt)).toBe(false);
 });
 it('never attributes an old transaction to the new ID after wallet revocation and relinking',()=>{
  const oldAccount={...oldOwner,status:'REVOKED' as const,
   revokedAt:new Date('2026-11-04T03:00:00Z')};
  const newAccount={...oldOwner,issuedAt:new Date('2026-11-04T04:00:00Z'),
   verifiedAt:new Date('2026-11-04T04:00:05Z')};
  expect(settlementBindingCoveredPayment(oldAccount,paidAt)).toBe(true);
  expect(settlementBindingCoveredPayment(newAccount,paidAt)).toBe(false);
  expect(settlementBindingCoveredPayment(oldAccount,new Date('2026-11-04T04:05:00Z'))).toBe(false);
  expect(settlementBindingCoveredPayment(newAccount,new Date('2026-11-04T04:05:00Z'))).toBe(true);
 });
 it('fails closed on invalid or contradictory binding status and timestamps',()=>{
  expect(settlementBindingCoveredPayment({...oldOwner,status:'REVOKED',revokedAt:null},paidAt)).toBe(false);
  expect(settlementBindingCoveredPayment({...oldOwner,revokedAt:new Date('2026-11-04T01:00:00Z')},paidAt)).toBe(false);
  expect(settlementBindingCoveredPayment({...oldOwner,status:'REVOKED',
   revokedAt:paidAt},paidAt)).toBe(false);
  expect(settlementBindingCoveredPayment({...oldOwner,
   verifiedAt:new Date('garbled timestamp')},paidAt)).toBe(false);
  expect(settlementBindingCoveredPayment(oldOwner,new Date('not a timestamp'))).toBe(false);
 });
 it('requires exactly one historical Arc wallet binding and rejects ambiguous associations',async()=>{
  const execute=vi.fn().mockResolvedValueOnce({rows:[{userId:'usr_A',walletAddress:wallet}]})
   .mockResolvedValueOnce({rows:[]})
   .mockResolvedValueOnce({rows:[{userId:'usr_A',walletAddress:wallet},
    {userId:'usr_B',walletAddress:wallet}]});
  const db={execute} as unknown as Parameters<typeof settlementBindingAtPayment>[0];
  expect(await settlementBindingAtPayment(db,wallet,paidAt)).toMatchObject({userId:'usr_A'});
  expect(await settlementBindingAtPayment(db,wallet,paidAt)).toBe(null);
  expect(await settlementBindingAtPayment(db,wallet,paidAt)).toBe(null);
  expect(await settlementBindingAtPayment(db,'not a wallet',paidAt)).toBe(null);
  expect(execute).toHaveBeenCalledTimes(3);
 });
 it('SQL implementation checks chain, signed verification time, and historical revocation cutoff',()=>{
  const source=readFileSync(new URL('../../server/services/mainnetSettlementReceiptService.ts',import.meta.url),'utf8');
  expect(source).toContain('wb.chain_id=5042');
  expect(source).toContain('wb.issued_at<=');
  expect(source).toContain('wb.verified_at<=');
  expect(source).toContain("wb.status='REVOKED'");
  expect(source).toContain('wb.revoked_at>');
  expect(source).toContain('LIMIT 2');
  expect(source).toContain('settlementBindingAtPayment(db,proof.sender,paidAt)');
  expect(source).toContain('settlementBindingAtPayment(db,proof.recipient,paidAt)');
 });
});
