export const COACH_MODEL_ROUTER_VERSION='crc-coach-model-router-v1';
export const COACH_FAST_MODEL_ID='@cf/zai-org/glm-4.7-flash';
const COACH_RETRYABLE_QUALITY_FAILURES=new Set(['INVALID_JSON','INVALID_SCHEMA','UNKNOWN_FACT','UNKNOWN_SOURCE']);
export function coachModelPlan(question,inferencePlan,action,env,defaultModel){
  const q=String(question||'').trim().toLowerCase().replace(/ي/g,'ی').replace(/ك/g,'ک');
  const trivial=!action&&(inferencePlan?.intent==='general')&&/^(سلام|درود|hi|hello|ممنون|مرسی|thanks|thank you)[!؟!.،,\s]*$/i.test(q);
  const fastEnabled=env?.COACH_FAST_MODEL===COACH_FAST_MODEL_ID;
  const useFast=trivial&&fastEnabled&&defaultModel!==COACH_FAST_MODEL_ID;
  const maxTokens=Number.isInteger(inferencePlan?.maxTokens)&&inferencePlan.maxTokens>0?inferencePlan.maxTokens:720;
  return {
    route:useFast?'fast':'quality',
    primary:useFast?COACH_FAST_MODEL_ID:defaultModel,
    fallback:useFast?defaultModel:null,
    maxTokens:useFast?Math.min(maxTokens,240):maxTokens,
    retryOnQuality:useFast
  };
}
export function coachModelText(generated){
  if(typeof generated?.response==='string'&&generated.response.trim())return generated.response;
  if(typeof generated?.choices?.[0]?.message?.content==='string')return generated.choices[0].message.content;
  if(Array.isArray(generated?.output))return generated.output.map(x=>x?.content||x?.text||'').join('\n');
  return '';
}
export async function coachModelExecute(env,route,messages,context,evaluate){
  if(!env?.AI||typeof env.AI.run!=='function')throw new Error('Workers AI binding unavailable');
  const run=model=>env.AI.run(model,{messages,chat_template_kwargs:{enable_thinking:false},response_format:{type:'json_object'},max_completion_tokens:route.maxTokens});
  let model=route.primary,generated,fallbackUsed=false;
  try{generated=await run(model);}
  catch(error){
    if(!route.fallback)throw error;
    generated=await run(route.fallback);model=route.fallback;fallbackUsed=true;
  }
  let quality=evaluate(coachModelText(generated),context);
  if(!fallbackUsed&&route.fallback&&route.retryOnQuality&&quality?.status==='limited'&&COACH_RETRYABLE_QUALITY_FAILURES.has(quality.reason)){
    try{
      const retry=await run(route.fallback);
      const retryQuality=evaluate(coachModelText(retry),context);
      if(retryQuality?.status==='checked_structure'){
        generated=retry;quality=retryQuality;model=route.fallback;fallbackUsed=true;
      }
    }catch(_){
      // Keep the first safe, limited answer if the one permitted retry also fails.
    }
  }
  return {generated,quality,model,route:route.route,fallbackUsed,routerVersion:COACH_MODEL_ROUTER_VERSION};
}
export function patchCoachRouter(source){
  let s=source;
  const once=(old,nu)=>{if(s.split(old).length!==2)throw new Error('Coach router anchor mismatch: '+old.slice(0,90));s=s.replace(old,()=>nu);};
  const declarations=[
    'const COACH_MODEL_ROUTER_VERSION='+JSON.stringify(COACH_MODEL_ROUTER_VERSION)+';',
    'const COACH_FAST_MODEL_ID='+JSON.stringify(COACH_FAST_MODEL_ID)+';',
    'const COACH_RETRYABLE_QUALITY_FAILURES=new Set('+JSON.stringify([...COACH_RETRYABLE_QUALITY_FAILURES])+');',
    coachModelPlan.toString(),coachModelText.toString(),coachModelExecute.toString()
  ].join('\n');
  once('async function previewChat(request,env) {',declarations+'\nasync function previewChat(request,env) {');
  once('    const generated=await env.AI.run(LIVE_AI_MODEL,{messages,chat_template_kwargs:{enable_thinking:false},max_completion_tokens:coachPlan.maxTokens});',
    '    const modelRoute=coachModelPlan(question,coachPlan,action,env,LIVE_AI_MODEL);\n    const execution=await coachModelExecute(env,modelRoute,messages,{battles:evidence,personal,docs:retrievedKnowledge,intent:coachPlan.intent,question},coachQualityEvaluate);\n    const selectedModel=execution.model;\n    const quality=execution.quality;\n    let answer=quality.answer;');
  const oldExtraction=[
    '    let answer=typeof generated?.response==="string"?generated.response:"";',
    '    if(!answer&&typeof generated?.choices?.[0]?.message?.content==="string")answer=generated.choices[0].message.content;',
    '    if(!answer&&Array.isArray(generated?.output))answer=generated.output.map(x=>x?.content||x?.text||"").join("\\n");',
    '    const quality=coachQualityEvaluate(answer,{battles:evidence,personal,docs:retrievedKnowledge,intent:coachPlan.intent});',
    '    answer=quality.answer;'
  ].join('\n');
  once(oldExtraction,'');
  once('model:LIVE_AI_MODEL,external_inference:true,replay_analyzed:false,evidence_status:"client_submitted_unverified",knowledge_version:',
    'model:selectedModel,model_route:execution.route,fallback_used:execution.fallbackUsed,router_version:execution.routerVersion,external_inference:true,replay_analyzed:false,evidence_status:"client_submitted_unverified",knowledge_version:');
  return s;
}
