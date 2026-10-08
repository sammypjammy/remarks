// Isolated Chrome profile + actual unpacked extension + real local Vite UI.
// Authentication is stubbed only inside this disposable test server.
import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { spawn } from 'node:child_process';
import { completeSyntheticIntake } from './complete-intake.mjs';
import { DEVELOPMENT_EXTENSION_ID } from '../src/model/development-extension-id.js';
const browser=process.argv[2];assert(browser,'Provide Chrome executable');
const directory=await mkdtemp(join(tmpdir(),'ssa-bridge-synthetic-'));
let authenticated=true;
const vite=await createServer({server:{host:'127.0.0.1',port:5173,strictPort:true},logLevel:'silent'});
vite.middlewares.stack.unshift({route:'',handle(req,res,next){
  if(!req.url.startsWith('/api/auth/'))return next();
  res.setHeader('Content-Type','application/json');res.setHeader('Cache-Control','no-store');
  res.end(JSON.stringify(req.url.includes('preferences')?{accountId:'synthetic',values:null}:{authenticated,user:{displayName:'Synthetic Employee'}}));
}});
await vite.listen();
const child=spawn(browser,['--headless=new','--no-first-run','--no-default-browser-check','--remote-debugging-pipe','--enable-unsafe-extension-debugging',`--user-data-dir=${join(directory,'profile')}`],{windowsHide:true,stdio:['ignore','ignore','ignore','pipe','pipe']});
let id=0,buffer='';const pending=new Map(),network=[],errors=[];
child.stdio[4].on('data',data=>{
  buffer+=data.toString();while(buffer.includes('\0')){
    const end=buffer.indexOf('\0'),m=JSON.parse(buffer.slice(0,end));buffer=buffer.slice(end+1);
    if(m.id){const p=pending.get(m.id);pending.delete(m.id);m.error?p.reject(Error(m.error.message)):p.resolve(m.result);}
    if(m.method==='Network.requestWillBeSent')network.push(m.params.request);
    if(m.method==='Runtime.exceptionThrown')errors.push('Runtime exception');
  }
});
function cdp(method,params={},sessionId){return new Promise((resolve,reject)=>{pending.set(++id,{resolve,reject});child.stdio[3].write(JSON.stringify({id,method,params,...(sessionId?{sessionId}:{})})+'\0');});}
async function until(fn,label='condition'){const end=Date.now()+15000;while(Date.now()<end){if(await fn())return;await new Promise(done=>setTimeout(done,60));}throw Error(`Timed out: ${label}`);}
async function page(url){
  const {targetId}=await cdp('Target.createTarget',{url:'about:blank'});
  const {sessionId}=await cdp('Target.attachToTarget',{targetId,flatten:true});
  await cdp('Page.enable',{},sessionId);await cdp('Runtime.enable',{},sessionId);await cdp('Network.enable',{},sessionId);
  const evaluate=async expression=>{const r=await cdp('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true,userGesture:true},sessionId);assert(!r.exceptionDetails,'Synthetic evaluation failed');return r.result.value;};
  const navigate=async next=>{await cdp('Page.navigate',{url:next},sessionId);await until(()=>evaluate('document.readyState === "complete"'));};
  await navigate(url);return {evaluate,navigate,sessionId,targetId};
}
try{
  const loaded=await cdp('Extensions.loadUnpacked',{path:resolve('ssa-intake-assistant/extension-dev')});
  assert.equal(loaded.id,DEVELOPMENT_EXTENSION_ID);
  const extension=await page(`chrome-extension://${loaded.id}/practice.html`);
  await until(()=>extension.evaluate("document.querySelectorAll('[data-practice-field]').length===54"));
  const source=await page('http://127.0.0.1:5173/intake-checker/');
  await until(()=>source.evaluate("!!document.querySelector('.toolkit-auth-name') && PackardSettings.accountPreferencesStatus()==='saved'"));
  async function click(p,text){assert(await p.evaluate(`(()=>{const b=[...document.querySelectorAll('button')].find(b=>b.textContent===${JSON.stringify(text)});if(!b)return false;b.click();return true})()`));}
  const text=completeSyntheticIntake().replace('**First Name:** Synthetic','**First Name:** Bridge Synthetic').replace('**Middle Name:** Synthetic','**Middle Name:** Not provided').replace('**When did you last work:** 2000-01-01','**When did you last work:** 2020-02').replace('**Physical Address - Street Address:** Synthetic','**Physical Address - Street Address:** 456 Fictional Avenue').replace('**Alternate Phone:** 202-555-0142','**Alternate Phone:** 202-555-0143').replace('**Secondary Phone:** 202-555-0142','**Secondary Phone:** 202-555-0144').replace('**Height (feet):** Synthetic','**Height (feet):** 5').replace('**Height (inches):** Synthetic','**Height (inches):** 8').replace('**Weight (pounds):** Synthetic','**Weight (pounds):** 150').replace('**Other first name:** Synthetic','**Other first name:** Alternate').replace('**Other last name:** Synthetic','**Other last name:** Fictional');
  async function parse(text){
    await until(()=>source.evaluate("document.readyState==='complete' && typeof PackardSettings!=='undefined' && PackardSettings.accountPreferencesStatus()==='saved'"),'Toolkit initialized');
    await source.evaluate(`document.getElementById('intakeText').value=${JSON.stringify(text)};document.getElementById('intakeText').dispatchEvent(new Event('input',{bubbles:true}))`);
    await click(source,'Check Intake');await until(()=>source.evaluate("!document.getElementById('continueToSsa').hidden"),'parsed intake');
    await source.evaluate("document.querySelectorAll('#validationIssues .intake-reviewed, #reviewItems .intake-reviewed').forEach(button => button.click())");
    await until(()=>source.evaluate("!document.getElementById('continueToSsa').disabled"),'Checker notices handled');
    await click(source,'Continue to SSA Intake Assistant');
    await until(()=>source.evaluate("[...document.querySelectorAll('button')].some(button => button.textContent === 'Open client filing')"),'filing preview');
    await click(source,'Open client filing');
    await until(()=>source.evaluate("!!document.querySelector('[aria-label=\"Synthetic extension connection\"]')"));
  }
  async function send(){
    await click(extension,'Receive from Toolkit');
    await source.evaluate("document.querySelector('[aria-label=\"Synthetic extension connection\"] input[type=checkbox]').click()");
    await click(source,'Send to practice extension');
    await until(()=>extension.evaluate("document.getElementById('connection').textContent.startsWith('Received')"),'approved transfer');
  }
  const empty=(count=54)=>extension.evaluate(`document.querySelectorAll('[data-practice-field]:not([data-practice-record])').length===${count} && [...document.querySelectorAll('#practice input, #practice select')].every(input=>input.value==='')`);
  await parse(text);
  assert(await source.evaluate("[...document.querySelectorAll('button')].find(b=>b.textContent==='Send to practice extension').disabled"));
  for(const p of [source,extension])await p.evaluate("window.clientWrites=0; for(const method of ['setItem','removeItem','clear']) Storage.prototype[method]=()=>{window.clientWrites++};indexedDB.open=()=>{window.clientWrites++};for(const method of ['log','warn','error','info','debug']) console[method]=()=>{window.clientWrites++}");
  const start=network.length;
  await send();assert(await empty(60),'receipt must not auto-fill');
  assert(await extension.evaluate("document.querySelectorAll('[data-conditional-question-group=employment-questions] [data-practice-field]').length===3"));
  assert(await extension.evaluate("document.querySelectorAll('[data-conditional-question-group=previous-application-questions] [data-practice-field]').length===1 && document.querySelectorAll('[data-conditional-question-group=work-condition-questions] [data-practice-field]').length===2"));
  assert(await extension.evaluate("[...document.querySelectorAll('[data-conditional-question-group] input, [data-conditional-question-group] select')].every(input=>input.value==='')"));
  assert(await extension.evaluate("document.querySelectorAll('[data-employment-record]').length===1 && document.querySelector('[data-employment-record=job-1] [data-practice-field=employment-employer]').value===''"));
  assert(await extension.evaluate("!document.getElementById('fill').disabled && document.getElementById('demo').disabled"));
  await click(extension,'Fill received answers');
  assert(await extension.evaluate("document.querySelector('[data-conditional-question-group=employment-questions] [data-practice-field=worked-outside-us]').value==='yes' && document.querySelector('[data-conditional-question-group=employment-questions] [data-practice-field=eligible-foreign-ssi]').value==='no' && document.querySelector('[data-conditional-question-group=employment-questions] [data-practice-field=foreign-ssi-country]').value==='Example Country'"));
  assert(await extension.evaluate("document.querySelector('[data-conditional-question-group=previous-application-questions] [data-practice-field=previous-application]').value==='yes' && document.querySelector('[data-conditional-question-group=work-condition-questions] [data-practice-field=conditions-related-to-work]').value==='yes' && document.querySelector('[data-conditional-question-group=work-condition-questions] [data-practice-field=expect-to-receive-more-money]').value==='no'"));
  assert(await extension.evaluate("document.querySelector('[data-practice-field=first-name]').value==='Bridge Synthetic'"));
  assert(await extension.evaluate("document.querySelector('[data-practice-field=birth-city]').value!=='' && document.querySelector('[data-practice-field=mailing-city]').value!==''"));
  assert(await extension.evaluate("document.querySelector('[data-practice-field=physical-street]').value==='456 Fictional Avenue' && document.querySelector('[data-practice-field=mailing-street]').value!=='456 Fictional Avenue'"));
  assert(await extension.evaluate("document.querySelector('[data-practice-field=ssn]').value==='000-12-3456' && document.querySelector('[data-practice-field=alternate-phone]').value==='202-555-0143' && document.querySelector('[data-practice-field=secondary-phone]').value==='202-555-0144'"));
  assert(await extension.evaluate("document.querySelector('[data-practice-field=speak-english]').value==='no' && document.querySelector('[data-practice-field=read-english]').value==='no'"));
  assert(await extension.evaluate("document.querySelector('[data-practice-field=mother-maiden-name]').value!=='' && document.querySelector('[data-practice-field=father-last-name]').value!==''"));
  assert(await extension.evaluate("document.querySelector('[data-practice-field=height-feet]').value==='5' && document.querySelector('[data-practice-field=height-inches]').value==='8' && document.querySelector('[data-practice-field=weight-pounds]').value==='150'"));
  assert(await extension.evaluate("document.querySelector('[data-practice-field=other-first-name]').value==='Alternate' && document.querySelector('[data-practice-field=other-last-name]').value==='Fictional' && document.querySelector('[data-practice-field=other-middle-name]').value==='' && document.querySelector('[data-practice-field=other-suffix]').value===''"));
  assert(await extension.evaluate("document.querySelector('[data-practice-placeholder=birth-month]').value==='01' && document.querySelector('[data-practice-placeholder=birth-day]').value==='01' && document.querySelector('[data-practice-placeholder=birth-year]').value==='2000'"));
  assert(await extension.evaluate("document.querySelector('[data-practice-field=applicant-blind]').value==='no' && document.querySelector('[data-practice-field=current-spouse-first]').value!=='' && document.querySelector('[data-practice-field=current-spouse-last]').value!==''"));
  assert(await extension.evaluate("document.querySelector('[data-practice-placeholder=current-marriage-month]').value==='01' && document.querySelector('[data-practice-placeholder=current-marriage-day]').value==='01' && document.querySelector('[data-practice-placeholder=current-marriage-year]').value==='2000'"));
  assert(await extension.evaluate("document.querySelector('[data-practice-placeholder=child-1-first-name]').value!=='' && document.querySelector('[data-practice-placeholder=child-1-last-name]').value!==''"));
  assert(await extension.evaluate("document.querySelector('[data-employment-record=job-1] [data-practice-field=employment-employer]').value==='Synthetic' && document.querySelector('[data-employment-record=job-1] [data-practice-field=employment-street-line-1]').value==='Synthetic'"));
  assert(await extension.evaluate("document.querySelector('[data-employment-record=job-1] [data-practice-placeholder=employment-start-month]').value==='01' && document.querySelector('[data-employment-record=job-1] [data-practice-placeholder=employment-start-year]').value==='2000' && document.querySelector('[data-employment-record=job-1] [data-practice-placeholder=employment-end-month]').value==='01' && document.querySelector('[data-employment-record=job-1] [data-practice-placeholder=employment-end-year]').value==='2001'"));
  assert(await extension.evaluate("[...document.querySelectorAll('[data-employment-record=job-1] [data-practice-field=employment-2025], [data-employment-record=job-1] [data-practice-field=employment-2026], [data-employment-record=job-1] [data-practice-field=employment-2027], [data-employment-record=job-1] [data-practice-field=employment-country], [data-employment-record=job-1] [data-practice-field=employment-street-line-2], [data-employment-record=job-1] [data-practice-field=employment-not-ended]')].every(input=>input.value==='')"));
  assert(await extension.evaluate("[...document.querySelectorAll('[data-practice-placeholder]')].filter(i=>!i.dataset.practicePlaceholder.startsWith('birth-') && !i.dataset.practicePlaceholder.startsWith('current-marriage-') && !i.dataset.practicePlaceholder.startsWith('child-') && !i.dataset.practicePlaceholder.startsWith('employment-')).every(i=>i.value==='')"));
  assert(await extension.evaluate("document.querySelector('[data-practice-field=middle-name]').value==='' && document.querySelector('[data-practice-field=work-stopped]').value==='' && document.querySelector('[data-practice-field=last-worked]').value===''"));
  await click(source,'Back to Intake Checker');await until(empty,'Back clears receiver');
  assert.equal(await source.evaluate('intakeText.value'),text);
  await click(source,'Continue to SSA Intake Assistant');
  await until(()=>source.evaluate("[...document.querySelectorAll('button')].some(button => button.textContent === 'Open client filing')"),'filing preview after Back');
  await click(source,'Open client filing');
  await until(()=>source.evaluate("!!document.querySelector('[aria-label=\"Synthetic extension connection\"]')"),'practice connection after Back');
  await send();await click(extension,'Fill received answers');
  await cdp('Page.reload',{},extension.sessionId);await until(empty,'receiver reload clears');
  await until(()=>source.evaluate("document.querySelector('[aria-label=\"Synthetic extension connection\"]').textContent.includes('Disconnected')"));
  await send();await click(extension,'Fill received answers');
  await click(source,'Back to Intake Checker');
  await parse(text.replace('Bridge Synthetic','Second Synthetic'));await send();await click(extension,'Fill received answers');
  assert(await extension.evaluate("document.querySelector('[data-practice-field=first-name]').value==='Second Synthetic'"));
  for(const width of [1280,390]){
    await cdp('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:width===390},source.sessionId);
    assert(await source.evaluate('document.documentElement.scrollWidth<=innerWidth'));
    const shot=await cdp('Page.captureScreenshot',{format:'png'},source.sessionId);await writeFile(join(directory,`source-${width}.png`),Buffer.from(shot.data,'base64'));
    await cdp('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:width===390},extension.sessionId);
    assert(await extension.evaluate("document.querySelectorAll('[data-conditional-question-group=employment-questions] [data-practice-field]').length===3"));
    assert(await extension.evaluate('document.documentElement.scrollWidth<=innerWidth'));
    const extensionShot=await cdp('Page.captureScreenshot',{format:'png'},extension.sessionId);await writeFile(join(directory,`extension-${width}.png`),Buffer.from(extensionShot.data,'base64'));
  }
  await cdp('Page.reload',{},source.sessionId);await until(empty,'source reload clears receiver');
  await until(()=>source.evaluate("!!document.getElementById('intakeText') && !!document.querySelector('.toolkit-auth-name')"));
  assert.equal(await source.evaluate('intakeText.value'),'');
  await parse(text);await send();await click(extension,'Fill received answers');
  authenticated=false;await source.evaluate("window.dispatchEvent(new Event('packardaccountchange'))");await until(empty,'logout clears receiver');
  assert(network.slice(start).every(r=>r.method==='GET'&&!r.postData&&(r.url.startsWith('http://127.0.0.1:5173/')||r.url.startsWith(`chrome-extension://${loaded.id}/`))));
  for(const p of [source,extension])assert.equal(await p.evaluate('window.clientWrites || 0'),0);
  authenticated=true;await source.evaluate("window.dispatchEvent(new Event('packardaccountchange'))");
  await until(()=>source.evaluate("!!document.getElementById('intakeText') && !!document.querySelector('.toolkit-auth-name')"));
  await parse(text);await send();await click(extension,'Fill received answers');
  await cdp('Target.closeTarget',{targetId:source.targetId});await until(empty,'source close clears receiver');
  assert.equal(errors.length,0);
  console.log('PASS actual unpacked Chrome extension: explicit approval, ready-only projection, manual fill, Back, reload, profile switch, auth loss, desktop/mobile and no storage/log/client-data network traffic.');
  console.log(`Synthetic screenshots: ${directory}`);
}finally{child.kill();await vite.close();}
