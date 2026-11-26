import assert from 'node:assert/strict';
import test from 'node:test';
import {coachQualityFacts,coachQualitySwap,coachQualityEvaluate,patchCoachQuality} from './coach-quality-v1.mjs';

const deck=Array.from({length:8},(_,i)=>({id:i+1,name:'Card '+(i+1),elixir:3,active_form:'base',rarity:'common'}));
const pair={remove:'Card 1',add:'Musketeer',remove_id:1,add_id:20,elixir_delta:1,level_gap:0,gain:['air'],loss:['splash']};
const personal={deck_cards:deck,allowed_single_swaps:[pair],selected_deck_results:{wins:2,losses:1,draws:0,unknown:1}};
const battles={matched_records:10,wins:5,losses:3,draws:1,unknown:1};
const docs=[{id:'K01',title:'source',url:'https://support.supercell.com/clash-royale/en/articles/example.html'}];
const ctx={personal,battles,docs,intent:'suggestions'};
const payload=(extra={})=>JSON.stringify({answer:'پیشنهاد مدل',swap_index:null,fact_keys:[],source_ids:[],...extra});
test('computed facts separate selected deck and overall and exclude unknown outcomes from denominator',()=>{
 const facts=coachQualityFacts(battles,personal);
 assert.match(facts.overall,/55\.6/);assert.match(facts.selected,/66\.7/);assert.match(facts.elixir,/3\.00/);
 assert.equal(coachQualityFacts({...battles,matched_records:11},personal).overall,undefined);
 assert.equal(coachQualityFacts(battles,{...personal,selected_deck_results:{...personal.selected_deck_results,wins:6}}).selected,undefined);
});
test('valid swap is rendered by server, not from hallucinated model advice',()=>{
 const result=coachQualityEvaluate(payload({answer:'Swap for an invented card',swap_index:0,fact_keys:['selected']}),ctx);
 assert.equal(result.status,'checked_structure');assert.match(result.answer,/حذف: Card 1/);assert.match(result.answer,/افزودن: Musketeer/);assert.doesNotMatch(result.answer,/invented/);assert.match(result.answer,/66\.7/);
});
test('reject invalid swap indices, duplicate cards, protected forms and excessive level gap',()=>{
 for(const index of [-1,1,4,0.5])assert.equal(coachQualityEvaluate(payload({swap_index:index}),ctx).status,'limited');
 assert.equal(coachQualitySwap({...personal,allowed_single_swaps:[{...pair,add_id:2}]},0),null);
 assert.equal(coachQualitySwap({...personal,deck_cards:[{...deck[0],active_form:'evo'},...deck.slice(1)]},0),null);
 assert.equal(coachQualitySwap({...personal,allowed_single_swaps:[{...pair,level_gap:-3}]},0),null);
});
test('invalid schema, invented statistics and invented references fail closed',()=>{
 for(const raw of ['not json','{}',payload({fact_keys:['fake_win_rate']}),payload({source_ids:['K99']}),payload({swap_index:0})]){
  const r=coachQualityEvaluate(raw,{...ctx,intent:'deck'});
  assert.equal(r.status,'limited');assert.equal(r.sources.length,0);assert.equal(r.swap,null);
 }
});
test('no unsupported meta or replay claims are displayed for detected intents',()=>{
 for(const intent of ['meta','vision']){
  const r=coachQualityEvaluate(payload({answer:'100% win rate and observed placement'}),{...ctx,intent});
  assert.equal(r.status,'checked_structure');assert.doesNotMatch(r.answer,/100%|observed placement/);
 }
});
test('only explicitly selected retrieved references are returned',()=>{
 const r=coachQualityEvaluate(payload({answer:'توضیح [K01] [K99]',source_ids:['K01']}),{...ctx,intent:'general'});
 assert.equal(r.sources.length,1);assert.doesNotMatch(r.answer,/K99/);
 assert.equal(coachQualityEvaluate(payload(),{...ctx,intent:'general'}).sources.length,0);
});
test('unknown worker source is rejected',()=>assert.throws(()=>patchCoachQuality('unknown')));

test('unverified numerical win-rate prose is withheld in both Persian and English',()=>{
 for(const answer of ['نرخ برد دک ۸۰٪ است','Win rate is 90%','درصد برد: ٧٥٪']){
  const r=coachQualityEvaluate(payload({answer}),{...ctx,intent:'deck'});
  assert.equal(r.status,'limited');assert.equal(r.reason,'UNVERIFIED_RATE_IN_PROSE');
 }
 const r=coachQualityEvaluate(payload({answer:'The Giant ability activates at 50% health',source_ids:['K01']}),{...ctx,intent:'general'});
 assert.equal(r.status,'checked_structure');
});

test('unverified personal battle counts and average elixir prose are withheld',()=>{
 const raw=payload({answer:'در ۲۰ نبرد ۱۱ برد و ۷ باخت داشتی. میانگین هزینه هر کارت 3.25 اکسیر است.',fact_keys:['overall','selected','elixir']});
 const r=coachQualityEvaluate(raw,{...ctx,intent:'style'});
 assert.equal(r.status,'limited');
 assert.equal(r.reason,'UNVERIFIED_PERSONAL_STATS_IN_PROSE');
 assert.match(r.answer,/میانگین اکسیر ثبت‌شده/);
 assert.doesNotMatch(r.answer,/3\.25|۱۱ برد/);
});
test('personal-stat guard allows card elixir costs and cycle counts',()=>{
 const answer='Giant با هزینه ۵ اکسیر شرط برد اصلی است؛ پس از بازی یک کارت، چهار کارت دیگر بازی می‌شود.';
 const r=coachQualityEvaluate(payload({answer,source_ids:['K01']}),{...ctx,intent:'deck'});
 assert.equal(r.status,'checked_structure');assert.equal(r.reason,null);
});
test('personal-stat guard does not block official mechanics with numbers',()=>{
 for(const answer of ['برای Evolution شش Evolution Shard لازم است.','پس از بازی یک کارت، چهار کارت دیگر باید بازی شود.','Evolution Giant در ۵۰٪ جان فعال می‌شود.']){
  const r=coachQualityEvaluate(payload({answer,source_ids:['K01']}),{...ctx,intent:'deck'});
  assert.equal(r.reason,null,answer);
 }
});

test('validated device memory is available only as an explicitly selected historical fact',()=>{
 const snapshot={
  captured_at:'2026-11-26T12:00:00.000Z',source:'live',deck_source:'profile-live',
  deck_card_ids:[1,2,3,4,5,6,7,8],cards:Array.from({length:8},(_,i)=>({id:i+1,level:12})),
  battles:{matched_records:2,outcomes:{wins:1,losses:1,draws:0,unknown:0},elixir_leak_sample:1,avg_elixir_leaked:4.5},
  selected_deck:{matched_records:2,outcomes:{wins:1,losses:1,draws:0,unknown:0}},deck_patterns:[],latest_battle_at:'20261126T110000.000Z'
 };
 const memory={version:1,focus:'elixir',snapshots:[snapshot],practice_feedback:[{action:'suggestions',deck_card_ids:[1,2,3,4,5,6,7,8],created_at:'2026-11-26T13:00:00.000Z',outcome:'improved',recorded_at:'2026-11-26T14:00:00.000Z'}]};
 const facts=coachQualityFacts(null,{coach_memory:memory});
 assert.match(facts.memory,/حافظه تاریخی محلی/);
 assert.match(facts.memory,/مدیریت اکسیر/);
 assert.match(facts.memory,/بازخورد خوداظهاری/);assert.match(facts.memory,/بهتر شد/);
 const result=coachQualityEvaluate(payload({fact_keys:['memory']}),{personal:{coach_memory:memory},battles:null,docs,intent:'style'});
 assert.equal(result.status,'checked_structure');
 assert.match(result.answer,/حافظه تاریخی محلی/);
 assert.match(result.answer,/۱ نبرد|1 نبرد/);
});
test('historical memory is not fabricated when snapshot totals are inconsistent',()=>{
 const snapshot={captured_at:'2026-11-26T12:00:00.000Z',deck_card_ids:[1,2,3,4,5,6,7,8],
  battles:{matched_records:3,outcomes:{wins:2,losses:0,draws:0,unknown:0},elixir_leak_sample:0,avg_elixir_leaked:null},
  selected_deck:{matched_records:0,outcomes:{wins:0,losses:0,draws:0,unknown:0}}};
 assert.equal(coachQualityFacts(null,{coach_memory:{version:1,focus:'balanced',snapshots:[snapshot]}}).memory,undefined);
});
