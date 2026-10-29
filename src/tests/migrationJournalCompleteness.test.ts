import {describe,it,expect} from 'vitest';
import {readFileSync,readdirSync} from 'node:fs';
const root=(path:string)=>readFileSync(new URL('../../'+path,import.meta.url),'utf8');
describe('Release gate: every committed SQL migration is in Drizzle journal',()=>{
 it('registers all SQL files in sorted order exactly once',()=>{
  const dir=new URL('../../server/db/migrations/',import.meta.url);
  const files=readdirSync(dir).filter(f=>/^\d{4}_.+\.sql$/.test(f))
   .map(f=>f.slice(0,-4)).sort();
  const json=JSON.parse(root('server/db/migrations/meta/_journal.json')) as {
   entries:Array<{idx:number;version:string;when:number;tag:string}>;
  };
  expect(json.entries.map(e=>e.tag)).toEqual(files);
  expect(new Set(json.entries.map(e=>e.tag)).size).toBe(files.length);
  for(let i=0;i<json.entries.length;i++){
   expect(json.entries[i].idx).toBe(i);
   expect(json.entries[i].version).toBe('7');
   if(i>0)expect(json.entries[i].when).toBeGreaterThan(json.entries[i-1].when);
  }
 });
 it('ensures quote/trade owner-bound tables are present in migration 0019',()=>{
  const sql=root('server/db/migrations/0019_stablefx_owner_bound_attempts.sql');
  expect(sql).toContain('CREATE TABLE IF NOT EXISTS stablefx_quote_bindings');
  expect(sql).toContain('CREATE TABLE IF NOT EXISTS stablefx_trade_attempts');
  expect(sql).toContain('owner_user_id');
  expect(sql).toContain('idempotency_key text PRIMARY KEY');
  expect(sql).not.toMatch(/DROP TABLE|TRUNCATE TABLE/);
 });
});
