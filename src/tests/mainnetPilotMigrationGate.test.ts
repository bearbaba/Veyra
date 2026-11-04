import {describe,it,expect} from 'vitest';
import {assertMainnetPilotMigrationTarget,assertMainnetSettlementUpgradeApproval} from '../../server/db/mainnetPilotMigrationGate';
const base:NodeJS.ProcessEnv={
 VEYRA_ENV:'mainnet',NODE_ENV:'production',VEYRA_MAINNET_IDENTITY_ONLY:'1',
 VEYRA_MAINNET_MIGRATE_CONFIRM:'veyra_mainnet_v1_db',VEYRA_DATABASE_PRIVATE_NETWORK:'1',
 DATABASE_URL:'postgresql://user:password@dpg-dbk4ingu01pc7391im20-a/veyra_mainnet_v1_db',
};
describe('Mainnet V1 isolated receipt migration target',()=>{
 it('permits only exact new Mainnet Pilot db under explicit approval',()=>{
  expect(assertMainnetPilotMigrationTarget(base)).toBe(base.DATABASE_URL);
 });
 it('rejects legacy Testnet DB, accidental default database and missing confirmation',()=>{
  for(const change of [
   {VEYRA_MAINNET_MIGRATE_CONFIRM:undefined},{VEYRA_ENV:'testnet'},
   // A copy on another Render cluster is NOT the authorized database.
   {DATABASE_URL:'postgresql://user:p@dpg-other-instance/veyra_mainnet_v1_db'},
   {DATABASE_URL:'postgresql://user:p@dpg-dbk4ingu01pc7391im20-ax/veyra_mainnet_v1_db'},
   {VEYRA_MAINNET_IDENTITY_ONLY:'0'},{NODE_ENV:'development'},
   {DATABASE_URL:undefined},{DATABASE_URL:'postgres://user:p@localhost/veyra_mainnet_v1_db'},
   {DATABASE_URL:'postgres://user:p@testnet-db/veyra_mainnet_v1_db'},
   {DATABASE_URL:'postgresql://user:p@dpg-mainnet.internal/veyra_testnet_acceptance_db'},
   {DATABASE_URL:'postgresql://user:p@dpg-mainnet.internal/veyra_mainnet_v1_db?options=evil'},
   {VEYRA_DATABASE_PRIVATE_NETWORK:'0'},
   {RELAY_PRIVATE_KEY:'0x'+'1'.repeat(64)},
  ])expect(()=>assertMainnetPilotMigrationTarget({...base,...change})).toThrow();
 });
 it('requires an explicit 0021 release, a recently verified restorable backup and exact DB host',()=>{
  const release={...base,
   VEYRA_MAINNET_MIGRATION_TARGET_VERSION:'0021_mainnet_settlement_receipts',
   VEYRA_MAINNET_BACKUP_REFERENCE:'render-snapshot-verified-by-operator',
   VEYRA_MAINNET_BACKUP_VERIFIED_AT:new Date(Date.now()-60_000).toISOString(),
   VEYRA_MAINNET_BACKUP_RESTORABLE:'1',
  };
  expect(assertMainnetSettlementUpgradeApproval(release)).toBe(base.DATABASE_URL);
  for(const patch of [
   {VEYRA_MAINNET_MIGRATION_TARGET_VERSION:undefined},
   {VEYRA_MAINNET_MIGRATION_TARGET_VERSION:'0020_mainnet_direct_pay_receipts'},
   {VEYRA_MAINNET_BACKUP_REFERENCE:undefined},
   {VEYRA_MAINNET_BACKUP_REFERENCE:'none'},
   {VEYRA_MAINNET_BACKUP_RESTORABLE:'0'},
   {VEYRA_MAINNET_BACKUP_VERIFIED_AT:undefined},
   {VEYRA_MAINNET_BACKUP_VERIFIED_AT:new Date(Date.now()-48*60*60*1000).toISOString()},
   {VEYRA_MAINNET_BACKUP_VERIFIED_AT:new Date(Date.now()+60_000).toISOString()},
   {DATABASE_URL:'postgresql://user:p@dpg-unauthorized-a/veyra_mainnet_v1_db'},
  ])expect(()=>assertMainnetSettlementUpgradeApproval({...release,...patch})).toThrow();
 });
});
