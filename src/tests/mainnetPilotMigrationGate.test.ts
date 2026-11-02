import {describe,it,expect} from 'vitest';
import {assertMainnetPilotMigrationTarget} from '../../server/db/mainnetPilotMigrationGate';
const base:NodeJS.ProcessEnv={
 VEYRA_ENV:'mainnet',NODE_ENV:'production',VEYRA_MAINNET_IDENTITY_ONLY:'1',
 VEYRA_MAINNET_MIGRATE_CONFIRM:'veyra_mainnet_v1_db',VEYRA_DATABASE_PRIVATE_NETWORK:'1',
 DATABASE_URL:'postgresql://user:password@dpg-mainnet.internal/veyra_mainnet_v1_db',
};
describe('Mainnet V1 isolated receipt migration target',()=>{
 it('permits only exact new Mainnet Pilot db under explicit approval',()=>{
  expect(assertMainnetPilotMigrationTarget(base)).toBe(base.DATABASE_URL);
 });
 it('rejects legacy Testnet DB, accidental default database and missing confirmation',()=>{
  for(const change of [
   {VEYRA_MAINNET_MIGRATE_CONFIRM:undefined},{VEYRA_ENV:'testnet'},
   {VEYRA_MAINNET_IDENTITY_ONLY:'0'},{NODE_ENV:'development'},
   {DATABASE_URL:undefined},{DATABASE_URL:'postgres://user:p@localhost/veyra_mainnet_v1_db'},
   {DATABASE_URL:'postgres://user:p@testnet-db/veyra_mainnet_v1_db'},
   {DATABASE_URL:'postgresql://user:p@dpg-mainnet.internal/veyra_testnet_acceptance_db'},
   {DATABASE_URL:'postgresql://user:p@dpg-mainnet.internal/veyra_mainnet_v1_db?options=evil'},
   {VEYRA_DATABASE_PRIVATE_NETWORK:'0'},
   {RELAY_PRIVATE_KEY:'0x'+'1'.repeat(64)},
  ])expect(()=>assertMainnetPilotMigrationTarget({...base,...change})).toThrow();
 });
});
