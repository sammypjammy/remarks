// No provider credentials, browser persistence or raw error rendering.
const $ = id => document.getElementById(id);
const states = {
  disconnected:'Not connected. Connect your own RingCentral account.',
  connecting:'A connection attempt is pending. You can try Connect again or disconnect to cancel it.',
  connected:'Connected to RingCentral.',
  refreshing:'RingCentral authorization is refreshing. Wait briefly, then refresh status.',
  needs_reconnect:'Reconnect required. Disconnect first, then connect your RingCentral account again.',
  disconnecting:'Disconnect is pending. Retry Disconnect to finish revoking access.'
};
let sequence=0,busy=false,signedIn=false;
const notice=message=>{$('notice').textContent=message;$('notice').hidden=!message;};
const clearIdentity=()=>{$('identity').hidden=true;for(const id of ['rcName','accountId','extensionId'])$(id).textContent='';};
const clearConnection=()=>{clearIdentity();$('connectForm').hidden=true;$('disconnect').hidden=true;};
const controls=()=>{for(const id of ['connect','disconnect','signOut','refresh'])$(id).disabled=busy;};
const url=new URL(location.href);
if(url.searchParams.get('connection')==='failed')notice('RingCentral connection could not be completed. Confirm Toolkit sign-in and try again.');
// Success is established only by the authenticated status response, never a URL flag.
if(url.search)history.replaceState(null,'','/fax-sender-v3/');
async function refresh(){
  const current=++sequence;
  signedIn=false;clearConnection();$('signOut').hidden=true;$('signIn').hidden=true;
  $('toolkitState').textContent='Checking Toolkit sign-in…';$('connectionState').textContent='Waiting for Toolkit authentication…';
  try{
    const r=await fetch('/api/auth/session',{cache:'no-store',credentials:'same-origin'});
    const data=await r.json();if(current!==sequence)return;
    if(r.status===401||r.status===403){window.dispatchEvent(new Event('toolkit-rc-reset'));$('toolkitState').textContent=r.status===403?'Toolkit access is unavailable for this account.':'Signed out of the Toolkit.';$('signIn').hidden=false;$('returnNote').hidden=false;$('connectionState').textContent='Sign into the Toolkit to connect RingCentral.';return;}
    if(!r.ok||data.authenticated!==true||typeof data.user?.displayName!=='string')throw Error();
    signedIn=true;$('toolkitState').textContent='Signed in as '+data.user.displayName;$('signOut').hidden=false;$('returnNote').hidden=true;
    const rc=await fetch('/api/ringcentral/connection',{cache:'no-store',credentials:'same-origin'});
    if(current!==sequence)return;
    if(rc.status===401||rc.status===403){signedIn=false;$('signOut').hidden=true;$('signIn').hidden=false;$('toolkitState').textContent='Toolkit session changed. Sign in again.';throw Error();}
    const connection=await rc.json();if(current!==sequence)return;
    if(!rc.ok||!Object.hasOwn(states,connection.state))throw Error();
    if(connection.state==='connected'){
      if(typeof connection.displayName!=='string'||![connection.accountId,connection.extensionId].every(x=>typeof x==='string'&&/^[1-9]\d{0,29}$/.test(x)))throw Error();
      $('rcName').textContent=connection.displayName;$('accountId').textContent=connection.accountId;$('extensionId').textContent=connection.extensionId;$('identity').hidden=false;
    }
    $('connectionState').textContent=states[connection.state];
    window.dispatchEvent(new CustomEvent('toolkit-rc-state',{detail:connection.state}));
    $('connectForm').hidden=!['disconnected','connecting'].includes(connection.state);
    $('disconnect').hidden=connection.state==='disconnected';
    $('disconnect').textContent=connection.state==='disconnecting'?'Retry Disconnect':'Disconnect RingCentral';
  }catch{if(current!==sequence)return;window.dispatchEvent(new Event('toolkit-rc-reset'));clearConnection();$('connectionState').textContent='Connection status unavailable. Refresh status to try again.';if(!signedIn){$('toolkitState').textContent='Toolkit sign-in is unavailable or has changed.';$('signIn').hidden=false;$('returnNote').hidden=false;}}
}
$('connectForm').addEventListener('submit',event=>{
  if(busy||!signedIn){event.preventDefault();return;}
  busy=true;++sequence;window.dispatchEvent(new Event('toolkit-rc-reset'));controls();notice('Opening RingCentral sign-in…');
  // Native same-origin POST follows the server's OAuth redirect without exposing its parameters to this script.
});
async function mutate(path,message){
  if(busy)return;busy=true;++sequence;window.dispatchEvent(new Event('toolkit-rc-reset'));clearConnection();controls();notice('');
  try{const r=await fetch(path,{method:'POST',credentials:'same-origin',cache:'no-store'});if(!r.ok)throw Error();notice(message);}
  catch{notice('The request could not be completed. Refresh status and retry; access may already be disabled.');}
  finally{busy=false;controls();await refresh();}
}
$('disconnect').addEventListener('click',()=>mutate('/api/ringcentral/disconnect','RingCentral disconnected.'));
$('signOut').addEventListener('click',()=>mutate('/api/auth/logout','Signed out of the Toolkit.'));
$('refresh').addEventListener('click',()=>{if(!busy)refresh();});
window.addEventListener('focus',()=>{if(!busy)refresh();});
window.addEventListener('pageshow',()=>{busy=false;controls();refresh();});
document.addEventListener('visibilitychange',()=>{if(document.hidden){++sequence;clearConnection();}else if(!busy)refresh();});
refresh();
setInterval(()=>{if(!busy&&!document.hidden)void refresh();},5000);
