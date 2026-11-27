// Owner-run smoke of the zero-traffic stage-23 gateway and Coach candidate.
// No network by default. No raw player, cookie, response text or secrets in output.
const BASE='https://crc-private-beta-gateway.alirezaanari117.workers.dev';
const GATEWAY='0d1463fe-0822-4869-b3e9-27d15f89b527';
const override='crc-private-beta-gateway="'+GATEWAY+'"';
const cookieName='__Host-crc_beta_session';
function check(condition,code){if(!condition)throw new Error(code);}
export function buildDeckContext(snapshot,tag){
 check(String(snapshot?.profile?.tag||'').toUpperCase()===tag,'PLAYER_TAG_MISMATCH');
 const ids=snapshot.current_deck?.card_ids;
 check(Array.isArray(ids)&&ids.length===8&&new Set(ids).size===8&&ids.every(Number.isSafeInteger),'INVALID_CURRENT_DECK');
 check(Array.isArray(snapshot.cards)&&Array.isArray(snapshot.battles),'INVALID_SNAPSHOT');
 const byId=new Map(snapshot.cards.map(c=>[c.id,c]));
 const deck_cards=ids.map(id=>{
  const c=byId.get(id);
  check(c&&typeof c.name==='string'&&c.name.length>0&&c.name.length<=65,'MISSING_DECK_CARD');
  const out={id,name:c.name};
  if(Number.isInteger(c.elixir_cost)&&c.elixir_cost>=0&&c.elixir_cost<=10)out.elixir=c.elixir_cost;
  if(typeof c.rarity==='string'&&['common','rare','epic','legendary','champion'].includes(c.rarity.toLowerCase()))out.rarity=c.rarity.toLowerCase();
  return out;
 });
 return {deck_cards,deck_source:'profile-live'};
}
export async function runSmoke(tag,fetchFn=fetch){
 check(/^#[A-Z0-9]{3,16}$/.test(tag),'INVALID_TAG');
 let cookie='';
 const call=async(path,{method='GET',body,authenticated=true}={})=>{
  const headers=new Headers({'Cloudflare-Workers-Version-Overrides':override,Accept:path==='/'?'text/html':'application/json'});
  if(authenticated&&cookie)headers.set('Cookie',cookie);
  if(method==='POST'){headers.set('Origin',BASE);headers.set('Content-Type','application/json');}
  return fetchFn(BASE+path,{method,headers,body,redirect:'error',cache:'no-store',signal:AbortSignal.timeout(25000)});
 };
 const page=await call('/',{authenticated:false});
 check(page.status===200,'GATEWAY_PAGE_UNAVAILABLE');
 const setCookies=page.headers.getSetCookie?.()??[page.headers.get('Set-Cookie')||''];
 const found=setCookies.find(v=>v.startsWith(cookieName+'='));
 check(found&&/;\s*HttpOnly\b/i.test(found)&&/;\s*Secure\b/i.test(found),'NO_EXISTING_BETA_SESSION');
 cookie=found.split(';',1)[0];
 await page.body?.cancel();
 const cap=await call('/api/v1/capabilities');
 check(cap.ok,'CAPABILITIES_UNAVAILABLE');
 const capabilities=await cap.json();
 check(capabilities.schema_version==='1.0'&&capabilities.live_lookup_enabled===true&&capabilities.ai_coach_enabled===true,'CAPABILITIES_DISABLED');
 const response=await call('/api/v1/players/'+encodeURIComponent(tag)+'/snapshot?limit=25');
 check(response.ok,'PLAYER_SNAPSHOT_UNAVAILABLE');
 const snapshot=await response.json();
 const personal=buildDeckContext(snapshot,tag);
 const body=JSON.stringify({question:'نقش هر هشت کارت دک فعلی را ساده توضیح بده',action:'deck',consent_to_external_ai:true,deck:{selected_card_count:8},personal});
 check(Buffer.byteLength(body)<=4096,'PAYLOAD_TOO_LARGE');
 // Exactly one intentional online inference, only after validated snapshot. No retries.
 const chat=await call('/api/v1/coach/chat',{method:'POST',body});
 check(chat.ok,'COACH_HTTP_'+chat.status);
 const result=await chat.json();
 check(result.quality_version==='crc-coach-quality-v1'&&result.router_version==='crc-coach-model-router-v1','CANDIDATE_MARKERS_MISSING');
 check(result.model==='@cf/google/gemma-4-26b-a4b-it'&&result.external_inference===true&&result.replay_analyzed===false&&result.evidence_status==='client_submitted_unverified','INVALID_COACH_CONTRACT');
 check(['checked_structure','limited'].includes(result.quality_status)&&typeof result.answer==='string'&&result.answer.trim().length>0&&result.answer.length<=2900,'INVALID_ANSWER');
 return {snapshot:'passed',deck_cards:8,battle_records_returned:snapshot.battles.length,partial:snapshot.partial===true,coach_contract:'passed',quality_status:result.quality_status,model_calls_requested:1};
}
if(import.meta.url===new URL(process.argv[1]||'', 'file:').href){
 if(!process.argv.includes('--live')||!process.argv.includes('--confirm-billable')){
  console.log('Disabled by default. Requires --live --confirm-billable and CRC_SMOKE_PLAYER_TAG.');process.exit(0);
 }
 try{
  const tag=String(process.env.CRC_SMOKE_PLAYER_TAG||'').trim().toUpperCase();
  console.log(JSON.stringify(await runSmoke(tag)));
 }catch(e){
  const code=String(e?.message||'');
  console.error(JSON.stringify({status:'failed',reason:/^[A-Z0-9_]{1,80}$/.test(code)?code:'NETWORK_OR_RUNTIME_ERROR'}));
  process.exitCode=1;
 }
}
