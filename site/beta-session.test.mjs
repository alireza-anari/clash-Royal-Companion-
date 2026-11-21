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
 let reloaded=0;
 const location={origin:base,reload(){reloaded++;}};
 const root={
   document:{querySelector:()=>enabled?{}:null},
   location,
   fetch:fetchImpl,
   Response,
   URL,
 };
 const globals={window:root,globalThis:root,URL,Response,console};
 vm.runInNewContext(source,globals);
 return {session:root.CRCBetaSession,getReloadCount:()=>reloaded};
}

test('beta helper stays completely inert on normal public staging',()=>{
 const r=context({enabled:false});
 assert.equal(r.session,undefined);
});

test('transport only permits approved same-origin read-only API paths',async()=>{
 const calls=[];
 const s=context({fetchImpl:async(path,options)=>{
   calls.push({path,options});
   return new Response('{"schema_version":"1.0"}',{headers:{'Content-Type':'application/json'}});
 }}).session;
 for(const path of [
   'https://evil.example', '//evil.example/api/v1/capabilities',
   '/api/v1/health/ready','/api/v1/players/%23ABC/cards',
   '/api/v1/players/%23ABC/snapshot?limit=999',
   '/api/v1/capabilities?proxy=http://evil.example',
   '/api/v1/capabilities#fragment',
 ]){
   const r=await s.fetch(path);
   assert.equal(r.status,403,path);
 }
 assert.equal(calls.length,0);
 const r=await s.fetch('/api/v1/players/%23ABC123/snapshot?limit=25',{method:'GET'});
 assert.equal(r.status,200);
 assert.equal(calls.length,1);
 assert.equal(calls[0].path,'/api/v1/players/%23ABC123/snapshot?limit=25');
});

test('uses browser-managed same-origin cookies, never puts a JWT into headers',async()=>{
 const calls=[];
 const s=context({fetchImpl:async(path,options)=>{
   calls.push(options);
   return new Response('{"live_lookup_enabled":true}',{headers:{'Content-Type':'application/json'}});
 }}).session;
 await s.fetch('/api/v1/capabilities',{credentials:'omit',headers:{Authorization:'Bearer malicious'}});
 assert.equal(calls.length,1);
 assert.equal(calls[0].credentials,'same-origin');
 assert.equal(calls[0].redirect,'manual');
 assert.equal(calls[0].cache,'no-store');
 assert.equal(calls[0].headers.Authorization,undefined);
 assert.equal(calls[0].headers['Cf-Access-Jwt-Assertion'],undefined);
 assert.equal(calls[0].headers.Accept,'application/json');
});

test('redirects and HTML login are converted into explicit auth-needed errors',async()=>{
 const redirected=context({fetchImpl:async()=>({type:'opaqueredirect',status:0})}).session;
 const r1=await redirected.fetch('/api/v1/capabilities');
 assert.equal(r1.status,401);
 assert.equal((await r1.json()).error.code,'ACCESS_LOGIN_REQUIRED');
 const html=context({fetchImpl:async()=>new Response('<html>Login</html>',{
   status:200,headers:{'Content-Type':'text/html'}
 })}).session;
 const r2=await html.fetch('/api/v1/capabilities');
 assert.equal(r2.status,401);
 assert.equal((await r2.json()).error.code,'ACCESS_LOGIN_REQUIRED');
});

test('network failures are sanitized and do not trigger automatic login redirects',async()=>{
 const {session,getReloadCount}=context({fetchImpl:async()=>{throw Error('private browser diagnostic')}});
 const r=await session.fetch('/api/v1/capabilities');
 assert.equal(r.status,503);
 assert.equal((await r.json()).error.code,'BETA_NETWORK_UNAVAILABLE');
 assert.equal(getReloadCount(),0);
});

test('top-level reauthentication only runs on explicit signInAgain call',()=>{
 const {session,getReloadCount}=context();
 assert.equal(getReloadCount(),0);
 session.signInAgain();
 assert.equal(getReloadCount(),1);
});


test('protected readiness uses same-origin Access session and never calls arbitrary health URLs',async()=>{
 const calls=[];
 const {session}=context({fetchImpl:async(path,options)=>{
   calls.push({path,options});
   return new Response('{"status":"ready_for_authenticated_requests"}',{
     headers:{"Content-Type":"application/json"}
   });
 }});
 const r=await session.fetch('/api/v1/health/ready');
 assert.equal(r.status,200);
 assert.equal(calls.length,1);
 assert.equal(calls[0].path,'/api/v1/health/ready');
 assert.equal(calls[0].options.credentials,'same-origin');
 assert.equal((await session.fetch('/api/v1/health/live')).status,403);
 assert.equal((await session.fetch('/api/v1/health/ready?private=1')).status,403);
 assert.equal(calls.length,1);
});
