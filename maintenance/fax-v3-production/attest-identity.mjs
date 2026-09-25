import {createInterface} from 'node:readline/promises';
import {writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {attestedIdentity,ATTESTATION_MS,ENDPOINT,DEVELOPMENT_ENDPOINT,PROJECT,BRANCH,DEVELOPMENT_BRANCH,DATABASE} from './policy.mjs';
// Local, nonsecret record creation only. No SQL, network, credential or CLI imports.
let terminal;
try {
 const [flag,path,...extra]=process.argv.slice(2);
 if(flag!=='--out'||!path||extra.length||!process.stdin.isTTY||!process.stdout.isTTY)throw Error();
 terminal=createInterface({input:process.stdin,output:process.stdout});
 console.log('Fresh Neon dashboard review only. Do not paste DATABASE_URL or any secret.');
 console.log('Project: '+PROJECT+'; database: '+DATABASE);
 const host=(await terminal.question('Full DIRECT Production endpoint hostname from the dashboard (hostname only): ')).trim();
 // Validate the hostname before asking for confirmations; errors never echo input.
 const verifiedAt=new Date().toISOString();
 const target={environment:'production',project:PROJECT,branch:BRANCH,endpoint:ENDPOINT,developmentBranch:DEVELOPMENT_BRANCH,developmentEndpoint:DEVELOPMENT_ENDPOINT,database:DATABASE,host,verifiedAt,expiresAt:new Date(Date.parse(verifiedAt)+ATTESTATION_MS).toISOString(),confirmations:{productionAttachedToMain:true,developmentAttachedToDevelopment:true,productionReadWrite:true,distinct:true,noAdministrativeChanges:true}};
 attestedIdentity(target);
 const confirmations=[
  ['In this project, '+ENDPOINT+' is currently attached to main ('+BRANCH+'), with database '+DATABASE+'. Type MAIN: ','MAIN'],
  [DEVELOPMENT_ENDPOINT+' is currently attached to development ('+DEVELOPMENT_BRANCH+'). Type DEVELOPMENT: ','DEVELOPMENT'],
  ['Production endpoint is primary/read-write. Type READ_WRITE: ','READ_WRITE'],
  ['Production and Development are distinct. Type DISTINCT: ','DISTINCT'],
  ['No endpoint reassignment, branch restore/reset or related Neon administrative work will occur from this review until migration execution finishes (or this attempt is abandoned). Type NO_ADMIN_CHANGES: ','NO_ADMIN_CHANGES']
 ];
 for(const [prompt,expected]of confirmations)if(await terminal.question(prompt)!==expected)throw Error();
 // The window starts at the beginning of the review, not after a delayed last answer.
 attestedIdentity(target);
 await writeFile(resolve(path),JSON.stringify(target,null,2)+'\n',{encoding:'utf8',mode:0o600});
 console.log('DASHBOARD_ATTESTATION_RECORDED_NO_PREFLIGHT_RUN');
 console.log('Expires at '+target.expiresAt);
}catch{console.log('DASHBOARD_ATTESTATION_FAILED_NO_PREFLIGHT_RUN');process.exitCode=1;}
finally{terminal?.close();}
