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
 assert.equal(result.status,'checked_structure');assert.match(result.answer,/Card 1 ← Musketeer/);assert.doesNotMatch(result.answer,/invented/);assert.match(result.answer,/66\.7/);
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
