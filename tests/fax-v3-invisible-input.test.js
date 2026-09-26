import test from 'node:test';import assert from 'node:assert/strict';
import {invisibleDiagnostics,inputDiagnostics} from '../maintenance/fax-v3-production/input-diagnostic.mjs';
import {checkedUrl} from '../maintenance/fax-v3-production/url-identity.mjs';import {identityReason} from '../maintenance/fax-v3-production/identity-errors.mjs';
const prefix='postgresql://synthetic:',suffix='@ep-young-dream-arkoh9e5.c-4.us-west-2.aws.neon.tech/neondb?sslmode=require&channel_binding=require',uri=prefix+'synthetic'+suffix;
const reason=value=>{try{checkedUrl(value);return 'PASS';}catch(e){return identityReason(e);}};
test('invisible diagnostics distinguish boundary/class without characters, offsets or counts',()=>{
 const cases=[[' '+uri,'LEADING_ASCII_WHITESPACE'],[uri+' ','TRAILING_ASCII_WHITESPACE'],['\r\n'+uri,'LEADING_CR_OR_LF'],[uri+'\r\n','TRAILING_CR_OR_LF'],['\u200b'+uri,'LEADING_UNICODE_FORMAT'],[uri+'\u2060','TRAILING_UNICODE_FORMAT'],[prefix+'one\x01two'+suffix,'EMBEDDED_ASCII_CONTROL'],[prefix+'one\u00a0two'+suffix,'EMBEDDED_UNICODE_WHITESPACE'],[prefix+'one\u0080two'+suffix,'EMBEDDED_OTHER_CONTROL'],['\u200b','ALL_INPUT_UNICODE_FORMAT']];
 for(const [value,expected]of cases){const d=invisibleDiagnostics(value);assert.deepEqual(d.invisibleClasses,[expected]);assert.deepEqual(Object.keys(d).sort(),['invisibleClasses','invisibleContext']);assert(Object.values(d).flat().every(v=>/^[A-Z_]+$/.test(v)));}
 assert.deepEqual(invisibleDiagnostics(uri).invisibleClasses,['NONE_DETECTED']);
 assert.deepEqual(invisibleDiagnostics(' '+uri+'\u200b').invisibleClasses,['LEADING_ASCII_WHITESPACE','TRAILING_UNICODE_FORMAT']);
});
test('credential classification is conservative and never asserts legitimacy or repairs input',()=>{
 assert.equal(invisibleDiagnostics(prefix+'one\u200btwo'+suffix).invisibleContext,'USERINFO_ONLY');
 assert.equal(invisibleDiagnostics(uri+'\u200b').invisibleContext,'OUTSIDE_USERINFO');
 assert.equal(invisibleDiagnostics('\u200b'+uri).invisibleContext,'URI_STRUCTURE_UNDETERMINED');
 assert.equal(invisibleDiagnostics(prefix+'one/\u200btwo'+suffix).invisibleContext,'URI_STRUCTURE_UNDETERMINED');
 assert.equal(invisibleDiagnostics(prefix+'one@\u200btwo'+suffix).invisibleContext,'URI_STRUCTURE_UNDETERMINED');
 const encoded=prefix+encodeURIComponent('one\u200btwo')+suffix;assert.deepEqual(invisibleDiagnostics(encoded).invisibleClasses,['NONE_DETECTED']);assert.equal(reason(encoded),'PASS');
});
test('observed combination including unevaluated credentials reproduced by disrupted URI structure',()=>{
 const input=uri.replace('://','\u200b:\u200b//');assert.equal(reason(input),'URL_MALFORMED');assert.equal(inputDiagnostics(input).parser,'WHATWG_PARSE_FAILED');assert.equal(inputDiagnostics(input).inputFormat,'WHITESPACE_OR_CONTROL_INPUT');assert.equal(inputDiagnostics(input).credentialEncoding,'NOT_EVALUATED');assert.deepEqual(invisibleDiagnostics(input).invisibleClasses,['EMBEDDED_UNICODE_FORMAT']);
 for(const value of [' '+uri,uri+'\r\n'])assert.equal(reason(value),'URL_COPY_FORMAT_INVALID');
});
