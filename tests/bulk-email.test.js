import test from "node:test";
import assert from "node:assert/strict";
import { openBulkDrafts, isValidBulkEmail, parseBulkRecipients } from "../welcome-email-sender/bulkEmail.js";
import { createOutlookDraft } from "../welcome-email-sender/outlookGraph.js";

for (const [name, separator] of [["newlines", "\n"], ["commas", ","], ["semicolons", ";"], ["spaces", " "], ["tabs", "\t"]]) {
  test(`parses ${name}`, () => {
    assert.deepEqual(parseBulkRecipients(`one@example.com${separator}two@example.com`).recipients,
      ["one@example.com", "two@example.com"]);
  });
}

test("mixed formatting, names, mail links, whitespace, duplicate removal and counts", () => {
  const result = parseBulkRecipients('  John Smith <John@example.com>\n[jane@example.com](mailto:jane@example.com); bill@example.com\t\n sarah@example.com, JOHN@EXAMPLE.COM; bad@@example.com  ');
  assert.deepEqual(result, { recipients: ["john@example.com", "jane@example.com", "bill@example.com", "sarah@example.com"],
    found: 6, duplicates: 1, invalid: ["bad@@example.com"] });
  assert.deepEqual(parseBulkRecipients("one@example.com <two@example.com>").recipients, ["one@example.com", "two@example.com"]);
});

test("obviously invalid entries are never silently repaired or queued", () => {
  const invalid = ["bad", "x@", "@example.com", "a@@example.com", "a@example", "a..b@example.com", ".a@example.com", "a.@example.com", "a@-example.com", "a@example..com", "a@example.com/path", "a@example.com?subject=hi", "a".repeat(65) + "@example.com"];
  for (const address of invalid) assert.equal(isValidBulkEmail(address), false, address);
  assert.deepEqual(parseBulkRecipients(invalid.join("\n")).recipients, []);
  assert.ok(isValidBulkEmail("first.last+tag@sub.example.com"));
  assert.equal(parseBulkRecipients("  \n\t,; ").found, 0);
});


const tab = () => ({closed:false,location:{href:"about:blank"},close(){this.closed=true;}});

test("all tabs open synchronously before authorization; unique recipients share Single draft logic", async () => {
  const tabs=[],calls=[]; let release;
  const authorized=new Promise(resolve=>{release=resolve;});
  const content={subject:"Welcome",body:"Template and signature",managerName:"Amanda Zuscar",language:"english"};
  const work=openBulkDrafts({text:"A@example.com, a@EXAMPLE.com; b@example.com\nbad\tc@example.com",content,
    openWindow:()=>{const t=tab();tabs.push(t);return t;},authorize:()=>{assert.equal(tabs.length,3);return authorized;},
    createDraft:async c=>{calls.push(c);return {webLink:"https://outlook.office.com/"+c.recipient};},composeUrl:d=>d.webLink});
  assert.equal(tabs.length,3);assert.equal(calls.length,0);
  content.body="changed after click"; release();
  assert.equal(await work,3);
  assert.deepEqual(calls.map(c=>c.recipient),["a@example.com","b@example.com","c@example.com"]);
  assert.ok(calls.every(c=>c.subject==="Welcome"&&c.body==="Template and signature"&&c.managerName==="Amanda Zuscar"));
  assert.deepEqual(tabs.map(t=>t.location.href),calls.map(c=>"https://outlook.office.com/"+c.recipient));
  assert.ok(tabs.every(t=>t.opener===null));
});

test("zero valid recipients open no tabs and make no Graph requests", async () => {
  assert.equal(await openBulkDrafts({text:"bad @",content:{},openWindow:()=>assert.fail(),authorize:()=>assert.fail(),createDraft:()=>assert.fail()}),0);
});

test("blocked or throwing popup calls close reserved tabs before any draft is created", async () => {
  for(const throws of [false,true]) {
    const first=tab();let opened=0;
    await assert.rejects(openBulkDrafts({text:"a@example.com b@example.com",content:{},
      openWindow:()=>{if(++opened===1)return first;if(throws)throw Error();return null;},
      authorize:()=>assert.fail("must not authenticate"),createDraft:()=>assert.fail("must not create drafts")}),/Allow pop-ups and redirects.*No drafts were created/);
    assert.equal(first.closed,true);
  }
});

test("sign-in and draft failures are reported without retries or stranded blank tabs", async () => {
  const first=tab();
  await assert.rejects(openBulkDrafts({text:"a@example.com",content:{},openWindow:()=>first,authorize:async()=>{throw Error();}}),/sign-in/);
  assert.equal(first.closed,true);
  const tabs=[];let calls=0;
  await assert.rejects(openBulkDrafts({text:"a@example.com b@example.com",content:{},openWindow:()=>{const t=tab();tabs.push(t);return t;},authorize:async()=>{},
    createDraft:async c=>{calls++;if(c.recipient.startsWith('b'))throw Error();return {webLink:'https://outlook.office.com/draft'};},composeUrl:d=>d.webLink}),/Check the opened tabs and Outlook Drafts/);
  assert.equal(calls,2);assert.equal(tabs[0].closed,false);assert.equal(tabs[1].closed,true);
});

test("Single draft builder creates one-recipient messages with identical attachments and never sends", async t => {
  const requests=[];
  t.mock.method(globalThis,"fetch",async (url,options)=>{
    requests.push({url,body:JSON.parse(options.body)});
    assert.doesNotMatch(url,/\/send(?:Mail)?$/);
    return Response.json({id:String(requests.length),webLink:"https://outlook.office.com/draft"},{status:201});
  });
  const prepared={accessToken:"test",attachments:[{name:"packet.pdf",buffer:new TextEncoder().encode("%PDF-test").buffer}]};
  const calls=[];
  await openBulkDrafts({text:"a@example.com A@example.com b@example.com invalid",content:{subject:"Welcome",body:"Same body",managerName:"Amanda Zuscar"},
    openWindow:()=>tab(),authorize:async()=>{},createDraft:c=>{calls.push(c);return createOutlookDraft(c,prepared);},composeUrl:d=>d.webLink});
  const messages=requests.filter(r=>r.url.endsWith('/messages'));
  assert.equal(messages.length,2);
  messages.forEach((r,i)=>assert.deepEqual(r.body,{subject:"Welcome",body:{contentType:"Text",content:"Same body"},toRecipients:[{emailAddress:{address:calls[i].recipient}}]}));
  const attachments=requests.filter(r=>r.url.endsWith('/attachments'));
  assert.equal(attachments.length,2);assert.deepEqual(attachments[0].body,attachments[1].body);
  requests.length=0;
  await createOutlookDraft({recipient:"single@example.com",subject:"Subject",body:"Body"},{accessToken:"test",attachments:[]});
  assert.equal(requests.length,1);assert.deepEqual(requests[0].body.toRecipients,[{emailAddress:{address:"single@example.com"}}]);
});
