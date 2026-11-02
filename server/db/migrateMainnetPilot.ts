/** Run intentionally from Mainnet Render BFF Shell only, after a database backup.
 * Example:
 *   VEYRA_MAINNET_MIGRATE_CONFIRM=veyra_mainnet_v1_db bun server/db/migrateMainnetPilot.ts
 */
import {assertMainnetPilotMigrationTarget} from './mainnetPilotMigrationGate.js';
import {runDatabaseMigrations} from './migrationService.js';
const url=assertMainnetPilotMigrationTarget(process.env);
try{
 await runDatabaseMigrations(url);
 console.log('[mainnet-pilot] migrations applied; verify 5042 identity and receipt schema separately.');
}catch(e){
 console.error('[mainnet-pilot] migration aborted safely:',e instanceof Error?e.message:'unknown');
 process.exitCode=1;
}
