import {describe,it,expect} from 'vitest';
import {assertV1MigrationApproval,decideV1Migration,type V1Catalog}
 from '../../server/db/mainnetV1JourneysUpgrade';
import {expectedSettlementMigrationHistory} from '../../server/db/settlementMigrationPreflight';
const url='postgresql://u:p@dpg-dbk4ingu01pc7391im20-a/veyra_mainnet_v1_db';
const base:NodeJS.ProcessEnv={
 VEYRA_ENV:'mainnet',NODE_ENV:'production',VEYRA_MAINNET_IDENTITY_ONLY:'1',
 VEYRA_MAINNET_MIGRATE_CONFIRM:'veyra_mainnet_v1_db',
 VEYRA_DATABASE_PRIVATE_NETWORK:'1',DATABASE_URL:url,
 VEYRA_MAINNET_MIGRATION_TARGET_VERSION:'0023_mainnet_pay_journeys',
 VEYRA_MAINNET_BACKUP_REFERENCE:'verified-restore-reference-001',
 VEYRA_MAINNET_BACKUP_VERIFIED_AT:new Date(Date.now()-60000).toISOString(),
 VEYRA_MAINNET_BACKUP_RESTORABLE:'1'
};
const history=expectedSettlementMigrationHistory();
const c:V1Catalog={name:'veyra_mainnet_v1_db',pgVersion:160011,
 history:history.slice(0,22),hasRequests:false,hasJourneys:false,
 requestColumns:0,journeyColumns:0,requestRefIndex:false,journeyOwnerIndex:false};
describe('Mainnet 0022/0023 additive upgrade gates',()=>{
 it('requires exact approved DB, backup, recent restore and migration version',()=>{
  expect(assertV1MigrationApproval(base)).toBe(url);
  for(const change of [
   {VEYRA_MAINNET_MIGRATION_TARGET_VERSION:'0021_mainnet_settlement_receipts'},
   {VEYRA_MAINNET_BACKUP_REFERENCE:undefined},
   {VEYRA_MAINNET_BACKUP_RESTORABLE:'0'},
   {VEYRA_MAINNET_BACKUP_VERIFIED_AT:new Date(Date.now()-172800000).toISOString()},
   {VEYRA_MAINNET_IDENTITY_ONLY:'0'},
   {DATABASE_URL:'postgresql://u:p@dpg-other/veyra_mainnet_v1_db'},
  ])expect(()=>assertV1MigrationApproval({...base,...change})).toThrow();
 });
 it('refuses partial schemas, mismatched migration journal and wrong database',()=>{
  expect(decideV1Migration(c)).toBe('0022+0023');
  const middle={...c,history:history.slice(0,23),hasRequests:true,
   requestColumns:13,requestRefIndex:true};
  expect(decideV1Migration(middle)).toBe('0023');
  expect(decideV1Migration({...middle,history,hasJourneys:true,
   journeyColumns:8,journeyOwnerIndex:true})).toBe('ready');
  for(const broken of [
   {...c,hasRequests:true},{...middle,requestColumns:12},
   {...middle,history:history.slice(0,22)},
   {...middle,history:history.slice(0,22).concat([{...history[22],hash:'0'.repeat(64)}])},
   {...middle,history,hasJourneys:true,journeyColumns:0},
   {...c,name:'veyra_testnet_db'}, {...c,pgVersion:150000},
  ])expect(()=>decideV1Migration(broken)).toThrow();
 });
});
