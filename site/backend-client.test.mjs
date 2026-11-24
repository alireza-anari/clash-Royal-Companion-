import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const filename=path.join(path.dirname(fileURLToPath(import.meta.url)),'backend-client.js');
const ctx={};
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

test('AI consent and capability fail closed; structured evidence excludes identities',async()=>{
 const seen=[];
 const session={enabled:true,fetch:async(path,options)=>{seen.push({path,options});return {ok:true,json:async()=>({answer:'پاسخ تست',model:'@cf/google/gemma-4-26b-a4b-it',external_inference:true,replay_analyzed:false,evidence_status:'client_submitted_unverified'})};}};
 const f={errors:[],items:Array(8).fill({name:'PRIVATE_NAME'}),average:3.25,cycle:7,tag:'#SECRET'};
 const b={filter:'event',matched_records:3,outcomes:{wins:2,losses:1,draws:0,unknown:0},player_tag:'#SECRET'};
 const cap={ai_coach_enabled:true};
 await assert.rejects(api.askAI(session,'اکسیر دک من',f,b,false,cap));
 await assert.rejects(api.askAI(session,'اکسیر دک من',f,b,true,{ai_coach_enabled:false}));
 assert.equal(seen.length,0);
 const out=await api.askAI(session,'اکسیر دک من',f,b,true,cap);
 assert.equal(out.answer,'پاسخ تست');
 assert.equal(seen.length,1);
 const payload=JSON.parse(seen[0].options.body);
 assert.deepEqual(payload.deck,{selected_card_count:8,average_elixir:3.25,cycle_cost_four_cheapest:7});
 assert.equal(payload.battles.wins,2);
 assert.ok(!seen[0].options.body.includes('PRIVATE_NAME'));
 assert.ok(!seen[0].options.body.includes('#SECRET'));
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
