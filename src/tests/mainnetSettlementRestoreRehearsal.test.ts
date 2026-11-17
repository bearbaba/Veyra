import {describe,it,expect} from 'vitest';
import {assertM0RestoreTarget,assertM0RestoreWriteApproval}
 from '../../server/db/rehearseMainnetSettlementRestore';

const base={
 VEYRA_M0_RESTORE_DATABASE_NAME:'veyra_m0_restore_20261104',
 VEYRA_M0_RESTORE_HOST:'dpg-restored-safe-a.internal',
 VEYRA_M0_RESTORE_DATABASE_URL:
  'postgresql://user:dummy@dpg-restored-safe-a.internal/veyra_m0_restore_20261104',
 VEYRA_M0_RESTORE_PRIVATE_NETWORK:'1',
};
describe('Separate restored PostgreSQL 16 M0 rehearsal, production fail-closed',()=>{
 it('accepts a separately named and explicitly pinned restored instance',()=>{
  const result=assertM0RestoreTarget(base);
  expect(result.databaseName).toBe('veyra_m0_restore_20261104');
  expect(result.host).toBe('dpg-restored-safe-a.internal');
 });
 it('never accepts live Mainnet or Testnet host, even with a renamed database',()=>{
  for(const host of [
   'dpg-dbk4ingu01pc7391im20-a',
   'dpg-dbk4ingu01pc7391im20-a.singapore-postgres.render.com',
   'dpg-testnet-acceptance-a.internal',
   'localhost',
  ]){
   const env={...base,VEYRA_M0_RESTORE_HOST:host,
    VEYRA_M0_RESTORE_DATABASE_URL:'postgresql://u:dummy@'+host+'/veyra_m0_restore_20261104'};
   expect(()=>assertM0RestoreTarget(env)).toThrow();
  }
 });
 it('refuses source name mismatch and a forged restore confirmation',()=>{
  expect(()=>assertM0RestoreTarget({...base,
   VEYRA_M0_RESTORE_DATABASE_NAME:'veyra_mainnet_v1_db'})).toThrow();
  expect(()=>assertM0RestoreTarget({...base,
   VEYRA_M0_RESTORE_HOST:'dpg-other-host.internal'})).toThrow();
  expect(()=>assertM0RestoreWriteApproval(base)).toThrow();
  expect(assertM0RestoreWriteApproval({...base,
   VEYRA_M0_RESTORE_CONFIRM:'veyra_m0_restore_20261104',
   VEYRA_M0_RESTORE_REHEARSAL_ONLY:'1',
   VEYRA_M0_RESTORE_BACKUP_REFERENCE:'operator-verified-restore-20261104'}).host)
    .toBe('dpg-restored-safe-a.internal');
 });
});
