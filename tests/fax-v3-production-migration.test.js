import test from 'node:test';import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';import {run} from '../maintenance/fax-v3-production/runner.mjs';import {authorize,targetConfig,attestedIdentity,assertFresh,ATTESTATION_MS,ENDPOINT,DEVELOPMENT_ENDPOINT,PROJECT,BRANCH,DEVELOPMENT_BRANCH,DATABASE} from '../maintenance/fax-v3-production/policy.mjs';
const target={environment:'production',endpoint:ENDPOINT,project:PROJECT,branch:BRANCH,developmentBranch:DEVELOPMENT_BRANCH,developmentEndpoint:DEVELOPMENT_ENDPOINT,database:DATABASE,host:ENDPOINT+'.us-east-1.aws.neon.tech',verifiedAt:new Date(0).toISOString(),expiresAt:new Date(ATTESTATION_MS).toISOString(),confirmations:{productionAttachedToMain:true,developmentAttachedToDevelopment:true,productionReadWrite:true,distinct:true,noAdministrativeChanges:true}};
const env={TOOLKIT_ORIGIN:'https://packardtoolkit.vercel.app',VERCEL_ENV:'production',DATABASE_URL:'postgresql://synthetic:private-password-canary@'+ENDPOINT+'.us-east-1.aws.neon.tech/neondb?sslmode=require'};
const args=apply=>apply?['--apply','--production','--target','synthetic.json','--authorize','APPLY_002_003_TO_PRODUCTION','--expires-at',new Date(600000).toISOString()]:['--read-only','--production','--target','synthetic.json'];
async function exercise(options={}){
 const queries=[],logs=[],checks=[];let opened=0,commits=0;const c={query:async(sql,params)=>{queries.push({sql,params});if(options.query)await options.query(sql,queries);if(sql==='COMMIT'){commits++;if(options.lostCommit===commits)throw Error('private-driver-canary');}return {rows:sql.includes('pg_try_advisory_lock')?[{locked:!options.busy}]:[]};},end:async()=>queries.push({sql:'END_CONNECTION'})};
 const code=await run({args:args(options.apply!==false),env,target,expected:{},readSql:name=>readFile(new URL('../migrations/'+name+'.sql',import.meta.url),'utf8'),openClient:async()=>{opened++;return c;},now:()=>options.expireAfterCheck&&checks.length>=3?700000:0,log:s=>logs.push(s),check:async(_c,_id,_expected,stage)=>{checks.push(stage);if(options.badStage===stage || (options.postCommitFailure&&commits===1))throw Error('private-schema-canary');},...options.dependencies});
 assert(!logs.join().includes('private-'));return {code,queries,logs,checks,opened,commits};
}
test('target guard positively pins Production and rejects Development, Preview and unknown targets before connection',async()=>{
 assert.equal(targetConfig(env,target,{now:0}).endpoint,ENDPOINT);
 for(const change of [{VERCEL_ENV:'development'},{VERCEL_ENV:'preview'},{VERCEL_ENV:undefined},{TOOLKIT_ORIGIN:'http://localhost:5173'},{DATABASE_URL:env.DATABASE_URL.replace(ENDPOINT,DEVELOPMENT_ENDPOINT)},{DATABASE_URL:env.DATABASE_URL.replace('/neondb?','/other?')}]){
  let opened=0;const r=await exercise({dependencies:{env:{...env,...change},openClient:async()=>{opened++;throw Error();}}});assert.equal(r.code,1);assert.equal(opened,0);
 }
 assert.throws(()=>targetConfig({...env,DATABASE_URL:env.DATABASE_URL.replace(ENDPOINT,ENDPOINT+'-pooler')},target,{apply:true,now:0}));
 assert.throws(()=>targetConfig(env,{...target,branch:target.developmentBranch},{now:0}));
});

test('dashboard attestation requires every pinned identifier, full hostname and exact confirmation',async()=>{
 assert.equal(attestedIdentity(target,0).identityVerification,'operator-dashboard-attestation');
 const changes=[{project:'unknown'},{branch:'br-other'},{endpoint:DEVELOPMENT_ENDPOINT},{developmentEndpoint:ENDPOINT},{developmentBranch:BRANCH},{developmentBranch:'br-other'},{database:'other'},{host:ENDPOINT+'.us-west-2.aws.neon.tech'},{host:target.host+'.evil.invalid'},{host:target.host.toUpperCase()},{host:target.host.replace(ENDPOINT,ENDPOINT+'-pooler')},{secret:'private-canary'}];
 for(const key of Object.keys(target))changes.push({[key]:undefined});
 for(const key of Object.keys(target.confirmations))for(const value of [false,undefined,'true',1])changes.push({confirmations:{...target.confirmations,[key]:value}});
 changes.push({confirmations:{...target.confirmations,extra:true}});
 for(const change of changes)for(const apply of [true,false]){
  const r=await exercise({apply,dependencies:{target:{...target,...change}}});
  assert.equal(r.opened,0);assert.equal(r.code,1);assert.deepEqual(r.logs,['PRODUCTION_IDENTITY_VERIFICATION_FAILED_STOP_NO_DATABASE_CONNECTION']);
 }
});

test('freshness rejects future, stale, malformed or excessive windows before SQL',async()=>{
 for(const change of [{verifiedAt:new Date(1).toISOString()},{verifiedAt:new Date(-ATTESTATION_MS).toISOString()},{expiresAt:new Date(0).toISOString()},{expiresAt:new Date(ATTESTATION_MS+1).toISOString()},{expiresAt:'tomorrow'},{verifiedAt:'1970-01-01'},{verifiedAt:0}]){
  const r=await exercise({dependencies:{target:{...target,...change}}});assert.equal(r.opened,0);assert.equal(r.code,1);
 }
 assert.doesNotThrow(()=>assertFresh(target,ATTESTATION_MS-1));assert.throws(()=>assertFresh(target,ATTESTATION_MS));
 const r=await exercise({apply:false,dependencies:{now:()=>NaN}});assert.equal(r.opened,0);
});

test('strict URL validation rejects routing overrides and accepts only attested host/database',()=>{
 for(const url of [env.DATABASE_URL+'&options=endpoint%3Dep-other',env.DATABASE_URL+'&host=evil.invalid',env.DATABASE_URL+'&sslmode=disable',env.DATABASE_URL+'&sslmode=require',env.DATABASE_URL.replace(':private-password-canary',''),env.DATABASE_URL.replace('.us-east-1.','.us-west-2.'),env.DATABASE_URL.replace('/neondb?','/other?'),env.DATABASE_URL.replace('/neondb?',':5433/neondb?')])assert.throws(()=>targetConfig({...env,DATABASE_URL:url},target,{now:0}));
 assert.equal(targetConfig({...env,DATABASE_URL:env.DATABASE_URL.replace(ENDPOINT,ENDPOINT+'-pooler')},target,{now:0}).host,target.host);
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

test('attestation expiry during SQL stops before COMMIT, including after 002',async()=>{
 for(const expiredStage of [2,3]){
  let time=0;
  const r=await exercise({dependencies:{target:{...target,expiresAt:new Date(500000).toISOString()},now:()=>time,check:async(_c,_id,_expected,stage)=>{if(stage===expiredStage)time=500000;}}});
  assert.equal(r.code,1);assert.equal(r.commits,expiredStage===2?0:1);
 }
 let time=0;const r=await exercise({apply:false,dependencies:{now:()=>time,check:async()=>{time=ATTESTATION_MS;}}});assert.equal(r.code,1);assert(!r.logs.some(s=>s.includes('PREFLIGHT_PASS')));
});
