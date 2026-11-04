/** Read-only schema preflight for a separately approved Mainnet 0021 upgrade.
 * Never calls migrate, creates a table, changes security settings, or logs URL.
 */
import {Pool} from 'pg';
export type SettlementSchemaPreflight={
 currentDatabase:string;migrations:number;tables:string[];
};
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
 if(state.migrations===22&&settlement)return 'already-ready';
 throw Error('SETTLEMENT_UPGRADE_UNEXPECTED_MIGRATION_STATE');
}
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
   return evaluateSettlementUpgradeSchema({
    currentDatabase:db.rows[0]?.name??'',
    migrations:Number(journal.rows[0]?.count??NaN),
    tables:schema.rows.map(r=>r.tablename),
   });
  }finally{
   await c.query('ROLLBACK').catch(()=>undefined);
   c.release();
  }
 }finally{await pool.end().catch(()=>undefined);}
}
