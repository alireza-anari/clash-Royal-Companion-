import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const filename=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'beta-session.js');
const source=fs.readFileSync(filename,'utf8');
const base='https://beta.crc.example';

function context({enabled=true,fetchImpl=async()=>new Response('{}',{headers:{'Content-Type':'application/json'}})}={}){
 let navigations=[];
 const location={origin:base,assign(path){navigations.push(path);}};
 const root={document:{querySelector:()=>enabled?{}:null},location,fetch:fetchImpl,Response,URL};
 const globals={window:root,globalThis:root,URL,Response,console};
 vm.runInNewContext(source,globals);
 return {session:root.CRCBetaSession,getNavigations:()=>navigations};
}

test('beta helper stays completely inert on normal public staging',()=>{
 assert.equal(context({enabled:false}).session,undefined);
});

test('transport permits only approved same-origin beta API paths',async()=>{
 const calls=[];
 const session=context({fetchImpl:async(path,options)=>{
  calls.push({path,options});
  return new Response('{"schema_version":"1.0"}',{headers:{'Content-Type':'application/json'}});
 }}).session;
 for(const path of [
  'https://evil.example','//evil.example/api/v1/capabilities',
  '/api/v1/health/live','/api/v1/players/%23ABC/cards',
  '/api/v1/players/%23ABC/snapshot?limit=999',
  '/api/v1/capabilities?proxy=http://evil.example','/api/v1/capabilities#fragment'
 ]){
  const response=await session.fetch(path);
  assert.equal(response.status,403,path);
 }
 assert.equal(calls.length,0);
 const response=await session.fetch('/api/v1/players/%23ABC123/snapshot?limit=25');
 assert.equal(response.status,200);
 assert.equal(calls.length,1);
 assert.equal(calls[0].path,'/api/v1/players/%23ABC123/snapshot?limit=25');
});

test('browser uses same-origin HttpOnly cookie automatically and never forwards caller credentials',async()=>{
 const calls=[];
 const session=context({fetchImpl:async(path,options)=>{
  calls.push({path,options});
  return new Response('{"live_lookup_enabled":true}',{headers:{'Content-Type':'application/json'}});
 }}).session;
 await session.fetch('/api/v1/capabilities',{credentials:'omit',headers:{Authorization:'Bearer malicious'}});
 assert.equal(calls.length,1);
 assert.equal(calls[0].options.credentials,'same-origin');
 assert.equal(calls[0].options.redirect,'manual');
 assert.equal(calls[0].options.cache,'no-store');
 assert.equal(calls[0].options.headers.Authorization,undefined);
 assert.equal(calls[0].options.headers['X-CRC-Worker-Assertion'],undefined);
 assert.equal(calls[0].options.headers.Accept,'application/json');
});

test('explicit sign-in navigation happens only after a user action',()=>{
 const {session,getNavigations}=context();
 assert.equal(getNavigations().length,0);
 session.signInAgain();
 assert.deepEqual(getNavigations(),['/login']);
});

test('network failures are sanitized without exposing private diagnostics',async()=>{
 const session=context({fetchImpl:async()=>{throw Error('private browser diagnostic');}}).session;
 const response=await session.fetch('/api/v1/capabilities');
 assert.equal(response.status,503);
 assert.equal((await response.json()).error.code,'BETA_NETWORK_UNAVAILABLE');
});

test('sign out calls the same-origin logout route and then navigates to login',async()=>{
 const calls=[];
 const {session,getNavigations}=context({fetchImpl:async(path,options)=>{
  calls.push({path,options});return new Response('{"authenticated":false}');
 }});
 await session.signOut();
 assert.equal(calls[0].path,'/api/v1/auth/logout');
 assert.equal(calls[0].options.method,'POST');
 assert.equal(calls[0].options.credentials,'same-origin');
 assert.deepEqual(getNavigations(),['/login']);
});

test('protected readiness uses same-origin session and never calls arbitrary health URLs',async()=>{
 const calls=[];
 const {session}=context({fetchImpl:async(path,options)=>{
  calls.push({path,options});
  return new Response('{"status":"ready_for_authenticated_requests"}',{headers:{'Content-Type':'application/json'}});
 }});
 const response=await session.fetch('/api/v1/health/ready');
 assert.equal(response.status,200);
 assert.equal(calls.length,1);
 assert.equal(calls[0].path,'/api/v1/health/ready');
 assert.equal(calls[0].options.credentials,'same-origin');
 assert.equal((await session.fetch('/api/v1/health/live')).status,403);
 assert.equal((await session.fetch('/api/v1/health/ready?private=1')).status,403);
 assert.equal(calls.length,1);
});

test('coach POST is exact and consent-bound',async()=>{
 const calls=[];
 const {session}=context({fetchImpl:async(path,options)=>{
  calls.push({path,options});return new Response('{}',{headers:{'Content-Type':'application/json'}});
 }});
 const body=JSON.stringify({question:'test',consent_to_external_ai:true});
 assert.equal((await session.fetch('/api/v1/capabilities',{method:'POST',body})).status,403);
 assert.equal((await session.fetch('/api/v1/coach/chat',{method:'POST',body:'{}'})).status,403);
 assert.equal(calls.length,0);
 assert.equal((await session.fetch('/api/v1/coach/chat',{method:'POST',body})).status,200);
 assert.equal(calls[0].options.credentials,'same-origin');
 assert.equal(calls[0].options.body,body);
});


test('vision browser transport is explicit-consent gated and scoped to known job routes',async()=>{
  const calls=[];
  const {session}=context();
  const transport=session.createTransport(async(path,options)=>{calls.push({path,options});return new Response('{}',{status:200});});
  const body=JSON.stringify({consent_to_upload:true,consent_to_external_ai:true,frames:[]});
  const denied=await transport('/api/v1/vision/jobs',{method:'POST',body:JSON.stringify({consent_to_external_ai:true})});
  assert.equal(denied.status,403);
  const accepted=await transport('/api/v1/vision/jobs',{method:'POST',body});
  assert.equal(accepted.status,200);
  assert.equal(calls[0].options.credentials,'same-origin');
  assert.equal(calls[0].options.cache,'no-store');
  const job='/api/v1/vision/jobs/123e4567-e89b-42d3-a456-426614174000';
  assert.equal(session.permittedPath('/api/v1/vision/capabilities','GET'),true);
  assert.equal(session.permittedPath(job,'GET'),true);
  assert.equal(session.permittedPath(job,'DELETE'),true);
  assert.equal(session.permittedPath('/api/v1/vision/jobs/not-a-uuid','GET'),false);
  assert.equal(session.permittedPath('/api/v1/vision/jobs?target=https://evil.example','POST'),false);
  const removed=await transport(job,{method:'DELETE'});
  assert.equal(removed.status,200);
});
