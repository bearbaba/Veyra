/** Migration target must be the newly provisioned isolated Mainnet pilot DB.
 * Never target historical Testnet, any default local DB or a user-provided generic DB.
 */
export function assertMainnetPilotMigrationTarget(env:NodeJS.ProcessEnv):string{
 const name='veyra_mainnet_v1_db';
 if(env.VEYRA_ENV!=='mainnet'||env.NODE_ENV!=='production'||
  env.VEYRA_MAINNET_IDENTITY_ONLY!=='1'||
  env.VEYRA_MAINNET_MIGRATE_CONFIRM!==name)
  throw Error('MAINNET_MIGRATION_NOT_EXPLICITLY_APPROVED');
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
 if(env.RELAY_PRIVATE_KEY)throw Error('MAINNET_MIGRATION_CANNOT_USE_RELAY_KEY');
 return raw;
}
