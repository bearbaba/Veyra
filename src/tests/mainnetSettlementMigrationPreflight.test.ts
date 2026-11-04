import {describe,it,expect} from 'vitest';
import {evaluateSettlementUpgradeSchema,expectedSettlementMigrationHistory} from '../../server/db/settlementMigrationPreflight';

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
const definitions:Record<string,[string,string]>={
 mainnet_settlement_receipts_pkey:['p','PRIMARY KEY (tx_hash)'],
 mainnet_settlement_receipts_tx_hash_check:['c',"CHECK (tx_hash ~ '^0x[0-9a-f]{64}$')"],
 mainnet_settlement_receipts_chain_id_check:['c','CHECK (chain_id = 5042)'],
 mainnet_settlement_receipts_payment_id_check:['c',"CHECK (payment_id ~ '^0x[0-9a-f]{64}$')"],
 mainnet_settlement_receipts_payment_ref_check:['c',"CHECK (payment_ref ~ '^0x[0-9a-f]{64}$')"],
 mainnet_settlement_receipts_amount_raw_check:['c',"CHECK (amount_raw ~ '^[1-9][0-9]*$')"],
 mainnet_settlement_receipts_net_amount_raw_check:['c',"CHECK (net_amount_raw ~ '^[1-9][0-9]*$')"],
 mainnet_settlement_receipts_protocol_fee_raw_check:['c',"CHECK (protocol_fee_raw ~ '^[0-9]+$')"],
 mainnet_settlement_receipts_network_fee_wei_check:['c',"CHECK (network_fee_wei ~ '^[0-9]+$')"],
 mainnet_settlement_receipts_block_number_check:['c','CHECK (block_number > 0)'],
 mainnet_settlement_receipts_sender_private_note_check:['c','CHECK (char_length(sender_private_note) <= 120)'],
 settlement_payer_or_receiver_bound:['c','CHECK (sender_user_id IS NOT NULL OR recipient_user_id IS NOT NULL)'],
 settlement_net_fee_matches_gross:['c','CHECK ((amount_raw)::numeric = (net_amount_raw)::numeric + (protocol_fee_raw)::numeric)'],
};
const ready={
 ...base,migrations:22,actualHistory:history,tables:[...legacyTables,'mainnet_settlement_receipts'],
 settlementColumns:columns.map(name=>({name,nullable:nullable.has(name)})),
 settlementConstraints:constraints.map(name=>({
  name,type:definitions[name]![0],definition:definitions[name]![1],
  validated:true,deferrable:false,
 })),
 settlementIndexes:indexes.map(i=>({...i,valid:true,ready:true})),
};
describe('Backed-up Mainnet Settlement additive migration preflight',()=>{
 it('checks 22 canonical ordered SQL hashes from committed Drizzle journal',()=>{
  const real=expectedSettlementMigrationHistory();
  expect(real).toHaveLength(22);
  expect(real.every(x=>/^[0-9a-f]{64}$/.test(x.hash))).toBe(true);
 });
 it('rejects altered same-named financial rules and forged Drizzle history',()=>{
  for(const state of [
   {...ready,settlementConstraints:ready.settlementConstraints.map(x=>x.name==='mainnet_settlement_receipts_chain_id_check'?{...x,definition:'CHECK (chain_id = 8453)'}:x)},
   {...ready,settlementConstraints:ready.settlementConstraints.map(x=>x.name==='settlement_net_fee_matches_gross'?{...x,definition:'CHECK ((amount_raw)::numeric >= (net_amount_raw)::numeric)'}:x)},
   {...ready,settlementConstraints:ready.settlementConstraints.map(x=>x.name==='settlement_net_fee_matches_gross'?{...x,validated:false}:x)},
   {...ready,settlementIndexes:ready.settlementIndexes.map(x=>x.name==='ix_mainnet_settlement_sender'?{...x,valid:false}:x)},
   {...base,actualHistory:history.slice(0,21).map((x,i)=>i===11?{...x,hash:'f'.repeat(64)}:x)},
   {...base,actualHistory:[...history.slice(0,20),history[19]!] },
   {...base,actualHistory:[...history.slice(0,20),{...history[20]!,createdAt:9999999999999}]},
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
