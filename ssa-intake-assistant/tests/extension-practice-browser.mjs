import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdtemp, writeFile } from 'node:fs/promises';
import { resolve, join, extname } from 'node:path';
import { tmpdir } from 'node:os';
import { spawn } from 'node:child_process';
const browser = process.argv[2]; assert(browser, 'Provide Chrome executable');
const root = resolve('ssa-intake-assistant/extension-dev');
const directory = await mkdtemp(join(tmpdir(), 'packard-synthetic-extension-'));
const allowed = new Set(['practice.html','practice.js','practice-layout.js','mapping.js','synthetic.js','bridge-contract.js','style.css']);
const server = createServer(async (req, res) => {
  const name = req.url.slice(1);
  if (!allowed.has(name) || req.method !== 'GET') return res.writeHead(404).end();
  res.setHeader('Cache-Control','no-store');
  res.setHeader('Content-Type', {'.html':'text/html','.js':'text/javascript','.css':'text/css'}[extname(name)]);
  res.end(await readFile(join(root,name)));
});
await new Promise(done => server.listen(0,'127.0.0.1',done));
const origin = `http://127.0.0.1:${server.address().port}`;
const child = spawn(browser, ['--headless=new','--disable-gpu','--no-first-run','--no-default-browser-check','--remote-debugging-port=0',`--user-data-dir=${join(directory,'profile')}`,'about:blank'], {windowsHide:true,stdio:'ignore'});
let launchError; child.on('error', error => { launchError=error; });
let socket;
async function until(fn) { const end=Date.now()+15000; while(Date.now()<end) { if(launchError)throw launchError; if(await fn())return; await new Promise(done=>setTimeout(done,50)); } throw Error('Synthetic condition timed out'); }
try {
  let port;
  await until(async()=>{try { port=(await readFile(join(directory,'profile/DevToolsActivePort'),'utf8')).split('\n')[0];return port; }catch{return false;}});
  const targets=await fetch(`http://127.0.0.1:${port}/json/list`).then(r=>r.json());
  socket=new WebSocket(targets.find(t=>t.type==='page').webSocketDebuggerUrl);
  await new Promise(done=>socket.onopen=done);
  let id=0;const pending=new Map(), network=[], errors=[];
  socket.onmessage=({data})=>{const e=JSON.parse(data);if(e.id){const p=pending.get(e.id);pending.delete(e.id);e.error?p.reject(Error(e.error.message)):p.resolve(e.result);}
    if(e.method==='Network.requestWillBeSent')network.push(e.params.request);
    if(e.method==='Runtime.exceptionThrown')errors.push('Runtime failure');
  };
  const cdp=(method,params={})=>new Promise((resolve,reject)=>{pending.set(++id,{resolve,reject});socket.send(JSON.stringify({id,method,params}));});
  const evaluate=async expression=>{const r=await cdp('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});assert(!r.exceptionDetails,r.exceptionDetails?.exception?.description||'Synthetic evaluation failed');return r.result.value;};
  await cdp('Page.enable');await cdp('Runtime.enable');await cdp('Network.enable');
  await cdp('Page.addScriptToEvaluateOnNewDocument',{source:"Object.defineProperty(window,'chrome',{configurable:true,value:{runtime:{onConnectExternal:{addListener(listener){window.practiceConnect=listener;}}}}});"});
  for(const width of [1280,390]) {
    await cdp('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:width===390});
    await cdp('Page.navigate',{url:origin+'/practice.html'});
    await until(()=>evaluate("document.querySelectorAll('[data-practice-field]').length === 54"));
    assert(await evaluate("[...document.querySelectorAll('#practice > .practice-section > h2')].map(h=>h.textContent).join('|')==='Applicant’s Name|Social Security Number (SSN)|Date of Birth|Sex|Is the applicant blind?|In the last 14 months, SGA?|Other Names|Marriage Information — Current Spouse|Children'"));
    assert(await evaluate("[...document.querySelectorAll('#practice .mapping-note')].length===2"));
    assert(await evaluate("!document.querySelector('[data-prior-record]')"));
    assert(await evaluate("!document.querySelector('[data-employment-record]')"));
    assert(await evaluate("!document.querySelector('[data-conditional-question-group=employment-questions]')"));
    await evaluate("window.writes=0; for(const name of ['setItem','removeItem','clear']) Storage.prototype[name]=()=>{window.writes++}; indexedDB.open=()=>{window.writes++}; for(const name of ['log','warn','error','info','debug']) console[name]=()=>{window.writes++}");
    assert(await evaluate("[...document.querySelectorAll('#practice input, #practice select')].every(i=>i.value==='')"));
    assert(await evaluate("document.getElementById('fill').disabled && document.getElementById('demo').textContent.includes('not your intake')"));
    const start=network.length;
    await evaluate("document.getElementById('demo').click()");
    assert(await evaluate("document.getElementById('status').textContent.startsWith('69 filled; 12 paused')"));
    assert(await evaluate("document.querySelectorAll('[data-employment-record]').length===1"));
    assert(await evaluate("document.querySelectorAll('[data-employment-record=job-1] [data-practice-field]').length===19"));
    assert(await evaluate("document.querySelector('[data-employment-record=job-1] [data-practice-field=employment-job-title]').value==='Example Job Title' && document.querySelector('[data-employment-record=job-1] [data-practice-field=employment-business-type]').value==='Example Business Type'"));
    assert(await evaluate("document.querySelector('[data-employment-record=job-1] [data-practice-field=employment-hours-per-day]').value==='8' && document.querySelector('[data-employment-record=job-1] [data-practice-field=employment-days-per-week]').value==='5' && document.querySelector('[data-employment-record=job-1] [data-practice-field=employment-rate-of-pay]').value==='$20.00' && document.querySelector('[data-employment-record=job-1] [data-practice-field=employment-pay-frequency]').value==='Weekly'"));
    assert(await evaluate("document.querySelector('[data-employment-record=job-1] [data-practice-field=employment-employer]').value==='Example Company'"));
    assert(await evaluate("document.querySelector('[data-employment-record=job-1] [data-practice-placeholder=employment-start-month]').value==='01' && document.querySelector('[data-employment-record=job-1] [data-practice-placeholder=employment-start-year]').value==='2010'"));
    assert(await evaluate("document.querySelector('[data-employment-record=job-1] [data-practice-placeholder=employment-end-month]').value==='06' && document.querySelector('[data-employment-record=job-1] [data-practice-placeholder=employment-end-year]').value==='2015'"));
    assert(await evaluate("[...document.querySelectorAll('[data-employment-record=job-1] [data-practice-field^=employment-202], [data-employment-record=job-1] [data-practice-field=employment-country], [data-employment-record=job-1] [data-practice-field=employment-street-line-2], [data-employment-record=job-1] [data-practice-field=employment-not-ended]')].every(i=>i.value==='')"));
    assert(await evaluate("document.querySelector('[data-practice-field=applicant-blind]').value==='yes' && document.querySelector('[data-practice-field=current-spouse-first]').value==='Fictional' && document.querySelector('[data-practice-field=current-spouse-ssn]').value==='000-98-7654'"));
    assert(await evaluate("document.querySelector('[data-practice-placeholder=current-marriage-month]').value==='01' && document.querySelector('[data-practice-placeholder=current-marriage-day]').value==='02' && document.querySelector('[data-practice-placeholder=current-marriage-year]').value==='2010'"));
    assert(await evaluate("document.querySelector('[data-practice-placeholder=child-1-first-name]').value==='Fictional' && document.querySelector('[data-practice-placeholder=child-1-last-name]').value==='Child'"));
    assert(await evaluate("document.querySelector('[data-practice-field=gender]').value==='Female'"));
    assert(await evaluate("document.querySelector('[data-practice-placeholder=birth-month]').value==='01' && document.querySelector('[data-practice-placeholder=birth-day]').value==='02' && document.querySelector('[data-practice-placeholder=birth-year]').value==='2000'"));
    assert(await evaluate("[...document.querySelectorAll('[data-practice-placeholder]')].filter(i=>!i.dataset.practicePlaceholder.startsWith('birth-') && !i.dataset.practicePlaceholder.startsWith('current-marriage-') && !i.dataset.practicePlaceholder.startsWith('child-') && !i.dataset.practicePlaceholder.startsWith('employment-')).every(i=>i.value==='')"));
    assert(await evaluate("document.querySelector('[data-practice-field=other-first-name]').value==='Alternate' && document.querySelector('[data-practice-field=other-last-name]').value==='Example' && document.querySelector('[data-practice-field=other-middle-name]').value==='' && document.querySelector('[data-practice-field=other-suffix]').value===''"));
    assert(await evaluate("document.querySelector('[data-practice-field=height-feet]').value==='5' && document.querySelector('[data-practice-field=height-inches]').value==='8' && document.querySelector('[data-practice-field=weight-pounds]').value==='150'"));
    assert(await evaluate("document.querySelector('[data-practice-field=mother-maiden-name]').value==='Fiction' && document.querySelector('[data-practice-field=other-legal-representative]').value===''"));
    assert(await evaluate("document.querySelector('[data-practice-field=birth-city]').value==='Example City' && document.querySelector('[data-practice-field=mailing-city]').value==='Sample City'"));
    assert(await evaluate("document.querySelector('[data-practice-field=physical-street]').value==='456 Fictional Avenue' && document.querySelector('[data-practice-field=physical-city]').value==='Another City'"));
    assert(await evaluate("document.querySelector('[data-practice-field=ssn]').value==='000-12-3456' && document.querySelector('[data-practice-field=alternate-phone]').value==='202-555-0143' && document.querySelector('[data-practice-field=secondary-phone]').value==='202-555-0144'"));
    assert(await evaluate("document.querySelector('[data-practice-field=speak-english]').value==='yes' && document.querySelector('[data-practice-field=read-english]').value==='no'"));
    assert(await evaluate("document.querySelector('[data-practice-field=onset]').value==='2020-03' && document.querySelector('[data-practice-field=last-worked]').value==='' && document.querySelector('[data-practice-field=work-stopped]').value===''"));
    await evaluate("document.querySelector('[data-practice-field=first-name]').value='Employee Synthetic';document.getElementById('demo').click()");
    assert(await evaluate("document.querySelector('[data-practice-field=first-name]').value==='Employee Synthetic'"));
    assert(await evaluate('document.documentElement.scrollWidth<=innerWidth'));
    assert.equal(await evaluate('window.writes'),0);assert.equal(network.length,start);
    const shot=await cdp('Page.captureScreenshot',{format:'png'});await writeFile(join(directory,`practice-${width}.png`),Buffer.from(shot.data,'base64'));
    await evaluate("document.getElementById('clear').click()");assert(await evaluate("[...document.querySelectorAll('#practice input, #practice select')].every(i=>i.value==='')"));
    await evaluate("document.getElementById('receive').click()");
    await evaluate(`(() => {
      const port = window.testPort = {
        name:'packard-synthetic-practice-v1',
        sender:{url:'http://127.0.0.1:5173/intake-checker/',origin:'http://127.0.0.1:5173',frameId:0,tab:{id:4}},
        onMessage:{addListener(fn){this.listener=fn},removeListener(){}},
        onDisconnect:{addListener(fn){this.listener=fn},removeListener(){}},
        postMessage(packet){if(packet.type==='challenge')this.receiver=packet.receiver},
        disconnect(){}
      };
      const records=['prior-spouse-1','prior-spouse-2'];
      const field=(definitionId,recordId,value,dataType='text',precision=null)=>({
        id:definitionId+'@'+recordId,definitionId,recordId,value,dataType,precision,
        readiness:'ready',blockingReasons:[]
      });
      const profile={
        schema:'packard.intake-client-profile',schemaVersion:'3.5.0',
        priorSpouseRecords:records,
        jobRecords:['job-1','job-2'],
        conditionalQuestionFields:['employment.worked-outside-united-states','employment.eligible-for-foreign-ssi','employment.foreign-ssi-country','previous-applications.previous-applications-previously-applied-for-medicare-ss-ssi','workers-compensation.illnesses-injuries-work-related','wages-earnings.expect-money-from-employer-in-future'],
        conditionalQuestionMissingFields:['employment.foreign-ssi-country','previous-applications.previous-applications-previously-applied-for-medicare-ss-ssi'],
        fields:[
          {id:'employment.worked-outside-united-states',definitionId:'employment.worked-outside-united-states',recordId:null,value:true,dataType:'boolean',readiness:'ready',blockingReasons:[]},
          {id:'employment.eligible-for-foreign-ssi',definitionId:'employment.eligible-for-foreign-ssi',recordId:null,value:false,dataType:'boolean',readiness:'ready',blockingReasons:[]},
          {id:'workers-compensation.illnesses-injuries-work-related',definitionId:'workers-compensation.illnesses-injuries-work-related',recordId:null,value:false,dataType:'boolean',readiness:'ready',blockingReasons:[]},
          {id:'wages-earnings.expect-money-from-employer-in-future',definitionId:'wages-earnings.expect-money-from-employer-in-future',recordId:null,value:true,dataType:'boolean',readiness:'ready',blockingReasons:[]},
          field('priorSpouses.first-name',records[0],'Former One'),
          field('priorSpouses.middle-name',records[0],'Middle One'),
          field('priorSpouses.name-at-birth',records[0],'Birth One'),
          field('priorSpouses.marriage-date',records[0],'2001-02-03','date','day'),
          field('priorSpouses.prior-spouse-died-since-marriage-ended',records[0],'Unknown'),
          field('priorSpouses.first-name',records[1],'Former Two'),
          field('priorSpouses.prior-spouse-died-since-marriage-ended',records[1],'No'),
          field('jobs.employer','job-1','Synthetic Recent Employer'),
          field('jobs.job-title','job-1','Synthetic Recent Title'),
          field('jobs.business-type','job-1','Synthetic Recent Business'),
          field('jobs.hours-per-day','job-1','8'),
          field('jobs.days-per-week','job-1','5'),
          field('jobs.rate-of-pay','job-1','$20.00'),
          field('jobs.pay-frequency','job-1','Weekly'),
          field('jobs.start-date','job-1','2010-01-02','date','day'),
          field('jobs.end-date','job-1','2015-06-07','date','day'),
          field('jobs.employer','job-2','Synthetic Previous Employer'),
          field('jobs.job-title','job-2','Synthetic Previous Title'),
          field('jobs.business-type','job-2','Synthetic Previous Business'),
          field('jobs.city','job-2','Example Previous City'),
          field('jobs.start-date','job-2','2010-01','date','month')
        ]
      };
      window.practiceConnect(port);
      port.onMessage.listener({type:'profile',receiver:port.receiver,session:'22222222-2222-2222-2222-222222222222',profile});
    })()`);
    assert(await evaluate("document.querySelectorAll('[data-prior-record]').length===2"));
    assert(await evaluate("[...document.querySelectorAll('[data-prior-record]')].every(section=>section.querySelectorAll('[data-practice-field]').length===18)"));
    assert(await evaluate("document.querySelector('[data-prior-record=prior-spouse-1] [data-practice-field=prior-middle-name]') !== document.querySelector('[data-prior-record=prior-spouse-1] [data-practice-field=prior-name-at-birth]')"));
    assert(await evaluate("document.querySelector('[data-prior-record=prior-spouse-2] [data-practice-field=prior-middle-name]').nextElementSibling.textContent==='Not provided'"));
    await evaluate("document.getElementById('fill').click()");
    assert(await evaluate("document.querySelector('[data-prior-record=prior-spouse-1] [data-practice-field=prior-first-name]').value==='Former One' && document.querySelector('[data-prior-record=prior-spouse-2] [data-practice-field=prior-first-name]').value==='Former Two'"));
    assert(await evaluate("document.querySelector('[data-prior-record=prior-spouse-1] [data-practice-field=prior-name-at-birth]').value==='Birth One' && document.querySelector('[data-prior-record=prior-spouse-1] [data-practice-field=prior-middle-name]').value==='Middle One'"));
    assert(await evaluate("document.querySelector('[data-prior-record=prior-spouse-1] [data-practice-field=prior-spouse-died]').value==='Unknown' && document.querySelector('[data-prior-record=prior-spouse-2] [data-practice-field=prior-spouse-died]').value==='No'"));
    assert(await evaluate("document.querySelector('[data-prior-record=prior-spouse-1] [data-practice-field=prior-marriage-date]').value==='2001-02-03'"));
    assert(await evaluate("document.querySelectorAll('[data-employment-record]').length===2"));
    assert(await evaluate("document.querySelectorAll('[data-conditional-question-group=employment-questions] [data-practice-field]').length===3"));
    assert(await evaluate("document.querySelector('[data-conditional-question-group=employment-questions] [data-practice-field=worked-outside-us]').nextElementSibling.textContent==='Ready answer; Fill is required to enter it.' && document.querySelector('[data-conditional-question-group=employment-questions] [data-practice-field=foreign-ssi-country]').nextElementSibling.textContent==='Not provided'"));
    assert(await evaluate("[...document.querySelectorAll('[data-employment-record]')].every(section=>section.querySelectorAll('[data-practice-field]').length===19)"));
    assert(await evaluate("document.querySelector('[data-employment-record=job-1] [data-practice-field=employment-employer]').value==='Synthetic Recent Employer' && document.querySelector('[data-employment-record=job-2] [data-practice-field=employment-employer]').value==='Synthetic Previous Employer'"));
    assert(await evaluate("document.querySelector('[data-conditional-question-group=employment-questions] [data-practice-field=worked-outside-us]').value==='yes' && document.querySelector('[data-conditional-question-group=employment-questions] [data-practice-field=eligible-foreign-ssi]').value==='no' && document.querySelector('[data-conditional-question-group=employment-questions] [data-practice-field=foreign-ssi-country]').value===''"));
    assert(await evaluate("document.querySelector('[data-conditional-question-group=previous-application-questions] [data-practice-field=previous-application]').value==='' && document.querySelector('[data-conditional-question-group=previous-application-questions] [data-practice-field=previous-application]').nextElementSibling.textContent==='Not provided' && document.querySelector('[data-conditional-question-group=work-condition-questions] [data-practice-field=conditions-related-to-work]').value==='no' && document.querySelector('[data-conditional-question-group=work-condition-questions] [data-practice-field=expect-to-receive-more-money]').value==='yes'"));
    assert(await evaluate("document.querySelector('[data-employment-record=job-1] [data-practice-field=employment-job-title]').value==='Synthetic Recent Title' && document.querySelector('[data-employment-record=job-2] [data-practice-field=employment-job-title]').value==='Synthetic Previous Title'"));
    assert(await evaluate("document.querySelector('[data-employment-record=job-1] [data-practice-field=employment-business-type]').value==='Synthetic Recent Business' && document.querySelector('[data-employment-record=job-2] [data-practice-field=employment-business-type]').value==='Synthetic Previous Business'"));
    assert(await evaluate("document.querySelector('[data-employment-record=job-1] [data-practice-field=employment-hours-per-day]').value==='8' && document.querySelector('[data-employment-record=job-1] [data-practice-field=employment-days-per-week]').value==='5' && document.querySelector('[data-employment-record=job-1] [data-practice-field=employment-rate-of-pay]').value==='$20.00' && document.querySelector('[data-employment-record=job-1] [data-practice-field=employment-pay-frequency]').value==='Weekly'"));
    assert(await evaluate("document.querySelector('[data-employment-record=job-2] [data-practice-field=employment-hours-per-day]').nextElementSibling.textContent==='Not provided' && document.querySelector('[data-employment-record=job-2] [data-practice-field=employment-pay-frequency]').nextElementSibling.textContent==='Not provided'"));
    assert(await evaluate("document.querySelector('[data-employment-record=job-1] [data-practice-placeholder=employment-start-month]').value==='01' && document.querySelector('[data-employment-record=job-1] [data-practice-placeholder=employment-start-year]').value==='2010'"));
    assert(await evaluate("document.querySelector('[data-employment-record=job-2] [data-practice-field=employment-city]').value==='Example Previous City' && document.querySelector('[data-employment-record=job-2] [data-practice-placeholder=employment-start-month]').value==='' && document.querySelector('[data-employment-record=job-2] [data-practice-placeholder=employment-start-year]').value===''"));
    assert(await evaluate("document.querySelector('[data-employment-record=job-2] [data-practice-field=employment-2025]').value==='' && document.querySelector('[data-employment-record=job-2] [data-practice-field=employment-not-ended]').value===''"));
    assert(await evaluate("document.querySelector('[data-employment-record=job-2] [data-practice-field=employment-street-line-1]').nextElementSibling.textContent==='Not provided' && document.querySelector('[data-employment-record=job-2] [data-practice-placeholder=employment-start-month]').nextElementSibling.textContent==='Not provided'"));
    await evaluate("document.getElementById('clear').click()");
    assert(await evaluate("!document.querySelector('[data-prior-record]') && document.getElementById('fill').disabled"));
    assert(await evaluate("!document.querySelector('[data-conditional-question-group=employment-questions]')"));
    await evaluate("document.getElementById('demo').click();window.dispatchEvent(new PageTransitionEvent('pagehide',{persisted:true}))");
    assert(await evaluate("[...document.querySelectorAll('#practice input, #practice select')].every(i=>i.value==='')"));
    await cdp('Page.reload');await until(()=>evaluate("document.querySelectorAll('[data-practice-field]').length===54 && [...document.querySelectorAll('#practice input, #practice select')].every(i=>i.value==='')"));
    assert(await evaluate('localStorage.length===0 && sessionStorage.length===0'));
    console.log(`PASS ${width}px: explicit fill, exact dates, pauses, overwrite protection, reset/reload, layout and no storage/log/network writes`);
  }
  assert.equal(errors.length,0);assert(network.every(r=>r.url.startsWith(origin+'/') && r.method==='GET' && !r.postData));
  console.log(`Synthetic screenshots: ${directory}`);
} finally { socket?.close();child.kill();await new Promise(done=>server.close(done)); }
