import assert from 'node:assert/strict';
import test from 'node:test';
import {exactSplit,gatewayMetadata,readGatewayModule,GATEWAY_OLD,GATEWAY_PIN,LEGACY_NEW} from './stage-coach-web-assets-v24.mjs';
const bindings=['ASSETS:assets','BETA_AI_CHAT_ENABLED:plain_text','BETA_ALLOW_WORKERS_DEV:plain_text','BETA_ASSERTION_HMAC_HEX:secret_text','BETA_AUTH_AUDIENCE:plain_text','BETA_AUTH_ISSUER:plain_text','BETA_ENABLED:plain_text','BETA_HOSTNAME:plain_text','BETA_INVITE_CODES_JSON:secret_text','BETA_SESSION_HMAC_HEX:secret_text','LEGACY_LIVE:service','PRIVATE_API:vpc_service'].map(s=>{const [name,type]=s.split(':');return {name,type};});
const runtime={compatibility_date:'2026-11-22',usage_model:'standard',assets:{html_handling:'none',not_found_handling:'404-page',serve_directly:true,raw_run_worker_first:false,base_path:'/'}};
test('candidate staging refuses nonzero or unexpected deployment',()=>{
 assert.ok(exactSplit([{version_id:GATEWAY_OLD,percentage:100},{version_id:GATEWAY_PIN,percentage:0}],GATEWAY_OLD,GATEWAY_PIN));
 assert.equal(exactSplit([{version_id:GATEWAY_OLD,percentage:99},{version_id:GATEWAY_PIN,percentage:1}],GATEWAY_OLD,GATEWAY_PIN),false);
});
test('asset metadata retains existing runtime and all bindings, no cron or new AI binding',()=>{
 const m=gatewayMetadata(runtime,bindings,'fixture-completion-token');
 assert.equal(m.bindings.length,12);assert.equal(m.bindings.find(b=>b.name==='ASSETS').type,'assets');
 assert.ok(m.bindings.filter(b=>b.name!=='ASSETS').every(b=>b.type==='inherit'));
 assert.equal(m.assets.config.run_worker_first,false);assert.equal(m.triggers,undefined);assert.equal(m.keep_assets,undefined);
 assert.throws(()=>gatewayMetadata(runtime,bindings.slice(1),'fixture-completion-token'),/BINDINGS_CHANGED/);
 assert.throws(()=>gatewayMetadata({...runtime,compatibility_date:'2025-01-01'},bindings,'fixture-completion-token'),/RUNTIME_CHANGED/);
});
test('only fixed-pin gateway module with existing guards is accepted',()=>{
 const src='Cloudflare-Workers-Version-Overrides '+LEGACY_NEW+' AI_CONSENT_REQUIRED env.ASSETS.fetch';
 const wrap=s=>'--fixture\r\nContent-Disposition: form-data; name="worker.js"\r\n\r\n'+s+'\r\n--fixture--\r\n';
 assert.equal(readGatewayModule(wrap(src)),src);
 assert.throws(()=>readGatewayModule(wrap('other')),/PIN_OR_SECURITY_GUARD_MISSING/);
});
