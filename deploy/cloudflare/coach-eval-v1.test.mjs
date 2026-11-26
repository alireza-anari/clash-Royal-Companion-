import assert from 'node:assert/strict';
import test from 'node:test';
import {loadCoachEval,coachEvalBuildMessages,coachEvalEstimateCost,coachEvalScore,coachEvalValidateCases,COACH_EVAL_MODELS} from './run-coach-eval-v1.mjs';

test('evaluation corpus has the requested 60 synthetic scenarios in five balanced groups',async()=>{
 const data=await loadCoachEval(),v=coachEvalValidateCases(data);
 assert.equal(v.ok,true);
 assert.equal(v.total,60);
 assert.deepEqual(v.counts,{deck:20,battle:10,swap:10,'evolution-hero':10,'meta-events':10});
 assert.equal(data.models.primary,COACH_EVAL_MODELS[0].id);
 assert.equal(data.models.candidate,COACH_EVAL_MODELS[1].id);
});
test('all prompts use synthetic, unverified evidence and a strict four-key response contract',async()=>{
 const data=await loadCoachEval();
 for(const s of data.scenarios){
  const b=coachEvalBuildMessages(data,s);
  assert.equal(b.messages.length,2);
  assert.match(b.messages[0].content,/JSON معتبر/);
  assert.match(b.messages[1].content,/ساختگی/);
  assert.match(b.messages[1].content,/سؤال بازیکن/);
  assert.equal(b.context.evidence_status,'client_submitted_unverified');
 }
});
test('the scoring rubric accepts a structurally valid evidence-backed deck answer',async()=>{
 const data=await loadCoachEval(),s=data.scenarios.find(x=>x.id==='D04');
 const raw=JSON.stringify({answer:'Star Level فقط ظاهر کارت را تغییر می‌دهد و روی گیم‌پلی اثر ندارد.',swap_index:null,fact_keys:[],source_ids:['K01']});
 const r=coachEvalScore(data,s,raw);
 assert.equal(r.qualityStatus,'checked_structure');
 assert.equal(r.passed,true);
 assert.equal(r.score,100);
});
test('the scoring rubric rejects malformed JSON and reports a limited quality status',async()=>{
 const data=await loadCoachEval(),s=data.scenarios.find(x=>x.id==='D04');
 const r=coachEvalScore(data,s,'not-json');
 assert.equal(r.qualityStatus,'limited');
 assert.equal(r.score,0);
 assert.equal(r.passed,false);
});
test('suggestion scoring requires the exact safe allowlisted swap index',async()=>{
 const data=await loadCoachEval(),s=data.scenarios.find(x=>x.id==='S01');
 const good=coachEvalScore(data,s,JSON.stringify({answer:'',swap_index:0,fact_keys:[],source_ids:[]}));
 const bad=coachEvalScore(data,s,JSON.stringify({answer:'',swap_index:1,fact_keys:[],source_ids:[]}));
 assert.equal(good.passed,true);
 assert.equal(good.score,100);
 assert.equal(bad.passed,false);
 assert.equal(bad.checks.find(x=>x.name==='safe_swap_selection').pass,false);
});
test('protected evolution form and empty candidate fixtures fail closed',async()=>{
 const data=await loadCoachEval();
 for(const id of ['S07','S08','S09']){
  const s=data.scenarios.find(x=>x.id===id);
  const r=coachEvalScore(data,s,JSON.stringify({answer:'در داده فعلی پیشنهاد تعویض تأییدشده‌ای ندارم؛ فرم محافظت‌شده را حذف نمی‌کنم.',swap_index:null,fact_keys:[],source_ids:[]}));
  assert.equal(r.qualityStatus,'checked_structure',id);
  assert.equal(r.checks.find(x=>x.name==='safe_swap_selection').pass,true,id);
 }
});
test('meta quality gate overwrites unsupported current-meta prose with a limited answer',async()=>{
 const data=await loadCoachEval(),s=data.scenarios.find(x=>x.id==='M01');
 const r=coachEvalScore(data,s,JSON.stringify({answer:'این دک قطعاً بهترین متای امروز است و نرخ برد بالایی دارد.',swap_index:null,fact_keys:[],source_ids:[]}));
 assert.equal(r.qualityStatus,'checked_structure');
 assert.equal(r.checks.find(x=>x.name==='abstention_when_required').pass,true);
 assert.doesNotMatch(r.answer,/قطعاً بهترین متای امروز/);
});
test('citation scoring requires retrieved official source identifiers',async()=>{
 const data=await loadCoachEval(),s=data.scenarios.find(x=>x.id==='E01');
 const good=coachEvalScore(data,s,JSON.stringify({answer:'برای بازکردن Evolution به شش Evolution Shard همان کارت نیاز است.',swap_index:null,fact_keys:[],source_ids:['K03']}));
 const bad=coachEvalScore(data,s,JSON.stringify({answer:'برای بازکردن Evolution به شش Evolution Shard همان کارت نیاز است.',swap_index:null,fact_keys:[],source_ids:[]}));
 assert.equal(good.checks.find(x=>x.name==='source_attribution').pass,true);
 assert.equal(bad.checks.find(x=>x.name==='source_attribution').pass,false);
});
test('cost estimate is capped, reproducible and uses official allowlisted model rates',async()=>{
 const data=await loadCoachEval(),estimate=coachEvalEstimateCost(data);
 assert.ok(estimate.totalEstimatedUsd>0);
 assert.ok(estimate.totalEstimatedUsd<0.10);
 assert.equal(estimate.byModel[COACH_EVAL_MODELS[0].id].outputTokenCap,60*220);
 assert.equal(COACH_EVAL_MODELS[0].inputUsdPerMillion,0.10);
 assert.equal(COACH_EVAL_MODELS[1].outputUsdPerMillion,0.40);
});
