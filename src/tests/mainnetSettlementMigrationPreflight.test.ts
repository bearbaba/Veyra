import {describe,it,expect} from 'vitest';
import {evaluateSettlementUpgradeSchema} from '../../server/db/settlementMigrationPreflight';

const legacyTables=['veyra_users','wallet_bindings','identity_snapshots',
 'mainnet_direct_pay_receipts'];
const base={
 currentDatabase:'veyra_mainnet_v1_db',tables:legacyTables,migrations:21,
};
const columns=[
 'tx_hash','chain_id','contract_address','payment_id','payment_ref',
 'sender_address','recipient_address','sender_user_id','recipient_user_id',
 'recipient_snapshot_id','recipient_label','amount_raw','net_amount_raw',
 'protocol_fee_raw','network_fee_wei','block_number','paid_at',
 'sender_private_note','created_at','verified_at',
];
const nullable=new Set(['sender_user_id','recipient_user_id','recipient_snapshot_id',
 'recipient_label','sender_private_note']);
const constraints=[
 'mainnet_settlement_receipts_pkey',
 'mainnet_settlement_receipts_tx_hash_check',
 'mainnet_settlement_receipts_chain_id_check',
 'mainnet_settlement_receipts_payment_id_check',
 'mainnet_settlement_receipts_payment_ref_check',
 'mainnet_settlement_receipts_amount_raw_check',
 'mainnet_settlement_receipts_net_amount_raw_check',
 'mainnet_settlement_receipts_protocol_fee_raw_check',
 'mainnet_settlement_receipts_network_fee_wei_check',
 'mainnet_settlement_receipts_block_number_check',
 'mainnet_settlement_receipts_sender_private_note_check',
 'settlement_payer_or_receiver_bound',
 'settlement_net_fee_matches_gross',
];
const indexes=[
 {name:'ix_mainnet_settlement_sender',
  definition:'CREATE INDEX ix_mainnet_settlement_sender ON public.mainnet_settlement_receipts USING btree (sender_user_id, paid_at DESC)'},
 {name:'ix_mainnet_settlement_recipient',
  definition:'CREATE INDEX ix_mainnet_settlement_recipient ON public.mainnet_settlement_receipts USING btree (recipient_user_id, paid_at DESC)'},
];
const ready={
 ...base,migrations:22,tables:[...legacyTables,'mainnet_settlement_receipts'],
 settlementColumns:columns.map(name=>({name,nullable:nullable.has(name)})),
 settlementConstraints:constraints,settlementIndexes:indexes,
};
describe('Backed-up Mainnet Settlement additive migration preflight',()=>{
 it('allows exactly legacy 0020 schema to upgrade by one migration',()=>{
  expect(evaluateSettlementUpgradeSchema(base)).toBe('upgrade-0021');
 });
 it('requires full SQL catalog proof, not only 22 journal rows and a table name',()=>{
  expect(evaluateSettlementUpgradeSchema(ready)).toBe('already-ready');
  expect(()=>evaluateSettlementUpgradeSchema({...ready,
   settlementColumns:undefined})).toThrow('SETTLEMENT_UPGRADE_INCOMPLETE_RECEIPT_SCHEMA');
 });
 it('refuses a missing or nullable financial column, missing indexes and missing checks',()=>{
  for(const state of [
   {...ready,settlementColumns:ready.settlementColumns.filter(c=>c.name!=='net_amount_raw')},
   {...ready,settlementColumns:ready.settlementColumns.map(c=>
    c.name==='paid_at'?{...c,nullable:true}:c)},
   {...ready,settlementIndexes:ready.settlementIndexes.slice(0,1)},
   {...ready,settlementIndexes:ready.settlementIndexes.map(i=>({...i,
    definition:i.definition.replace('paid_at DESC','created_at DESC')}))},
   {...ready,settlementConstraints:ready.settlementConstraints.filter(c=>
    c!=='settlement_net_fee_matches_gross')},
  ])expect(()=>evaluateSettlementUpgradeSchema(state))
   .toThrow('SETTLEMENT_UPGRADE_INCOMPLETE_RECEIPT_SCHEMA');
 });
 it('refuses migration journal drift, partial installation, and wrong database',()=>{
  for(const state of [
   {...base,migrations:20},{...base,migrations:0},{...base,migrations:23},
   {...base,migrations:22},
   {...base,migrations:21,tables:ready.tables},
   {...base,currentDatabase:'veyra_testnet_acceptance_db'},
   {...base,tables:legacyTables.slice(0,3)},
   {...base,migrations:Number.NaN},
  ])expect(()=>evaluateSettlementUpgradeSchema(state)).toThrow();
 });
});
