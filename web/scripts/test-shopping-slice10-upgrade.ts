import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import postgres from 'postgres';
import { shoppingCompatibilityFixture } from '../src/test/shopping-compatibility-fixtures';
import { initializeShoppingDocument } from '../src/lib/shopping-initialization';
import { projectShoppingDocument } from '../src/lib/shopping-document';
import { readShoppingCompatibility } from '../src/lib/shopping-compatibility';
import { shoppingRowCoverage } from '../src/lib/shopping-coverage-runtime';

const db=postgres({host:'127.0.0.1',port:57322,database:'postgres',user:'postgres',password:'postgres',max:1,onnotice:()=>{}});
const evidencePath='../.codex-artifacts/slice10/upgrade-state.json';
const json=(value:unknown)=>db.json(JSON.parse(JSON.stringify(value)));
let checks=0;
function check(actual:unknown,expected:unknown,label:string){assert.deepEqual(actual,expected,label);checks++;console.log('PASS '+label);}
async function rows(ids:string[]){return db`select user_id,document,content_revision,trip_id,trip_revision,content_epoch from public.shopping_list where user_id in ${db(ids)} order by user_id`;}
async function main(){try{
 if(process.argv.includes('--seed')){
  check(Number((await db`select count(*) from auth.users`)[0].count),0,'empty task-owned fixture database before historical seed');
  check((await db`select max(version) as version from supabase_migrations.schema_migrations`)[0].version,'026','historical schema 026');
  const original=shoppingCompatibilityFixture().document;
  original.manualItems[0].checked=true;
  const initialized=initializeShoppingDocument(original,[]);
  const recovered=structuredClone(initialized);
  recovered.preferences.categoryByIngredient.lemon='dairy';
  recovered.preferences.ingredientOrderByCategory.produce=recovered.preferences.ingredientOrderByCategory.produce.filter(key=>key!=='lemon');
  recovered.preferences.ingredientOrderByCategory.dairy=['lemon'];
  recovered.placementEvidence!.resolved.lemon={categories:['dairy'],sequences:{dairy:['lemon']}};
  const row=projectShoppingDocument(recovered,[]).items.find(item=>item.orderingKey==='lemon'&&!item.manualId)!;
  recovered.acknowledgements={lemon:{version:4,basis:{...shoppingRowCoverage(row),comparisonVersion:1}}};
  const owners:string[]=[];
  for(const document of [original,initialized,recovered]){
   const id=randomUUID();owners.push(id);
   await db`insert into auth.users(id,email) values(${id},${`${id}@example.test`})`;
   await db`update public.shopping_list set document=${json(document)},content_revision=content_revision+1 where user_id=${id}`;
  }
  const before=await rows(owners);
  writeFileSync(evidencePath,JSON.stringify({owners,before},null,2));
  check(before.length,3,'populated V3, initialized V4 and recovered V4 with old completion');
 }else{
  const {owners,before}=JSON.parse(readFileSync(evidencePath,'utf8'));
  try{
   // Exact forward files on one reserved connection; migration history is not fabricated.
   for(const file of ['027_shopping_coverage_constraints.sql','028_shopping_organization_versions.sql']){
    await db.unsafe(readFileSync('../supabase/migrations/'+file,'utf8'));
   }
   const after=await rows(owners);check(JSON.parse(JSON.stringify(after)),before,'upgrade preserves every document, revision, trip and epoch byte-for-byte');
   for(const state of after){
    const read=readShoppingCompatibility(state.document,Number(state.content_revision));check(read.status,'Supported','upgraded historical state remains readable');
    assert.equal(read.status,'Supported');if(read.status!=='Supported')throw new Error('Unsupported');
    const projected=projectShoppingDocument(read.state.document,[]);
    check(projected.rows.some(row=>row.manualId==='manual-extra'),true,'ambiguous manual stays visible');
    check(Object.keys(read.state.document.recipeEntries).length,5,'frozen selections including hidden/empty remain available');
    if(read.state.document.acknowledgements?.lemon){
     check(projected.items.find(row=>row.orderingKey==='lemon'&&!row.manualId)?.coverageNeedsRecheck,true,'old completion requires bounded recheck');
     check(read.state.document.acknowledgements.lemon.version,4,'old acknowledgement version preserved');
     check(read.state.document.preferences.ingredientOrderByCategory.dairy,['lemon'],'recovered placement persists');
     check(read.state.document.manualItems[0].identity?.legacy?.previousChecked,true,'previous check retained as evidence');
    }
   }
   writeFileSync('../.codex-artifacts/slice10/upgrade-results.json',JSON.stringify({checks,complete:true,before,after},null,2));
  }finally{for(const id of owners)await db`delete from auth.users where id=${id}`;}
 }
}finally{await db.end();}}
main().catch(error=>{console.error(error);process.exitCode=1;});
