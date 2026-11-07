import {describe,it,expect} from 'vitest';
import {evaluateSettlementUpgradeSchema,expectedSettlementMigrationHistory,EXPECTED_PG16_SETTLEMENT_CONSTRAINTS} from '../../server/db/settlementMigrationPreflight';

const legacyTables=['veyra_users','wallet_bindings','identity_snapshots',
 'mainnet_direct_pay_receipts'];
const history=Array.from({length:22},(_,i)=>({
 hash:i.toString(16).padStart(64,'0'),createdAt:1791000000000+i*10000,
}));
const base={
 currentDatabase:'veyra_mainnet_v1_db',tables:legacyTables,migrations:21,actualHistory:history.slice(0,21),expectedHistory:history,
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
 ...base,migrations:22,actualHistory:history,tables:[...legacyTables,'mainnet_settlement_receipts'],
 settlementColumns:columns.map(name=>({name,nullable:nullable.has(name)})),
 settlementConstraints:constraints.map(name=>({
  name,type:EXPECTED_PG16_SETTLEMENT_CONSTRAINTS[name][0],definition:EXPECTED_PG16_SETTLEMENT_CONSTRAINTS[name][1],
  validated:true,deferrable:false,
 })),
 settlementIndexes:indexes.map(i=>({...i,valid:true,ready:true})),
};
describe('Backed-up Mainnet Settlement additive migration preflight',()=>{
 it('keeps the PG16 normalized SQL definition exact: regex case and parentheses matter',()=>{
  expect(EXPECTED_PG16_SETTLEMENT_CONSTRAINTS.mainnet_settlement_receipts_tx_hash_check[1])
   .toContain('[0-9a-f]');
  expect(evaluateSettlementUpgradeSchema(ready)).toBe('already-ready');
  const sameNameDifferentRegex={...ready,settlementConstraints:ready.settlementConstraints.map(c=>
   c.name==='mainnet_settlement_receipts_tx_hash_check'?
    {...c,definition:c.definition.replace('[0-9a-f]','[0-9A-F]')}:c)};
  expect(()=>evaluateSettlementUpgradeSchema(sameNameDifferentRegex))
   .toThrow('SETTLEMENT_UPGRADE_INCOMPLETE_RECEIPT_SCHEMA');
 });
 it('permits a named isolated restore DB for read-only rehearsal but never production',()=>{
  expect(evaluateSettlementUpgradeSchema({...base,currentDatabase:'veyra_m0_restore_20261104'},
   {kind:'restore',databaseName:'veyra_m0_restore_20261104'})).toBe('upgrade-0021');
  expect(()=>evaluateSettlementUpgradeSchema(base,
   {kind:'restore',databaseName:'veyra_mainnet_v1_db'})).toThrow();
  expect(()=>evaluateSettlementUpgradeSchema(base,
   {kind:'restore',databaseName:'veyra_m0_restore_20261104'})).toThrow();
  expect(()=>evaluateSettlementUpgradeSchema({...base,currentDatabase:'veyra_m0_restore_20261104'}))
   .toThrow('SETTLEMENT_UPGRADE_WRONG_DATABASE');
 });

 it('checks the complete canonical SQL history including additive requests and cross-device journey migrations',()=>{
  const real=expectedSettlementMigrationHistory();
  expect(real).toHaveLength(24);
  expect(real[23]?.createdAt).toBeGreaterThan(real[22]?.createdAt??0);
  expect(real[22]?.createdAt).toBeGreaterThan(real[21]?.createdAt??0);
  expect(real.every(x=>/^[0-9a-f]{64}$/.test(x.hash))).toBe(true);
 });
 it('rejects altered same-named financial rules and forged Drizzle history',()=>{
  for(const state of [
   {...ready,settlementConstraints:ready.settlementConstraints.map(x=>x.name==='mainnet_settlement_receipts_chain_id_check'?{...x,definition:'CHECK (chain_id = 8453)'}:x)},
   {...ready,settlementConstraints:ready.settlementConstraints.map(x=>x.name==='settlement_net_fee_matches_gross'?{...x,definition:'CHECK ((amount_raw)::numeric >= (net_amount_raw)::numeric)'}:x)},
   {...ready,settlementConstraints:ready.settlementConstraints.map(x=>x.name==='settlement_net_fee_matches_gross'?{...x,validated:false}:x)},
   {...ready,settlementIndexes:ready.settlementIndexes.map(x=>x.name==='ix_mainnet_settlement_sender'?{...x,valid:false}:x)},
   {...base,actualHistory:history.slice(0,21).map((x,i)=>i===11?{...x,hash:'f'.repeat(64)}:x)},
   {...base,actualHistory:[...history.slice(0,20),history[19]] },
   {...base,actualHistory:[...history.slice(0,20),{...history[20],createdAt:9999999999999}]},
  ])expect(()=>evaluateSettlementUpgradeSchema(state)).toThrow();
 });
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
    c.name!=='settlement_net_fee_matches_gross')},
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
