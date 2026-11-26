import {patchCoachIdentity} from './coach-identity-v1.mjs';
export const CORE_VERSION='crc-coach-core-v1';
export function coachIntent(question,action){
  if(['deck','suggestions','style','overview','progress','events'].includes(action))return action;
  const q=String(question||'').trim().toLowerCase().replace(/ي/g,'ی').replace(/ك/g,'ک');
  // A hint only: never replace free-text questions with fixed shortcut tasks.
  if(/ریپلی|بازپخش|ویدیو|ویدئو|\breplay\b|\bvideo\b/.test(q))return 'vision';
  if(/متا|ایونت|چالش|\bmeta\b|\bevent\b|\bchallenge\b/.test(q))return 'events';
  if(/ارتقا|آپگرید|\bupgrade\b/.test(q))return 'progress';
  if(/تعویض|جایگزین|بهبود دک|\bswap\b|\breplace\b/.test(q))return 'suggestions';
  if(/سبک بازی|نبرد|برد و باخت|\bbattle\b|\bmatchup\b/.test(q))return 'style';
  if(/دک|ترکیب|\bdeck\b/.test(q))return 'deck';
  if(/تمرین|پیشرفت|\bpractice\b|\btraining\b/.test(q))return 'overview';
  return 'general';
}
export function coachInferencePlan(question,action){
  const intent=coachIntent(question,action);
  // Only the existing configured model is verified. Token budget routing, no added provider.
  const short=intent==='general'&&/^(سلام|درود|hi|hello|ممنون|thanks)[!؟!.\s]*$/i.test(String(question).trim());
  return {intent,maxTokens:short?240:720};
}
export function coachValidatedEvidence(input,personal){
  const keys=['wins','losses','draws','unknown'];
  const validCount=x=>Number.isInteger(x)&&x>=0&&x<=200;
  const total=input?.matched_records;
  const valid=validCount(total)&&total>0&&keys.every(k=>validCount(input[k]))&&keys.reduce((s,k)=>s+input[k],0)===total;
  const battles=valid?{matched_records:total,...Object.fromEntries(keys.map(k=>[k,input[k]])),filter:['all','event','other'].includes(input.filter)?input.filter:'all'}:{};
  const clean={...personal};
  const result=personal?.selected_deck_results;
  const subset=valid&&Array.isArray(personal?.deck_cards)&&personal.deck_cards.length===8&&result&&keys.every(k=>validCount(result[k])&&result[k]<=battles[k]);
  if(!subset){clean.selected_deck_results=null;clean.form_results=null;clean.opponent_card_patterns=[];}
  return {battles,personal:clean};
}
export function patchCoachCore(source){
  // Source transformation candidate; no deployment. Every anchor must match once.
  let s=patchCoachIdentity(source);
  const once=(old,nu)=>{if(s.split(old).length!==2)throw new Error('Coach core anchor mismatch');s=s.replace(old,()=>nu);};
  const declaration=[coachIntent,coachInferencePlan,coachValidatedEvidence].map(fn=>fn.toString()).join('\n');
  once('async function previewChat(request,env) {',declaration+'\nasync function previewChat(request,env) {');
  once('  const evidence={};','  let evidence={};');
  once('  const personal=personalCoachEvidence(data.personal);','  let personal=personalCoachEvidence(data.personal);\n  const checked=coachValidatedEvidence(evidence,personal);evidence=checked.battles;personal=checked.personal;\n  const coachPlan=coachInferencePlan(question,action);');
  once('  if(action)personal.style_summary=guidedStyleEvidence(data.personal&&data.personal.style);','  personal.style_summary=guidedStyleEvidence(data.personal&&data.personal.style);');
  const questionAnchor='content:(action?"ابزار انتخاب‌شده: "+action+"\\nوظیفه ثابت سرور: ":"سؤال: ")+question';
  once(questionAnchor,'content:"نوع درخواست پیشنهادی (فقط راهنما): "+coachPlan.intent+"\\n"+(action?"ابزار انتخاب‌شده: "+action+"\\nوظیفه ثابت سرور: ":"سؤال: ")+question');
  once('max_completion_tokens:720','max_completion_tokens:coachPlan.maxTokens');
  return s;
}
