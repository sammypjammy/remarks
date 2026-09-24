import {HASHES,fail} from './policy.mjs';
export async function schemaShape(c,schema,auth='toolkit_auth') {
 const norm=v=>JSON.parse(schema===auth?JSON.stringify(v).replaceAll(auth,'toolkit_auth'):JSON.stringify(v).replaceAll(schema,'toolkit_rc_v3').replaceAll(auth,'toolkit_auth'));
 const queries={
  relations:`SELECT relname, relkind, relrowsecurity, relforcerowsecurity, reloptions FROM pg_class WHERE relnamespace=(SELECT oid FROM pg_namespace WHERE nspname=$1) ORDER BY relname`,
  columns:`SELECT r.relname,a.attname,format_type(a.atttypid,a.atttypmod) AS type,a.attnotnull,a.attidentity,a.attgenerated,pg_get_expr(d.adbin,d.adrelid) AS default_value FROM pg_attribute a JOIN pg_class r ON r.oid=a.attrelid LEFT JOIN pg_attrdef d ON d.adrelid=r.oid AND d.adnum=a.attnum WHERE r.relnamespace=(SELECT oid FROM pg_namespace WHERE nspname=$1) AND r.relkind='r' AND a.attnum>0 AND NOT a.attisdropped ORDER BY r.relname,a.attnum`,
  constraints:`SELECT r.relname,c.conname,c.contype,c.convalidated,pg_get_constraintdef(c.oid,true) AS definition FROM pg_constraint c JOIN pg_class r ON r.oid=c.conrelid WHERE r.relnamespace=(SELECT oid FROM pg_namespace WHERE nspname=$1) ORDER BY r.relname,c.conname`,
  indexes:`SELECT r.relname,i.indisvalid,i.indisready,pg_get_indexdef(i.indexrelid) AS definition FROM pg_index i JOIN pg_class r ON r.oid=i.indexrelid WHERE r.relnamespace=(SELECT oid FROM pg_namespace WHERE nspname=$1) ORDER BY r.relname`,
  routines:`SELECT proname,prokind FROM pg_proc WHERE pronamespace=(SELECT oid FROM pg_namespace WHERE nspname=$1) ORDER BY proname,prokind`,
  triggers:`SELECT r.relname,t.tgname FROM pg_trigger t JOIN pg_class r ON r.oid=t.tgrelid WHERE r.relnamespace=(SELECT oid FROM pg_namespace WHERE nspname=$1) AND NOT t.tgisinternal ORDER BY r.relname,t.tgname`,
  policies:`SELECT tablename,policyname FROM pg_policies WHERE schemaname=$1 ORDER BY tablename,policyname`,
  types:`SELECT typname,typtype FROM pg_type WHERE typnamespace=(SELECT oid FROM pg_namespace WHERE nspname=$1) ORDER BY typname`
 };
 const out={};for(const [name,sql]of Object.entries(queries))out[name]=(await c.query(sql,[schema])).rows;
 return norm(out);
}
export async function inspect(c,identity,expected,stage=0,{auth='toolkit_auth',schema='toolkit_rc_v3'}={}) {
 // Names are internal constants; test adapters use validated random fixture names.
 if(!/^[a-z_][a-z0-9_]*$/.test(auth)||!/^[a-z_][a-z0-9_]*$/.test(schema))fail();
 const database=(await c.query('SELECT current_database() AS database')).rows[0]?.database;if(database!==identity.database)fail();
 const authShape=await schemaShape(c,auth,auth);
 if(JSON.stringify(authShape)!==JSON.stringify(expected.auth))fail();
 const rows=(await c.query(`SELECT name,checksum FROM ${auth}.migrations ORDER BY name`)).rows;
 const wanted=['001_toolkit_auth',...(stage>=2?['002_ringcentral_v3']:[]),...(stage>=3?['003_fax_v3_operations']:[])];
 if(rows.length!==wanted.length || rows.some(r=>!wanted.includes(r.name)||r.checksum!==HASHES[r.name]))fail();
 const exists=(await c.query('SELECT EXISTS(SELECT 1 FROM pg_namespace WHERE nspname=$1) AS present',[schema])).rows[0]?.present;
 if(stage===0){if(exists)fail();return;}
 if(!exists || JSON.stringify(await schemaShape(c,schema,auth))!==JSON.stringify(expected[String(stage)]))fail();
 for(const table of ['identities','connections','oauth_transactions','fax_attempts'])if((await c.query(`SELECT EXISTS(SELECT 1 FROM ${schema}.${table}) AS present`)).rows[0]?.present)fail();
}
export async function readOnly(c,fn) {
 await c.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
 try{await c.query("SET LOCAL search_path = pg_catalog");await c.query("SET LOCAL statement_timeout = '15s'");await c.query("SET LOCAL lock_timeout = '3s'");await fn();await c.query('ROLLBACK');}
 catch(e){await c.query('ROLLBACK').catch(()=>{});throw e;}
}
