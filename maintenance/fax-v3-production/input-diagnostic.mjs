// Descriptive fixed categories only; never repair input or change URL policy.
export function inputDiagnostics(value) {
 const out={inputFormat:'URI_SHAPE',parser:'NOT_RUN',credentialEncoding:'NOT_EVALUATED'};
 if(typeof value!=='string'||!value)return {...out,inputFormat:'EMPTY_INPUT'};
 if(/^(?:psql\b|DATABASE_URL\s*=|\$env:)/i.test(value))out.inputFormat='COMMAND_OR_ASSIGNMENT';
 else if(/^["'\u2018\u2019\u201c\u201d]|["'\u2018\u2019\u201c\u201d]$/.test(value))out.inputFormat='QUOTED_INPUT';
 else if(/[\s\x00-\x1f\x7f\u200b-\u200f\u2060\ufeff]/u.test(value))out.inputFormat='WHITESPACE_OR_CONTROL_INPUT';
 else if(!/^postgres(?:ql)?:\/\//.test(value))out.inputFormat='SCHEME_MISSING_OR_NONSTANDARD';
 const scheme=value.indexOf('://'),at=value.lastIndexOf('@');
 if(scheme>=0&&at>scheme+3){
  const userinfo=value.slice(scheme+3,at);
  if(/[/?#\\]/.test(userinfo))out.credentialEncoding='UNESCAPED_USERINFO_DELIMITER_SUSPECTED';
  else {try{decodeURIComponent(userinfo);out.credentialEncoding='ENCODING_PARSEABLE';}catch{out.credentialEncoding='PERCENT_ENCODING_INVALID';}}
 }
 try{new URL(value);out.parser='WHATWG_PARSE_PASS';}catch{out.parser='WHATWG_PARSE_FAILED';}
 return out;
}
export async function compareTransport(stream,value) {
 const chunks=[];let bytes=0;
 const timeout=setTimeout(()=>stream.destroy(Error('INPUT_TRANSPORT_FAILED')),10000);
 try{
  for await(const chunk of stream){const buffer=Buffer.from(chunk);chunks.push(buffer);bytes+=buffer.length;if(bytes>262144)throw Error();}
  const reference=Buffer.concat(chunks),received=Buffer.from(value??'','utf16le');
  try{return typeof value==='string'&&reference.equals(received)?'SECURE_INPUT_TRANSPORT_MATCH':'SECURE_INPUT_TRANSPORT_MISMATCH';}
  finally{reference.fill(0);received.fill(0);}
 }catch{return 'SECURE_INPUT_TRANSPORT_FAILED';}
 finally{clearTimeout(timeout);for(const b of chunks)b.fill(0);}
}

// Coarse categories only. No characters, offsets, counts, excerpts or fingerprints.
// Boundary labels describe runs at the outer edges; nothing is trimmed or reparsed.
export function invisibleDiagnostics(value) {
 if(typeof value!=='string'||!value)return {invisibleClasses:['NONE_DETECTED'],invisibleContext:'NOT_APPLICABLE'};
 const kind=c=>/[\r\n]/u.test(c)?'CR_OR_LF':/[\x00-\x1f\x7f]/u.test(c)?'ASCII_CONTROL':c===' '?'ASCII_WHITESPACE':/\p{White_Space}/u.test(c)?'UNICODE_WHITESPACE':/\p{Cf}/u.test(c)?'UNICODE_FORMAT':/\p{Cc}/u.test(c)?'OTHER_CONTROL':null;
 const chars=Array.from(value);let first=0,last=chars.length;
 while(first<last&&kind(chars[first]))first++;
 while(last>first&&kind(chars[last-1]))last--;
 const found=new Set();
 for(let i=0;i<chars.length;i++){const k=kind(chars[i]);if(k)found.add((first===chars.length?'ALL_INPUT':i<first?'LEADING':i>=last?'TRAILING':'EMBEDDED')+'_'+k);}
 if(!found.size)return {invisibleClasses:['NONE_DETECTED'],invisibleContext:'NOT_APPLICABLE'};
 // Identify userinfo only with an anchored scheme, a single unambiguous @ in
 // authority, and an explicit user/password separator. Never guess after stripping.
 const match=/^postgres(?:ql)?:\/\/([^/?#]*?)@([^/?#]+)(?:[/?#]|$)/u.exec(value);
 let context='URI_STRUCTURE_UNDETERMINED';
 if(match&&!match[1].includes('@')&&!match[2].includes('@')&&match[1].includes(':')){
  const start=value.indexOf('://')+3,end=start+match[1].length;
  let inside=false,outside=false,offset=0;
  for(const c of chars){if(kind(c)){if(offset>=start&&offset<end)inside=true;else outside=true;}offset+=c.length;}
  context=inside?(outside?'USERINFO_AND_OTHER_REGIONS':'USERINFO_ONLY'):'OUTSIDE_USERINFO';
 }
 return {invisibleClasses:[...found].sort(),invisibleContext:context};
}
