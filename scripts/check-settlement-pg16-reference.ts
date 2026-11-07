/** Compare PostgreSQL 16's OWN pg_get_constraintdef() output from an
 * isolated schema created using 0021 SQL, against the committed reference.
 * No lossy normalization is permitted.
 */
import {readFileSync} from 'node:fs';
import {EXPECTED_PG16_SETTLEMENT_CONSTRAINTS} from '../server/db/settlementMigrationPreflight.js';
type ReferenceRow={name:string;type:string;definition:string};
let rows:ReferenceRow[];
try{rows=JSON.parse(readFileSync(0,'utf8').trim()) as ReferenceRow[];}
catch{throw Error('PG16_REFERENCE_INVALID_JSON');}
const actual=new Map(rows.map(r=>[r.name,r] as const));
const expected=Object.entries(EXPECTED_PG16_SETTLEMENT_CONSTRAINTS);
if(rows.length!==expected.length)throw Error('PG16_REFERENCE_CONSTRAINT_COUNT_MISMATCH');
for(const [name,[type,definition]] of expected){
 const row=actual.get(name);
 if(!row||row.type!==type||row.definition!==definition){
  console.error('PG16 canonical definition mismatch:',name,
   'expected=',definition,'actual=',row?.definition??'(missing)');
  throw Error('PG16_REFERENCE_DIFFERENT_FROM_PINNED_MIGRATION');
 }
}
console.log('[m0-release] PostgreSQL 16 exact canonical constraints: PASS');
