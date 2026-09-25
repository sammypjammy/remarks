import {readFile} from 'node:fs/promises';
import pg from 'pg';
import {authorize} from './policy.mjs';
import {run} from './runner.mjs';
import {databaseOptions} from '../../server/auth/database.js';
// Intentionally no environment-file loader; use protected process-level injection.
try{
 const args=process.argv.slice(2),auth=authorize(args);
 if ((process.argv[1].endsWith('preflight.mjs') && auth.mode==='--apply') || (process.argv[1].endsWith('apply.mjs') && auth.mode!=='--apply')) throw Error();
 const target=JSON.parse((await readFile(auth.targetPath,'utf8')).replace(/^\uFEFF/,''));
 const expected=JSON.parse(await readFile(new URL('./schema-expected.json',import.meta.url),'utf8'));
 process.exitCode=await run({args,env:process.env,target,expected,
  readSql:name=>readFile(new URL('../../migrations/'+name+'.sql',import.meta.url),'utf8'),
  openClient:async()=>{const c=new pg.Client({...databaseOptions(),query_timeout:35000});c.on('error',()=>{});try{await c.connect();return c;}catch{await c.end().catch(()=>{});throw Error('CONNECTION_FAILED');}}
 });
}catch{console.log('CONFIGURATION_OR_AUTHORIZATION_FAILED');process.exitCode=1;}
