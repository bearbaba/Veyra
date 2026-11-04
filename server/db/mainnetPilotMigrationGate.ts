/** Migration target must be the newly provisioned isolated Mainnet pilot DB.
 * Never target historical Testnet, any default local DB or a user-provided generic DB.
 */
/** The only authorized Render Mainnet Pilot Postgres instance. This is a
 * public host identifier, not a connection secret. Do not trust a matching
 * database name on another Render account, cluster or generic host. */
export const MAINNET_PILOT_RENDER_HOST='dpg-dbk4ingu01pc7391im20-a';
export function assertMainnetPilotDatabaseHost(databaseUrl:string):void{
 let host:string;
 try{host=new URL(databaseUrl).hostname.toLowerCase();}
 catch{throw Error('INVALID_MAINNET_MIGRATION_TARGET');}
 if(host!==MAINNET_PILOT_RENDER_HOST&&
    !host.startsWith(MAINNET_PILOT_RENDER_HOST+'.'))
  throw Error('MAINNET_DATABASE_HOST_IS_NOT_THE_APPROVED_RENDER_INSTANCE');
}
export function assertMainnetPilotMigrationTarget(env:NodeJS.ProcessEnv):string{
 const name='veyra_mainnet_v1_db';
 if(env.VEYRA_ENV!=='mainnet'||env.NODE_ENV!=='production'||
  env.VEYRA_MAINNET_IDENTITY_ONLY!=='1'||
  env.VEYRA_MAINNET_MIGRATE_CONFIRM!==name)
  throw Error('MAINNET_MIGRATION_NOT_EXPLICITLY_APPROVED');
 // Require the exact newly-created DB instance; don't trust only a DB name.
 const raw=env.DATABASE_URL;
 if(!raw)throw Error('MAINNET_DATABASE_URL_MISSING');
 let target:URL;
 try{target=new URL(raw)}catch{throw Error('INVALID_MAINNET_MIGRATION_TARGET');}
 if(!['postgres:','postgresql:'].includes(target.protocol)||
    target.pathname!==('/'+name)||!target.hostname||
    /localhost|127\.0\.0\.1|testnet|acceptance|sepolia/i.test(target.hostname)||
    target.searchParams.has('options'))
   throw Error('INVALID_MAINNET_MIGRATION_TARGET');
 if(env.VEYRA_DATABASE_PRIVATE_NETWORK!=='1'&&
   !['require','verify-ca','verify-full'].includes(target.searchParams.get('sslmode')??''))
   throw Error('MAINNET_MIGRATION_REQUIRES_TLS_OR_PRIVATE_NETWORK');
 assertMainnetPilotDatabaseHost(raw);
 if(env.RELAY_PRIVATE_KEY)throw Error('MAINNET_MIGRATION_CANNOT_USE_RELAY_KEY');
 return raw;
}

/** Intentionally separate from the empty-DB bootstrap. Applying additive
 * migration 0021 to existing user data requires explicit evidence of a
 * current, restorable backup; merely setting the database name is insufficient.
 * Only the operator can verify a backup. Never fabricate its reference.
 */
export function assertMainnetSettlementUpgradeApproval(env:NodeJS.ProcessEnv):string{
 const url=assertMainnetPilotMigrationTarget(env);
 if(env.VEYRA_MAINNET_MIGRATION_TARGET_VERSION!=='0021_mainnet_settlement_receipts')
  throw Error('MAINNET_MIGRATION_VERSION_NOT_APPROVED');
 const backup=env.VEYRA_MAINNET_BACKUP_REFERENCE;
 if(typeof backup!=='string'||backup.trim().length<12||backup.length>256)
  throw Error('MAINNET_BACKUP_REFERENCE_REQUIRED');
 const raw=env.VEYRA_MAINNET_BACKUP_VERIFIED_AT;
 if(typeof raw!=='string'||!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?Z$/.test(raw))
  throw Error('MAINNET_BACKUP_VERIFICATION_TIMESTAMP_REQUIRED');
 const verified=Date.parse(raw);
 if(!Number.isFinite(verified)||verified>Date.now()||
   Date.now()-verified>24*60*60*1000)
  throw Error('MAINNET_BACKUP_VERIFICATION_NOT_RECENT');
 if(env.VEYRA_MAINNET_BACKUP_RESTORABLE!=='1')
  throw Error('MAINNET_BACKUP_RESTORE_NOT_VERIFIED');
 return url;
}
