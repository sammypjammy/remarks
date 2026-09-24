import {authorize,verifyNeon,HASHES,digest,fail} from './policy.mjs';
import {inspect,readOnly} from './schema.mjs';
// No retries, no production auto-run hook, no schema/identity data in error output.
export async function run({args,env,target,expected,readSql,openClient,request,now=Date.now,log=console.log,check=inspect}) {
 let c,lock=false,commitPending=false,committed=0,phase='PREFLIGHT';
 try{
  const auth=authorize(args,now());const apply=auth.mode==='--apply';
  const identity=await verifyNeon(env,target,request,{apply});
  const sql={};for(const name of ['002_ringcentral_v3','003_fax_v3_operations']){sql[name]=await readSql(name);if(digest(sql[name])!==HASHES[name])fail();}
  c=await openClient();
  const verify=stage=>check(c,identity,expected,stage);
  if(auth.mode==='--inspect'){
   let stage;
   await readOnly(c,async()=>{const rows=(await c.query('SELECT name FROM toolkit_auth.migrations ORDER BY name')).rows;stage=rows.some(r=>r.name==='003_fax_v3_operations')?3:rows.some(r=>r.name==='002_ringcentral_v3')?2:0;await verify(stage);});
   log(JSON.stringify({...identity,state:stage===0?'CLEAN':stage===2?'002_COMMITTED':'002_003_COMMITTED'}));return 0;
  }
  await readOnly(c,()=>verify(0));
  if(!apply){log(JSON.stringify({...identity,state:'PREFLIGHT_PASS'}));return 0;}
  if(now()>=auth.expires)fail();
  lock=(await c.query('SELECT pg_try_advisory_lock(731942015) AS locked')).rows[0]?.locked===true;if(!lock)fail();
  await readOnly(c,()=>verify(0)); // Recheck after lock, never trust an earlier report file.
  for(const [name,stage]of [['002_ringcentral_v3',2],['003_fax_v3_operations',3]]){
   phase=name;if(now()>=auth.expires)fail();
   await c.query('BEGIN');await c.query("SET LOCAL search_path = pg_catalog");await c.query("SET LOCAL lock_timeout = '3s'");await c.query("SET LOCAL statement_timeout = '30s'");
   await verify(stage===2?0:2);
   await c.query(sql[name]);await c.query('INSERT INTO toolkit_auth.migrations(name,checksum) VALUES($1,$2)',[name,HASHES[name]]);
   await verify(stage);if(now()>=auth.expires)fail();
   commitPending=true;await c.query('COMMIT');commitPending=false;committed=stage;
   phase='VERIFY_'+name;await readOnly(c,()=>verify(stage));
   log(stage===2?'002_COMMITTED_VERIFIED':'003_COMMITTED_VERIFIED');
  }
  log('PRODUCTION_MIGRATIONS_VERIFIED');return 0;
 }catch{
  if(commitPending){log('COMMIT_ACKNOWLEDGEMENT_UNKNOWN_STOP_NO_RETRY');return 2;}
  await c?.query('ROLLBACK').catch(()=>{});
  if(phase.startsWith('VERIFY_')){log('COMMITTED_BUT_VERIFICATION_FAILED_STOP_NO_RETRY');return 3;}
  log(committed===2?'003_PRECOMMIT_FAILED_002_REMAINS_COMMITTED_STOP':'PRECOMMIT_FAILED_NO_MIGRATION_COMMIT_ACKNOWLEDGED');return 1;
 }finally{
  // A lost COMMIT acknowledgement is reconciled by a separate read-only invocation.
  if(lock&&!commitPending)await c?.query('SELECT pg_advisory_unlock(731942015)').catch(()=>{});
  await c?.end().catch(()=>{});
 }
}
