import assert from 'node:assert/strict';
import {createHash,createHmac} from 'node:crypto';
import test from 'node:test';
import {routeRequest,apiRoute,privateHost} from './beta-edge-worker.mjs';

const HOST='crc-private-beta-gateway.alirezaanari117.workers.dev';
const BASE='https://'+HOST;
const LEGACY_HOST='crc-mvp-live-test-20261123.alirezaanari117.workers.dev';
const SESSION_KEY='11'.repeat(32);
const ASSERTION_KEY='22'.repeat(32);
const AUDIENCE='crc-private-beta-api';
const SUBJECT='tester-opaque-id';
const DEFAULT_CODE='default-private-beta-subject';
const DEFAULT_HASH=createHash('sha256').update(DEFAULT_CODE).digest('hex');
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
const ACCOUNT_SUBJECT='acct_'+'a'.repeat(32);
const ACCOUNT_SESSION=signJwt(SESSION_KEY,{
  iss:BASE,aud:'crc-beta-session',sub:ACCOUNT_SUBJECT,iat:now,exp:now+8*60*60,
  jti:'account-session-token-identifier'
});
const ACCOUNT_SESSION_HEADER={Cookie:'__Host-crc_beta_session='+ACCOUNT_SESSION};
const snapshot={
  profile:{tag:'#ABC123',display_name:'Test Player',trophies:7000,king_tower_level:14,arena:null},
  current_deck:{card_ids:[1,2,3,4,5,6,7,8],support_card_ids:[]},
  cards:[],support_items:[],battles:[],partial:false,
  source:{provider:'supercell',fetched_at:'2026-11-24T00:00:00.000Z',stale:false}
};
const sandbox=(config={})=>{
  const privateCalls=[],legacyCalls=[],staticCalls=[];
  const env={
    BETA_ENABLED:'true',BETA_HOSTNAME:HOST,BETA_AUTH_ISSUER:BASE,
    BETA_AUTH_AUDIENCE:AUDIENCE,BETA_ALLOW_WORKERS_DEV:'true',
    BETA_SESSION_HMAC_HEX:SESSION_KEY,BETA_ASSERTION_HMAC_HEX:ASSERTION_KEY,
    BETA_INVITE_CODES_JSON:JSON.stringify({[DEFAULT_HASH]:SUBJECT}),
    BETA_AI_CHAT_ENABLED:'true',
    PRIVATE_API:{async fetch(request){
      privateCalls.push(request);
      return json({status:'ok',schema_version:'1.0'});
    }},
    LEGACY_LIVE:{async fetch(request){
      legacyCalls.push(request);
      const path=new URL(request.url).pathname;
      if(path==='/api/v1/capabilities')return json({
        schema_version:'1.0',live_lookup_enabled:true,
        provider:'supercell-via-royaleapi-proxy',ai_coach_enabled:true,
        ai_external_data_requires_consent:true
      });
      if(path.startsWith('/api/v1/players/'))return json(snapshot);
      if(path==='/api/v1/coach/chat')return json({
        answer:'پاسخ آزمایشی مربی',model:'@cf/google/gemma-4-26b-a4b-it',
        external_inference:true,replay_analyzed:false,
        evidence_status:'client_submitted_unverified'
      });
      return json({error:{code:'NOT_FOUND'}},404);
    }},
    ASSETS:{async fetch(request){
      const path=new URL(request.url).pathname;staticCalls.push(path);
      if(path==='/')return new Response('<html><head><link rel="manifest" href="/manifest.webmanifest"></head><body><script src="/app.js" defer></script></body></html>',{
        headers:{'Content-Type':'text/html'}
      });
      return new Response('// static fixture',{headers:{'Content-Type':'text/javascript'}});
    }},
    ...config
  };
  return {env,privateCalls,legacyCalls,staticCalls};
};
const req=(path,headers=SESSION_HEADER,options={})=>new Request(BASE+path,{headers,...options});

test('API allowlist is strict and normalizes Player Tags',()=>{
  assert.equal(apiRoute(new URL(BASE+'/api/v1/health/ready')),'/api/v1/health/ready');
  assert.equal(apiRoute(new URL(BASE+'/api/v1/capabilities')),'/api/v1/capabilities');
  assert.equal(apiRoute(new URL(BASE+'/api/v1/catalog/cards')),'/api/v1/catalog/cards');
  assert.equal(apiRoute(new URL(BASE+'/api/v1/vision/capabilities')),'/api/v1/vision/capabilities');
  const job='/api/v1/vision/jobs/123e4567-e89b-42d3-a456-426614174000';
  assert.equal(apiRoute(new URL(BASE+job),'GET'),job);
  assert.equal(apiRoute(new URL(BASE+job),'DELETE'),job);
  assert.equal(apiRoute(new URL(BASE+'/api/v1/vision/jobs?x=1'),'POST'),null);
  assert.equal(apiRoute(new URL(BASE+'/api/v1/players/%23abc123/snapshot?limit=5')),
    '/api/v1/players/%23ABC123/snapshot?limit=5');
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

test('root issues the automatic HttpOnly session for the configured single beta subject',async()=>{
  const {env,privateCalls,legacyCalls,staticCalls}=sandbox();
  const response=await routeRequest(req('/',{}),env);
  assert.equal(response.status,200);
  const cookie=response.headers.get('Set-Cookie')||'';
  assert.match(cookie,/^__Host-crc_beta_session=/);
  assert.match(cookie,/HttpOnly/);
  assert.match(cookie,/Secure/);
  assert.match(cookie,/SameSite=Strict/);
  assert.match(cookie,/Path=\//);
  assert.match(cookie,/Max-Age=28800/);
  const html=await response.text();
  assert.match(html,/src="\/beta-session.js"/);
  assert.match(html,/content="private-beta"/);
  assert.equal(privateCalls.length,0);
  assert.equal(legacyCalls.length,0);
  assert.deepEqual(staticCalls,['/']);
});

test('unauthenticated API is rejected while an authenticated browser session can call APIs',async()=>{
  const {env,privateCalls,legacyCalls}=sandbox();
  const denied=await routeRequest(req('/api/v1/capabilities',{}),env);
  assert.equal(denied.status,401);
  assert.equal((await denied.json()).error.code,'SESSION_REQUIRED');
  assert.equal(privateCalls.length,0);
  assert.equal(legacyCalls.length,0);
});

test('capabilities and live player snapshots route to the isolated legacy Worker',async()=>{
  const {env,privateCalls,legacyCalls}=sandbox();
  const cap=await routeRequest(req('/api/v1/capabilities'),env);
  assert.equal(cap.status,200);
  assert.equal((await cap.json()).live_lookup_enabled,true);
  assert.equal(legacyCalls.length,1);
  assert.equal(new URL(legacyCalls[0].url).origin,'https://'+LEGACY_HOST);
  assert.equal(new URL(legacyCalls[0].url).pathname,'/api/v1/capabilities');
  assert.equal(legacyCalls[0].headers.get('Cookie'),null);
  assert.equal(legacyCalls[0].headers.get('Authorization'),null);
  assert.equal(legacyCalls[0].headers.get('X-CRC-Worker-Assertion'),null);
  assert.equal(privateCalls.length,0);

  const player=await routeRequest(req('/api/v1/players/%23abc123/snapshot?limit=5'),env);
  assert.equal(player.status,200);
  const body=await player.json();
  assert.equal(body.profile.tag,'#ABC123');
  assert.equal(new URL(legacyCalls[1].url).pathname,'/api/v1/players/%23ABC123/snapshot');
  assert.equal(new URL(legacyCalls[1].url).search,'?limit=5');
  assert.equal(privateCalls.length,0);
});

test('health and catalog routes continue to use the private VPC backend',async()=>{
  const {env,privateCalls,legacyCalls}=sandbox();
  const ready=await routeRequest(req('/api/v1/health/ready'),env);
  assert.equal(ready.status,200);
  assert.equal(new URL(privateCalls[0].url).protocol,'http:');
  assert.equal(new URL(privateCalls[0].url).pathname,'/api/v1/health/ready');
  assert.ok(privateCalls[0].headers.get('X-CRC-Worker-Assertion'));
  assert.equal(privateCalls[0].headers.get('Cookie'),null);
  const catalog=await routeRequest(req('/api/v1/catalog/cards'),env);
  assert.equal(catalog.status,200);
  assert.equal(new URL(privateCalls[1].url).pathname,'/api/v1/catalog/cards');
  assert.equal(legacyCalls.length,0);
});

test('private backend assertion is short-lived, signed and excludes browser credentials',async()=>{
  const {env,privateCalls}=sandbox();
  await routeRequest(req('/api/v1/health/ready',{
    ...SESSION_HEADER,Authorization:'Bearer attacker','X-Forwarded-For':'127.0.0.1',
    'Cf-Access-Jwt-Assertion':'forged-access-token','X-CRC-Worker-Assertion':'forged-worker-token'
  }),env);
  const assertion=privateCalls[0].headers.get('X-CRC-Worker-Assertion');
  assert.ok(assertion);
  const [header,payload,signature]=assertion.split('.');
  assert.deepEqual(JSON.parse(Buffer.from(header,'base64url').toString()),{alg:'HS256',typ:'JWT'});
  const claims=JSON.parse(Buffer.from(payload,'base64url').toString());
  assert.equal(claims.iss,BASE);
  assert.equal(claims.aud,AUDIENCE);
  assert.equal(claims.sub,SUBJECT);
  assert.ok(claims.exp-claims.iat<=60);
  const expected=createHmac('sha256',Buffer.from(ASSERTION_KEY,'hex')).update(header+'.'+payload).digest('base64url');
  assert.equal(signature,expected);
  for(const key of ['Cookie','Authorization','X-Forwarded-For','Cf-Access-Jwt-Assertion'])
    assert.equal(privateCalls[0].headers.get(key),null,key);
});

test('Workers AI chat requires same-origin consent and routes only to legacy Worker',async()=>{
  const body=JSON.stringify({question:'تحلیل کوتاه دک',consent_to_external_ai:true});
  const headers={...SESSION_HEADER,Origin:BASE,'Content-Type':'application/json',Authorization:'never-forward'};
  const post=(data=body,h=headers)=>req('/api/v1/coach/chat',h,{method:'POST',body:data});
  const {env,legacyCalls,privateCalls}=sandbox();
  const cross=await routeRequest(post(body,{...headers,Origin:'https://evil.example'}),env);
  assert.equal(cross.status,403);
  const noConsent=await routeRequest(post(JSON.stringify({question:'test'})),env);
  assert.equal(noConsent.status,403);
  assert.equal(legacyCalls.length,0);
  assert.equal(privateCalls.length,0);
  const response=await routeRequest(post(),env);
  assert.equal(response.status,200);
  const result=await response.json();
  assert.equal(result.model,'@cf/google/gemma-4-26b-a4b-it');
  assert.equal(new URL(legacyCalls[0].url).origin,'https://'+LEGACY_HOST);
  assert.equal(legacyCalls[0].headers.get('Origin'),'https://'+LEGACY_HOST);
  assert.equal(legacyCalls[0].headers.get('Content-Type'),'application/json');
  assert.equal(legacyCalls[0].headers.get('Cookie'),null);
  assert.equal(legacyCalls[0].headers.get('Authorization'),null);
  assert.equal(privateCalls.length,0);
  const off=sandbox({BETA_AI_CHAT_ENABLED:'false'});
  assert.equal((await routeRequest(post(),off.env)).status,503);
});

test('legacy binding is required for live and AI routes, but private routes remain independent',async()=>{
  const noLegacy=sandbox({LEGACY_LIVE:null});
  assert.equal((await routeRequest(req('/api/v1/capabilities'),noLegacy.env)).status,503);
  assert.equal((await routeRequest(req('/api/v1/coach/chat',{
    ...SESSION_HEADER,Origin:BASE,'Content-Type':'application/json'
  },{method:'POST',body:JSON.stringify({question:'test',consent_to_external_ai:true})}),noLegacy.env)).status,503);
  assert.equal(noLegacy.privateCalls.length,0);
  const noPrivate=sandbox({PRIVATE_API:null});
  assert.equal((await routeRequest(req('/api/v1/health/ready'),noPrivate.env)).status,503);
  assert.equal((await routeRequest(req('/api/v1/capabilities'),noPrivate.env)).status,200);
});

test('upstream errors preserve status but never reflect cookies, redirects or private headers',async()=>{
  const rate=sandbox({LEGACY_LIVE:{fetch:async()=>json({error:{code:'UPSTREAM_RATE_LIMITED'}},429,{
    'Set-Cookie':'bad=secret','Retry-After':'30'
  })}});
  const res=await routeRequest(req('/api/v1/capabilities'),rate.env);
  assert.equal(res.status,429);
  assert.equal(res.headers.get('Retry-After'),'30');
  assert.equal(res.headers.get('Set-Cookie'),null);
  assert.equal((await res.json()).error.code,'UPSTREAM_RATE_LIMITED');

  const redirect=sandbox({LEGACY_LIVE:{fetch:async()=>json({message:'redirect'},302,{
    Location:'https://evil.example'
  })}});
  const denied=await routeRequest(req('/api/v1/capabilities'),redirect.env);
  assert.equal(denied.status,502);
  assert.equal(denied.headers.get('Location'),null);
  assert.equal((await denied.json()).error.code,'PRIVATE_ORIGIN_REDIRECT_DENIED');
});

test('oversized or invalid upstream JSON fails closed and response caching is disabled',async()=>{
  const giant='x'.repeat(600*1024);
  const oversized=sandbox({LEGACY_LIVE:{fetch:async()=>json({payload:giant})}});
  const res=await routeRequest(req('/api/v1/capabilities'),oversized.env);
  assert.equal(res.status,502);
  assert.equal(res.headers.get('Cache-Control'),'no-store');
  const invalid=sandbox({PRIVATE_API:{fetch:async()=>new Response('<html>login</html>',{
    headers:{'Content-Type':'text/html'}
  })}});
  const bad=await routeRequest(req('/api/v1/health/ready'),invalid.env);
  assert.equal(bad.status,502);
});

test('tampered or expired session cookies never reach either origin',async()=>{
  const {env,privateCalls,legacyCalls}=sandbox();
  const bad=await routeRequest(req('/api/v1/capabilities',{
    Cookie:'__Host-crc_beta_session='+SESSION.slice(0,-2)+'xx'
  }),env);
  assert.equal(bad.status,401);
  const expired=signJwt(SESSION_KEY,{
    iss:BASE,aud:'crc-beta-session',sub:SUBJECT,iat:now-7200,exp:now-3600,
    jti:'expired-session-token-id'
  });
  const old=await routeRequest(req('/api/v1/capabilities',{
    Cookie:'__Host-crc_beta_session='+expired
  }),env);
  assert.equal(old.status,401);
  assert.equal(privateCalls.length,0);
  assert.equal(legacyCalls.length,0);
});

test('logout revokes the browser session cookie',async()=>{
  const {env}=sandbox();
  const response=await routeRequest(req('/api/v1/auth/logout',{
    ...SESSION_HEADER,Origin:BASE
  },{method:'POST'}),env);
  assert.equal(response.status,200);
  assert.match(response.headers.get('Set-Cookie'),/Max-Age=0/);
  assert.match(response.headers.get('Set-Cookie'),/HttpOnly/);
});

test('disabled Worker blocks all traffic before either origin',async()=>{
  const {env,privateCalls,legacyCalls,staticCalls}=sandbox({BETA_ENABLED:'false'});
  for(const path of ['/api/v1/health/ready','/api/v1/capabilities','/'])
    assert.equal((await routeRequest(req(path),env)).status,503,path);
  assert.equal(privateCalls.length,0);
  assert.equal(legacyCalls.length,0);
  assert.equal(staticCalls.length,0);
});

test('unconfigured static assets fail closed and service worker stays disabled',async()=>{
  const {env}=sandbox({ASSETS:null});
  assert.equal((await routeRequest(req('/'),env)).status,503);
  const normal=sandbox();
  assert.equal((await routeRequest(req('/sw.js'),normal.env)).status,410);
});


test('vision capability is fail-closed for the current shared beta subject',async()=>{
  const {env,privateCalls}=sandbox({BETA_VISION_ENABLED:'true'});
  const response=await routeRequest(req('/api/v1/vision/capabilities'),env);
  assert.equal(response.status,200);
  const data=await response.json();
  assert.equal(data.enabled,false);
  assert.equal(data.upload_enabled,false);
  assert.equal(data.reason,'ACCOUNT_IDENTITY_REQUIRED');
  assert.equal(privateCalls.length,0);
});

test('vision upload requires explicit feature, unique account identity and both consents',async()=>{
  const body=JSON.stringify({client_request_id:'123e4567-e89b-42d3-a456-426614174000',
    consent_to_upload:true,consent_to_external_ai:true,frames:[]});
  const disabled=sandbox({BETA_VISION_ENABLED:'false'});
  const noFeature=await routeRequest(req('/api/v1/vision/jobs',{
    ...SESSION_HEADER,Origin:BASE,'Content-Type':'application/json'
  },{method:'POST',body}),disabled.env);
  assert.equal(noFeature.status,503);
  assert.equal((await noFeature.json()).error.code,'VISION_ANALYSIS_DISABLED');
  assert.equal(disabled.privateCalls.length,0);

  const shared=sandbox({BETA_VISION_ENABLED:'true'});
  const sharedDenied=await routeRequest(req('/api/v1/vision/jobs',{
    ...SESSION_HEADER,Origin:BASE,'Content-Type':'application/json'
  },{method:'POST',body}),shared.env);
  assert.equal(sharedDenied.status,403);
  assert.equal((await sharedDenied.json()).error.code,'VISION_ACCOUNT_IDENTITY_REQUIRED');
  assert.equal(shared.privateCalls.length,0);

  const account=sandbox({BETA_VISION_ENABLED:'true'});
  const consentDenied=await routeRequest(req('/api/v1/vision/jobs',{
    ...ACCOUNT_SESSION_HEADER,Origin:BASE,'Content-Type':'application/json'
  },{method:'POST',body:JSON.stringify({consent_to_upload:true,consent_to_external_ai:false})}),account.env);
  assert.equal(consentDenied.status,403);
  assert.equal((await consentDenied.json()).error.code,'VISION_CONSENT_REQUIRED');
  assert.equal(account.privateCalls.length,0);

  const response=await routeRequest(req('/api/v1/vision/jobs',{
    ...ACCOUNT_SESSION_HEADER,Origin:BASE,'Content-Type':'application/json'
  },{method:'POST',body}),account.env);
  assert.equal(response.status,200);
  assert.equal(account.privateCalls.length,1);
  const forwarded=account.privateCalls[0];
  assert.equal(new URL(forwarded.url).pathname,'/api/v1/vision/jobs');
  assert.equal(forwarded.headers.get('Cookie'),null);
  assert.equal(forwarded.headers.get('Authorization'),null);
  const claims=JSON.parse(Buffer.from(forwarded.headers.get('X-CRC-Worker-Assertion').split('.')[1],'base64url').toString());
  assert.equal(claims.sub,ACCOUNT_SUBJECT);
  assert.equal(await forwarded.text(),body);
});

test('vision job status and deletion use only the private API and require account identity',async()=>{
  const {env,privateCalls,legacyCalls}=sandbox({BETA_VISION_ENABLED:'true'});
  const path='/api/v1/vision/jobs/123e4567-e89b-42d3-a456-426614174000';
  const status=await routeRequest(req(path,ACCOUNT_SESSION_HEADER),env);
  assert.equal(status.status,200);
  const removed=await routeRequest(req(path,{...ACCOUNT_SESSION_HEADER,Origin:BASE},{method:'DELETE'}),env);
  assert.equal(removed.status,200);
  assert.equal(privateCalls.length,2);
  assert.equal(new URL(privateCalls[0].url).pathname,path);
  assert.equal(privateCalls[1].method,'DELETE');
  assert.equal(legacyCalls.length,0);
});


test('mobile bearer token alone is not accepted until device identity exchange exists',async()=>{
  const {env,privateCalls}=sandbox({BETA_VISION_ENABLED:'true'});
  const response=await routeRequest(req('/api/v1/vision/jobs',{
    Authorization:'Bearer mobile-short-lived-token',
    Origin:BASE,'Content-Type':'application/json'
  },{method:'POST',body:JSON.stringify({consent_to_upload:true,consent_to_external_ai:true,frames:[]})}),env);
  assert.equal(response.status,401);
  assert.equal((await response.json()).error.code,'SESSION_REQUIRED');
  assert.equal(privateCalls.length,0);
});


test('vision scheduled processor stays disabled unless both worker and feature gates are explicitly enabled',async()=>{
 const {runVisionQueue}=await import('./beta-edge-worker.mjs');
 const {env,privateCalls}=sandbox({BETA_VISION_ENABLED:'true'});
 const disabled=await runVisionQueue(env);
 assert.equal(disabled.status,'disabled');
 assert.equal(privateCalls.length,0);
 const noAI=sandbox({BETA_VISION_ENABLED:'true',BETA_VISION_WORKER_ENABLED:'true'});
 assert.equal((await runVisionQueue(noAI.env)).status,'disabled');
 assert.equal(noAI.privateCalls.length,0);
});

test('vision worker uses private claims and Workers AI, validates observations and stores no image bytes in reports',async()=>{
 const {runVisionQueue}=await import('./beta-edge-worker.mjs');
 const calls=[],modelCalls=[];
 const jpeg=Buffer.from([255,216,1,2,3,4,255,217]).toString('base64');
 const job={job_id:'123e4567-e89b-42d3-a456-426614174000',
  lease_token:'123e4567-e89b-42d3-a456-426614174001',attempt_count:1,
  frames:[{at_ms:0,mime:'image/jpeg',width:180,height:320,data_base64:jpeg}]};
 const env=sandbox({
  BETA_VISION_ENABLED:'true',BETA_VISION_WORKER_ENABLED:'true',
  ASSETS:{async fetch(){return Response.json({cards:[{id:1,name:'Knight'},{id:2,name:'Archer'}]});}},
  PRIVATE_API:{async fetch(request){
   const path=new URL(request.url).pathname;const body=await request.clone().text();
   const claims=JSON.parse(Buffer.from(request.headers.get('X-CRC-Worker-Assertion').split('.')[1],'base64url').toString());
   assert.equal(claims.sub,'crc-vision-worker');assert.equal(request.headers.get('Authorization'),null);
   calls.push({path,body});
   if(path.endsWith('/claim'))return json({job},200);
   if(path.endsWith('/complete'))return json({status:'succeeded'},200);
   if(path.endsWith('/fail'))return json({status:'failed'},200);
   return json({error:{code:'NOT_FOUND'}},404);
  }},
  AI:{async run(model,input,options){
   modelCalls.push({model,input,options});
   return {choices:[{message:{content:JSON.stringify({screen:'battle',game_clock_s:120,elixir:5,
    hand:[1],units:[{card_id:2,x:0.4,y:0.5,side:'opponent'}]})}}],usage:{input_tokens:1000,output_tokens:100}};
  }}
 }).env;
 const result=await runVisionQueue(env);
 assert.equal(result.status,'completed');
 assert.equal(modelCalls.length,1);
 assert.equal(modelCalls[0].model,'@cf/google/gemma-4-26b-a4b-it');
 assert.equal(modelCalls[0].options.rejectIfBusy,true);
 assert.match(modelCalls[0].input.messages[1].content[1].image_url.url,/^data:image\/jpeg;base64,/);
 assert.deepEqual(calls.map(x=>x.path),['/api/v1/vision/worker/claim','/api/v1/vision/worker/complete']);
 const completed=JSON.parse(calls[1].body);
 const {readFile}=await import('node:fs/promises');
 const fixture=JSON.parse(await readFile(new URL('../../android-companion/app/src/test/resources/vision-worker-result-v1.json',import.meta.url),'utf8'));
 assert.deepEqual(completed.result,fixture);
 assert.equal(completed.result.replay_analyzed,false);
 assert.equal(completed.result.results[0].observation.hand[0],1);
 assert.equal(JSON.stringify(completed).includes(jpeg),false);
});

test('vision worker fails the lease when the model cannot return an observation',async()=>{
 const {runVisionQueue}=await import('./beta-edge-worker.mjs');
 const calls=[];const jpeg=Buffer.from([255,216,1,2,255,217]).toString('base64');
 const env=sandbox({
  BETA_VISION_ENABLED:'true',BETA_VISION_WORKER_ENABLED:'true',
  ASSETS:{async fetch(){return Response.json({cards:[{id:1,name:'Knight'}]});}},
  PRIVATE_API:{async fetch(request){const path=new URL(request.url).pathname;calls.push(path);
   if(path.endsWith('/claim'))return json({job:{job_id:'123e4567-e89b-42d3-a456-426614174000',
    lease_token:'123e4567-e89b-42d3-a456-426614174001',frames:[{at_ms:0,mime:'image/jpeg',width:180,height:320,data_base64:jpeg}] }});
   return json({status:'failed'});
  }},
  AI:{async run(){throw new Error('provider private detail');}}
 }).env;
 const result=await runVisionQueue(env);
 assert.equal(result.status,'failed');
 assert.deepEqual(calls,['/api/v1/vision/worker/claim','/api/v1/vision/worker/fail']);
});


test('OIDC native bootstrap is allowlisted without a browser cookie and rejects cross-origin requests',async()=>{
 const {env,privateCalls}=sandbox();
 const config=await routeRequest(req('/api/v1/auth/oidc/config',{}),env);
 assert.equal(config.status,200);
 const nonce=await routeRequest(req('/api/v1/auth/oidc/nonce',{},{
  method:'POST',body:'{}',headers:{'Content-Type':'application/json'}
 }),env);
 assert.equal(nonce.status,200);
 assert.equal(privateCalls.length,2);
 for(const call of privateCalls){
  const claims=JSON.parse(Buffer.from(call.headers.get('X-CRC-Worker-Assertion').split('.')[1],'base64url').toString());
  assert.equal(claims.sub,SUBJECT);
  assert.equal(call.headers.get('Cookie'),null);
  assert.equal(call.headers.get('Authorization'),null);
 }
 const before=privateCalls.length;
 const cross=await routeRequest(req('/api/v1/auth/oidc/nonce',{},{
  method:'POST',body:'{}',headers:{Origin:'https://evil.example','Content-Type':'application/json'}
 }),env);
 assert.equal(cross.status,403);
 assert.equal(privateCalls.length,before);
});

test('OIDC exchange rejects unexpected payload keys before forwarding ID tokens',async()=>{
 const {env,privateCalls}=sandbox();
 const response=await routeRequest(req('/api/v1/auth/oidc/exchange',{},{
  method:'POST',body:JSON.stringify({id_token:'x'.repeat(100),nonce_token:'y'.repeat(100),email:'x'}),
  headers:{'Content-Type':'application/json'}
 }),env);
 assert.equal(response.status,422);
 assert.equal(privateCalls.length,0);
});

test('short-lived OIDC bearer tokens authenticate native vision requests without forwarding caller credentials',async()=>{
 const {currentMobileSession,deriveMobileSessionSecret,authConfig}=await import('./beta-edge-worker.mjs');
 const {env,privateCalls}=sandbox({BETA_VISION_ENABLED:'true'});
 const secret=await deriveMobileSessionSecret(Buffer.from(ASSERTION_KEY,'hex'));
 const token=signJwt(Buffer.from(secret).toString('hex'),{
  iss:BASE,aud:'crc-mobile-session',sub:ACCOUNT_SUBJECT,iat:now,exp:now+600,
  jti:'mobile-access-token-identifier',token_use:'mobile_access'
 });
 const request=req('/api/v1/vision/capabilities',{Authorization:'Bearer '+token});
 assert.equal((await currentMobileSession(request,authConfig(env,HOST))).subject,ACCOUNT_SUBJECT);
 const response=await routeRequest(request,env);
 assert.equal(response.status,200);
 assert.equal(privateCalls.length,1);
 assert.equal(privateCalls[0].headers.get('Authorization'),null);
 assert.equal(privateCalls[0].headers.get('Cookie'),null);
});


// Stage 22: real client serialization -> authenticated gateway -> real Coach router/quality
// with a synthetic model adapter. No external network, account or provider calls.
test('web release contract connects browser client to gateway and Coach quality engine',async()=>{
 const {readFile}=await import('node:fs/promises');
 const vm=await import('node:vm');
 const {coachInferencePlan}=await import('./coach-core-v1.mjs');
 const {coachRetrieve,COACH_KNOWLEDGE_VERSION}=await import('./coach-knowledge-v1.mjs');
 const {coachQualityEvaluate,QUALITY_VERSION}=await import('./coach-quality-v1.mjs');
 const {coachModelPlan,coachModelExecute}=await import('./coach-router-v1.mjs');
 const clientContext={TextEncoder,URL};
 vm.runInNewContext(await readFile(new URL('../../site/backend-client.js',import.meta.url),'utf8'),clientContext);
 const api=clientContext.CRCBackendClient;
 const model='@cf/google/gemma-4-26b-a4b-it';
 const deck=Array.from({length:8},(_,i)=>({id:i+1,name:'Card '+(i+1),elixir:3,active_form:'base',rarity:'common'}));
 const candidate={id:20,name:'Musketeer',elixir:4,rarity:'rare',active_form:'base'};
 const pair={remove:'Card 1',add:'Musketeer',remove_id:1,add_id:20,elixir_delta:1,level_gap:0,gain:['air'],loss:['splash']};
 const personal={deck_source:'profile-live',deck_cards:deck,owned_candidates:[candidate],selected_deck_results:{wins:2,losses:1,draws:0,unknown:1},player_tag:'#PRIVATE_FIXTURE',name:'PRIVATE_NAME'};
 const facts={errors:[],items:deck,average:3,cycle:12};
 const evidence={filter:'all',matched_records:10,outcomes:{wins:5,losses:3,draws:1,unknown:1}};
 let raw='',mode='normal',modelCalls=0,upstreamCalls=0;
 const {env,privateCalls}=sandbox({LEGACY_LIVE:{async fetch(request){
  upstreamCalls++;
  assert.equal(request.headers.get('Cookie'),null);
  assert.equal(request.headers.get('Authorization'),null);
  assert.equal(request.headers.get('Origin'),'https://'+LEGACY_HOST);
  const body=await request.text();assert.ok(Buffer.byteLength(body)<=4096);
  assert.doesNotMatch(body,/PRIVATE_FIXTURE|PRIVATE_NAME/);
  const data=JSON.parse(body);
  assert.equal(data.consent_to_external_ai,true);
  assert.equal(data.personal.deck_cards.length,8);
  assert.equal(data.personal.owned_candidates[0].id,20);
  if(mode==='rate')return json({error:{code:'UPSTREAM_RATE_LIMITED'}},429);
  const plan=coachInferencePlan(data.question,data.action);
  const docs=coachRetrieve(data.question,data.action||plan.intent,data.personal.deck_cards);
  const fakeEnv={AI:{async run(id,options){modelCalls++;assert.equal(id,model);assert.equal(options.response_format.type,'json_object');return {response:raw};}}};
  // The legacy sanitizer normally calculates allowed swaps. This fixture supplies
  // a known server-side allowed pair; it does not test the private legacy sanitizer.
  const context={battles:data.battles,personal:{...data.personal,allowed_single_swaps:[pair]},docs,intent:plan.intent,question:data.question};
  const execution=await coachModelExecute(fakeEnv,coachModelPlan(data.question,plan,data.action,fakeEnv,model),[],context,coachQualityEvaluate);
  const q=execution.quality;
  return json({answer:q.answer,model:execution.model,external_inference:true,replay_analyzed:false,evidence_status:'client_submitted_unverified',
   knowledge_version:COACH_KNOWLEDGE_VERSION,knowledge_sources:docs.filter(d=>q.sources.includes(d.id)),
   quality_version:QUALITY_VERSION,quality_status:q.status,quality_checks:q.checks,quality_swap:q.swap,
   model_route:execution.route,fallback_used:execution.fallbackUsed});
 }}});
 const session={enabled:true,fetch:(path,options)=>routeRequest(req(path,{...SESSION_HEADER,Origin:BASE,'Content-Type':'application/json'},options),env)};
 const call=(question,action)=>api.askAI(session,question,facts,evidence,{ai_coach_enabled:true},personal,action);
 const payload=extra=>JSON.stringify({answer:'تمرین دفاع و چرخه کارت',swap_index:null,fact_keys:[],source_ids:[],...extra});
 raw=payload({swap_index:0,fact_keys:['selected']});
 let reply=await call('پیشنهاد تعویض کارت','suggestions');
 assert.equal(reply.qualityStatus,'checked_structure');assert.equal(reply.swap.add_id,20);assert.equal(reply.swap.remove_id,1);
 assert.match(reply.answer,/Musketeer/);assert.equal(reply.modelRoute,'quality');assert.equal(reply.fallbackUsed,false);
 raw=payload({answer:'نرخ برد دک ۸۰٪ است'});
 reply=await call('تحلیل دک','deck');assert.equal(reply.qualityStatus,'limited');assert.equal(reply.swap,null);assert.doesNotMatch(reply.answer,/۸۰/);
 raw=payload({answer:'invented tactical replay observation'});
 reply=await call('تحلیل ویدیو و بازپخش نبرد');assert.doesNotMatch(reply.answer,/invented tactical/);
 mode='rate';
 await assert.rejects(call('تحلیل دک','deck'),e=>e.code==='UPSTREAM_RATE_LIMITED'&&e.status===429);
 assert.equal(modelCalls,3);assert.equal(upstreamCalls,4);assert.equal(privateCalls.length,0);
});


test('stage 23 live smoke runner uses fixed gateway override, bound snapshot and one chat',async()=>{
 const {runSmoke}=await import('./coach-web-smoke-v23.mjs');
 const calls=[];
 const snapshotFixture={profile:{tag:'#TEST123'},current_deck:{card_ids:[1,2,3,4,5,6,7,8]},cards:Array.from({length:8},(_,i)=>({id:i+1,name:'Card '+(i+1),elixir_cost:3,rarity:'common'})),battles:[],partial:false};
 const fake=async(url,opts)=>{
  calls.push({url,opts});
  assert.equal(opts.headers.get('Cloudflare-Workers-Version-Overrides'),'crc-private-beta-gateway="0d1463fe-0822-4869-b3e9-27d15f89b527"');
  const path=new URL(url).pathname;
  if(path==='/')return new Response('fixture',{headers:{'Set-Cookie':'__Host-crc_beta_session=test; Secure; HttpOnly; Path=/'}});
  assert.equal(opts.headers.get('Cookie'),'__Host-crc_beta_session=test');
  if(path==='/api/v1/capabilities')return json({schema_version:'1.0',live_lookup_enabled:true,ai_coach_enabled:true});
  if(path.startsWith('/api/v1/players/'))return json(snapshotFixture);
  const body=JSON.parse(opts.body);
  assert.equal(opts.method,'POST');assert.equal(body.personal.deck_cards.length,8);
  assert.equal(body.consent_to_external_ai,true);assert.doesNotMatch(opts.body,/TEST123/);
  return json({quality_version:'crc-coach-quality-v1',router_version:'crc-coach-model-router-v1',quality_status:'checked_structure',model:'@cf/google/gemma-4-26b-a4b-it',answer:'synthetic',external_inference:true,replay_analyzed:false,evidence_status:'client_submitted_unverified'});
 };
 const result=await runSmoke('#TEST123',fake);
 assert.equal(result.coach_contract,'passed');assert.equal(result.model_calls_requested,1);
 assert.equal(calls.length,4);assert.equal(calls.filter(c=>c.opts.method==='POST').length,1);
 snapshotFixture.profile.tag='#OTHER123';calls.length=0;
 await assert.rejects(runSmoke('#TEST123',fake),/PLAYER_TAG_MISMATCH/);
 assert.equal(calls.filter(c=>c.opts.method==='POST').length,0);
});
