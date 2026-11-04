import {describe,it,expect} from 'vitest';
import {evaluateSettlementUpgradeSchema} from '../../server/db/settlementMigrationPreflight';
const base={
 currentDatabase:'veyra_mainnet_v1_db',
 tables:['veyra_users','wallet_bindings','identity_snapshots',
  'mainnet_direct_pay_receipts'],
 migrations:21,
};
describe('Backed-up Mainnet Settlement additive migration preflight',()=>{
 it('allows exactly a complete 0020 schema to upgrade by one migration',()=>{
  expect(evaluateSettlementUpgradeSchema(base)).toBe('upgrade-0021');
 });
 it('identifies a consistent already-upgraded 0021 schema without rewriting anything',()=>{
  expect(evaluateSettlementUpgradeSchema({...base,migrations:22,
   tables:[...base.tables,'mainnet_settlement_receipts']}))
   .toBe('already-ready');
 });
 it('refuses migration journal drift, partial installation and arbitrary additional changes',()=>{
  for(const state of [
   {...base,migrations:20},
   {...base,migrations:0},
   {...base,migrations:23},
   {...base,migrations:22},
   {...base,migrations:21,tables:[...base.tables,'mainnet_settlement_receipts']},
   {...base,currentDatabase:'veyra_testnet_acceptance_db'},
   {...base,tables:base.tables.slice(0,3)},
   {...base,migrations:Number.NaN},
  ])expect(()=>evaluateSettlementUpgradeSchema(state)).toThrow();
 });
});
