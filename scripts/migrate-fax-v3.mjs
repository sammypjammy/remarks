import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { assertDevelopment } from './rc-v3-development-guard.mjs';
export async function migrateFax({args,env,openPool,readSql,log,error}) {
  let pool,c;
  try {
    if(args.length!==2 || !args.includes('--apply') || !args.includes('--development'))throw new Error();
    assertDevelopment(env);
    const digest=s=>createHash('sha256').update(s.replaceAll('\r\n','\n')).digest('hex');
    const priorChecksum=digest(await readSql('002_ringcentral_v3'));
    const sql=await readSql('003_fax_v3_operations'),checksum=digest(sql);
    pool=await openPool();c=await pool.connect();await c.query('BEGIN');await c.query('SELECT pg_advisory_xact_lock(731942015)');
    const prior=await c.query('SELECT checksum FROM toolkit_auth.migrations WHERE name=$1',['002_ringcentral_v3']);
    if(prior.rows[0]?.checksum!==priorChecksum)throw new Error();
    const existing=await c.query('SELECT checksum FROM toolkit_auth.migrations WHERE name=$1',['003_fax_v3_operations']);
    if(existing.rows.length) { if(existing.rows[0].checksum!==checksum)throw new Error(); }
    else { await c.query(sql);await c.query('INSERT INTO toolkit_auth.migrations(name,checksum) VALUES($1,$2)',['003_fax_v3_operations',checksum]); }
    await c.query('COMMIT');log('Development fax operations migration ready.');return 0;
  } catch { if(c)await c.query('ROLLBACK').catch(()=>{});error('Development fax migration failed; diagnostics withheld.');return 1; }
  finally { try{c?.release();await pool?.end();}catch{} }
}
if(process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href)process.exitCode=await migrateFax({args:process.argv.slice(2),env:process.env,
  openPool:async()=>(await import('../server/auth/database.js')).getPool(),
  readSql:name=>readFile(new URL('../migrations/'+name+'.sql',import.meta.url),'utf8'),log:message=>console.log(message),error:message=>console.error(message)});
