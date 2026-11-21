import assert from 'node:assert/strict';
import test from 'node:test';
import {routeRequest,apiRoute,privateHost} from './beta-edge-worker.mjs';

const HOST='beta.crc.example';
const BASE='https://'+HOST;
const ACCESS='signed-access-jwt-test-placeholder';
const HEADER={'Cf-Access-Jwt-Assertion':ACCESS};
const json = (body,status=200,headers={})=>new Response(JSON.stringify(body),{
  status,headers:{'Content-Type':'application/json',...headers}
});
const sandbox = (config={})=>{
 const outbound=[];
 const staticCalls=[];
 const env={
   BETA_ENABLED:'true',
   BETA_HOSTNAME:HOST,
   PRIVATE_API:{async fetch(request){
     outbound.push(request);
     return json({schema_version:'1.0',live_lookup_enabled:true},
       200,{'Set-Cookie':'private-should-not-be-reflected=1','Cache-Control':'public'});
   }},
   ASSETS:{async fetch(request){
     staticCalls.push(request.url);
     if(new URL(request.url).pathname==='/')
       return new Response('<html><head></head><body><script src="/app.js" defer></script></body></html>',
         {headers:{'Content-Type':'text/html'}});
     return new Response('// static fixture', {headers:{'Content-Type':'text/javascript'}});
   }},
   ...config
 };
 return {env,outbound,staticCalls};
};
const req=(path,headers=HEADER,options={})=>new Request(BASE+path,{headers,...options});

test('API allowlist is strict and normalizes literal Player Tags',()=>{
 assert.equal(apiRoute(new URL(BASE+'/api/v1/health/ready')),'/api/v1/health/ready');
 assert.equal(apiRoute(new URL(BASE+'/api/v1/capabilities')),'/api/v1/capabilities');
 assert.equal(apiRoute(new URL(BASE+'/api/v1/catalog/cards')),'/api/v1/catalog/cards');
 assert.equal(apiRoute(new URL(BASE+'/api/v1/players/%23test123/snapshot?limit=2')),
   '/api/v1/players/%23TEST123/snapshot?limit=2');
 for(const path of [
   '/api/v1/players/%23ABC/cards', '/api/v1/players/%23ABC/battles',
   '/api/v1/players/%23ABC/snapshot?limit=0',
   '/api/v1/players/%23ABC/snapshot?limit=26',
   '/api/v1/players/%23ABC/snapshot?limit=2&limit=3',
   '/api/v1/players/%23ABC/snapshot?url=https://evil.example',
   '/api/v1/players/%2523ABC/snapshot',
   '/api/v1/players/%23ABC%2Fadmin/snapshot',
   '/api/v1/capabilities?admin=true',
   '/api/v1/health/live',
   '/api/v1/health/ready?expose=1',
   '/api/v1/../admin'
 ])assert.equal(apiRoute(new URL(BASE+path)),null,path);
 assert.equal(privateHost('http://evil.example'),null);
 assert.equal(privateHost('malicious.workers.dev'),null);
});

test('private route needs opt-in, host and VPC service binding',async()=>{
 const missing=sandbox({BETA_ENABLED:'false'});
 assert.equal((await routeRequest(req('/api/v1/capabilities'),missing.env)).status,503);
 assert.equal(missing.outbound.length,0);
 const wrong=sandbox();
 assert.equal((await routeRequest(new Request('https://evil.example/api/v1/capabilities',{headers:HEADER}),wrong.env)).status,400);
 assert.equal(wrong.outbound.length,0);
 const noBinding=sandbox({PRIVATE_API:null});
 assert.equal((await routeRequest(req('/api/v1/capabilities'),noBinding.env)).status,503);
 assert.equal(noBinding.outbound.length,0);
});

test('missing assertion, incorrect Origin and cross-site requests never call the origin',async()=>{
 const {env,outbound}=sandbox();
 const attempts=[
   req('/api/v1/capabilities',{}),
   req('/api/v1/capabilities',{...HEADER,Origin:'https://evil.example'}),
   req('/api/v1/capabilities',{...HEADER,'Sec-Fetch-Site':'cross-site'}),
 ];
 for(const attempt of attempts){
   const r=await routeRequest(attempt,env);
   assert.ok([401,403].includes(r.status));
 }
 assert.equal(outbound.length,0);
});

test('API router does not proxy unsupported endpoints or verbs',async()=>{
 const {env,outbound}=sandbox();
 assert.equal((await routeRequest(req('/api/v1/players/%23ABC/cards'),env)).status,404);
 assert.equal((await routeRequest(req('/api/v1/capabilities',HEADER,{method:'POST'}),env)).status,405);
 assert.equal((await routeRequest(req('/api/v1/players/%23ABC/snapshot?limit=25&x=evil'),env)).status,404);
 assert.equal(outbound.length,0);
});

test('only a signed assertion header is forwarded to pinned private VPC binding',async()=>{
 const {env,outbound}=sandbox();
 const response=await routeRequest(req('/api/v1/players/%23abc123/snapshot?limit=5',{
   ...HEADER, Cookie:'CF_Authorization=do-not-forward',
   Authorization:'Bearer attacker', 'X-Forwarded-For':'127.0.0.1',
   'Cf-Access-Authenticated-User-Email':'forged@example.com',
   'X-CRC-Internal-Token':'client-controlled',
 }),env);
 assert.equal(response.status,200);
 assert.equal(outbound.length,1);
 const request=outbound[0];
 assert.equal(request.url,'http://'+HOST+'/api/v1/players/%23ABC123/snapshot?limit=5');
 assert.equal(request.method,'GET');
 assert.equal(request.headers.get('Cf-Access-Jwt-Assertion'),ACCESS);
 assert.equal(request.headers.get('Accept'),'application/json');
 for(const key of ['Cookie','Authorization','X-Forwarded-For','Cf-Access-Authenticated-User-Email','X-CRC-Internal-Token'])
   assert.equal(request.headers.get(key),null,key);
 assert.equal(response.headers.get('Set-Cookie'),null);
 assert.equal(response.headers.get('Cache-Control'),'no-store');
 assert.equal(response.headers.get('Content-Type'),'application/json; charset=utf-8');
 assert.equal((await response.json()).live_lookup_enabled,true);
});

test('backend errors retain status, never forward Set-Cookie or redirects',async()=>{
 const {env}=sandbox({PRIVATE_API:{fetch:async()=>json({error:{code:'MEMBER_QUOTA_EXCEEDED'}},429,{
   'Set-Cookie':'bad=secret','Retry-After':'30'
 })}});
 const res=await routeRequest(req('/api/v1/capabilities'),env);
 assert.equal(res.status,429);
 assert.equal(res.headers.get('Retry-After'),'30');
 assert.equal(res.headers.get('Set-Cookie'),null);
 assert.equal((await res.json()).error.code,'MEMBER_QUOTA_EXCEEDED');
});

test('bad upstream JSON, HTML login and failed VPC binding fail closed',async()=>{
 const errors=[
  {fetch:async()=>new Response('<html>login</html>',{headers:{'Content-Type':'text/html'}})},
  {fetch:async()=>new Response('{bad',{headers:{'Content-Type':'application/json'}})},
  {fetch:async()=>{throw Error('private secrets must not be shown')}}
 ];
 for(const binding of errors){
   const {env}=sandbox({PRIVATE_API:binding});
   const res=await routeRequest(req('/api/v1/capabilities'),env);
   assert.ok([502,503].includes(res.status));
   assert.ok(!(await res.text()).includes('private secrets'));
 }
});

test('caps oversized upstream payload and prevents response caching',async()=>{
 const giant='x'.repeat(600*1024);
 const {env}=sandbox({PRIVATE_API:{fetch:async()=>json({payload:giant})}});
 const res=await routeRequest(req('/api/v1/capabilities'),env);
 assert.equal(res.status,502);
 assert.equal(res.headers.get('Cache-Control'),'no-store');
});

test('beta HTML only injects same-origin beta session and never activates a service worker',async()=>{
 const {env,outbound,staticCalls}=sandbox();
 const res=await routeRequest(req('/'),env);
 const html=await res.text();
 assert.match(html,/src="\/beta-session.js"/);
 assert.match(html,/src="\/app.js"/);
 assert.match(html,/content="private-beta"/);
 assert.equal(res.headers.get('content-security-policy').includes("connect-src 'self'"),true);
 assert.equal(res.headers.get('cache-control'),'no-store');
 assert.equal(outbound.length,0);
 assert.equal(staticCalls.length,1);
 const sw=await routeRequest(req('/sw.js'),env);
 assert.equal(sw.status,410);
});

test('unconfigured static asset binding fails closed',async()=>{
 const {env}=sandbox({ASSETS:null});
 const res=await routeRequest(req('/'),env);
 assert.equal(res.status,503);
});

test('even static beta assets require the Access assertion header',async()=>{
 const {env,staticCalls}=sandbox();
 const response=await routeRequest(req('/',{}),env);
 assert.equal(response.status,401);
 assert.equal(staticCalls.length,0);
});

test('backend redirects cannot become browser navigation, even with JSON',async()=>{
 const {env}=sandbox({PRIVATE_API:{fetch:async()=>json({message:'redirect'},302,{Location:'https://evil.example'})}});
 const res=await routeRequest(req('/api/v1/capabilities'),env);
 assert.equal(res.status,502);
 assert.equal(res.headers.get('Location'),null);
 assert.equal((await res.json()).error.code,'PRIVATE_ORIGIN_REDIRECT_DENIED');
});

test('private operational readiness is identity-gated and forwarded only to fixed VPC binding',async()=>{
 const {env,outbound}=sandbox();
 const denied=await routeRequest(req('/api/v1/health/ready',{}),env);
 assert.equal(denied.status,401);
 assert.equal(outbound.length,0);
 const ready=await routeRequest(req('/api/v1/health/ready'),env);
 assert.equal(ready.status,200);
 assert.equal(outbound.length,1);
 assert.equal(new URL(outbound[0].url).pathname,'/api/v1/health/ready');
 assert.equal(outbound[0].headers.get('Cf-Access-Jwt-Assertion'),ACCESS);
 assert.equal(ready.headers.get('Cache-Control'),'no-store');
});
test('disabled Worker blocks authenticated readiness and all traffic before origin',async()=>{
 const {env,outbound,staticCalls}=sandbox({BETA_ENABLED:'false'});
 for(const path of ['/api/v1/health/ready','/api/v1/capabilities','/']){
   const res=await routeRequest(req(path),env);
   assert.equal(res.status,503,path);
 }
 assert.equal(outbound.length,0);
 assert.equal(staticCalls.length,0);
});


test('distinct Access-protected workers.dev beta hostname is explicit opt-in',async()=>{
 const host='crc-private-beta.alirezaanari117.workers.dev';
 assert.equal(privateHost(host),null);
 assert.equal(privateHost(host,true),host);
 assert.equal(privateHost('my.workers.dev',true),null);
 assert.equal(privateHost('crc-mvp-stage-20261120.alirezaanari117.workers.dev',true),null);
 const request=new Request('https://'+host+'/api/v1/capabilities',{headers:HEADER});
 const blocked=sandbox({BETA_HOSTNAME:host});
 assert.equal((await routeRequest(request,blocked.env)).status,503);
 assert.equal(blocked.outbound.length,0);
 const enabled=sandbox({BETA_HOSTNAME:host,BETA_ALLOW_WORKERS_DEV:'true'});
 const response=await routeRequest(request,enabled.env);
 assert.equal(response.status,200);
 assert.equal(enabled.outbound.length,1);
 assert.equal(enabled.outbound[0].headers.get('Cf-Access-Jwt-Assertion'),ACCESS);
 assert.equal(enabled.outbound[0].url,'http://'+host+'/api/v1/capabilities');
});

test('public sample workers.dev hostname can never be reused as beta',async()=>{
 const host='crc-mvp-stage-20261120.alirezaanari117.workers.dev';
 const env=sandbox({BETA_HOSTNAME:host,BETA_ALLOW_WORKERS_DEV:'true'});
 const response=await routeRequest(
   new Request('https://'+host+'/api/v1/capabilities',{headers:HEADER}),env.env);
 assert.equal(response.status,503);
 assert.equal(env.outbound.length,0);
});

test('coach POST is disabled by default then gated by origin, consent and body limit',async()=>{
 const body=JSON.stringify({question:'test',consent_to_external_ai:true});
 const headers={...HEADER,Origin:BASE,'Content-Type':'application/json',Authorization:'never-forward'};
 const post=(data=body,h=headers)=>req('/api/v1/coach/chat',h,{method:'POST',body:data});
 const off=sandbox();
 assert.equal((await routeRequest(post(),off.env)).status,503);
 const {env,outbound}=sandbox({BETA_AI_CHAT_ENABLED:'true'});
 assert.equal((await routeRequest(post(body,{...headers,Origin:'https://evil.example'}),env)).status,403);
 assert.equal((await routeRequest(post('{}'),env)).status,403);
 assert.equal((await routeRequest(post('x'.repeat(5000)),env)).status,422);
 assert.equal(outbound.length,0);
 assert.equal((await routeRequest(post(),env)).status,200);
 assert.equal(outbound[0].method,'POST');
 assert.equal(outbound[0].headers.get('Authorization'),null);
 assert.equal(await outbound[0].text(),body);
 assert.equal(privateHost('crc-coach-ci-stage-20261121.alirezaanari117.workers.dev',true),null);
});
