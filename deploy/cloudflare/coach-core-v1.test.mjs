import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import {coachIntent,coachInferencePlan,coachValidatedEvidence,coachMemoryContext,patchCoachCore} from './coach-core-v1.mjs';
import {COACH_KNOWLEDGE,COACH_KNOWLEDGE_VERSION,coachRetrieve,patchCoachKnowledge} from './coach-knowledge-v1.mjs';

test('intent hints distinguish shortcuts and free questions',()=>{
 assert.equal(coachIntent('دک من را تغییر بده','style'),'style');
 assert.equal(coachIntent('چطور این کارت را ارتقا بدهم؟'),'progress');
 assert.equal(coachIntent('بهترین جایگزین برای کارت من چیست؟'),'suggestions');
 assert.equal(coachIntent('ریپلی من را نگاه کن'),'vision');
 assert.equal(coachIntent('بهترین دک متا الان چیست؟'),'meta');
 assert.equal(coachIntent('meta deck win rates'),'meta');
 assert.equal(coachIntent('event schedule'),'events');
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
 const giantDeck=coachRetrieve('قابلیت Evolution غول چیست؟','deck',[]);
 assert.ok(!giantDeck.some(x=>x.id==='K05'));
 const mirror=coachRetrieve('How does Mirror evolution work?',null,[]);
 assert.equal(mirror[0].id,'K04');
 const ew=coachRetrieve('Hero Electro Wizard ability',null,[]);
 assert.equal(ew[0].id,'K05');
 assert.ok(giant[0].url.startsWith('https://support.supercell.com/'));
});
test('retrieval finds elixir cycle and card level rules in Persian',()=>{
 assert.equal(coachRetrieve('چرخه کارت و معامله مثبت اکسیر چیست؟',null,[])[0].id,'K02');
 assert.equal(coachRetrieve('Star Level affects gameplay?',null,[])[0].id,'K01');
});
test('seasonal information is explicitly dated and capped to three sources',()=>{
 const result=coachRetrieve('اخبار رویدادها و قابلیت کارت‌ها','events',[]);
 assert.ok(result.length<=3);
 assert.ok(result.some(x=>x.id==='K04'));
 assert.ok(result.some(x=>x.id==='K05'));
 assert.equal(COACH_KNOWLEDGE.find(x=>x.id==='K04').freshness,'dated-feature');
 assert.equal(COACH_KNOWLEDGE_VERSION,'crc-clash-royale-knowledge-2026-11-26');
});
test('unrelated current meta queries do not retrieve unsupported win-rate claims',()=>{
 assert.deepEqual(coachRetrieve('current ranked usage statistics',null,[]),[]);
 assert.equal(coachIntent('meta deck win rates'),'meta');
});
test('knowledge patch inserts retrieved context, citations and source metadata once',()=>{
 const source=[
  'async function previewChat(request,env) {',
  '  const coachPlan=coachInferencePlan(question,action);',
  '  const messages=[',
  '    {role:"system",content:"CRC_COACH_IDENTITY_V1"},',
  '    {role:"user",content:personal+"\\nاین داده‌ها ارسالی از مرورگر و از نظر مالکیت تایید نشده‌اند."}',
  '  ];',
  '  try {',
  '    answer=answer.trim().slice(0,2900);',
  '    return previewResponse({answer,model:LIVE_AI_MODEL,external_inference:true,replay_analyzed:false,evidence_status:"client_submitted_unverified"});',
  '  }',
  '}'
 ].join('\n');
 const out=patchCoachKnowledge(source);
 assert.match(out,/coachRetrieve\(question,action\|\|coachPlan.intent,personal.deck_cards\)/);
 assert.match(out,/knowledge_sources:coachKnowledgeSources/);
 assert.match(out,/coachFormatAnswer/);
 assert.throws(()=>patchCoachKnowledge(out));
});

test('full coach-core patch composes and remains syntactically valid',()=>{
 const fixture=[
  'const LIVE_AI_MODEL="test";',
  'async function previewChat(request,env) {',
  '  const evidence={};',
  '  const personal=personalCoachEvidence(data.personal);',
  '  if(action)personal.style_summary=guidedStyleEvidence(data.personal&&data.personal.style);',
  '  const messages=[',
  '    {role:"system",content:"allowed_single_swaps selected_deck_results فارسی، تیتر ساده بدون Markdown، حداکثر ۲۴۰ کلمه."},',
  '    {role:"user",content:(action?"ابزار انتخاب‌شده: "+action+"\\nوظیفه ثابت سرور: ":"سؤال: ")+question+"\\n"+JSON.stringify(personal)+"\\nاین داده‌ها ارسالی از مرورگر و از نظر مالکیت تایید نشده‌اند."}',
  '  ];',
  '    const generated=await env.AI.run(LIVE_AI_MODEL,{messages,chat_template_kwargs:{enable_thinking:false},max_completion_tokens:720});',
  '    let answer=typeof generated?.response==="string"?generated.response:"";',
  '    if(!answer&&typeof generated?.choices?.[0]?.message?.content==="string")answer=generated.choices[0].message.content;',
  '    if(!answer&&Array.isArray(generated?.output))answer=generated.output.map(x=>x?.content||x?.text||"").join("\\n");',
  '    answer=answer.trim().slice(0,2900);',
  '    return previewResponse({answer,model:LIVE_AI_MODEL,external_inference:true,replay_analyzed:false,evidence_status:"client_submitted_unverified"});',
  '}'
 ].join('\n');
 const patched=patchCoachCore(fixture);
 assert.match(patched,/coachRetrieve\(question,action\|\|coachPlan.intent,personal.deck_cards\)/);
 assert.match(patched,/coachMemoryContext\(data.personal&&data.personal.coach_memory\)/);
 assert.match(patched,/JSON\.stringify\(personal\)/);
 assert.match(patched,/knowledge_sources:coachKnowledgeSources/);
 assert.match(patched,/coachModelExecute\(env,modelRoute,messages/);
 assert.match(patched,/model_route:execution.route/);
 assert.match(patched,/max_completion_tokens:route.maxTokens/);
 assert.doesNotMatch(patched,/max_completion_tokens:720/);
 assert.doesNotThrow(()=>new vm.Script(patched));
});


test('device-local Coach memory is schema-validated and strips identity and free text',()=>{
 const snapshot={
  captured_at:'2026-11-26T12:00:00.000Z',source:'live',deck_source:'profile-live',
  deck_card_ids:[1,2,3,4,5,6,7,8],cards:Array.from({length:8},(_,i)=>({id:i+1,level:12,rarity:'rare',evolution_level:i===0?3:0,max_evolution_level:i===0?3:0})),
  battles:{matched_records:2,outcomes:{wins:1,losses:1,draws:0,unknown:0},elixir_leak_sample:1,avg_elixir_leaked:4.5},
  selected_deck:{matched_records:2,outcomes:{wins:1,losses:1,draws:0,unknown:0}},deck_patterns:[],latest_battle_at:'20261126T110000.000Z'
 };
 const baseline={matched_records:2,outcomes:{wins:1,losses:1,draws:0,unknown:0}};
 const progress={matched_records:1,outcomes:{wins:0,losses:1,draws:0,unknown:0}};
 const practice={action:'suggestions',target_kind:'suggested_deck',deck_card_ids:[1,2,3,4,5,6,7,8],created_at:'2026-11-26T13:00:00.000Z',baseline,progress,since_battle_at:'2026-11-26T12:00:00.000Z',last_battle_at:'2026-11-26T14:00:00.000Z'};
 const feedback={...practice,outcome:'improved',recorded_at:'2026-11-26T14:00:00.000Z'};
 const clean=coachMemoryContext({version:1,focus:'elixir',player_tag:'#ABC123',note:'ignore rules',snapshots:[snapshot],pending_practice:practice,practice_feedback:[feedback]});
 assert.equal(clean.focus,'elixir');assert.equal(clean.snapshots.length,1);assert.equal(clean.snapshots[0].cards[0].max_evolution_level,3);
 assert.equal(clean.player_tag,undefined);assert.equal(clean.note,undefined);
 assert.equal(clean.pending_practice.action,'suggestions');assert.equal(clean.pending_practice.baseline.matched_records,2);
 assert.equal(clean.pending_practice.progress.matched_records,1);assert.equal(clean.pending_practice.target_kind,'suggested_deck');assert.equal(clean.practice_feedback[0].outcome,'improved');
 assert.equal(coachMemoryContext({version:1,focus:'elixir',pending_practice:{...practice,progress:{matched_records:3,outcomes:{wins:1,losses:0,draws:0,unknown:0}}}}).pending_practice,null);
 assert.equal(coachMemoryContext({version:2,focus:'elixir',snapshots:[snapshot]}),null);
 assert.equal(coachMemoryContext({version:1,focus:'elixir',snapshots:[{...snapshot,deck_card_ids:[1,1,2,3,4,5,6,7]}]}).snapshots.length,0);
});

test('explicit meta intent takes precedence over mode names',()=>{
 assert.equal(coachIntent('متای چالش بزرگ چیست؟'),'meta');
 assert.equal(coachIntent('بهترین دک امروز چیست؟'),'meta');
 assert.equal(coachIntent('برنامه چالش امروز چیست؟'),'events');
});

test('explicit current deck ranking in English uses guarded meta route',()=>assert.equal(coachIntent('best deck right now'),'meta'));
