import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { projectReady, trustedSender, receiveBridge, BRIDGE_NAME, SOURCE_URL, HOSTED_PILOT_URL, LEASE_MS, MAX_SESSION_MS } from '../ssa-intake-assistant/extension-dev/bridge-contract.js';
import { sendDevelopmentProfile } from '../ssa-intake-assistant/src/model/development-bridge.js';
import { DEVELOPMENT_EXTENSION_ID } from '../ssa-intake-assistant/src/model/development-extension-id.js';
import { syntheticProfile } from '../ssa-intake-assistant/extension-dev/synthetic.js';
import { canonicalPracticeProfile } from '../ssa-intake-assistant/src/model/canonical-practice-profile.js';
import { createClientData } from '../intake-checker/client-data.js';
import { createIntakeSession } from '../intake-checker/session.js';
import { parseIntake } from '../intake-checker/parser.js';
import { completeSyntheticIntake } from '../ssa-intake-assistant/tests/complete-intake.mjs';
const nonce='11111111-1111-1111-1111-111111111111', session='22222222-2222-2222-2222-222222222222';
const sender=()=>({url:SOURCE_URL,origin:'http://127.0.0.1:5173',frameId:0,tab:{id:7}});
function event() { const listeners=new Set();return {addListener:f=>listeners.add(f),removeListener:f=>listeners.delete(f),emit:m=>[...listeners].forEach(f=>f(m))}; }
function harness() {
  let time=0, cleared=0, received=null, next;
  const messages=[], port={name:BRIDGE_NAME,sender:sender(),onMessage:event(),onDisconnect:event(),postMessage:m=>messages.push(m),disconnect(){this.disconnected=true;}};
  const stop=receiveBridge(port,{nonce,onProfile:p=>{received=p},onClear:()=>{cleared++;received=null},now:()=>time,schedule:(f,delay)=>{next={f,delay};return 1},cancel:()=>{}});
  return {port,stop,messages,send:(type,extra={})=>port.onMessage.emit({type,receiver:nonce,session,...extra}),get received(){return received},get cleared(){return cleared},get timer(){return next},time:value=>{time=value}};
}
test('projection sends only mapped ready values with no source, review, credentials or unknown fields',()=>{
  const p=syntheticProfile();p.credentials='synthetic-secret';p.fields[0].sources=[{rawValue:'synthetic source'}];p.fields[0].employeeReview={edits:[]};
  const projected=projectReady(p);
  assert.equal(projected.fields.length,70);assert.deepEqual(projected.jobRecords,['job-1']);
  assert.deepEqual(projected.conditionalQuestionFields, [
    'employment.worked-outside-united-states','employment.eligible-for-foreign-ssi','employment.foreign-ssi-country',
    'previous-applications.previous-applications-previously-applied-for-medicare-ss-ssi',
    'previous-applications.previous-applications-medicare',
    'previous-applications.previous-applications-social-security',
    'previous-applications.previous-applications-ssi',
    'workers-compensation.illnesses-injuries-work-related',
    'wages-earnings.expect-money-from-employer-in-future',
  ]);
  assert.deepEqual(projected.conditionalQuestionMissingFields, []);
  assert(!JSON.stringify(projected).includes('synthetic-secret'));assert(!JSON.stringify(projected).includes('sources'));
  assert.equal(projected.fields.find(field=>field.id==='jobs.employer@job-1').value,'Example Company');
  assert.equal(projected.fields.find(field=>field.id==='language.can-read-simple-english-messages').value,false);
  p.fields[0].readiness='blocked';assert(!projectReady(p).fields.some(f=>f.id==='personal.first-name'));
  p.fields.push({...p.fields[1]});assert(!projectReady(p).fields.some(f=>f.id==='personal.last-name'));
  const incomplete=syntheticProfile();
  incomplete.fields.find(field=>field.definitionId==='jobs.start-date').precision='month';
  assert(!projectReady(incomplete).fields.some(field=>field.definitionId==='jobs.start-date'));
  const invalidDate=syntheticProfile();
  invalidDate.fields.find(field=>field.definitionId==='jobs.end-date').value='2015-02-30';
  assert(!projectReady(invalidDate).fields.some(field=>field.definitionId==='jobs.end-date'));
  p.schemaVersion='99';assert.equal(projectReady(p),null);
});
test('only exact local URL, origin, top frame and browser tab are accepted',()=>{
  assert(trustedSender(sender()));
  assert(trustedSender({...sender(),url:'http://localhost:5173/intake-checker/',origin:'http://localhost:5173'}));
  assert(trustedSender({...sender(),url:HOSTED_PILOT_URL,origin:'https://packardtoolkit.vercel.app'}));
  assert(!trustedSender({...sender(),url:'http://localhost:5173/intake-checker/'}));
  for(const change of [{url:'https://ssa.gov/'},{url:SOURCE_URL+'?profile=x'},{url:SOURCE_URL.replace(':5173',':5174')},{origin:'https://untrusted.invalid'},{frameId:1},{tab:null},{id:'another-extension'}]) assert(!trustedSender({...sender(),...change}));
  for(const url of [HOSTED_PILOT_URL+'?profile=x',HOSTED_PILOT_URL+'#x','http://packardtoolkit.vercel.app/intake-checker/','https://other.vercel.app/intake-checker/']) assert(!trustedSender({...sender(),url,origin:new URL(url).origin}));
});
test('hosted pilot transfers only approved eligible fields from the current fictional intake',async()=>{
  let port;
  const runtime={connect(id){assert.equal(id,DEVELOPMENT_EXTENSION_ID);port={onDisconnect:event(),onMessage:event(),postMessage(packet){if(packet.type==='profile')this.sent=packet.profile;},disconnect(){}};return port;}};
  const windowObject={location:{href:HOSTED_PILOT_URL},addEventListener(){},removeEventListener(){}};windowObject.top=windowObject;
  const client=canonicalPracticeProfile(createClientData(createIntakeSession(parseIntake(
    completeSyntheticIntake().replace('**First Name:** Synthetic','**First Name:** Fictional Change')))));
  client.fields[0].sources=[{rawValue:'Do not send source text'}];
  client.fields[1].readiness='blocked';
  const stop=sendDevelopmentProfile(client,{runtime,windowObject,onStatus(){},checkAccess:async()=>true});
  for(let i=0;i<10&&!port;i++)await new Promise(resolve=>setTimeout(resolve,0));
  assert(port);
  port.onMessage.emit({type:'challenge',receiver:nonce});
  assert(port.sent);
  assert.equal(port.sent.fields.find(field=>field.id==='personal.first-name').value,'Fictional Change');
  assert(!port.sent.fields.some(field=>field.id==='personal.last-name'));
  assert(!JSON.stringify(port.sent).includes('Do not send source text'));
  stop();
});
test('hosted pilot refuses transfer without authenticated access or an exact source URL',async()=>{
  let connections=0;
  const runtime={connect(){connections++;throw Error('Must not connect');}};
  const statuses=[];
  const source={location:{href:HOSTED_PILOT_URL},addEventListener(){},removeEventListener(){}};
  source.top=source;
  sendDevelopmentProfile(syntheticProfile(),{runtime,windowObject:source,onStatus:status=>statuses.push(status),checkAccess:async()=>false});
  await new Promise(resolve=>setTimeout(resolve,0));
  assert.equal(connections,0);
  source.location.href=HOSTED_PILOT_URL+'?intake=forbidden';
  sendDevelopmentProfile(syntheticProfile(),{runtime,windowObject:source,onStatus:status=>statuses.push(status),checkAccess:async()=>true});
  await new Promise(resolve=>setTimeout(resolve,0));
  assert.equal(connections,0);
});
test('receiver binds nonce and session, clears on revoke and rejects repeated payloads',()=>{
  const h=harness();assert.equal(h.messages[0].type,'challenge');assert.equal(h.timer.delay,LEASE_MS);
  h.send('profile',{receiver:'wrong',profile:syntheticProfile()});assert.equal(h.received,null);
  h.send('profile',{profile:syntheticProfile()});assert(h.received);assert.equal(h.messages.at(-1).type,'accepted');
  h.send('heartbeat');assert(h.received);
  h.send('profile',{profile:syntheticProfile()});assert.equal(h.received,null);assert.equal(h.cleared,1);
  h.stop();assert.equal(h.cleared,1);
  const other=harness();other.send('profile',{profile:syntheticProfile()});other.send('revoke');assert.equal(other.received,null);
});
test('disconnect, expired lease, hard deadline and wrong-session replay clear the receiver',()=>{
  for(const release of [h=>h.port.onDisconnect.emit(),h=>h.timer.f(),h=>{h.time(MAX_SESSION_MS);h.send('heartbeat')},h=>h.send('heartbeat',{session:nonce})]){
    const h=harness();h.send('profile',{profile:syntheticProfile()});release(h);assert.equal(h.received,null);assert.equal(h.cleared,1);
  }
});
test('public package key pins the expected extension identity',async()=>{
  const m=JSON.parse(await readFile(new URL('../ssa-intake-assistant/extension-dev/manifest.json',import.meta.url),'utf8'));
  const id=createHash('sha256').update(Buffer.from(m.key,'base64')).digest('hex').slice(0,32).replace(/[0-9a-f]/g,c=>String.fromCharCode(97+parseInt(c,16)));
  assert.equal(id,DEVELOPMENT_EXTENSION_ID);
});
