import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const filename=path.join(path.dirname(fileURLToPath(import.meta.url)),'backend-client.js');
const ctx={TextEncoder,URL};
vm.runInNewContext(fs.readFileSync(filename,'utf8'),ctx);
const api=ctx.CRCBackendClient;
assert.ok(api);

const tag='#TEST123';
const profile={profile:{tag,display_name:'Sample',trophies:1234,king_tower_level:10,arena:{name:'Arena'}},current_deck:{card_ids:[1,2,3,4,5,6,7,8],support_card_ids:[159000000]},source:{fetched_at:'2026-11-20T13:00:00Z'}};
const cards={items:Array.from({length:8},(_,i)=>({id:i+1,name:'Card '+(i+1),level_raw:10,elixir_cost:i+1,icon_url:'https://api-assets.clashroyale.com/cards/300/test.png'})),support_items:[{id:159000000,name:'Tower Princess',level_raw:11}]};
const battles={items:[{battle_time:'2026-11-20T12:07:19Z',type:'trail',deck_selection:'eventDeck',game_mode:{name:'Event'},participants:[
 {side:'team',name:'Sample',tag,crowns:0,elixir_leaked:25.8,deck:{card_ids:[1,2,3,4,5,6,7,8]},support_cards:{card_ids:[159000000]},tower_hp:{king:0,princess:null}},
 {side:'opponent',name:'Rival',tag:'#RIVAL99',crowns:3,elixir_leaked:1.28,deck:{card_ids:[8,7,6,5,4,3,2,1]},tower_hp:{king:4000,princess:[3000]}}
]}]};
const capability={schema_version:'1.0',live_lookup_enabled:true,provider:'supercell'};
function mock(routes,requests=[]){
 return async (path,options)=>{
   requests.push({path,options});
   const record=routes[path];
   if(record===undefined)return {ok:false,status:404,json:async()=>({error:{code:'NOT_FOUND'}})};
   return {ok:record.status===undefined||record.status===200,status:record.status||200,json:async()=>record.body===undefined?record:record.body};
 };
}

test('normalizes tag and encodes literal # before API request',()=>{
 assert.equal(api.normalizeTag(' test123 '),tag);
 assert.equal(api.route('#test123'),'/api/v1/players/%23TEST123');
 assert.equal(api.normalizeTag('#bad#tag'),null);
});
test('fail-closed when capability absent or explicitly disabled',async()=>{
 const seen=[];
 const off=await api.capabilities(mock({'/api/v1/capabilities':{schema_version:'1.0',live_lookup_enabled:false}},seen));
 assert.equal(off.live_lookup_enabled,false);
 await assert.rejects(api.loadPlayer(mock({'/api/v1/capabilities':{schema_version:'1.0',live_lookup_enabled:false}},seen),tag),e=>e.code==='NOT_ENABLED');
 assert.ok(seen.every(x=>x.path==='/api/v1/capabilities'));
});
test('successful live read translates normalized backend to official-compatible public record',async()=>{
 const requested=[];
 const base='/api/v1/players/%23TEST123';
 const read=mock({'/api/v1/capabilities':capability,[base]:profile,[base+'/cards']:cards,[base+'/battles?limit=25']:battles},requested);
 const result=await api.loadPlayer(read,tag);
 assert.equal(result.profile.name,'Sample');
 assert.equal(result.profile.currentDeck.length,8);
 assert.equal(result.profile.currentDeckSupportCards[0].name,'Tower Princess');
 assert.equal(result.profile.cards[0].elixirCost,1);
 assert.equal(result.battles.length,1);
 assert.equal(result.battles[0].team[0].elixirLeaked,25.8);
 assert.equal(result.battles[0].team[0].name,'Sample');
 assert.equal(result.battles[0].battleTime,'2026-11-20T12:07:19Z');
 assert.equal(result.partial,false);
 assert.equal(result.ownership_verified,false);
 assert.equal(result.full_history,false);
 assert.ok(requested.every(x=>x.options.credentials==='omit'));
 assert.ok(requested.every(x=>!JSON.stringify(x).includes('Bearer')));
});
test('when Battle Log unavailable returns profile and explicit partial result',async()=>{
 const base='/api/v1/players/%23TEST123';
 const read=mock({'/api/v1/capabilities':capability,[base]:profile,[base+'/cards']:cards,
 [base+'/battles?limit=25']:{status:504,body:{error:{code:'UPSTREAM_TIMEOUT'}}}});
 const result=await api.loadPlayer(read,tag);
 assert.equal(result.partial,true);
 assert.equal(result.profile.cards.length,8);
 assert.equal(result.battles.length,0);
});
test('profile failure does not produce fallback fake account',async()=>{
 const base='/api/v1/players/%23TEST123';
 const read=mock({'/api/v1/capabilities':capability,[base]:{status:404,body:{error:{code:'PLAYER_NOT_FOUND'}}},[base+'/cards']:cards,[base+'/battles?limit=25']:battles});
 await assert.rejects(api.loadPlayer(read,tag),e=>e.code==='PLAYER_NOT_FOUND');
});
test('tag mismatch and invalid inputs are rejected',async()=>{
 const base='/api/v1/players/%23TEST123';
 const read=mock({'/api/v1/capabilities':capability,[base]:{...profile,profile:{...profile.profile,tag:'#OTHER123'}},[base+'/cards']:cards,[base+'/battles?limit=25']:battles});
 await assert.rejects(api.loadPlayer(read,tag),e=>e.code==='TAG_MISMATCH');
 let seen=0;
 await assert.rejects(api.loadPlayer(async()=>{seen++;return {};},'##oops'),e=>e.code==='INVALID_TAG');
 assert.equal(seen,0);
});
test('malformed data rejects rather than silently normalizing',()=>{
 assert.throws(()=>api.normalizedToProfile(profile,{items:null,support_items:[]}),e=>e.code==='SCHEMA_MISMATCH');
 assert.throws(()=>api.normalizedToBattles({items:[{participants:null}]}),e=>e.code==='SCHEMA_MISMATCH');
});
test('unknown or dynamic elixir costs are never guessed',()=>{
 const data=api.normalizedToProfile(profile,{items:[{id:1,name:'Mirror',elixir_cost:null}],support_items:[]});
 assert.equal(data.cards[0].elixirCost,undefined);
});

test('new snapshot endpoint eliminates duplicate upstream profile requests',async()=>{
 const seen=[];
 const base='/api/v1/players/%23TEST123';
 const snapshot={...profile,cards:cards.items,support_items:cards.support_items,battles:battles.items,
                 partial:false,coverage:{full_history:false,returned_count:1}};
 const read=mock({'/api/v1/capabilities':capability,[base+'/snapshot?limit=25']:snapshot},seen);
 const result=await api.loadPlayer(read,tag);
 assert.equal(result.profile.cards.length,8);
 assert.equal(result.battles.length,1);
 assert.equal(result.partial,false);
 assert.deepEqual(seen.map(x=>x.path),['/api/v1/capabilities',base+'/snapshot?limit=25']);
});
test('partial snapshots preserve player data without inventing empty-history claims',async()=>{
 const seen=[];
 const base='/api/v1/players/%23TEST123';
 const snapshot={...profile,cards:cards.items,support_items:cards.support_items,
                 battles:[],partial:true,battles_error_code:'UPSTREAM_UNAVAILABLE',coverage:{full_history:false,returned_count:0}};
 const read=mock({'/api/v1/capabilities':capability,[base+'/snapshot?limit=25']:snapshot},seen);
 const result=await api.loadPlayer(read,tag);
 assert.equal(result.partial,true);
 assert.equal(result.profile.tag,tag);
 assert.equal(result.full_history,false);
 assert.equal(seen.length,2);
});

test('online coach starts directly from a user message; no separate approval argument is required',async()=>{
 const seen=[];
 const session={enabled:true,fetch:async(path,options)=>{seen.push({path,options});return {ok:true,json:async()=>({answer:'پاسخ آنلاین تست',model:'@cf/google/gemma-4-26b-a4b-it',external_inference:true,replay_analyzed:false,evidence_status:'client_submitted_unverified'})};}};
 const f={errors:[],items:Array(8).fill({name:'PRIVATE_NAME'}),average:3.25,cycle:7,tag:'#SECRET'};
 const b={filter:'event',matched_records:3,outcomes:{wins:2,losses:1,draws:0,unknown:0},player_tag:'#SECRET'};
 const cap={ai_coach_enabled:true};
 await assert.rejects(api.askAI(session,'اکسیر دک من',f,b,{ai_coach_enabled:false}));
 await assert.rejects(api.askAI(null,'اکسیر دک من',f,b,cap));
 assert.equal(seen.length,0);
 const out=await api.askAI(session,'اکسیر دک من',f,b,cap);
 assert.equal(out.answer,'پاسخ آنلاین تست');
 assert.equal(seen.length,1);
 const payload=JSON.parse(seen[0].options.body);
 assert.equal(payload.consent_to_external_ai,true);
 assert.deepEqual(payload.deck,{selected_card_count:8,average_elixir:3.25,cycle_cost_four_cheapest:7});
 assert.equal(payload.battles.wins,2);
 assert.ok(!seen[0].options.body.includes('PRIVATE_NAME'));
 assert.ok(!seen[0].options.body.includes('#SECRET'));
 assert.equal(api.askAI.length,7);
});
test('AI capability independently checks explicit backend consent flag',async()=>{
 const cap=await api.capabilities(mock({'/api/v1/capabilities':{schema_version:'1.0',live_lookup_enabled:false,ai_coach_enabled:true,ai_external_data_requires_consent:true}}));
 assert.equal(cap.live_lookup_enabled,false);
 assert.equal(cap.ai_coach_enabled,true);
});

test('personal coach payload includes selected cards and only owned candidates, without identity',()=>{
 const items=Array.from({length:8},(_,i)=>({id:26000000+i,name:'Card '+i,elixir:3,type:'troop'}));
 const other={id:26000100,name:'Owned candidate',elixir:2,type:'troop'};
 const absent={id:26000101,name:'Not owned',elixir:2,type:'troop'};
 const facts={errors:[],items,average:3,cycle:12};
 const profile={name:'PRIVATE_PROFILE',tag:'#PRIVATE_TAG',cards:items.concat(other).map(c=>({...c,rarity:'common',level:12,maxLevel:16}))};
 const entries=[{attribution:'matched_tag',outcome:'win',deck:{card_ids:items.map(c=>c.id)}},{attribution:'matched_tag',outcome:'loss',deck:{card_ids:[1,2,3,4,5,6,7,8]}}];
 const context=api.personalCoachContext(facts,profile,items.concat(other,absent),[other.id,absent.id],'profile-live',entries);
 const p=api.coachPayload('تحلیل دک',facts,null,context,'deck');
 assert.equal(p.action,'deck');assert.equal(p.personal.deck_cards.length,8);
 assert.equal(p.personal.deck_cards[0].display_level,12);
 assert.equal(p.personal.owned_candidates.length,1);
 assert.equal(p.personal.selected_deck_results.wins,1);
 assert.equal(p.personal.selected_deck_results.losses,0);
 assert.equal(p.personal.style.records,2);
 assert.ok(!JSON.stringify(p).includes('PRIVATE_'));
});

test('coach session retains at most two successful turns and resets by account object',()=>{
 const s=api.createCoachSession(),a={},b={};
 assert.equal(s.history(a).length,0);
 for(let i=0;i<3;i++)s.record(a,'question '+i,'answer '+i);
 assert.equal(s.history(a).length,2);assert.equal(s.history(a)[0].question,'question 1');
 assert.equal(s.history(b).length,0);
 s.record(a,'late reply','must not appear');assert.equal(s.history(b).length,0);
 s.record(b,'question','answer');s.clear();assert.equal(s.history(b).length,0);
});
test('optional history is bounded, strips tags/emails and never replaces current question',()=>{
 const personal={chat_history:[{question:'contact a@example.com #ABC123',answer:'past answer'},{question:'follow up',answer:'x'.repeat(600)}]};
 const p=api.coachPayload('سؤال جدید',null,null,personal);
 assert.equal(p.question,'سؤال جدید');assert.equal(p.personal.chat_history.length,2);
 assert.ok(!JSON.stringify(p).includes('a@example.com'));assert.ok(!JSON.stringify(p).includes('#ABC123'));
 assert.equal(api.coachPayload('تحلیل دک',null,null,personal,'deck').personal.chat_history,undefined);
 const large={deck_cards:Array.from({length:8},(_,i)=>({id:i+1,name:'ک'.repeat(65),elixir:4,rarity:'legendary',active_form:'unknown'})),owned_candidates:Array.from({length:8},(_,i)=>({id:i+20,name:'ک'.repeat(65),elixir:3,rarity:'legendary',active_form:'unknown'})),chat_history:[{question:'الف'.repeat(280),answer:'ب'.repeat(600)}]};
 const bounded=api.coachPayload('تحلیل',null,null,large);
 assert.equal(bounded.personal.deck_cards.length,8);
 assert.ok(new TextEncoder().encode(JSON.stringify(bounded)).length<=4096);
});
test('inconsistent battle totals are not sent as evidence',()=>{
 const p=api.coachPayload('تحلیل',null,{filter:'all',matched_records:10,outcomes:{wins:2,losses:1,draws:0,unknown:0}},null);
 assert.equal(p.battles,undefined);
});
test('style separates reported elixir leakage in wins and losses without guessing missing data',()=>{
 const items=Array.from({length:8},(_,i)=>({id:i+1,name:'Card '+i,elixir:3}));
 const entries=[{attribution:'matched_tag',outcome:'win',elixir_leaked:3},{attribution:'matched_tag',outcome:'loss',elixir_leaked:7},{attribution:'matched_tag',outcome:'loss',elixir_leaked:null},{attribution:'unknown',outcome:'win',elixir_leaked:50}];
 const personal=api.personalCoachContext({items,errors:[]},null,items,[],'manual',entries);
 assert.equal(personal.style.win_leaked_sample,1);assert.equal(personal.style.win_leaked_average,3);
 assert.equal(personal.style.loss_leaked_sample,1);assert.equal(personal.style.loss_leaked_average,7);
 const p=api.coachPayload('تحلیل',null,null,personal,'style');assert.equal(p.personal.style.loss_leaked_average,7);
});

test('coach response accepts only allowlisted official knowledge sources',async()=>{
 const good={id:'K01',title:'Cards & Decks',url:'https://support.supercell.com/clash-royale/en/articles/cards-and-decks-6.html',publisher:'Supercell Support',verified_at:'2026-11-26',authority:'official-support'};
 const bad={...good,id:'K99',url:'https://evil.example/steal'};
 const session={enabled:true,fetch:async()=>({ok:true,json:async()=>({answer:'پاسخ [K01]',model:'@cf/google/gemma-4-26b-a4b-it',external_inference:true,replay_analyzed:false,evidence_status:'client_submitted_unverified',knowledge_version:'test',knowledge_sources:[good,bad]})})};
 const reply=await api.askAI(session,'کارت‌ها و دک من',null,null,{ai_coach_enabled:true},null);
 assert.equal(reply.sources.length,1);assert.equal(reply.sources[0].id,'K01');assert.equal(reply.knowledgeVersion,'test');
});

test('quality status is recognized only for a known response version',async()=>{
 const response={answer:'پاسخ محدود',model:'@cf/google/gemma-4-26b-a4b-it',external_inference:true,replay_analyzed:false,evidence_status:'client_submitted_unverified',quality_version:'crc-coach-quality-v1',quality_status:'limited',quality_swap:{remove:'Knight',add:'Valkyrie',remove_id:26000000,add_id:26000011,gain:['دفاع'],loss:[],elixir_delta:1,level_gap:0}};
 const session={enabled:true,fetch:async()=>({ok:true,json:async()=>response})};
 const ask=()=>api.askAI(session,'تحلیل دک من',null,null,{ai_coach_enabled:true},null);
 assert.equal((await ask()).qualityStatus,'limited');
 response.quality_status='verified_truth';assert.equal((await ask()).qualityStatus,null);assert.equal((await ask()).swap,null);
 response.quality_status='limited';response.quality_version='unknown';assert.equal((await ask()).qualityStatus,null);
});

test('coach router model and route metadata accept only known values',async()=>{
 const response={answer:'پاسخ کوتاه',model:'@cf/zai-org/glm-4.7-flash',external_inference:true,replay_analyzed:false,evidence_status:'client_submitted_unverified',model_route:'fast',fallback_used:false,router_version:'crc-coach-model-router-v1'};
 const session={enabled:true,fetch:async()=>({ok:true,json:async()=>response})};
 const ask=()=>api.askAI(session,'سلام',null,null,{ai_coach_enabled:true},null);
 const reply=await ask();assert.equal(reply.model,'@cf/zai-org/glm-4.7-flash');assert.equal(reply.modelRoute,'fast');assert.equal(reply.fallbackUsed,false);
 response.model_route='untrusted';response.fallback_used='yes';
 const next=await ask();assert.equal(next.modelRoute,null);assert.equal(next.fallbackUsed,null);
});


const memoryStorage=()=>{const values=new Map();return {getItem:key=>values.has(key)?values.get(key):null,setItem:(key,value)=>values.set(key,String(value)),removeItem:key=>values.delete(key),values};};
const memorySnapshot=(overrides={})=>({
 captured_at:'2026-11-26T12:00:00.000Z',source:'live',deck_source:'profile-live',
 deck_card_ids:[1,2,3,4,5,6,7,8],
 cards:Array.from({length:8},(_,i)=>({id:i+1,level:12,rarity:'rare',evolution_level:0,max_evolution_level:3,star_level:1})),
 battles:{matched_records:2,outcomes:{wins:1,losses:1,draws:0,unknown:0},elixir_leak_sample:2,avg_elixir_leaked:4.5},
 selected_deck:{matched_records:2,outcomes:{wins:1,losses:1,draws:0,unknown:0}},
 deck_patterns:[{deck_card_ids:[1,2,3,4,5,6,7,8],plays:2,outcomes:{wins:1,losses:1,draws:0,unknown:0},event_plays:0}],
 latest_battle_at:'20261126T110000.000Z',...overrides
});
test('Coach memory is opt-in, profile-scoped, bounded and device-local',()=>{
 const storage=memoryStorage(),memory=api.createCoachMemory(storage),snapshot=memorySnapshot();
 assert.equal(memory.isEnabled('#TEST123'),false);
 assert.equal(memory.record('#TEST123',snapshot),false);
 assert.equal(memory.setEnabled('#TEST123',true),true);
 assert.equal(memory.isEnabled('#TEST123'),true);
 assert.equal(memory.record('#TEST123',snapshot),true);
 assert.equal(memory.read('#TEST123').snapshots.length,1);
 assert.equal(memory.read('#OTHER123'),null);
 assert.equal(memory.setFocus('#TEST123','elixir'),true);
 assert.equal(memory.read('#TEST123').focus,'elixir');
 const next=memorySnapshot({captured_at:'2026-11-26T13:00:00.000Z',latest_battle_at:'20261126T120000.000Z'});
 assert.equal(memory.record('#TEST123',next),true);
 assert.equal(memory.read('#TEST123').snapshots.length,2);
 assert.equal(memory.record('#TEST123',next),true);
 assert.equal(memory.read('#TEST123').snapshots.length,2);
 const baseline={matched_records:2,outcomes:{wins:1,losses:1,draws:0,unknown:0}};
 assert.equal(memory.recordPractice('#TEST123','suggestions',[1,2,3,4,5,6,7,8],baseline,'2026-11-26T12:00:00.000Z','suggested_deck'),true);
 assert.equal(memory.read('#TEST123').pending_practice.action,'suggestions');
 assert.equal(memory.read('#TEST123').pending_practice.target_kind,'suggested_deck');
 assert.equal(memory.read('#TEST123').pending_practice.baseline.matched_records,2);
 const delta={matched_records:2,outcomes:{wins:1,losses:1,draws:0,unknown:0}};
 assert.equal(memory.addPracticeProgress('#TEST123',delta,'2030-01-01T12:00:00.000Z'),true);
 assert.equal(memory.read('#TEST123').pending_practice.progress.matched_records,2);
 assert.equal(memory.addPracticeProgress('#TEST123',delta,'2030-01-01T12:00:00.000Z'),false);
 assert.equal(memory.addPracticeProgress('#TEST123',{matched_records:1,outcomes:{wins:1,losses:0,draws:0,unknown:0}},'2030-01-02T12:00:00.000Z'),true);
 assert.equal(memory.read('#TEST123').pending_practice.progress.matched_records,3);
 assert.equal(memory.submitPracticeFeedback('#TEST123','improved'),true);
 assert.equal(memory.read('#TEST123').pending_practice,null);
 assert.equal(memory.read('#TEST123').practice_feedback[0].outcome,'improved');
 assert.equal(memory.read('#TEST123').practice_feedback[0].progress.matched_records,3);
 assert.equal(memory.submitPracticeFeedback('#TEST123','invented'),false);
 assert.equal(memory.setEnabled('#TEST123',false),true);
 assert.equal(memory.read('#TEST123'),null);
 assert.equal(memory.record('#TEST123',snapshot),false);
 assert.equal(memory.setEnabled('#TEST123',true),true);
 assert.equal(memory.read('#TEST123').snapshots.length,2);
 assert.equal(memory.clear('#TEST123'),true);
 assert.equal(memory.read('#TEST123'),null);
 assert.equal(storage.values.size,0);
});
test('Coach memory rejects invalid tags, malformed snapshots and unapproved focus values',()=>{
 const memory=api.createCoachMemory(memoryStorage());
 assert.equal(memory.setEnabled('not-a-tag',true),false);
 assert.equal(memory.setEnabled('#TEST123',true),true);
 assert.equal(memory.record('#TEST123',memorySnapshot({deck_card_ids:[1,1,2,3,4,5,6,7]})),false);
 assert.equal(memory.setFocus('#TEST123','ignore-all-rules'),false);
 assert.equal(memory.setFocus('#TEST123','defense'),true);
});
test('coach payload forwards only bounded structured memory, never tag or free text',()=>{
 const snapshot=memorySnapshot();
 const personal={deck_cards:Array.from({length:8},(_,i)=>({id:i+1,name:'Card '+(i+1),elixir:3})),
  coach_memory:{version:1,focus:'elixir',snapshots:[snapshot],pending_practice:{action:'suggestions',deck_card_ids:[1,2,3,4,5,6,7,8],created_at:'2026-11-26T13:00:00.000Z'},practice_feedback:[{action:'suggestions',deck_card_ids:[1,2,3,4,5,6,7,8],created_at:'2026-11-26T13:00:00.000Z',outcome:'improved',recorded_at:'2026-11-26T14:00:00.000Z'}],player_tag:'#TEST123',private_note:'do not send'}};
 const payload=api.coachPayload('تحلیل سبک بازی',null,null,personal,'style');
 assert.equal(payload.personal.coach_memory.focus,'elixir');
 assert.equal(payload.personal.coach_memory.snapshots.length,1);
 assert.equal(payload.personal.coach_memory.player_tag,undefined);
 assert.equal(payload.personal.coach_memory.private_note,undefined);
 assert.equal(payload.personal.coach_memory.pending_practice.action,'suggestions');
 assert.equal(payload.personal.coach_memory.practice_feedback[0].outcome,'improved');
 assert.equal(JSON.stringify(payload).includes('#TEST123'),false);
 assert.equal(JSON.stringify(payload).includes('do not send'),false);
});

test('post-task practice delta counts only newer exact-deck matches for the selected tag',()=>{
 const task={action:'suggestions',deck_card_ids:[1,2,3,4,5,6,7,8],created_at:'2026-11-26T13:00:00.000Z',
  since_battle_at:'2026-11-26T12:00:00.000Z',last_battle_at:'2026-11-26T13:00:00.000Z',
  baseline:{matched_records:2,outcomes:{wins:1,losses:1,draws:0,unknown:0}},
  progress:{matched_records:0,outcomes:{wins:0,losses:0,draws:0,unknown:0}}};
 const exact=[1,2,3,4,5,6,7,8],different=[1,2,3,4,5,6,7,9];
 const entry=(time,outcome,attribution='matched_tag',ids=exact)=>({battle_time:time,outcome,attribution,deck:{card_ids:ids}});
 const delta=api.coachPracticeDelta([
  entry('2026-11-26T13:01:00.000Z','win'),
  entry('2026-11-26T13:02:00.000Z','loss'),
  entry('2026-11-26T12:59:00.000Z','win'),
  entry('2026-11-26T13:03:00.000Z','win','single_team_assumed'),
  entry('2026-11-26T13:04:00.000Z','win','matched_tag',different)
 ],task);
 assert.equal(delta.matched_records,2);assert.equal(delta.outcomes.wins,1);assert.equal(delta.outcomes.losses,1);assert.equal(delta.outcomes.draws,0);assert.equal(delta.outcomes.unknown,0);assert.equal(delta.last_battle_at,'2026-11-26T13:02:00.000Z');
 assert.equal(api.coachPracticeDelta([entry('2026-11-26T13:00:00.000Z','win')],task),null);
});

test('coach client exposes only schema-valid server-checked card swap metadata',async()=>{
 const response={answer:'پیشنهاد آزمایشی',model:'@cf/google/gemma-4-26b-a4b-it',external_inference:true,replay_analyzed:false,evidence_status:'client_submitted_unverified',
  quality_version:'crc-coach-quality-v1',quality_status:'checked_structure',
  quality_swap:{remove:'Knight',add:'Valkyrie',remove_id:26000000,add_id:26000011,gain:['دفاع'],loss:[],elixir_delta:1,level_gap:0}};
 const session={enabled:true,fetch:async()=>({ok:true,json:async()=>response})};
 const reply=await api.askAI(session,'پیشنهاد تعویض',null,null,{ai_coach_enabled:true},null);
 assert.equal(reply.swap.remove_id,26000000);assert.equal(reply.swap.add_id,26000011);
 response.quality_swap={...response.quality_swap,add_id:'not-an-id'};
 assert.equal((await api.askAI(session,'پیشنهاد تعویض',null,null,{ai_coach_enabled:true},null)).swap,null);
});

test('Evolution and Hero bitfields are decoded independently and Collection Level is bounded',()=>{
 const cards=[
  {id:1,level:16,maxLevel:16,rarity:'common',maxEvolutionLevel:3,evolutionLevel:3},
  {id:2,level:10,maxLevel:14,rarity:'rare',maxEvolutionLevel:1,evolutionLevel:1},
  {id:3,level:8,maxLevel:8,rarity:'legendary'},
  {id:4,level:6,maxLevel:6,rarity:'champion',maxEvolutionLevel:2,evolutionLevel:2}
 ];
 const forms=api.cardFormProgress(cards[0]);
 assert.equal(forms.evolution_available,true);assert.equal(forms.hero_available,true);
 assert.equal(forms.evolution_unlocked,true);assert.equal(forms.hero_unlocked,true);
 const progress=api.collectionLevel({cards,supportCards:[{id:159000001,level:16,maxLevel:16,rarity:'common'}]});
 assert.equal(progress.level,96);assert.equal(progress.base_levels,76);
 assert.equal(progress.card_count,5);assert.equal(progress.evolutions,2);assert.equal(progress.heroes,2);
 assert.equal(api.collectionLevel({cards:[{id:1,level:12,rarity:'unknown'}]}),null);
 assert.equal(api.collectionLevel({cards:[{id:1,level:12,maxLevel:16,rarity:'common',evolutionLevel:4}]}),null);
});

test('normalized profile retains max Evolution/Hero capability and trusted form icons',()=>{
 const profile=api.normalizedToProfile(
  {profile:{tag:'#TEST123',display_name:'Test',trophies:1000}},
  {items:[{id:26000000,name:'Knight',level_raw:14,max_level_raw:16,evolution_level:3,max_evolution_level:3,star_level:2,count:10,rarity:'common',
    icon_url:'https://api-assets.clashroyale.com/cards/300/base.png',
    hero_icon_url:'https://api-assets.clashroyale.com/cardheroes/300/hero.png',
    evolution_icon_url:'https://api-assets.clashroyale.com/cardevolutions/300/evo.png'}],support_items:[]}
 );
 assert.equal(profile.cards[0].maxEvolutionLevel,3);assert.equal(profile.cards[0].evolutionLevel,3);
 assert.equal(profile.cards[0].iconUrls.heroMedium,'https://api-assets.clashroyale.com/cardheroes/300/hero.png');
 assert.equal(profile.cards[0].iconUrls.evolutionMedium,'https://api-assets.clashroyale.com/cardevolutions/300/evo.png');
});


test('practice evidence deduplicates timestamps, excludes conflicts and rejects pre-task observations',()=>{
 const deck=[1,2,3,4,5,6,7,8],zero={wins:0,losses:0,draws:0,unknown:0};
 const row=(battle_time,outcome,ids=deck,attribution='matched_tag')=>({battle_time,outcome,deck:{card_ids:ids},attribution});
 const task={action:'style',deck_card_ids:deck,created_at:'2026-11-26T13:00:00Z',since_battle_at:'2026-11-26T12:00:00Z',last_battle_at:'2026-11-26T12:30:00Z',progress:{matched_records:0,outcomes:zero}};
 const rows=[row('2026-11-26T12:55:00Z','win'),row('2026-11-26T13:01:00Z','win'),row('2026-11-26T13:01:00.000Z','win'),
 row('2026-11-26T13:02:00Z','loss'),row('2026-11-26T13:02:00Z','win'),row('2026-11-26T13:03:00Z','draw'),row('bad','win'),
 row('2026-11-26T13:04:00Z','win',deck,'single_team_assumed')];
 const delta=api.coachPracticeDelta(rows,task);
 assert.equal(delta.matched_records,2);assert.equal(delta.outcomes.wins,1);assert.equal(delta.outcomes.draws,1);
 assert.equal(delta.last_battle_at,'2026-11-26T13:03:00.000Z');
 assert.equal(api.coachPracticeDelta(rows,{...task,last_battle_at:delta.last_battle_at}),null);
 const capped=api.coachPracticeDelta(rows,{...task,progress:{matched_records:199,outcomes:{...zero,wins:199}}});
 assert.equal(capped.matched_records,1);
 assert.equal(api.coachPracticeDelta(rows,{...task,progress:{matched_records:200,outcomes:{...zero,wins:200}}}),null);
});
test('pending practice is not overwritten and review checkpoint is not a performance claim',()=>{
 const storage=memoryStorage(),memory=api.createCoachMemory(storage),tag='#TEST123',deck=[1,2,3,4,5,6,7,8];
 assert.equal(api.coachPracticePlan(null),null);
 assert.equal(memory.setEnabled(tag,true),true);assert.equal(memory.setFocus(tag,'elixir'),true);
 assert.equal(api.coachPracticePlan(memory.read(tag)).status,'ready');
 assert.equal(memory.recordPractice(tag,'style',deck,null,null),true);
 assert.equal(memory.recordPractice(tag,'deck',deck,null,null),false);
 assert.equal(memory.read(tag).pending_practice.action,'style');
 assert.equal(memory.addPracticeProgress(tag,{matched_records:6,outcomes:{wins:2,losses:2,draws:1,unknown:1}},'2090-01-01T00:00:00Z'),true);
 const plan=api.coachPracticePlan(memory.read(tag));
 assert.equal(plan.known,5);assert.equal(plan.status,'review');assert.equal(plan.remaining,0);
 assert.match(plan.steps[0],/اکسیر/);
 assert.equal(memory.submitPracticeFeedback(tag,'worse'),true);
 assert.match(api.coachPracticePlan(memory.read(tag)).follow_up,/اثبات نمی‌کند/);
 assert.equal(memory.recordPractice(tag,'deck',deck,null,null),true);
 assert.equal(memory.read('#OTHER123'),null);
});

test('proactive hint requires actual deck ownership and explicit form evidence',()=>{
 const ids=[1,2,3,4,5,6,7,8],cards=ids.map(id=>({id,rarity:'common',level:12,maxLevel:16}));
 const p={tag:'#TEST123',cards,currentDeck:ids.map(id=>({id}))};
 assert.equal(api.coachProactiveHint(null,ids,[],null),null);
 assert.equal(api.coachProactiveHint(p,ids,[],null),null);
 cards[0].maxEvolutionLevel=3;
 assert.equal(api.coachProactiveHint(p,ids,[],null),null);
 cards[0].evolutionLevel=0;
 const hint=api.coachProactiveHint(p,ids,[],null);
 assert.equal(hint.kind,'form');assert.equal(hint.card_id,1);assert.match(hint.detail,/Evolution/);
 assert.equal(api.coachProactiveHint(p,[1,2,3,4,5,6,7,9],[],null),null);
 cards[0].evolutionLevel=3;cards[1].level=9;
 const level=api.coachProactiveHint(p,ids,[],null);
 assert.equal(level.kind,'level');assert.equal(level.card_id,2);
 cards[1].maxLevel=14;
 assert.equal(api.coachProactiveHint(p,ids,[],null),null);
});
test('proactive hints respect recent distinct same-mode evidence and session dismissal isolation',()=>{
 const ids=[1,2,3,4,5,6,7,8],p={tag:'#TEST123',cards:ids.map(id=>({id})),currentDeck:ids.map(id=>({id}))};
 const now=Date.parse('2026-11-26T15:00:00Z');
 const row=(n,mode='Ladder')=>({battle_time:new Date(now-n*60000).toISOString(),attribution:'matched_tag',outcome:'loss',game_mode:mode,classification:'unclassified',deck:{card_ids:ids}});
 assert.equal(api.coachProactiveHint(p,ids,[row(1),row(1),row(2)],null,now),null);
 assert.equal(api.coachProactiveHint(p,ids,[row(1),row(2,'Event'),row(3)],null,now),null);
 assert.equal(api.coachProactiveHint(p,ids,[row(1),row(2),row(3)],null,now+8*86400000),null);
 const hint=api.coachProactiveHint(p,ids,[row(1),row(2),row(3)],null,now);
 assert.equal(hint.kind,'battle');
 const session=api.createCoachHintSession();assert.equal(session.visible(p.tag,hint),hint);
 assert.equal(session.dismiss(p.tag,hint),true);assert.equal(session.visible(p.tag,hint),null);
 assert.equal(session.visible('#OTHER123',hint),hint);
 assert.equal(api.createCoachHintSession().visible(p.tag,hint),hint);
});
test('proactive practice review is prioritized only with opted-in structured memory',()=>{
 const ids=[1,2,3,4,5,6,7,8],p={tag:'#TEST123'},memory=api.createCoachMemory(memoryStorage());
 memory.setEnabled(p.tag,true);memory.recordPractice(p.tag,'style',ids,null,null);
 assert.equal(api.coachProactiveHint(p,ids,[],memory.read(p.tag)),null);
 memory.addPracticeProgress(p.tag,{matched_records:5,outcomes:{wins:2,losses:3,draws:0,unknown:0}},'2090-01-01T00:00:00Z');
 assert.equal(api.coachProactiveHint(p,ids,[],memory.read(p.tag)).action,'review');
 memory.setEnabled(p.tag,false);
 assert.equal(api.coachProactiveHint(p,ids,[],memory.read(p.tag)),null);
});

function fakeCapture(surface='window'){
 let time=0,callback=null,stopped=0,ended=null,attached=0,detached=0;
 const track={readyState:'live',getSettings:()=>({displaySurface:surface}),stop(){stopped++;},addEventListener(name,fn){ended=fn;}};
 const stream={getVideoTracks:()=>[track],getAudioTracks:()=>[],getTracks:()=>[track]};
 const deps={request:async()=>stream,attach:async()=>{attached++;},detach:()=>{detached++;},sample:()=>({width:2,height:2,data:{byteLength:16}}),now:()=>time,schedule:fn=>{callback=fn;return 1;},cancel:()=>{callback=null;}};
 return {deps,stream,advance(ms){time+=ms;callback?.();},end(){ended?.();},stats:()=>({stopped,attached,detached})};
}
test('capture uses explicit request, samples bounded frames only and releases tracks on stop',async()=>{
 const mock=fakeCapture(),capture=api.createBattleCapture(mock.deps);
 assert.equal(capture.summary().state,'idle');assert.equal(mock.stats().attached,0);
 assert.equal(await capture.start(),true);assert.equal(capture.summary().frames,1);assert.equal(capture.frame(0),null);
 mock.advance(1000);assert.equal(capture.summary().frames,1);
 mock.advance(1000);assert.equal(capture.summary().frames,2);
 mock.advance(240000);assert.equal(capture.summary().state,'ready');assert.equal(capture.summary().reason,'limit');
 assert.equal(mock.stats().stopped,1);assert.equal(capture.frame(1).at_ms,2000);assert.equal(capture.summary().replay_analyzed,false);
 capture.discard();assert.equal(capture.frame(0),null);assert.equal(capture.summary().bytes,0);
});
test('capture rejects monitor, permission denial, unsupported devices and late permission after discard',async()=>{
 const monitor=fakeCapture('monitor'),a=api.createBattleCapture(monitor.deps);
 assert.equal(await a.start(),false);assert.equal(a.summary().reason,'surface');assert.equal(monitor.stats().stopped,1);
 const missing=api.createBattleCapture({});assert.equal(await missing.start(),false);assert.equal(missing.summary().reason,'unsupported');
 const m=fakeCapture(),denied=api.createBattleCapture({...m.deps,request:async()=>{throw {name:'NotAllowedError'};}});
 assert.equal(await denied.start(),false);assert.equal(denied.summary().reason,'denied');
 let resolve;const pending=api.createBattleCapture({...m.deps,request:()=>new Promise(r=>resolve=r)});
 const task=pending.start();pending.discard();resolve(m.stream);
 assert.equal(await task,false);assert.equal(m.stats().stopped,1);assert.equal(m.stats().attached,0);
});
test('capture stops on source end or byte budget and disallows unsupported observations',async()=>{
 const m=fakeCapture(),capture=api.createBattleCapture({...m.deps,sample:()=>({width:320,height:320,data:{byteLength:320*320*4}})});
 await capture.start();for(let i=0;i<80;i++)m.advance(2000);
 assert.equal(capture.summary().state,'ready');assert.ok(capture.summary().bytes<=api.CAPTURE_LIMITS.maxBytes);
 const n=fakeCapture(),ended=api.createBattleCapture(n.deps);await ended.start();n.end();assert.equal(ended.summary().reason,'ended');assert.equal(n.stats().stopped,1);
 const v={version:1,replay_analyzed:false,observations:[{kind:'unit_visible',status:'unverified',at_ms:2000,card_id:1,x:.5,y:.4}]};
 assert.ok(api.validateBattleObservations(v,[1],[2000]));
 for(const o of [{...v.observations[0],card_id:2},{...v.observations[0],status:'verified'},{...v.observations[0],at_ms:3000},{...v.observations[0],x:2},{...v.observations[0],claim:'mistake'}])assert.equal(api.validateBattleObservations({...v,observations:[o]},[1],[2000]),null);
 assert.equal(api.validateBattleObservations({...v,replay_analyzed:true},[1],[2000]),null);
});
