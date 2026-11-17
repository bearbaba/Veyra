/** Run intentionally from Mainnet Render BFF Shell only, after a database backup.
 * Example:
 *   Follow docs/MAINNET_SETTLEMENT_RECEIPTS_ACCEPTANCE.md. A recent, verified\n *   restorable backup reference and exact migration version must be supplied.
 */
import {assertMainnetSettlementUpgradeApproval} from './mainnetPilotMigrationGate.js';
import {runDatabaseMigrations} from './migrationService.js';
import {checkSettlementUpgradeSchema} from './settlementMigrationPreflight.js';
const url=assertMainnetSettlementUpgradeApproval(process.env);
try{
 const state=await checkSettlementUpgradeSchema(url);
 if(state==='already-ready'){
  console.log('[mainnet-pilot] Settlement schema 0021 already present; no migration executed');
 }else{
  console.log('[mainnet-pilot] upgrading exact approved Mainnet database with backed-up additive 0021 migration');
  await runDatabaseMigrations(url);
  if(await checkSettlementUpgradeSchema(url)!=='already-ready')
   throw Error('MAINNET_SETTLEMENT_MIGRATION_POSTFLIGHT_INCOMPLETE');
  console.log('[mainnet-pilot] verified additive Settlement receipt schema; old Pay history retained');
 }
}catch(e){
 console.error('[mainnet-pilot] migration aborted safely:',e instanceof Error?e.message:'unknown');
 process.exitCode=1;
}
