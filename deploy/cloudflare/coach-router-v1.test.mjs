import assert from 'node:assert/strict';
import test from 'node:test';
import {COACH_FAST_MODEL_ID,COACH_MODEL_ROUTER_VERSION,coachModelPlan,coachModelText,coachModelExecute,patchCoachRouter} from './coach-router-v1.mjs';

const GEMMA='@cf/google/gemma-4-26b-a4b-it';
const fastEnv={COACH_FAST_MODEL:COACH_FAST_MODEL_ID,AI:{run:async()=>({response:'{"answer":"ok"}'})}};
const plan=(intent='general',maxTokens=720)=>({intent,maxTokens});
test('default route keeps the verified Gemma model when no explicit fast-model config exists',()=>{
 const r=coachModelPlan('سلام',plan('general',240),null,{},GEMMA);
 assert.equal(r.route,'quality');assert.equal(r.primary,GEMMA);assert.equal(r.fallback,null);
});
test('fast route is limited to exact trivial messages and an allowlisted explicit config',()=>{
 const r=coachModelPlan('سلام',plan('general',720),null,fastEnv,GEMMA);
 assert.equal(r.route,'fast');assert.equal(r.primary,COACH_FAST_MODEL_ID);assert.equal(r.fallback,GEMMA);assert.equal(r.maxTokens,240);
 for(const q of ['تحلیل دک من','بهترین دک چیست؟','سلام دکم را بررسی کن'])assert.equal(coachModelPlan(q,plan('general'),null,fastEnv,GEMMA).route,'quality');
 assert.equal(coachModelPlan('سلام',plan('deck'),null,fastEnv,GEMMA).route,'quality');
 assert.equal(coachModelPlan('سلام',plan('general'),null,{COACH_FAST_MODEL:'@cf/unknown/model'},GEMMA).primary,GEMMA);
});
test('model execution requests provider JSON mode and keeps reasoning disabled',async()=>{
 let options=null;const env={AI:{run:async(_model,value)=>{options=value;return {response:'{"answer":"ok","swap_index":null,"fact_keys":[],"source_ids":[]}'};}}};
 const route={primary:GEMMA,fallback:null,maxTokens:240,route:'quality',retryOnQuality:false};
 await coachModelExecute(env,route,[],{},()=>({status:'checked_structure',answer:'ok'}));
 assert.deepEqual(options.response_format,{type:'json_object'});assert.equal(options.chat_template_kwargs.enable_thinking,false);
});
test('only one allowlisted fallback is attempted after a primary upstream failure',async()=>{
 const calls=[];const env={AI:{run:async model=>{calls.push(model);if(model===COACH_FAST_MODEL_ID)throw new Error('temporary');return {response:'{"answer":"ok"}'};}}};
 const route=coachModelPlan('سلام',plan('general'),null,fastEnv,GEMMA);
 const result=await coachModelExecute(env,route,[],{},()=>({status:'checked_structure',answer:'ok'}));
 assert.deepEqual(calls,[COACH_FAST_MODEL_ID,GEMMA]);assert.equal(result.model,GEMMA);assert.equal(result.fallbackUsed,true);
});
test('one schema-only retry uses the quality model and accepts only its validated response',async()=>{
 const calls=[];const env={AI:{run:async model=>{calls.push(model);return {response:model===COACH_FAST_MODEL_ID?'bad json':'{"answer":"valid"}'};}}};
 let evaluations=0;const evaluate=raw=>{evaluations++;return raw==='bad json'?{status:'limited',reason:'INVALID_JSON',answer:'limited'}:{status:'checked_structure',answer:'valid'};};
 const route=coachModelPlan('سلام',plan('general'),null,fastEnv,GEMMA);
 const result=await coachModelExecute(env,route,[],{},evaluate);
 assert.deepEqual(calls,[COACH_FAST_MODEL_ID,GEMMA]);assert.equal(evaluations,2);assert.equal(result.quality.answer,'valid');assert.equal(result.fallbackUsed,true);
});
test('semantic or unsupported-rate limitations do not trigger a second model call',async()=>{
 let calls=0;const env={AI:{run:async()=>{calls++;return {response:'some output'};}}};
 const route=coachModelPlan('سلام',plan('general'),null,fastEnv,GEMMA);
 const result=await coachModelExecute(env,route,[],{},()=>({status:'limited',reason:'UNVERIFIED_RATE_IN_PROSE',answer:'safe'}));
 assert.equal(calls,1);assert.equal(result.quality.status,'limited');assert.equal(result.fallbackUsed,false);
});
test('model output parser supports the verified Workers AI response shapes',()=>{
 assert.equal(coachModelText({response:'hello'}),'hello');
 assert.equal(coachModelText({choices:[{message:{content:'hi'}}]}),'hi');
 assert.equal(coachModelText({output:[{text:'a'},{content:'b'}]}),'a\nb');
 assert.equal(coachModelText({}), '');
 assert.equal(COACH_MODEL_ROUTER_VERSION,'crc-coach-model-router-v1');
});
test('router patch is fail-closed and inserts route metadata once',()=>{
 const fixture=[
  'async function previewChat(request,env) {',
  '  try {',
  '    const generated=await env.AI.run(LIVE_AI_MODEL,{messages,chat_template_kwargs:{enable_thinking:false},max_completion_tokens:coachPlan.maxTokens});',
  '    let answer=typeof generated?.response==="string"?generated.response:"";',
  '    if(!answer&&typeof generated?.choices?.[0]?.message?.content==="string")answer=generated.choices[0].message.content;',
  '    if(!answer&&Array.isArray(generated?.output))answer=generated.output.map(x=>x?.content||x?.text||"").join("\\n");',
  '    const quality=coachQualityEvaluate(answer,{battles:evidence,personal,docs:retrievedKnowledge,intent:coachPlan.intent});',
  '    answer=quality.answer;',
  '    answer=answer.trim().slice(0,2900);',
  '    return previewResponse({answer,model:LIVE_AI_MODEL,external_inference:true,replay_analyzed:false,evidence_status:"client_submitted_unverified",knowledge_version:COACH_KNOWLEDGE_VERSION,knowledge_sources:coachKnowledgeSources(quality.sources),quality_version:QUALITY_VERSION,quality_status:quality.status,quality_checks:quality.checks});',
  '  }',
  '}'
 ].join('\n');
 const out=patchCoachRouter(fixture);
 assert.match(out,/coachModelPlan\(question,coachPlan,action,env,LIVE_AI_MODEL\)/);
 assert.match(out,/model:selectedModel,model_route:execution.route/);
 assert.doesNotMatch(out,/env\.AI\.run\(LIVE_AI_MODEL/);
 assert.throws(()=>patchCoachRouter(out));
});

test('parsed JSON response is serialized without bypassing the quality gate',()=>{
 const response={answer:'راهنما',swap_index:null,fact_keys:[],source_ids:[]};
 assert.deepEqual(JSON.parse(coachModelText({response})),response);
 assert.equal(coachModelText({response:{...response,extra:'unknown'}}),'');
 assert.equal(coachModelText({response:[]}), '');
});
