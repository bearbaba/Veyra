/** Read-only schema preflight for a separately approved Mainnet 0021 upgrade.
 * Never calls migrate, creates a table, changes security settings, or logs URLs.
 * Journal counts alone do not prove that receipt permissions and constraints exist.
 */
import {Pool} from 'pg';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';

type SchemaColumn={name:string;nullable:boolean};
type SchemaIndex={name:string;definition:string;valid:boolean;ready:boolean};
type SchemaConstraint={name:string;definition:string;type:string;validated:boolean;deferrable:boolean};
export type MigrationRecord={hash:string;createdAt:number};
export type SettlementSchemaPreflight={
 currentDatabase:string;migrations:number;tables:string[];serverVersionNum?:number;
 settlementColumns?:SchemaColumn[];
 settlementIndexes?:SchemaIndex[];
 settlementConstraints?:SchemaConstraint[];
 actualHistory?:MigrationRecord[];expectedHistory?:MigrationRecord[];
};

/** Restore rehearsal NEVER authorizes a Production migration. The restored DB
 * needs an explicit distinct name and host checked by the rehearsal runner. */
export type SettlementSchemaTarget=
 |{kind:'production'}
 |{kind:'restore';databaseName:string};
export function validateSettlementSchemaTarget(actual:string,target:SettlementSchemaTarget):void{
 if(target.kind==='production'){
  if(actual!=='veyra_mainnet_v1_db')throw Error('SETTLEMENT_UPGRADE_WRONG_DATABASE');
  return;
 }
 if(!/^[a-z][a-z0-9_]{3,62}$/.test(target.databaseName)||
    target.databaseName==='veyra_mainnet_v1_db'||/testnet|acceptance/i.test(target.databaseName)||
    target.databaseName!==actual)
  throw Error('SETTLEMENT_RESTORE_TARGET_NOT_ISOLATED');
}
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


/** Drizzle 0.45 migration identity = SHA256 of exact SQL text + journal.when.
 * Refuse missing/duplicated/out-of-order rows, not merely an incorrect count.
 */
export function expectedSettlementMigrationHistory():MigrationRecord[]{
 const dir=join(dirname(fileURLToPath(import.meta.url)),'migrations');
 const journal=JSON.parse(readFileSync(join(dir,'meta/_journal.json'),'utf8')) as {
  version?:string;dialect?:string;
  entries?:Array<{idx:number;when:number;tag:string}>;
 };
 const entries=journal.entries??[];
 if(journal.version!=='7'||journal.dialect!=='postgresql'||(entries.length!==22&&entries.length!==23)||
    entries[20]?.tag!=='0020_mainnet_direct_pay_receipts'||
    entries[21]?.tag!=='0021_mainnet_settlement_receipts'||
    (entries.length===23&&entries[22]?.tag!=='0022_veyra_payment_requests'))
  throw Error('SETTLEMENT_MIGRATION_JOURNAL_UNEXPECTED');
 let prev=0;
 return entries.map((entry,i)=>{
  if(entry.idx!==i||!Number.isSafeInteger(entry.when)||entry.when<=prev||
     !/^\d{4}_[a-z0-9_]+$/.test(entry.tag))
   throw Error('SETTLEMENT_MIGRATION_JOURNAL_UNEXPECTED');
  prev=entry.when;
  const sqlText=readFileSync(join(dir,entry.tag+'.sql'),'utf8');
  return {hash:createHash('sha256').update(sqlText).digest('hex'),createdAt:entry.when};
 });
}
export function assertExactSettlementMigrationHistory(
 actual:MigrationRecord[]|undefined, expected:MigrationRecord[]|undefined,count:number,
):void{
 if(!actual||!expected||(expected.length!==22&&expected.length!==23)||actual.length!==count||
    (count!==21&&count!==22&&count!==23)||
    actual.some((entry,i)=>entry.hash!==expected[i]?.hash||
      !Number.isSafeInteger(entry.createdAt)||entry.createdAt!==expected[i]?.createdAt))
  throw Error('SETTLEMENT_MIGRATION_HISTORY_MISMATCH');
}

/** PostgreSQL 16 pg_get_constraintdef() output from an isolated reference
 * schema created by the checked-in migration SQL. Compare byte-for-byte:
 * never strip parentheses, quotes, regex character classes, or case.
 * The CI PostgreSQL 16 reference test must validate these pinned definitions.
 */
export const EXPECTED_PG16_SETTLEMENT_CONSTRAINTS:Readonly<Record<string,readonly [string,string]>>={
 mainnet_settlement_receipts_pkey:['p','PRIMARY KEY (tx_hash)'],
 mainnet_settlement_receipts_tx_hash_check:['c',"CHECK ((tx_hash ~ '^0x[0-9a-f]{64}$'::text))"],
 mainnet_settlement_receipts_chain_id_check:['c','CHECK ((chain_id = 5042))'],
 mainnet_settlement_receipts_payment_id_check:['c',"CHECK ((payment_id ~ '^0x[0-9a-f]{64}$'::text))"],
 mainnet_settlement_receipts_payment_ref_check:['c',"CHECK ((payment_ref ~ '^0x[0-9a-f]{64}$'::text))"],
 mainnet_settlement_receipts_amount_raw_check:['c',"CHECK ((amount_raw ~ '^[1-9][0-9]*$'::text))"],
 mainnet_settlement_receipts_net_amount_raw_check:['c',"CHECK ((net_amount_raw ~ '^[1-9][0-9]*$'::text))"],
 mainnet_settlement_receipts_protocol_fee_raw_check:['c',"CHECK ((protocol_fee_raw ~ '^[0-9]+$'::text))"],
 mainnet_settlement_receipts_network_fee_wei_check:['c',"CHECK ((network_fee_wei ~ '^[0-9]+$'::text))"],
 mainnet_settlement_receipts_block_number_check:['c','CHECK ((block_number > 0))'],
 mainnet_settlement_receipts_sender_private_note_check:['c','CHECK ((char_length(sender_private_note) <= 120))'],
 settlement_payer_or_receiver_bound:['c','CHECK (((sender_user_id IS NOT NULL) OR (recipient_user_id IS NOT NULL)))'],
 settlement_net_fee_matches_gross:['c','CHECK (((amount_raw)::numeric = ((net_amount_raw)::numeric + (protocol_fee_raw)::numeric)))'],
};

/** Fail closed if a recorded migration left incomplete or altered SQL objects. */
export function evaluateSettlementUpgradeSchema(
 state:SettlementSchemaPreflight,target:SettlementSchemaTarget={kind:'production'},
):'upgrade-0021'|'already-ready'{
 validateSettlementSchemaTarget(state.currentDatabase,target);
 if(state.serverVersionNum!==undefined&&
    (!Number.isSafeInteger(state.serverVersionNum)||
     state.serverVersionNum<160000||state.serverVersionNum>=170000))
  throw Error('SETTLEMENT_PG16_REQUIRED');
 const tables=new Set(state.tables);
 const required=['veyra_users','wallet_bindings','identity_snapshots',
  'mainnet_direct_pay_receipts'];
 if(!required.every(t=>tables.has(t)))
  throw Error('SETTLEMENT_UPGRADE_MISSING_LEGACY_SCHEMA');
 assertExactSettlementMigrationHistory(state.actualHistory,state.expectedHistory,state.migrations);
 const settlement=tables.has('mainnet_settlement_receipts');
 if(state.migrations===21&&!settlement)return 'upgrade-0021';
 if((state.migrations===22||state.migrations===23)&&settlement){
  const columns=new Map<string,SchemaColumn>((state.settlementColumns??[]).map(c=>[c.name,c] as const));
  const constraints=new Map<string,SchemaConstraint>(
   (state.settlementConstraints??[]).map(c=>[c.name,c] as const));
  const completeColumns=REQUIRED_COLUMNS.every(c=>columns.has(c));
  const requiredNotNull=NOT_NULL_COLUMNS.every(c=>columns.get(c)?.nullable===false);
  const completeConstraints=REQUIRED_CONSTRAINTS.every(name=>{
   const actual=constraints.get(name),wanted=EXPECTED_PG16_SETTLEMENT_CONSTRAINTS[name];
   return actual!==undefined&&wanted!==undefined&&actual.type===wanted[0]&&
    actual.validated===true&&actual.deferrable===false&&
    actual.definition===wanted[1];
  });
  const validIndexes=[
   ['ix_mainnet_settlement_sender',/\(\s*sender_user_id\s*,\s*paid_at\s+DESC\s*\)/i],
   ['ix_mainnet_settlement_recipient',/\(\s*recipient_user_id\s*,\s*paid_at\s+DESC\s*\)/i],
  ] as const;
  if(!completeColumns||!requiredNotNull||!completeConstraints||
     !validIndexes.every(([name,pattern])=>{
       const ix=state.settlementIndexes?.find(x=>x.name===name);
       return ix?.valid===true&&ix.ready===true&&pattern.test(ix.definition);
     }))
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
 databaseUrl:string,target:SettlementSchemaTarget={kind:'production'},
):Promise<'upgrade-0021'|'already-ready'>{
 const expectedHistory=expectedSettlementMigrationHistory();
 const pool=new Pool({connectionString:databaseUrl,max:1,
  connectionTimeoutMillis:8000,query_timeout:8000,
  application_name:'veyra_settlement_0021_read_only_preflight'});
 try{
  const c=await pool.connect();
  try{
   await c.query('BEGIN READ ONLY');
   const [db,schema,migrationTable,version]=await Promise.all([
    c.query<{name:string}>('SELECT current_database() AS name'),
    c.query<{tablename:string}>(
     "SELECT tablename FROM pg_tables WHERE schemaname='public'"),
    c.query<{present:boolean}>(
     "SELECT to_regclass('drizzle.__drizzle_migrations') IS NOT NULL AS present"),
    c.query<{num:string}>("SELECT current_setting('server_version_num') AS num"),
   ]);
   if(!migrationTable.rows[0]?.present)
    throw Error('SETTLEMENT_UPGRADE_MIGRATION_JOURNAL_MISSING');
   const journal=await c.query<{hash:string;createdAt:string}>(
    'SELECT hash,created_at::text AS "createdAt" FROM drizzle.__drizzle_migrations ORDER BY created_at ASC,id ASC');
   const actualHistory=journal.rows.map(r=>({hash:r.hash,createdAt:Number(r.createdAt)}));
   const migrations=actualHistory.length;
   const hasReceipt=schema.rows.some(r=>r.tablename==='mainnet_settlement_receipts');
   let settlementColumns:SchemaColumn[]|undefined;
   let settlementIndexes:SchemaIndex[]|undefined;
   let settlementConstraints:SchemaConstraint[]|undefined;
   if((migrations===22||migrations===23)&&hasReceipt){
    const [cols,idx,checks]=await Promise.all([
     c.query<{column_name:string;is_nullable:string}>(
      "SELECT column_name,is_nullable FROM information_schema.columns WHERE table_schema='public' AND table_name='mainnet_settlement_receipts'"),
     c.query<{indexname:string;indexdef:string;valid:boolean;ready:boolean}>(`
      SELECT cls.relname AS indexname,pg_get_indexdef(ix.indexrelid) AS indexdef,
       ix.indisvalid AS valid,ix.indisready AS ready
      FROM pg_index ix JOIN pg_class cls ON cls.oid=ix.indexrelid
      WHERE ix.indrelid='public.mainnet_settlement_receipts'::regclass`),
     c.query<{conname:string;definition:string;contype:string;convalidated:boolean;condeferrable:boolean}>(`
      SELECT conname,pg_get_constraintdef(oid) AS definition,contype,convalidated,condeferrable
      FROM pg_constraint WHERE conrelid='public.mainnet_settlement_receipts'::regclass`),
    ]);
    settlementColumns=cols.rows.map(r=>({name:r.column_name,nullable:r.is_nullable==='YES'}));
    settlementIndexes=idx.rows.map(r=>({name:r.indexname,definition:r.indexdef,
     valid:r.valid,ready:r.ready}));
    settlementConstraints=checks.rows.map(r=>({name:r.conname,definition:r.definition,
     type:r.contype,validated:r.convalidated,deferrable:r.condeferrable}));
   }
   return evaluateSettlementUpgradeSchema({
    currentDatabase:db.rows[0]?.name??'',migrations,actualHistory,expectedHistory,
    serverVersionNum:Number(version.rows[0]?.num??NaN),
    tables:schema.rows.map(r=>r.tablename),
    settlementColumns,settlementIndexes,settlementConstraints,
   },target);
  }finally{
   await c.query('ROLLBACK').catch(()=>undefined);
   c.release();
  }
 }finally{await pool.end().catch(()=>undefined);}
}
