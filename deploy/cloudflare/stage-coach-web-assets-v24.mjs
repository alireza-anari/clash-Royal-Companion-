// Stage 24: attach the approved web assets to a zero-traffic gateway candidate.
 // Intentionally separate from the existing production PUT deployment script.
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { ASSET_PATHS, buildAssetManifest, SCRIPT_NAME, PRIVATE_BETA_HOST, LEGACY_LIVE_WORKER_NAME } from './deploy-private-beta.mjs';

export const GATEWAY_OLD='a0b9d034-f7c2-4a3c-abd0-fc86ef5b07fe';
export const GATEWAY_PIN='ea969d9a-d1a4-4fcf-8bef-15f6d07f0c56';
export const LEGACY_OLD='690453ba-6aac-4a28-9951-61ada639ede0';
export const LEGACY_NEW='a561d2fa-5d4a-4942-9686-9362d9880bc1';
const EXPECTED_BINDINGS=['ASSETS:assets','BETA_AI_CHAT_ENABLED:plain_text','BETA_ALLOW_WORKERS_DEV:plain_text','BETA_ASSERTION_HMAC_HEX:secret_text','BETA_AUTH_AUDIENCE:plain_text','BETA_AUTH_ISSUER:plain_text','BETA_ENABLED:plain_text','BETA_HOSTNAME:plain_text','BETA_INVITE_CODES_JSON:secret_text','BETA_SESSION_HMAC_HEX:secret_text','LEGACY_LIVE:service','PRIVATE_API:vpc_service'].sort();
function check(ok,code){if(!ok)throw new Error(code);}
const canonical=value=>value===null||typeof value!=='object'?value:Array.isArray(value)?value.map(canonical):Object.fromEntries(Object.keys(value).sort().map(k=>[k,canonical(value[k])]));
const equivalent=(a,b)=>JSON.stringify(canonical(a))===JSON.stringify(canonical(b));
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
export function exactSplit(active,old,candidate){
 return Array.isArray(active)&&active.length===2&&active.some(v=>v.version_id===old&&v.percentage===100)&&active.some(v=>v.version_id===candidate&&v.percentage===0);
}
export function gatewayMetadata(runtime,bindings,completionToken){
 check(runtime.compatibility_date==='2026-11-22'&&runtime.usage_model==='standard','RUNTIME_CHANGED');
 check(equivalent(runtime.assets,{html_handling:'none',not_found_handling:'404-page',serve_directly:true,raw_run_worker_first:false,base_path:'/'}),'ASSET_ROUTING_CHANGED');
 check(equivalent(bindings.map(b=>b.name+':'+b.type).sort(),EXPECTED_BINDINGS),'BINDINGS_CHANGED');
 check(typeof completionToken==='string'&&completionToken.length>=16,'MISSING_COMPLETION_TOKEN');
 return {main_module:'worker.js',compatibility_date:runtime.compatibility_date,compatibility_flags:runtime.compatibility_flags??[],usage_model:runtime.usage_model,
  bindings:bindings.map(b=>b.type==='assets'?{name:b.name,type:'assets'}:{name:b.name,type:'inherit'}),
  assets:{jwt:completionToken,config:{html_handling:'none',not_found_handling:'404-page',run_worker_first:false}},
  annotations:{'workers/message':'CRC stage 24: web assets candidate, no normal traffic'}};
}
export function readGatewayModule(raw){
 const boundary=raw.split(/\r?\n/)[0];check(boundary.startsWith('--'),'MODULE_FORMAT_CHANGED');
 const parts=raw.split(boundary).filter(p=>p.includes('Content-Disposition:'));
 check(parts.length===1&&parts[0].includes('name="worker.js"'),'MODULE_INVENTORY_CHANGED');
 const source=parts[0].replace(/^[\s\S]*?\r?\n\r?\n/,'').replace(/\r?\n$/,'');
 check(source.includes('Cloudflare-Workers-Version-Overrides')&&source.includes(LEGACY_NEW)&&source.includes('AI_CONSENT_REQUIRED')&&source.includes('env.ASSETS.fetch'),'PIN_OR_SECURITY_GUARD_MISSING');
 return source;
}
const mime=name=>({'.html':'text/html; charset=utf-8','.js':'application/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json; charset=utf-8','.svg':'image/svg+xml'}[path.extname(name)]||'application/octet-stream');
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
export async function stageAssets(env=process.env,fetchImpl=fetch){
 const account=env.CF_ACCOUNT_ID||'',token=env.CF_API_TOKEN||'';
 check(/^[a-f0-9]{32}$/.test(account)&&token.length>=20,'DEPLOY_CREDENTIALS_UNAVAILABLE');
 const base='https://api.cloudflare.com/client/v4/accounts/'+account;
 const gateway='/workers/scripts/'+SCRIPT_NAME,legacy='/workers/scripts/'+LEGACY_LIVE_WORKER_NAME;
 const request=async(endpoint,{method='GET',body,bearer=token,raw=false}={})=>{
  const headers={Authorization:'Bearer '+bearer};
  if(body&&!(body instanceof FormData)){headers['Content-Type']='application/json';body=JSON.stringify(body);}
  const res=await fetchImpl(base+endpoint,{method,headers,body,redirect:'error',signal:AbortSignal.timeout(60000)});
  if(raw){check(res.ok,'MODULE_DOWNLOAD_FAILED');return res.text();}
  const data=await res.json().catch(()=>null);
  if(!res.ok||data?.success!==true){
   const code=data?.errors?.[0]?.code;
   throw new Error('CF_HTTP_'+res.status+(Number.isInteger(code)?'_CODE_'+code:''));
  }
  return {result:data.result,status:res.status};
 };
 const get=async endpoint=>(await request(endpoint)).result;
 const active=async prefix=>{const value=await get(prefix+'/deployments');return (value.deployments??value).slice().sort((a,b)=>Date.parse(b.created_on)-Date.parse(a.created_on))[0]?.versions;};
 const latest=async prefix=>{const value=await get(prefix+'/versions');return (value.items??value.versions??value)[0]?.id;};
 const preflight=async()=>{
  check(exactSplit(await active(gateway),GATEWAY_OLD,GATEWAY_PIN),'GATEWAY_DEPLOYMENT_CHANGED');
  check(exactSplit(await active(legacy),LEGACY_OLD,LEGACY_NEW),'LEGACY_DEPLOYMENT_CHANGED');
  check(await latest(gateway)===GATEWAY_PIN&&await latest(legacy)===LEGACY_NEW,'LATEST_VERSION_CHANGED');
  const g=await get(gateway+'/subdomain'),l=await get(legacy+'/subdomain');
  check(g.enabled===true&&g.previews_enabled===false&&l.enabled===false&&l.previews_enabled===false,'PUBLIC_ACCESS_CHANGED');
 };
 await preflight();
 const old=await get(gateway+'/versions/'+GATEWAY_PIN);
 const oldActive=await get(gateway+'/versions/'+GATEWAY_OLD);
 check(equivalent(old.resources.bindings,oldActive.resources.bindings)&&equivalent(old.resources.script_runtime,oldActive.resources.script_runtime),'PIN_SETTINGS_MISMATCH');
 const source=readGatewayModule(await request(gateway,{raw:true}));
 const entries=await Promise.all(ASSET_PATHS.map(async name=>['/'+name,await readFile(path.join(root,'site',name))]));
 const manifest=buildAssetManifest(entries);
 const files=new Map(entries.map(([name,bytes])=>[manifest[name].hash,{name,bytes}]));
 check(entries.find(([n])=>n==='/index.html')[1].toString().includes('<script src="/app.js" defer></script>'),'HTML_ENTRYPOINT_CHANGED');
 const session=await request(gateway+'/assets-upload-session',{method:'POST',body:{manifest}});
 const uploadToken=session.result?.jwt,buckets=session.result?.buckets;
 check(typeof uploadToken==='string'&&Array.isArray(buckets),'INVALID_ASSET_SESSION');
 let complete=buckets.length===0?uploadToken:null;
 for(const bucket of buckets){
  check(Array.isArray(bucket)&&bucket.length>0&&bucket.every(hash=>files.has(hash)),'INVALID_ASSET_BUCKET');
  const form=new FormData();
  for(const hash of bucket){const item=files.get(hash);form.append(hash,new Blob([item.bytes.toString('base64')],{type:mime(item.name)}),hash);}
  const uploaded=await request('/workers/assets/upload?base64=true',{method:'POST',body:form,bearer:uploadToken});
  if(typeof uploaded.result?.jwt==='string')complete=uploaded.result.jwt;
 }
 check(typeof complete==='string','INCOMPLETE_ASSET_UPLOAD');
 await preflight();
 const metadata=gatewayMetadata(old.resources.script_runtime,old.resources.bindings,complete);
 const form=new FormData();
 form.append('metadata',new Blob([JSON.stringify(metadata)],{type:'application/json'}));
 form.append('worker.js',new Blob([source],{type:'application/javascript+module'}),'worker.js');
 const uploaded=await request(gateway+'/versions?bindings_inherit=strict',{method:'POST',body:form});
 const id=uploaded.result?.id;
 check(typeof id==='string'&&/^[0-9a-f-]{36}$/.test(id)&&id!==GATEWAY_PIN,'INVALID_NEW_VERSION');
 const next=await get(gateway+'/versions/'+id);
 check(equivalent(next.resources.bindings,old.resources.bindings)&&equivalent(next.resources.script_runtime,old.resources.script_runtime)&&equivalent(next.resources.script.handlers,old.resources.script.handlers),'NEW_VERSION_SETTINGS_MISMATCH');
 check(exactSplit(await active(gateway),GATEWAY_OLD,GATEWAY_PIN)&&exactSplit(await active(legacy),LEGACY_OLD,LEGACY_NEW)&&await latest(gateway)===id,'CONCURRENT_DEPLOYMENT_CHANGE');
 await request(gateway+'/deployments',{method:'POST',body:{strategy:'percentage',versions:[{version_id:GATEWAY_OLD,percentage:100},{version_id:id,percentage:0}],annotations:{'workers/message':'CRC stage 24: new web assets, zero normal traffic'}}});
 check(exactSplit(await active(gateway),GATEWAY_OLD,id),'ZERO_TRAFFIC_VERIFICATION_FAILED');
 // Check actual returned assets, not merely version metadata. No inference.
 const baseUrl='https://'+PRIVATE_BETA_HOST;
 const override=SCRIPT_NAME+'="'+id+'"';
 const verified=[];
 for(const name of ['/app.js','/styles.css','/backend-client.js','/beta-session.js']){
  const response=await fetchImpl(baseUrl+name,{headers:{'Cloudflare-Workers-Version-Overrides':override},redirect:'error',cache:'no-store',signal:AbortSignal.timeout(20000)});
  if(response.ok&&digest(Buffer.from(await response.arrayBuffer()))===digest(entries.find(([n])=>n===name)[1]))verified.push(name);
 }
 return {status:'staged_zero_traffic',version:id,number:next.number,assets:entries.length,verified_assets:verified,asset_verification_passed:verified.length===4,normal_traffic_old:100,normal_traffic_candidate:0};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
 if(!process.argv.includes('--stage'))console.log('Disabled by default; pass --stage to upload a zero-traffic candidate.');
 else try{const result=await stageAssets();console.log(JSON.stringify(result));if(!result.asset_verification_passed)process.exitCode=1;}
 catch(e){const code=String(e?.message||'');console.error(JSON.stringify({status:'failed',reason:/^[A-Z0-9_]{1,100}$/.test(code)?code:'NETWORK_OR_RUNTIME_ERROR'}));process.exitCode=1;}
}
