import {describe,it,expect} from 'vitest';
import {assertPilotDatabaseHost,decideMainnetPilotBootstrap,mainnetPilotBootstrapEnabled}
 from '../../server/db/bootstrapMainnetPilot';
const correct='postgres://u:p@dpg-dbk4ingu01pc7391im20-a/veyra_mainnet_v1_db';
describe('single-use isolated Render Mainnet database bootstrap',()=>{
 it('refuses all other Render database instances regardless of their db name',()=>{
  expect(()=>assertPilotDatabaseHost(correct)).not.toThrow();
  for(const u of [
   'postgres://u:p@dpg-other-a/veyra_mainnet_v1_db',
   'postgres://u:p@veyra-testnet-acceptance-db/veyra_mainnet_v1_db',
   'postgres://u:p@localhost/veyra_mainnet_v1_db',
  ])expect(()=>assertPilotDatabaseHost(u)).toThrow();
 });
 it('is disabled unless explicitly enabled and only creates a completely blank schema',()=>{
  expect(mainnetPilotBootstrapEnabled({})).toBe(false);
  expect(mainnetPilotBootstrapEnabled({VEYRA_MAINNET_BOOTSTRAP_SCHEMA:'1'})).toBe(true);
  expect(decideMainnetPilotBootstrap({publicTables:0,drizzleMigrationCount:0,essentialTables:[]})).toBe('create');
  expect(decideMainnetPilotBootstrap({publicTables:4,drizzleMigrationCount:21,
   essentialTables:['veyra_users','wallet_bindings','identity_snapshots','mainnet_direct_pay_receipts']})).toBe('already-ready');
  for(const data of [
   {publicTables:1,drizzleMigrationCount:0,essentialTables:[]},
   {publicTables:20,drizzleMigrationCount:19,essentialTables:['veyra_users']},
   {publicTables:4,drizzleMigrationCount:0,essentialTables:['veyra_users','wallet_bindings','identity_snapshots','mainnet_direct_pay_receipts']},
  ])expect(()=>decideMainnetPilotBootstrap(data)).toThrow('MAINNET_BOOTSTRAP_REFUSED');
 });
});
