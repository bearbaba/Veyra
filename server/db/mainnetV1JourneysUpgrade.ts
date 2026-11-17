/** Forward-only Mainnet 0022/0023 migration: explicit operator command only.
 * Never executes at server startup. Never changes IP allowlists.
 */
import {Pool} from 'pg';
import {assertMainnetPilotMigrationTarget} from './mainnetPilotMigrationGate.js';
import {assertExactSettlementMigrationHistory,expectedSettlementMigrationHistory,
 checkSettlementUpgradeSchema,type MigrationRecord} from './settlementMigrationPreflight.js';
import {runDatabaseMigrations} from './migrationService.js';

export function assertV1MigrationApproval(env:NodeJS.ProcessEnv):string{
 const url=assertMainnetPilotMigrationTarget(env);
 if(env.VEYRA_MAINNET_MIGRATION_TARGET_VERSION!=='0023_mainnet_pay_journeys')
  throw Error('MAINNET_V1_VERSION_NOT_APPROVED');
 const ref=env.VEYRA_MAINNET_BACKUP_REFERENCE;
 if(typeof ref!=='string'||ref.trim().length<12||ref.length>256)
  throw Error('MAINNET_V1_BACKUP_REFERENCE_REQUIRED');
 const at=env.VEYRA_MAINNET_BACKUP_VERIFIED_AT;
 if(typeof at!=='string'||!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?Z$/.test(at)||
   !Number.isFinite(Date.parse(at))||Date.parse(at)>Date.now()||
   Date.now()-Date.parse(at)>86400000)
  throw Error('MAINNET_V1_RECENT_BACKUP_REQUIRED');
 if(env.VEYRA_MAINNET_BACKUP_RESTORABLE!=='1')
  throw Error('MAINNET_V1_RESTORE_REHEARSAL_REQUIRED');
 if(expectedSettlementMigrationHistory().length!==24)
  throw Error('MAINNET_V1_MIGRATION_SET_CHANGED');
 return url;
}
export type V1Catalog={
 name:string;pgVersion:number;history:MigrationRecord[];
 hasRequests:boolean;hasJourneys:boolean;requestColumns:number;journeyColumns:number;
 requestRefIndex:boolean;journeyOwnerIndex:boolean;
};
export function decideV1Migration(c:V1Catalog):'0022+0023'|'0023'|'ready'{
 if(c.name!=='veyra_mainnet_v1_db'||!Number.isSafeInteger(c.pgVersion)||
    c.pgVersion<160000||c.pgVersion>=170000)throw Error('MAINNET_V1_WRONG_DATABASE');
 const history=expectedSettlementMigrationHistory();
 if(history.length!==24)throw Error('MAINNET_V1_MIGRATION_SET_CHANGED');
 assertExactSettlementMigrationHistory(c.history,history,c.history.length);
 if(c.history.length===22&&!c.hasRequests&&!c.hasJourneys&&c.requestColumns===0&&
  c.journeyColumns===0&&!c.requestRefIndex&&!c.journeyOwnerIndex)return '0022+0023';
 if(c.history.length===23&&c.hasRequests&&!c.hasJourneys&&c.requestColumns===13&&
  c.journeyColumns===0&&c.requestRefIndex&&!c.journeyOwnerIndex)return '0023';
 if(c.history.length===24&&c.hasRequests&&c.hasJourneys&&c.requestColumns===13&&
  c.journeyColumns===8&&c.requestRefIndex&&c.journeyOwnerIndex)return 'ready';
 throw Error('MAINNET_V1_SCHEMA_OR_JOURNAL_PARTIAL');
}
export async function readV1Catalog(url:string):Promise<V1Catalog>{
 const pool=new Pool({connectionString:url,max:1,connectionTimeoutMillis:8000,
  query_timeout:8000,application_name:'veyra_mainnet_0023_readonly_preflight'});
 try{
  const c=await pool.connect();
  try{
   await c.query('BEGIN READ ONLY');
   const db=await c.query<{name:string;pgVersion:string}>(
    "SELECT current_database() AS name,current_setting('server_version_num') AS \"pgVersion\"");
   const exists=await c.query<{present:boolean}>(
    "SELECT to_regclass('drizzle.__drizzle_migrations') IS NOT NULL AS present");
   if(!exists.rows[0]?.present)throw Error('MAINNET_V1_JOURNAL_MISSING');
   const journal=await c.query<{hash:string;createdAt:string}>(
    'SELECT hash,created_at::text AS "createdAt" FROM drizzle.__drizzle_migrations ORDER BY created_at ASC,id ASC');
   const sql=[
    "SELECT to_regclass('public.veyra_payment_requests') IS NOT NULL AS \"hasRequests\",",
    "to_regclass('public.mainnet_pay_journeys') IS NOT NULL AS \"hasJourneys\",",
    "(SELECT count(*)::int FROM information_schema.columns",
    " WHERE table_schema='public' AND table_name='veyra_payment_requests'",
    " AND column_name IN ('request_id','payer_user_id','requester_user_id',",
    " 'recipient_wallet','payment_ref','amount_raw','expires_at','status',",
    " 'claim_id','claim_wallet','claimed_at','tx_hash','client_request_id')) AS \"requestColumns\",",
    "(SELECT count(*)::int FROM information_schema.columns",
    " WHERE table_schema='public' AND table_name='mainnet_pay_journeys'",
    " AND column_name IN ('journey_id','owner_user_id','owner_wallet','payee_wallet',",
    " 'amount_raw','payment_ref','gateway_operation_id','verified_tx_hash')) AS \"journeyColumns\",",
    "EXISTS(SELECT 1 FROM pg_index i JOIN pg_class k ON k.oid=i.indexrelid",
    " JOIN pg_namespace n ON n.oid=k.relnamespace WHERE n.nspname='public'",
    " AND k.relname='uq_payment_requests_ref' AND i.indisvalid AND i.indisready) AS \"requestRefIndex\",",
    "EXISTS(SELECT 1 FROM pg_index i JOIN pg_class k ON k.oid=i.indexrelid",
    " JOIN pg_namespace n ON n.oid=k.relnamespace WHERE n.nspname='public'",
    " AND k.relname='uq_mainnet_pay_journey_one_unresolved_wallet'",
    " AND i.indisvalid AND i.indisready) AS \"journeyOwnerIndex\""
   ].join(' ');
   const catalog=await c.query<Omit<V1Catalog,'name'|'pgVersion'|'history'>>(sql);
   const row=catalog.rows[0];
   if(!row||!db.rows[0])throw Error('MAINNET_V1_SCHEMA_PROBE_UNAVAILABLE');
   return {name:db.rows[0].name,pgVersion:Number(db.rows[0].pgVersion),
    history:journal.rows.map(x=>({hash:x.hash,createdAt:Number(x.createdAt)})),
    ...row};
  }finally{await c.query('ROLLBACK').catch(()=>{});c.release();}
 }finally{await pool.end().catch(()=>{});}
}
export async function runApprovedV1Migration(env:NodeJS.ProcessEnv=process.env){
 const url=assertV1MigrationApproval(env);
 const before=decideV1Migration(await readV1Catalog(url));
 await checkSettlementUpgradeSchema(url);
 if(before==='ready'){
  console.log('[v1-0023] schema already ready, no migration executed');
  return;
 }
 console.log('[v1-0023] applying only journal-pending, approved forward migrations');
 await runDatabaseMigrations(url);
 if(decideV1Migration(await readV1Catalog(url))!=='ready')
  throw Error('MAINNET_V1_POSTFLIGHT_FAILED');
 await checkSettlementUpgradeSchema(url);
 console.log('[v1-0023] migration 0022/0023 independently verified');
}
