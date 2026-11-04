/** Strictly isolated restoration rehearsal. This runner can NEVER point at
 * the approved Mainnet PostgreSQL instance, even when a database is renamed.
 */
import {Pool} from 'pg';
import {MAINNET_PILOT_RENDER_HOST} from './mainnetPilotMigrationGate.js';
import {checkSettlementUpgradeSchema} from './settlementMigrationPreflight.js';
import {runDatabaseMigrations} from './migrationService.js';

export type M0RestoreTarget={url:string;databaseName:string;host:string};
export function assertM0RestoreTarget(env:NodeJS.ProcessEnv):M0RestoreTarget{
 const databaseName=env.VEYRA_M0_RESTORE_DATABASE_NAME??'';
 const approvedHost=(env.VEYRA_M0_RESTORE_HOST??'').toLowerCase();
 const raw=env.VEYRA_M0_RESTORE_DATABASE_URL;
 if(!raw)throw Error('M0_RESTORE_URL_MISSING');
 let u:URL;
 try{u=new URL(raw)}catch{throw Error('M0_RESTORE_INVALID_URL');}
 const host=u.hostname.toLowerCase();
 if(!/^[a-z][a-z0-9_]{3,62}$/.test(databaseName)||
   databaseName==='veyra_mainnet_v1_db'||/testnet|acceptance/i.test(databaseName))
  throw Error('M0_RESTORE_DATABASE_NOT_ISOLATED');
 if(u.pathname!=='/'+databaseName||!['postgres:','postgresql:'].includes(u.protocol)||
   u.searchParams.has('options'))
  throw Error('M0_RESTORE_DATABASE_MISMATCH');
 if(!approvedHost||host!==approvedHost||!/^dpg-[a-z0-9-]+(?:[.][a-z0-9.-]+)?$/.test(host))
  throw Error('M0_RESTORE_INSTANCE_NOT_PINNED');
 if(host===MAINNET_PILOT_RENDER_HOST||
    host.startsWith(MAINNET_PILOT_RENDER_HOST+'.')||
    /testnet|acceptance/i.test(host))
  throw Error('M0_RESTORE_PRODUCTION_OR_TESTNET_HOST_BLOCKED');
 if(env.VEYRA_M0_RESTORE_PRIVATE_NETWORK!=='1'&&
   !['require','verify-ca','verify-full'].includes(u.searchParams.get('sslmode')??''))
  throw Error('M0_RESTORE_NEEDS_PRIVATE_NETWORK_OR_TLS');
 if(env.RELAY_PRIVATE_KEY)throw Error('M0_RESTORE_RELAY_KEY_FORBIDDEN');
 return {url:raw,databaseName,host};
}
export function assertM0RestoreWriteApproval(env:NodeJS.ProcessEnv):M0RestoreTarget{
 const target=assertM0RestoreTarget(env);
 if(env.VEYRA_M0_RESTORE_CONFIRM!==target.databaseName||
    env.VEYRA_M0_RESTORE_REHEARSAL_ONLY!=='1'||
    !env.VEYRA_M0_RESTORE_BACKUP_REFERENCE?.trim())
  throw Error('M0_RESTORE_REHEARSAL_NOT_APPROVED');
 return target;
}

const legacy=['veyra_users','wallet_bindings','identity_snapshots',
 'mainnet_direct_pay_receipts'] as const;
/** Compare full data digests and counts without displaying identity records.
 * The 10,000 row cap prevents accidentally hashing a large live database.
 */
export async function legacyRestoreFingerprint(url:string){
 const pool=new Pool({connectionString:url,max:1,connectionTimeoutMillis:8000,query_timeout:12000});
 try{
  const c=await pool.connect();
  try{
   await c.query('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
   const result:Record<string,{rows:string;digest:string}>={};
   for(const table of legacy){
    const rows=await c.query<{n:string}>(`SELECT count(*)::text AS n FROM public.${table}`);
    const n=Number(rows.rows[0]?.n??NaN);
    if(!Number.isSafeInteger(n)||n>10000)throw Error('M0_RESTORE_DATASET_CAP_EXCEEDED');
    const digest=await c.query<{digest:string}>(`
     SELECT md5(coalesce(string_agg(to_jsonb(t)::text, E'\\n' ORDER BY to_jsonb(t)::text),'')) AS digest
     FROM public.${table} t`);
    result[table]={rows:String(n),digest:digest.rows[0]?.digest??''};
   }
   return result;
  }finally{await c.query('ROLLBACK').catch(()=>{});c.release();}
 }finally{await pool.end();}
}
export async function runM0RestoreRehearsal(env:NodeJS.ProcessEnv):Promise<void>{
 const t=assertM0RestoreWriteApproval(env);
 const target={kind:'restore' as const,databaseName:t.databaseName};
 const before=await checkSettlementUpgradeSchema(t.url,target);
 if(before!=='upgrade-0021')throw Error('M0_RESTORE_EXPECTED_PRE_0021_SCHEMA');
 const baseline=await legacyRestoreFingerprint(t.url);
 // This can only modify the explicitly approved RESTORED, isolated database.
 await runDatabaseMigrations(t.url);
 const after=await checkSettlementUpgradeSchema(t.url,target);
 if(after!=='already-ready')throw Error('M0_RESTORE_MIGRATION_POSTFLIGHT_FAILED');
 const current=await legacyRestoreFingerprint(t.url);
 if(JSON.stringify(baseline)!==JSON.stringify(current))
  throw Error('M0_RESTORE_LEGACY_ROWS_CHANGED');
 // Run a single synthetic receipt DB write/read inside ROLLBACK on the copy.
 const pool=new Pool({connectionString:t.url,max:1,connectionTimeoutMillis:8000});
 try{
  const c=await pool.connect();
  try{
   await c.query('BEGIN');
   const owner=await c.query<{id:string}>(
    'SELECT veyr_user_id AS id FROM veyra_users ORDER BY veyr_user_id LIMIT 1');
   if(owner.rows[0]?.id){
    const tx='0x'+'f'.repeat(64),ref='0x'+'e'.repeat(64);
    await c.query(`INSERT INTO mainnet_settlement_receipts
     (tx_hash,chain_id,contract_address,payment_id,payment_ref,sender_address,
      recipient_address,sender_user_id,amount_raw,net_amount_raw,protocol_fee_raw,
      network_fee_wei,block_number,paid_at) VALUES
     ($1,5042,$2,$3,$3,$2,$2,$4,'10000','9900','100','0',1,now())`,
     [tx,'0x'+'1'.repeat(40),ref,owner.rows[0].id]);
    const check=await c.query<{n:string}>(
     'SELECT count(*)::text AS n FROM mainnet_settlement_receipts WHERE tx_hash=$1',[tx]);
    if(check.rows[0]?.n!=='1')throw Error('M0_RESTORE_RECEIPT_WRITE_READ_FAILED');
   }
  }finally{await c.query('ROLLBACK').catch(()=>{});c.release();}
 }finally{await pool.end();}
 console.log('[m0-restore] verified: 0021 migration; legacy data fingerprints; receipt write/read rolled back');
 console.log('[m0-restore] restore-only success. This does NOT authorize Production migration.');
}
if(import.meta.main){
 runM0RestoreRehearsal(process.env).catch(e=>{
  console.error('[m0-restore] refused:',e instanceof Error?e.message:'unknown');
  process.exitCode=1;
 });
}
