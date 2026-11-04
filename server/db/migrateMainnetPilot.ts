/** Run intentionally from Mainnet Render BFF Shell only, after a database backup.
 * Example:
 *   Follow docs/MAINNET_SETTLEMENT_RECEIPTS_ACCEPTANCE.md. A recent, verified\n *   restorable backup reference and exact migration version must be supplied.
 */
import {assertMainnetSettlementUpgradeApproval} from './mainnetPilotMigrationGate.js';
import {runDatabaseMigrations} from './migrationService.js';
const url=assertMainnetSettlementUpgradeApproval(process.env);
try{
 await runDatabaseMigrations(url);
 console.log('[mainnet-pilot] migrations applied; verify 5042 identity and receipt schema separately.');
}catch(e){
 console.error('[mainnet-pilot] migration aborted safely:',e instanceof Error?e.message:'unknown');
 process.exitCode=1;
}
