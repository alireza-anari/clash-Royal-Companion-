import test from 'node:test';
import assert from 'node:assert/strict';
import {visionFramePlan,visionObservation,visionPrompt,visionCost,runVisionLab,visionReport,evaluateVisionFrames,VISION_VERSION} from './coach-vision-v1.mjs';
const model='@cf/google/gemma-4-26b-a4b-it',cards=[{id:1,name:'Knight'},{id:2,name:'Archer'}];
const unknown={screen:'unknown',game_clock_s:null,elixir:null,hand:[],units:[]};
const battle={screen:'battle',game_clock_s:120,elixir:5,hand:[1],units:[{card_id:2,x:.4,y:.5,side:'opponent'}]};
const frame=at_ms=>({at_ms,bytes:Uint8Array.from([255,216,1,2,3,4,5,6,7,8,255,217]),mime:'image/jpeg',width:180,height:320});
test('bounded sampling is deterministic and rejects duplicate or out of order times',()=>{
 const times=Array.from({length:120},(_,i)=>i*2000),p=visionFramePlan(times);
 assert.equal(p.length,8);assert.equal(p[0],0);assert.equal(p.at(-1),238000);
 assert.throws(()=>visionFramePlan([0,0]));assert.throws(()=>visionFramePlan([2000,0]));assert.throws(()=>visionFramePlan([240000]));
});
test('only visible structured observations are accepted; no claimed moves or extra prose',()=>{
 assert.deepEqual(visionObservation(JSON.stringify(battle),cards),battle);
 assert.ok(visionObservation(unknown,cards));assert.match(visionPrompt(cards),/untrusted/);
 for(const bad of [{...battle,elixir:11},{...battle,hand:[99]},{...battle,hand:[1,1]},{...battle,screen:'other'},{...battle,game_clock_s:-1},{...battle,units:[{...battle.units[0],x:2}]},{...battle,units:[{...battle.units[0],deployed:true}]},{...battle,confidence:1}])assert.equal(visionObservation(bad,cards),null);
 assert.equal(visionObservation('Here is JSON: '+JSON.stringify(battle),cards),null);
});
test('lab is disabled without explicit reviewed sample approval, validates batch before calling and bounds calls',async()=>{
 let calls=0;const adapter=async request=>{calls++;assert.equal(request.max_output_tokens,384);assert.equal(request.model,model);return {output:JSON.stringify(battle),usage:{input_tokens:1000,output_tokens:100}};};
 const input={model,cards,frames:Array.from({length:10},(_,i)=>frame(i*2000)),adapter,approvedReviewedSample:true,allowExternalInference:true};
 await assert.rejects(runVisionLab({...input,allowExternalInference:false}),/DISABLED/);assert.equal(calls,0);
 await assert.rejects(runVisionLab({...input,frames:[frame(0),{...frame(1000),mime:'image/svg+xml'}]}),/INVALID_FRAME_IMAGE/);assert.equal(calls,0);
 const result=await runVisionLab(input);assert.equal(calls,8);assert.equal(result.replay_analyzed,false);
 assert.equal(result.results.length,8);assert.ok(Math.abs(result.token_price_equivalent_usd-8*visionCost(model,{input_tokens:1000,output_tokens:100}))<1e-10);
 const report=visionReport(result,cards);assert.equal(report.timeline[0].units[0].name,'Archer');assert.equal(report.readable_battle_frames,8);assert.match(report.limitation_fa,/تأییدنشده/);
});
test('missing usage or provider failure stops remaining calls and marks unprocessed frames',async()=>{
 const input={model,cards,frames:[frame(0),frame(2000),frame(4000)],approvedReviewedSample:true,allowExternalInference:true};
 const bad=await runVisionLab({...input,adapter:async()=>({output:'invalid'})});assert.equal(bad.calls,1);assert.equal(bad.token_price_equivalent_usd,null);
 const report=visionReport(bad,cards);assert.equal(report.timeline[0].status,'invalid_output');assert.equal(report.timeline[1].status,'not_processed');
 const failure=await runVisionLab({...input,adapter:async()=>{throw Error('private data');}});assert.equal(failure.calls,1);assert.equal(failure.results[0].status,'provider_error');assert.ok(!JSON.stringify(failure).includes('private data'));
 assert.throws(()=>visionReport({...bad,results:[{at_ms:9000,status:'unverified',observation:battle}]},cards));
});
test('evaluation penalizes abstention, wrong units, false reads and malformed predictions separately',()=>{
 const rows=[{id:'one',reviewed:true,truth:battle,prediction:battle},{id:'two',reviewed:true,truth:battle,prediction:unknown},{id:'three',reviewed:true,truth:{...battle,elixir:null,game_clock_s:null},prediction:{...battle,hand:[2],units:[{...battle.units[0],x:.9}]}},{id:'four',reviewed:true,truth:unknown,prediction:'bad'}];
 const r=evaluateVisionFrames(rows,cards);assert.equal(r.counts.frames,4);assert.equal(r.counts.invalid,1);assert.equal(r.elixir.coverage,.5);assert.equal(r.elixir.exact_all_labeled,.5);assert.equal(r.counts.elixir_false_reads,1);assert.equal(r.counts.hand_tp,1);assert.equal(r.counts.hand_fn,2);assert.equal(r.counts.unit_fp,1);assert.equal(r.units.recall,1/3);
 assert.throws(()=>evaluateVisionFrames([...rows,rows[0]],cards));assert.throws(()=>evaluateVisionFrames([{...rows[0],reviewed:false}],cards));
});
