import test from 'node:test';import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';import {run} from '../maintenance/fax-v3-production/runner.mjs';import {authorize,targetConfig,verifyNeon,ENDPOINT,DEVELOPMENT_ENDPOINT} from '../maintenance/fax-v3-production/policy.mjs';
const target={environment:'production',endpoint:ENDPOINT,project:'synthetic-project',branch:'br-production-fixture',developmentBranch:'br-development-fixture',database:'synthetic'};
const env={TOOLKIT_ORIGIN:'https://packardtoolkit.vercel.app',VERCEL_ENV:'production',NEON_API_KEY:'private-api-canary',DATABASE_URL:'postgresql://synthetic:private-password-canary@'+ENDPOINT+'.us-east-1.aws.neon.tech/synthetic?sslmode=require'};
const args=apply=>apply?['--apply','--production','--target','synthetic.json','--authorize','APPLY_002_003_TO_PRODUCTION','--expires-at',new Date(600000).toISOString()]:['--read-only','--production','--target','synthetic.json'];
const request=async(url,options)=>{assert.equal(options.redirect,'error');return {ok:true,json:async()=>url.endsWith('/endpoints/'+DEVELOPMENT_ENDPOINT)?{endpoint:{id:DEVELOPMENT_ENDPOINT,project_id:target.project,branch_id:target.developmentBranch}}:url.includes('/endpoints/')?{endpoint:{id:ENDPOINT,project_id:target.project,branch_id:target.branch,host:ENDPOINT+'.us-east-1.aws.neon.tech',type:'read_write'}}:{branch:{id:target.branch,project_id:target.project}}};};
async function exercise(options={}){
 const queries=[],logs=[],checks=[];let opened=0,commits=0;const c={query:async(sql,params)=>{queries.push({sql,params});if(options.query)await options.query(sql,queries);if(sql==='COMMIT'){commits++;if(options.lostCommit===commits)throw Error('private-driver-canary');}return {rows:sql.includes('pg_try_advisory_lock')?[{locked:!options.busy}]:[]};},end:async()=>queries.push({sql:'END_CONNECTION'})};
 const code=await run({args:args(options.apply!==false),env,target,expected:{},readSql:name=>readFile(new URL('../migrations/'+name+'.sql',import.meta.url),'utf8'),openClient:async()=>{opened++;return c;},request,now:()=>options.expireAfterCheck&&checks.length>=3?700000:0,log:s=>logs.push(s),check:async(_c,_id,_expected,stage)=>{checks.push(stage);if(options.badStage===stage || (options.postCommitFailure&&commits===1))throw Error('private-schema-canary');},...options.dependencies});
 assert(!logs.join().includes('private-'));return {code,queries,logs,checks,opened,commits};
}
test('target guard positively pins Production and rejects Development, Preview and unknown targets before connection',async()=>{
 assert.equal(targetConfig(env,target).endpoint,ENDPOINT);
 for(const change of [{VERCEL_ENV:'development'},{VERCEL_ENV:'preview'},{VERCEL_ENV:undefined},{TOOLKIT_ORIGIN:'http://localhost:5173'},{DATABASE_URL:env.DATABASE_URL.replace(ENDPOINT,'ep-development-fixture')},{DATABASE_URL:env.DATABASE_URL.replace('/synthetic?','/other?')},{NEON_API_KEY:''}]){
  let opened=0;const r=await exercise({dependencies:{env:{...env,...change},openClient:async()=>{opened++;throw Error();}}});assert.equal(r.code,1);assert.equal(opened,0);
 }
 assert.throws(()=>targetConfig({...env,DATABASE_URL:env.DATABASE_URL.replace(ENDPOINT,ENDPOINT+'-pooler')},target,{apply:true}));
 assert.throws(()=>targetConfig(env,{...target,branch:target.developmentBranch}));
 for(const change of [{branch_id:target.developmentBranch},{host:'wrong.neon.tech'},{id:'ep-other'},{project_id:'other'},{type:'read_only'}])await assert.rejects(verifyNeon(env,target,async()=>({ok:true,json:async()=>({endpoint:{id:ENDPOINT,project_id:target.project,branch_id:target.branch,host:ENDPOINT+'.us-east-1.aws.neon.tech',type:'read_write',...change}})})));
});
test('explicit authorization is short-lived and rejects omissions, duplicate/extra args and expired windows',()=>{
 assert.equal(authorize(args(true),0).mode,'--apply');for(const bad of [[],args(true).slice(0,4),[...args(true),'--force'],args(true).map(x=>x==='--production'?'--development':x),args(true).map(x=>x==='APPLY_002_003_TO_PRODUCTION'?'yes':x)])assert.throws(()=>authorize(bad,0));assert.throws(()=>authorize(args(true),700000));assert.throws(()=>authorize(args(true),-1000000));
});
test('preflight transaction is read-only and emits sanitized identity without migration SQL or ledger writes',async()=>{
 const r=await exercise({apply:false});assert.equal(r.code,0);assert.deepEqual(r.checks,[0]);assert.equal(r.commits,0);assert(r.queries.some(q=>q.sql.includes('REPEATABLE READ READ ONLY')));assert(!r.queries.some(q=>/CREATE|ALTER|INSERT|UPDATE|DELETE|pg_try_advisory_lock/.test(q.sql)));assert.equal(JSON.parse(r.logs[0]).state,'PREFLIGHT_PASS');assert(!r.logs.join().includes('postgresql'));
});
test('ordered migrations lock, re-preflight, verify before/after each COMMIT and never execute 001',async()=>{
 const r=await exercise();assert.equal(r.code,0);assert.deepEqual(r.checks,[0,0,0,2,2,2,3,3]);assert.equal(r.commits,2);const writes=r.queries.filter(q=>q.sql.startsWith('INSERT INTO toolkit_auth.migrations'));assert.deepEqual(writes.map(q=>q.params[0]),['002_ringcentral_v3','003_fax_v3_operations']);assert(!r.queries.some(q=>q.sql.includes('CREATE SCHEMA IF NOT EXISTS toolkit_auth')));assert.deepEqual(r.logs,['002_COMMITTED_VERIFIED','003_COMMITTED_VERIFIED','PRODUCTION_MIGRATIONS_VERIFIED']);
});
test('bad checksums and conflicting preflight fail closed; lock contention never reaches DDL',async()=>{
 let r=await exercise({dependencies:{readSql:async()=> 'SELECT 1'}});assert.equal(r.opened,0);assert.equal(r.code,1);
 r=await exercise({badStage:0});assert.equal(r.code,1);assert.equal(r.commits,0);
 r=await exercise({busy:true});assert.equal(r.code,1);assert(!r.queries.some(q=>q.sql.startsWith('CREATE SCHEMA')));
});
test('COMMIT uncertainty never rolls back/retries/reopens; explicit read-only reconciliation is required',async()=>{
 for(const lostCommit of [1,2]){const r=await exercise({lostCommit});assert.equal(r.code,2);assert.equal(r.opened,1);assert.equal(r.commits,lostCommit);assert.equal(r.logs.at(-1),'COMMIT_ACKNOWLEDGEMENT_UNKNOWN_STOP_NO_RETRY');assert.deepEqual(r.queries.slice(r.queries.findLastIndex(q=>q.sql==='COMMIT')+1).map(q=>q.sql),['END_CONNECTION']);}
});
test('post-commit verification failure differs from 003 pre-commit failure; neither continues',async()=>{
 let r=await exercise({postCommitFailure:true});assert.equal(r.code,3);assert.equal(r.commits,1);assert.equal(r.logs.at(-1),'COMMITTED_BUT_VERIFICATION_FAILED_STOP_NO_RETRY');
 r=await exercise({query:async sql=>{if(sql.startsWith('-- Development Phase 2'))throw Error();}});assert.equal(r.code,1);assert.equal(r.commits,1);assert.equal(r.logs.at(-1),'003_PRECOMMIT_FAILED_002_REMAINS_COMMITTED_STOP');
 r=await exercise({expireAfterCheck:true});assert.equal(r.code,1);assert.equal(r.commits,0);
});
