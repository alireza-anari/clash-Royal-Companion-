import assert from 'node:assert/strict';
import {createHash,createHmac} from 'node:crypto';
import test from 'node:test';
import {routeRequest,apiRoute,privateHost} from './beta-edge-worker.mjs';

const HOST='beta.crc.example';
const BASE='https://'+HOST;
const SESSION_KEY='11'.repeat(32);
const ASSERTION_KEY='22'.repeat(32);
const AUDIENCE='crc-private-beta-api';
const INVITE_CODE='crc-private-beta-invite-code-12345678901234567890';
const SUBJECT='tester-opaque-id';
const INVITE_HASH=createHash('sha256').update(INVITE_CODE).digest('hex');
const json=(body,status=200,headers={})=>new Response(JSON.stringify(body),{
  status,headers:{'Content-Type':'application/json',...headers}
});
function signJwt(secretHex,claims){
 const b64=value=>Buffer.from(value).toString('base64url');
 const input=b64(JSON.stringify({alg:'HS256',typ:'JWT'}))+'.'+b64(JSON.stringify(claims));
 return input+'.'+createHmac('sha256',Buffer.from(secretHex,'hex')).update(input).digest('base64url');
}
const now=Math.floor(Date.now()/1000);
const SESSION=signJwt(SESSION_KEY,{
 iss:BASE,aud:'crc-beta-session',sub:SUBJECT,iat:now,exp:now+8*60*60,
 jti:'test-session-token-identifier'
});
const SESSION_HEADER={Cookie:'__Host-crc_beta_session='+SESSION};
const sandbox=(config={})=>{
 const outbound=[],staticCalls=[];
 const env={
  BETA_ENABLED:'true',BETA_HOSTNAME:HOST,BETA_AUTH_ISSUER:BASE,
  BETA_AUTH_AUDIENCE:AUDIENCE,BETA_SESSION_HMAC_HEX:SESSION_KEY,
  BETA_ASSERTION_HMAC_HEX:ASSERTION_KEY,
  BETA_INVITE_CODES_JSON:JSON.stringify({[INVITE_HASH]:SUBJECT}),
  PRIVATE_API:{async fetch(request){
   outbound.push(request);
   return json({schema_version:'1.0',live_lookup_enabled:true},200,
    {'Set-Cookie':'private-should-not-be-reflected=1','Cache-Control':'public'});
  }},
  ASSETS:{async fetch(request){
   const path=new URL(request.url).pathname;staticCalls.push(path);
   if(path==='/beta-login.html')return new Response('<!doctype html><html>login</html>',{headers:{'Content-Type':'text/html'}});
   if(path==='/')return new Response('<html><head></head><body><script src="/app.js" defer></script></body></html>',
    {headers:{'Content-Type':'text/html'}});
   return new Response('// static fixture',{headers:{'Content-Type':'text/javascript'}});
  }},
  ...config
 };
 return {env,outbound,staticCalls};
};
const req=(path,headers=SESSION_HEADER,options={})=>new Request(BASE+path,{headers,...options});
const loginRequest=(code=INVITE_CODE,headers={Origin:BASE,'Content-Type':'application/json'})=>
 req('/api/v1/auth/login',headers,{method:'POST',body:JSON.stringify({invite_code:code})});

test('API allowlist is strict and normalizes literal Player Tags',()=>{
 assert.equal(apiRoute(new URL(BASE+'/api/v1/health/ready')),'/api/v1/health/ready');
 assert.equal(apiRoute(new URL(BASE+'/api/v1/capabilities')),'/api/v1/capabilities');
 assert.equal(apiRoute(new URL(BASE+'/api/v1/catalog/cards')),'/api/v1/catalog/cards');
 assert.equal(apiRoute(new URL(BASE+'/api/v1/players/%23test123/snapshot?limit=2')),
  '/api/v1/players/%23TEST123/snapshot?limit=2');
 for(const path of [
  '/api/v1/players/%23ABC/cards','/api/v1/players/%23ABC/battles',
  '/api/v1/players/%23ABC/snapshot?limit=0','/api/v1/players/%23ABC/snapshot?limit=26',
  '/api/v1/players/%23ABC/snapshot?limit=2&limit=3',
  '/api/v1/players/%23ABC/snapshot?url=https://evil.example',
  '/api/v1/players/%2523ABC/snapshot','/api/v1/players/%23ABC%2Fadmin/snapshot',
  '/api/v1/capabilities?admin=true','/api/v1/health/live',
  '/api/v1/health/ready?expose=1','/api/v1/../admin'
 ])assert.equal(apiRoute(new URL(BASE+path)),null,path);
 assert.equal(privateHost('http://evil.example'),null);
 assert.equal(privateHost('malicious.workers.dev'),null);
});

test('private route needs opt-in, exact host, auth secrets and VPC service binding',async()=>{
 const missing=sandbox({BETA_ENABLED:'false'});
 assert.equal((await routeRequest(req('/api/v1/capabilities'),missing.env)).status,503);
 assert.equal(missing.outbound.length,0);
 const wrong=sandbox();
 assert.equal((await routeRequest(new Request('https://evil.example/api/v1/capabilities',{headers:SESSION_HEADER}),wrong.env)).status,400);
 assert.equal(wrong.outbound.length,0);
 const noBinding=sandbox({PRIVATE_API:null});
 assert.equal((await routeRequest(req('/api/v1/capabilities'),noBinding.env)).status,503);
 assert.equal(noBinding.outbound.length,0);
 const noSecrets=sandbox({BETA_ASSERTION_HMAC_HEX:''});
 assert.equal((await routeRequest(req('/api/v1/capabilities'),noSecrets.env)).status,503);
 assert.equal((await routeRequest(req('/api/v1/capabilities'),noSecrets.env)).status,503);
});

test('unauthenticated API gets JSON 401 and static pages redirect to the login screen',async()=>{
 const {env,outbound,staticCalls}=sandbox();
 const api=await routeRequest(req('/api/v1/capabilities',{}),env);
 assert.equal(api.status,401);
 assert.equal((await api.json()).error.code,'INVITE_SESSION_REQUIRED');
 assert.equal(outbound.length,0);
 const page=await routeRequest(req('/',{}),env);
 assert.equal(page.status,303);
 assert.equal(page.headers.get('Location'),BASE+'/login');
 assert.equal(staticCalls.length,0);
 const login=await routeRequest(req('/login',{}),env);
 assert.equal(login.status,200);
 assert.match(await login.text(),/login/);
 assert.equal(login.headers.get('content-security-policy').includes("script-src 'self'"),true);
 const js=await routeRequest(req('/beta-login.js',{}),env);
 assert.equal(js.status,200);
 assert.equal(staticCalls.length,2);
});

test('invite login accepts only same-origin valid codes and issues host-only HttpOnly cookie',async()=>{
 const {env,outbound}=sandbox();
 const wrong=await routeRequest(loginRequest('wrong-invite-code-xxxxxxxxxxxxxxxxxxxx'),env);
 assert.equal(wrong.status,401);
 assert.equal((await wrong.json()).error.code,'INVITE_CODE_INVALID');
 const cross=await routeRequest(loginRequest(INVITE_CODE,{Origin:'https://evil.example','Content-Type':'application/json'}),env);
 assert.equal(cross.status,403);
 const success=await routeRequest(loginRequest(),env);
 assert.equal(success.status,200);
 assert.deepEqual(await success.json(),{authenticated:true});
 const cookie=success.headers.get('Set-Cookie');
 assert.match(cookie,/^__Host-crc_beta_session=/);
 assert.match(cookie,/HttpOnly/);
 assert.match(cookie,/Secure/);
 assert.match(cookie,/SameSite=Strict/);
 assert.match(cookie,/Path=\//);
 assert.doesNotMatch(cookie,/Domain=/);
 assert.equal(outbound.length,0);
});

test('valid invite session mints a short-lived backend assertion and never forwards browser credentials',async()=>{
 const {env,outbound}=sandbox();
 const response=await routeRequest(req('/api/v1/players/%23abc123/snapshot?limit=5',{
  ...SESSION_HEADER,Authorization:'Bearer attacker','X-Forwarded-For':'127.0.0.1',
  'Cf-Access-Jwt-Assertion':'forged-access-token','X-CRC-Worker-Assertion':'forged-worker-token'
 }),env);
 assert.equal(response.status,200);
 assert.equal(outbound.length,1);
 const forwarded=outbound[0];
 assert.equal(forwarded.url,'http://'+HOST+'/api/v1/players/%23ABC123/snapshot?limit=5');
 assert.equal(forwarded.method,'GET');
 assert.ok(forwarded.headers.get('X-CRC-Worker-Assertion'));
 for(const key of ['Cookie','Authorization','X-Forwarded-For','Cf-Access-Jwt-Assertion'])
  assert.equal(forwarded.headers.get(key),null,key);
 const assertion=forwarded.headers.get('X-CRC-Worker-Assertion');
 const [header,payload,signature]=assertion.split('.');
 assert.deepEqual(JSON.parse(Buffer.from(header,'base64url').toString()),{alg:'HS256',typ:'JWT'});
 const claims=JSON.parse(Buffer.from(payload,'base64url').toString());
 assert.equal(claims.iss,BASE);
 assert.equal(claims.aud,AUDIENCE);
 assert.equal(claims.sub,SUBJECT);
 assert.ok(claims.exp-claims.iat<=60);
 const expected=createHmac('sha256',Buffer.from(ASSERTION_KEY,'hex')).update(header+'.'+payload).digest('base64url');
 assert.equal(signature,expected);
 assert.equal(response.headers.get('Set-Cookie'),null);
 assert.equal(response.headers.get('Cache-Control'),'no-store');
 assert.equal(response.headers.get('Content-Type'),'application/json; charset=utf-8');
 assert.equal((await response.json()).live_lookup_enabled,true);
});

test('tampered or expired session cookies never reach private origin',async()=>{
 const {env,outbound}=sandbox();
 const bad=await routeRequest(req('/api/v1/capabilities',{Cookie:'__Host-crc_beta_session='+SESSION.slice(0,-2)+'xx'}),env);
 assert.equal(bad.status,401);
 const expired=signJwt(SESSION_KEY,{
  iss:BASE,aud:'crc-beta-session',sub:SUBJECT,iat:now-7200,exp:now-3600,
  jti:'expired-session-token-id'
 });
 const old=await routeRequest(req('/api/v1/capabilities',{Cookie:'__Host-crc_beta_session='+expired}),env);
 assert.equal(old.status,401);
 assert.equal(outbound.length,0);
});

test('logout revokes browser session cookie',async()=>{
 const {env}=sandbox();
 const response=await routeRequest(req('/api/v1/auth/logout',{
  ...SESSION_HEADER,Origin:BASE
 },{method:'POST'}),env);
 assert.equal(response.status,200);
 assert.match(response.headers.get('Set-Cookie'),/Max-Age=0/);
 assert.match(response.headers.get('Set-Cookie'),/HttpOnly/);
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
  {fetch:async()=>{throw Error('private secrets must not be shown');}}
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

test('authenticated beta HTML injects session adapter and never activates a service worker',async()=>{
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

test('backend redirects cannot become browser navigation, even with JSON',async()=>{
 const {env}=sandbox({PRIVATE_API:{fetch:async()=>json({message:'redirect'},302,{Location:'https://evil.example'})}});
 const res=await routeRequest(req('/api/v1/capabilities'),env);
 assert.equal(res.status,502);
 assert.equal(res.headers.get('Location'),null);
 assert.equal((await res.json()).error.code,'PRIVATE_ORIGIN_REDIRECT_DENIED');
});

test('private readiness is invite-gated and forwarded only as a signed assertion',async()=>{
 const {env,outbound}=sandbox();
 const denied=await routeRequest(req('/api/v1/health/ready',{}),env);
 assert.equal(denied.status,401);
 assert.equal(outbound.length,0);
 const ready=await routeRequest(req('/api/v1/health/ready'),env);
 assert.equal(ready.status,200);
 assert.equal(outbound.length,1);
 assert.equal(new URL(outbound[0].url).pathname,'/api/v1/health/ready');
 assert.ok(outbound[0].headers.get('X-CRC-Worker-Assertion'));
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

test('distinct workers.dev beta hostname is explicit opt-in and public staging is forbidden',async()=>{
 const host='crc-private-beta.alirezaanari117.workers.dev';
 assert.equal(privateHost(host),null);
 assert.equal(privateHost(host,true),host);
 assert.equal(privateHost('my.workers.dev',true),null);
 assert.equal(privateHost('crc-mvp-stage-20261120.alirezaanari117.workers.dev',true),null);
 const config=sandbox({BETA_HOSTNAME:host,BETA_AUTH_ISSUER:'https://'+host,BETA_ALLOW_WORKERS_DEV:'true'});
 const hostSession=signJwt(SESSION_KEY,{
  iss:'https://'+host,aud:'crc-beta-session',sub:SUBJECT,iat:now,exp:now+8*60*60,
  jti:'host-session-token-identifier'
 });
 const request=new Request('https://'+host+'/api/v1/capabilities',{
  headers:{Cookie:'__Host-crc_beta_session='+hostSession}
 });
 const response=await routeRequest(request,config.env);
 assert.equal(response.status,200);
 assert.equal(config.outbound.length,1);
 assert.equal(config.outbound[0].headers.get('X-CRC-Worker-Assertion')!==null,true);
});

test('public sample workers.dev hostname can never be reused as beta',async()=>{
 const host='crc-mvp-stage-20261120.alirezaanari117.workers.dev';
 const env=sandbox({BETA_HOSTNAME:host,BETA_AUTH_ISSUER:'https://'+host,BETA_ALLOW_WORKERS_DEV:'true'});
 const response=await routeRequest(new Request('https://'+host+'/api/v1/capabilities',{headers:SESSION_HEADER}),env.env);
 assert.equal(response.status,503);
 assert.equal(env.outbound.length,0);
});

test('coach POST remains consent-bound and private by default',async()=>{
 const body=JSON.stringify({question:'test',consent_to_external_ai:true});
 const headers={...SESSION_HEADER,Origin:BASE,'Content-Type':'application/json',Authorization:'never-forward'};
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
 assert.equal(outbound[0].headers.get('Cookie'),null);
 assert.equal(outbound[0].headers.get('X-CRC-Worker-Assertion')!==null,true);
 assert.equal(await outbound[0].text(),body);
 assert.equal(privateHost('crc-coach-ci-stage-20261121.alirezaanari117.workers.dev',true),null);
});
