import test from 'node:test';import assert from 'node:assert/strict';import {readFile,readdir} from 'node:fs/promises';import {createHash} from 'node:crypto';import {build} from 'vite';import {env} from './rc-v3-fixtures.js';
test('opt-in production artifact adds only five v3 assets; default build preserves all existing tools',async()=>{
  const vars={...env(),VERCEL:'1',VERCEL_ENV:'production',TOOLKIT_ORIGIN:'https://packardtoolkit.vercel.app',FAX_V3_PRODUCTION_ACCEPTANCE:undefined,DATABASE_URL:'postgresql://synthetic:synthetic@ep-young-dream-arkoh9e5-pooler.us-east-1.aws.neon.tech/test?sslmode=require'};
  const before=Object.fromEntries(Object.keys(vars).map(k=>[k,process.env[k]]));const set=values=>{for(const [k,v]of Object.entries(values)){if(v===undefined)delete process.env[k];else process.env[k]=v;}};
  const snapshot=async(dir='dist')=>{const out={};for(const e of await readdir(dir,{withFileTypes:true})){const p=dir+'/'+e.name;if(e.isDirectory())Object.assign(out,await snapshot(p));else out[p]=createHash('sha256').update(await readFile(p)).digest('hex');}return out;};
  try{set(vars);await build({envDir:false,logLevel:'silent'});const normal=await snapshot();assert(!Object.keys(normal).some(p=>p.includes('fax-sender-v3')));
    process.env.FAX_V3_PRODUCTION_ACCEPTANCE='enabled';await build({envDir:false,logLevel:'silent'});const staged=await snapshot();const added=Object.keys(staged).filter(p=>!Object.hasOwn(normal,p));assert.deepEqual(added.sort(),['app.js','client.js','index.html','style.css','test.js'].map(f=>'dist/fax-sender-v3/'+f).sort());for(const [p,hash]of Object.entries(normal))assert.equal(staged[p],hash,p);
    for(const p of added){const s=await readFile(p,'utf8');assert(!/RC_USER_JWT|RC_OAUTH_CLIENT_SECRET|RC_TOKEN_ENCRYPTION_KEY|ENTRA_CLIENT_SECRET|postgres(?:ql)?:\/\//.test(s));}
    delete process.env.FAX_V3_PRODUCTION_ACCEPTANCE;await build({envDir:false,logLevel:'silent'});assert.deepEqual(await snapshot(),normal);
  }finally{set(before);}
});
