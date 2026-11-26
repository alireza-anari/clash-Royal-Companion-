import assert from 'node:assert/strict';
import test from 'node:test';
import {coachIntent,coachInferencePlan,coachValidatedEvidence,patchCoachCore} from './coach-core-v1.mjs';
import {COACH_KNOWLEDGE,COACH_KNOWLEDGE_VERSION,coachRetrieve,patchCoachKnowledge} from './coach-knowledge-v1.mjs';

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

test('official knowledge retrieval ranks current Giant and Mirror mechanics',()=>{
 const giant=coachRetrieve('قابلیت Evolution غول چیست؟',null,[]);
 assert.equal(giant[0].id,'K04');
 const mirror=coachRetrieve('How does Mirror evolution work?',null,[]);
 assert.equal(mirror[0].id,'K04');
 assert.ok(giant[0].url.startsWith('https://support.supercell.com/'));
});
test('retrieval finds elixir cycle and card level rules in Persian',()=>{
 assert.equal(coachRetrieve('چرخه کارت و معامله مثبت اکسیر چیست؟',null,[])[0].id,'K02');
 assert.equal(coachRetrieve('Star Level affects gameplay?',null,[])[0].id,'K01');
});
test('seasonal information is explicitly dated and capped to three sources',()=>{
 const result=coachRetrieve('اخبار رویدادها و قابلیت کارت‌ها','events',[]);
 assert.ok(result.length<=3);
 assert.ok(result.some(x=>x.id==='K04'||x.id==='K05'));
 assert.equal(COACH_KNOWLEDGE.find(x=>x.id==='K04').freshness,'dated-feature');
 assert.equal(COACH_KNOWLEDGE_VERSION,'crc-clash-royale-knowledge-2026-11-26');
});
test('unrelated current meta queries do not retrieve unsupported win-rate claims',()=>{
 assert.deepEqual(coachRetrieve('current ranked usage statistics',null,[]),[]);
});
test('knowledge patch inserts retrieved context, citations and source metadata once',()=>{
 const source=String.raw\`async function previewChat(request,env) {
  const coachPlan=coachInferencePlan(question,action);
  const messages=[
    {role:"system",content:"CRC_COACH_IDENTITY_V1"},
    {role:"user",content:personal+"\\nاین داده‌ها ارسالی از مرورگر و از نظر مالکیت تایید نشده‌اند."}
  ];
  try {
    answer=answer.trim().slice(0,2900);
    return previewResponse({answer,model:LIVE_AI_MODEL,external_inference:true,replay_analyzed:false,evidence_status:"client_submitted_unverified"});
  }
}\`;
 const out=patchCoachKnowledge(source);
 assert.match(out,/coachRetrieve\\(question,action,personal.deck_cards\\)/);
 assert.match(out,/knowledge_sources:coachKnowledgeSources/);
 assert.match(out,/coachFormatAnswer/);
 assert.throws(()=>patchCoachKnowledge(out));
});
