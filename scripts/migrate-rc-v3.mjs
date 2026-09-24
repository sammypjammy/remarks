import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { assertDevelopment } from './rc-v3-development-guard.mjs';
export const migrationName = '002_ringcentral_v3';
export async function runRcMigration({args,env,openPool,readSql,log,error}) {
  let pool,client;
  try {
    if (args.length!==2 || !args.includes('--apply') || !args.includes('--development')) throw new Error();
    assertDevelopment(env);
    const sql = await readSql();
    const checksum = createHash('sha256').update(sql.replaceAll('\r\n','\n')).digest('hex');
    pool=await openPool(); client=await pool.connect(); await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(731942015)');
    const priorAuth=await client.query('SELECT checksum FROM toolkit_auth.migrations WHERE name=$1',['001_toolkit_auth']);
    if (priorAuth.rows[0]?.checksum!=='d25c789f9fe3840a3f061f40dddc02578df2f1e0b91f4ed07f9508bac8f0b605') throw new Error();
    const prior=await client.query('SELECT checksum FROM toolkit_auth.migrations WHERE name=$1',[migrationName]);
    if (prior.rows.length) { if(prior.rows[0].checksum!==checksum)throw new Error(); }
    else { await client.query(sql); await client.query('INSERT INTO toolkit_auth.migrations(name,checksum) VALUES($1,$2)',[migrationName,checksum]); }
    await client.query('COMMIT'); log(prior.rows.length?'Development RC migration already applied.':'Development RC migration applied.'); return 0;
  } catch {
    if(client)await client.query('ROLLBACK').catch(()=>{});
    error('Development RC migration failed; diagnostics withheld.'); return 1;
  } finally { try{client?.release();await pool?.end();}catch{} }
}
if(process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href) {
  process.exitCode=await runRcMigration({args:process.argv.slice(2),env:process.env,
    openPool:async()=> (await import('../server/auth/database.js')).getPool(),
    readSql:()=>readFile(new URL('../migrations/002_ringcentral_v3.sql',import.meta.url),'utf8'),
    log:message=>console.log(message),error:message=>console.error(message)});
}
