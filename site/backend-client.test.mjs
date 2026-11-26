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
