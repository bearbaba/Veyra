/** Read-only schema preflight for a separately approved Mainnet 0021 upgrade.
 * Never calls migrate, creates a table, changes security settings, or logs URLs.
 * Journal counts alone do not prove that receipt permissions and constraints exist.
 */
import {Pool} from 'pg';

type SchemaColumn={name:string;nullable:boolean};
type SchemaIndex={name:string;definition:string};
export type SettlementSchemaPreflight={
 currentDatabase:string;migrations:number;tables:string[];
 settlementColumns?:SchemaColumn[];
 settlementIndexes?:SchemaIndex[];
 settlementConstraints?:string[];
};

const REQUIRED_COLUMNS=[
 'tx_hash','chain_id','contract_address','payment_id','payment_ref',
 'sender_address','recipient_address','sender_user_id','recipient_user_id',
 'recipient_snapshot_id','recipient_label','amount_raw','net_amount_raw',
 'protocol_fee_raw','network_fee_wei','block_number','paid_at',
 'sender_private_note','created_at','verified_at',
];
const NOT_NULL_COLUMNS=[
 'tx_hash','chain_id','contract_address','payment_id','payment_ref',
 'sender_address','recipient_address','amount_raw','net_amount_raw',
 'protocol_fee_raw','network_fee_wei','block_number','paid_at',
 'created_at','verified_at',
];
const REQUIRED_CONSTRAINTS=[
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

/** Fail closed if a recorded migration left incomplete or altered SQL objects. */
export function evaluateSettlementUpgradeSchema(
 state:SettlementSchemaPreflight,
):'upgrade-0021'|'already-ready'{
 if(state.currentDatabase!=='veyra_mainnet_v1_db')
  throw Error('SETTLEMENT_UPGRADE_WRONG_DATABASE');
 const tables=new Set(state.tables);
 const required=['veyra_users','wallet_bindings','identity_snapshots',
  'mainnet_direct_pay_receipts'];
 if(!required.every(t=>tables.has(t)))
  throw Error('SETTLEMENT_UPGRADE_MISSING_LEGACY_SCHEMA');
 const settlement=tables.has('mainnet_settlement_receipts');
 if(state.migrations===21&&!settlement)return 'upgrade-0021';
 if(state.migrations===22&&settlement){
  const columns=new Map<string,SchemaColumn>((state.settlementColumns??[]).map(c=>[c.name,c] as const));
  const indexes=new Map<string,string>((state.settlementIndexes??[]).map(i=>[i.name,i.definition] as const));
  const constraints=new Set(state.settlementConstraints??[]);
  const completeColumns=REQUIRED_COLUMNS.every(c=>columns.has(c));
  const requiredNotNull=NOT_NULL_COLUMNS.every(c=>columns.get(c)?.nullable===false);
  const completeConstraints=REQUIRED_CONSTRAINTS.every(c=>constraints.has(c));
  const validIndexes=[
   ['ix_mainnet_settlement_sender',/\(\s*sender_user_id\s*,\s*paid_at\s+DESC\s*\)/i],
   ['ix_mainnet_settlement_recipient',/\(\s*recipient_user_id\s*,\s*paid_at\s+DESC\s*\)/i],
  ] as const;
  if(!completeColumns||!requiredNotNull||!completeConstraints||
     !validIndexes.every(([name,pattern])=>pattern.test(indexes.get(name)??'')))
   throw Error('SETTLEMENT_UPGRADE_INCOMPLETE_RECEIPT_SCHEMA');
  return 'already-ready';
 }
 throw Error('SETTLEMENT_UPGRADE_UNEXPECTED_MIGRATION_STATE');
}

/** Read-only PostgreSQL catalog inspection, including receipt indexes,
 * nullability and financial check constraints. Never asks for credentials
 * outside Render or changes the production IP allowlist.
 */
export async function checkSettlementUpgradeSchema(
 databaseUrl:string,
):Promise<'upgrade-0021'|'already-ready'>{
 const pool=new Pool({connectionString:databaseUrl,max:1,
  connectionTimeoutMillis:8000,query_timeout:8000,
  application_name:'veyra_settlement_0021_read_only_preflight'});
 try{
  const c=await pool.connect();
  try{
   await c.query('BEGIN READ ONLY');
   const [db,schema,migrationTable]=await Promise.all([
    c.query<{name:string}>('SELECT current_database() AS name'),
    c.query<{tablename:string}>(
     "SELECT tablename FROM pg_tables WHERE schemaname='public'"),
    c.query<{present:boolean}>(
     "SELECT to_regclass('drizzle.__drizzle_migrations') IS NOT NULL AS present"),
   ]);
   if(!migrationTable.rows[0]?.present)
    throw Error('SETTLEMENT_UPGRADE_MIGRATION_JOURNAL_MISSING');
   const journal=await c.query<{count:string}>(
    'SELECT count(*)::text AS count FROM drizzle.__drizzle_migrations');
   const migrations=Number(journal.rows[0]?.count??NaN);
   const hasReceipt=schema.rows.some(r=>r.tablename==='mainnet_settlement_receipts');
   let settlementColumns:SchemaColumn[]|undefined;
   let settlementIndexes:SchemaIndex[]|undefined;
   let settlementConstraints:string[]|undefined;
   if(migrations===22&&hasReceipt){
    const [cols,idx,checks]=await Promise.all([
     c.query<{column_name:string;is_nullable:string}>(
      "SELECT column_name,is_nullable FROM information_schema.columns WHERE table_schema='public' AND table_name='mainnet_settlement_receipts'"),
     c.query<{indexname:string;indexdef:string}>(
      "SELECT indexname,indexdef FROM pg_indexes WHERE schemaname='public' AND tablename='mainnet_settlement_receipts'"),
     c.query<{conname:string}>(
      "SELECT conname FROM pg_constraint WHERE conrelid=to_regclass('public.mainnet_settlement_receipts')"),
    ]);
    settlementColumns=cols.rows.map(r=>({name:r.column_name,nullable:r.is_nullable==='YES'}));
    settlementIndexes=idx.rows.map(r=>({name:r.indexname,definition:r.indexdef}));
    settlementConstraints=checks.rows.map(r=>r.conname);
   }
   return evaluateSettlementUpgradeSchema({
    currentDatabase:db.rows[0]?.name??'',migrations,
    tables:schema.rows.map(r=>r.tablename),
    settlementColumns,settlementIndexes,settlementConstraints,
   });
  }finally{
   await c.query('ROLLBACK').catch(()=>undefined);
   c.release();
  }
 }finally{await pool.end().catch(()=>undefined);}
}
