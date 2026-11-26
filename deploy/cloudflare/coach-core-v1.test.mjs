import assert from 'node:assert/strict';
import test from 'node:test';
import {coachIntent,coachInferencePlan,coachValidatedEvidence,patchCoachCore} from './coach-core-v1.mjs';
test('intent hints distinguish shortcuts and free questions',()=>{
 assert.equal(coachIntent('دک من را تغییر بده','style'),'style');
 assert.equal(coachIntent('چطور این کارت را ارتقا بدهم؟'),'progress');
 assert.equal(coachIntent('بهترین جایگزین برای کارت من چیست؟'),'suggestions');
 assert.equal(coachIntent('ریپلی من را نگاه کن'),'vision');
 assert.equal(coachInferencePlan('سلام').maxTokens,240);
 assert.equal(coachInferencePlan('سلام، دک من را تحلیل کن').maxTokens,720);
});
test('reject inconsistent totals and selected deck counts outside overall sample',()=>{
 const overall={matched_records:4,wins:2,losses:1,draws:0,unknown:1,filter:'all'};
 const personal={deck_cards:Array.from({length:8},(_,i)=>({id:i+1})),selected_deck_results:{wins:2,losses:0,draws:0,unknown:0},opponent_card_patterns:[1]};
 assert.deepEqual(coachValidatedEvidence(overall,personal).personal.selected_deck_results,personal.selected_deck_results);
 assert.deepEqual(coachValidatedEvidence({...overall,matched_records:5},personal).battles,{});
 const invalid=coachValidatedEvidence(overall,{...personal,selected_deck_results:{...personal.selected_deck_results,wins:3}});
 assert.equal(invalid.personal.selected_deck_results,null);
 assert.deepEqual(invalid.personal.opponent_card_patterns,[]);
});
test('candidate patch refuses unknown worker sources',()=>assert.throws(()=>patchCoachCore('unknown')));
