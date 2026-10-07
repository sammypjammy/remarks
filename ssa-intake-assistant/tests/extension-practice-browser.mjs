import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdtemp, writeFile } from 'node:fs/promises';
import { resolve, join, extname } from 'node:path';
import { tmpdir } from 'node:os';
import { spawn } from 'node:child_process';
const browser = process.argv[2]; assert(browser, 'Provide Chrome executable');
const root = resolve('ssa-intake-assistant/extension-dev');
const directory = await mkdtemp(join(tmpdir(), 'packard-synthetic-extension-'));
const allowed = new Set(['practice.html','practice.js','mapping.js','synthetic.js','bridge-contract.js','style.css']);
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
  const evaluate=async expression=>{const r=await cdp('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});assert(!r.exceptionDetails,'Synthetic evaluation failed');return r.result.value;};
  await cdp('Page.enable');await cdp('Runtime.enable');await cdp('Network.enable');
  for(const width of [1280,390]) {
    await cdp('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:width===390});
    await cdp('Page.navigate',{url:origin+'/practice.html'});
    await until(()=>evaluate("document.querySelectorAll('#practice input, #practice select').length === 41"));
    await evaluate("window.writes=0; for(const name of ['setItem','removeItem','clear']) Storage.prototype[name]=()=>{window.writes++}; indexedDB.open=()=>{window.writes++}; for(const name of ['log','warn','error','info','debug']) console[name]=()=>{window.writes++}");
    assert(await evaluate("[...document.querySelectorAll('#practice input, #practice select')].every(i=>i.value==='')"));
    const start=network.length;
    await evaluate("document.getElementById('fill').click()");
    assert(await evaluate("document.getElementById('status').textContent.startsWith('37 filled; 4 paused')"));
    assert(await evaluate("document.querySelector('[data-practice-field=height-feet]').value==='5' && document.querySelector('[data-practice-field=height-inches]').value==='8' && document.querySelector('[data-practice-field=weight-pounds]').value==='150'"));
    assert(await evaluate("document.querySelector('[data-practice-field=mother-maiden-name]').value==='Fiction' && document.querySelector('[data-practice-field=other-legal-representative]').value===''"));
    assert(await evaluate("document.querySelector('[data-practice-field=birth-city]').value==='Example City' && document.querySelector('[data-practice-field=mailing-city]').value==='Sample City'"));
    assert(await evaluate("document.querySelector('[data-practice-field=physical-street]').value==='456 Fictional Avenue' && document.querySelector('[data-practice-field=physical-city]').value==='Another City'"));
    assert(await evaluate("document.querySelector('[data-practice-field=ssn]').value==='000-12-3456' && document.querySelector('[data-practice-field=alternate-phone]').value==='202-555-0143' && document.querySelector('[data-practice-field=secondary-phone]').value==='202-555-0144'"));
    assert(await evaluate("document.querySelector('[data-practice-field=speak-english]').value==='yes' && document.querySelector('[data-practice-field=read-english]').value==='no'"));
    assert(await evaluate("document.querySelector('[data-practice-field=onset]').value==='2020-03' && document.querySelector('[data-practice-field=last-worked]').value==='' && document.querySelector('[data-practice-field=work-stopped]').value===''"));
    await evaluate("document.querySelector('[data-practice-field=first-name]').value='Employee Synthetic';document.getElementById('fill').click()");
    assert(await evaluate("document.querySelector('[data-practice-field=first-name]').value==='Employee Synthetic'"));
    assert(await evaluate('document.documentElement.scrollWidth<=innerWidth'));
    assert.equal(await evaluate('window.writes'),0);assert.equal(network.length,start);
    const shot=await cdp('Page.captureScreenshot',{format:'png'});await writeFile(join(directory,`practice-${width}.png`),Buffer.from(shot.data,'base64'));
    await evaluate("document.getElementById('clear').click()");assert(await evaluate("[...document.querySelectorAll('#practice input, #practice select')].every(i=>i.value==='')"));
    await evaluate("document.getElementById('fill').click();window.dispatchEvent(new PageTransitionEvent('pagehide',{persisted:true}))");
    assert(await evaluate("[...document.querySelectorAll('#practice input, #practice select')].every(i=>i.value==='')"));
    await cdp('Page.reload');await until(()=>evaluate("document.querySelectorAll('#practice input, #practice select').length===41 && [...document.querySelectorAll('#practice input, #practice select')].every(i=>i.value==='')"));
    assert(await evaluate('localStorage.length===0 && sessionStorage.length===0'));
    console.log(`PASS ${width}px: explicit fill, exact dates, pauses, overwrite protection, reset/reload, layout and no storage/log/network writes`);
  }
  assert.equal(errors.length,0);assert(network.every(r=>r.url.startsWith(origin+'/') && r.method==='GET' && !r.postData));
  console.log(`Synthetic screenshots: ${directory}`);
} finally { socket?.close();child.kill();await new Promise(done=>server.close(done)); }
