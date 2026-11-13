/** One-shot, isolated database bootstrap. There is NO HTTP endpoint for this.
 * This ONLY creates the known schema on a completely empty, exact Render
 * PostgreSQL pilot. Any partial, existing or unknown schema fails closed.
 */
import {Pool} from 'pg';
import {runDatabaseMigrations} from './migrationService.js';
import {assertMainnetPilotMigrationTarget,assertMainnetPilotDatabaseHost} from './mainnetPilotMigrationGate.js';

const REQUIRED_TABLES=[
 'veyra_users','wallet_bindings','identity_snapshots','mainnet_direct_pay_receipts',
 'mainnet_settlement_receipts',
] as const;
export function mainnetPilotBootstrapEnabled(env:NodeJS.ProcessEnv):boolean{
 return env.VEYRA_MAINNET_BOOTSTRAP_SCHEMA==='1';
}
export function assertPilotDatabaseHost(databaseUrl:string):void{
 assertMainnetPilotDatabaseHost(databaseUrl);
}
type SchemaState={publicTables:number;drizzleMigrationCount:number;essentialTables:string[]};
export function decideMainnetPilotBootstrap(state:SchemaState):'create'|'already-ready'{
 const ready=REQUIRED_TABLES.every(t=>state.essentialTables.includes(t));
 if(ready&&state.drizzleMigrationCount>=22)return 'already-ready';
 if(state.publicTables===0&&state.drizzleMigrationCount===0)return 'create';
 throw Error('MAINNET_BOOTSTRAP_REFUSED_PARTIAL_OR_UNEXPECTED_SCHEMA');
}
export async function bootstrapMainnetPilotIfRequested(
 env:NodeJS.ProcessEnv=process.env,
):Promise<void>{
 if(!mainnetPilotBootstrapEnabled(env))return;
 const url=assertMainnetPilotMigrationTarget(env);
 assertPilotDatabaseHost(url);
 const pool=new Pool({connectionString:url,max:1,connectionTimeoutMillis:8000});
 const client=await pool.connect();
 let locked=false;
 try{
  const db=await client.query<{name:string}>('SELECT current_database() AS name');
  if(db.rows[0]?.name!=='veyra_mainnet_v1_db')
   throw Error('WRONG_MAINNET_DATABASE');
  // Prevent multiple Render instances or concurrent bootstraps racing.
  await client.query('SELECT pg_advisory_lock(5042,20261102)');
  locked=true;
  const schema=await client.query<{tablename:string}>(
   "SELECT tablename FROM pg_tables WHERE schemaname='public'");
  const oldMigrations=await client.query<{present:boolean}>(
   "SELECT to_regclass('drizzle.__drizzle_migrations') IS NOT NULL AS present");
  let count=0;
  if(oldMigrations.rows[0]?.present){
   const c=await client.query<{count:string}>(
    'SELECT COUNT(*)::text AS count FROM drizzle.__drizzle_migrations');
   count=Number(c.rows[0]?.count??0);
  }
  const state={publicTables:schema.rows.length,drizzleMigrationCount:count,
   essentialTables:schema.rows.map(x=>x.tablename)};
  const choice=decideMainnetPilotBootstrap(state);
  if(choice==='already-ready'){
   console.log('[mainnet-pilot] expected schema already exists; no migration ran');
   return;
  }
  console.log('[mainnet-pilot] initializing empty, approved Mainnet database');
  await runDatabaseMigrations(url);
  const after=await client.query<{table_name:string}>(
   "SELECT table_name FROM information_schema.tables WHERE table_schema='public'");
  const tables=new Set(after.rows.map(x=>x.table_name));
  if(!REQUIRED_TABLES.every(x=>tables.has(x)))
   throw Error('MAINNET_BOOTSTRAP_SCHEMA_NOT_READY');
  const migrations=await client.query<{count:string}>(
   'SELECT COUNT(*)::text AS count FROM drizzle.__drizzle_migrations');
  if(Number(migrations.rows[0]?.count??0)<22)
   throw Error('MAINNET_BOOTSTRAP_MIGRATIONS_INCOMPLETE');
  console.log('[mainnet-pilot] isolated database schema initialized and checked');
 }finally{
  if(locked)await client.query('SELECT pg_advisory_unlock(5042,20261102)').catch(()=>{});
  client.release();
  await pool.end().catch(()=>{});
 }
}
