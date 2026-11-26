import {patchCoachIdentity} from './coach-identity-v1.mjs';
import {patchCoachKnowledge} from './coach-knowledge-v1.mjs';
import {patchCoachQuality} from './coach-quality-v1.mjs';
import {patchCoachRouter} from './coach-router-v1.mjs';
export const CORE_VERSION='crc-coach-core-v1';
export function coachIntent(question,action){
  if(['deck','suggestions','style','overview','progress','events'].includes(action))return action;
  const q=String(question||'').trim().toLowerCase().replace(/ي/g,'ی').replace(/ك/g,'ک');
  // A hint only: never replace free-text questions with fixed shortcut tasks.
  if(/ریپلی|بازپخش|ویدیو|ویدئو|\breplay\b|\bvideo\b/.test(q))return 'vision';
  const terms=q.split(' ');
  if(/متا|محبوب.?ترین دک|بهترین دک (?:روز|امروز|الان)|\bmeta\b|\btop decks\b/.test(q))return 'meta';
  if(/ایونت|رویداد|چالش/.test(q)||terms.includes('event')||terms.includes('challenge'))return 'events';
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
export function coachMemoryContext(value){
  if(!value||typeof value!=='object'||Array.isArray(value)||value.version!==1)return null;
  const focuses=new Set(['balanced','cycle','elixir','defense','pressure','deck']);
  const deckSources=new Set(['profile-live','profile-import','profile-edited','manual','sample','battle-event-import','battle-import']);
  const countSet=(raw,total)=>{
    const keys=['wins','losses','draws','unknown'];
    if(!raw||!Number.isInteger(total)||total<0||total>200||!keys.every(k=>Number.isInteger(raw[k])&&raw[k]>=0&&raw[k]<=200))return null;
    const out=Object.fromEntries(keys.map(k=>[k,raw[k]]));
    return keys.reduce((sum,k)=>sum+out[k],0)===total?out:null;
  };
  const snapshots=[];
  for(const item of (Array.isArray(value.snapshots)?value.snapshots:[]).slice(0,2)){
    if(!item||typeof item!=='object'||typeof item.captured_at!=='string'||item.captured_at.length>40||!Number.isFinite(Date.parse(item.captured_at)))continue;
    const ids=Array.isArray(item.deck_card_ids)?item.deck_card_ids.slice(0,8):[];
    if(ids.length!==8||!ids.every(id=>Number.isSafeInteger(id)&&id>0&&id<=1000000000)||new Set(ids).size!==8)continue;
    const cards=Array.isArray(item.cards)?item.cards.slice(0,8):[];
    if(cards.length!==8||new Set(cards.map(c=>c?.id)).size!==8||cards.some(c=>!c||!ids.includes(c.id)))continue;
    const cleanCards=cards.map(c=>{
      const out={id:c.id};
      if(Number.isInteger(c.level)&&c.level>=1&&c.level<=16)out.level=c.level;
      if(['common','rare','epic','legendary','champion'].includes(c.rarity))out.rarity=c.rarity;
      if(Number.isInteger(c.evolution_level)&&c.evolution_level>=0&&c.evolution_level<=3)out.evolution_level=c.evolution_level;
      if(Number.isInteger(c.max_evolution_level)&&c.max_evolution_level>=0&&c.max_evolution_level<=3)out.max_evolution_level=c.max_evolution_level;
      if(Number.isInteger(c.star_level)&&c.star_level>=0&&c.star_level<=3)out.star_level=c.star_level;
      return out;
    });
    const b=item.battles,bo=countSet(b?.outcomes,b?.matched_records);
    const selected=item.selected_deck,so=countSet(selected?.outcomes,selected?.matched_records);
    if(!bo||!so||selected.matched_records>b.matched_records||
      !Number.isInteger(b.elixir_leak_sample)||b.elixir_leak_sample<0||b.elixir_leak_sample>b.matched_records||
      !(b.avg_elixir_leaked===null||(typeof b.avg_elixir_leaked==='number'&&Number.isFinite(b.avg_elixir_leaked)&&b.avg_elixir_leaked>=0&&b.avg_elixir_leaked<=1000)))continue;
    const patterns=[];
    for(const p of (Array.isArray(item.deck_patterns)?item.deck_patterns:[]).slice(0,3)){
      const pids=Array.isArray(p?.deck_card_ids)?p.deck_card_ids.slice(0,8):[];
      const po=countSet(p?.outcomes,p?.plays);
      if(pids.length===8&&!pids.some(id=>!Number.isSafeInteger(id)||id<=0||id>1000000000)&&new Set(pids).size===8&&po&&
        Number.isInteger(p.event_plays)&&p.event_plays>=0&&p.event_plays<=p.plays)
        patterns.push({deck_card_ids:pids,plays:p.plays,outcomes:po,event_plays:p.event_plays});
    }
    const source=item.source==='live'?'live':'imported';
    const deck_source=deckSources.has(item.deck_source)?item.deck_source:'manual';
    snapshots.push({
      captured_at:item.captured_at,source,deck_source,deck_card_ids:ids,cards:cleanCards,
      battles:{matched_records:b.matched_records,outcomes:bo,elixir_leak_sample:b.elixir_leak_sample,avg_elixir_leaked:b.avg_elixir_leaked},
      selected_deck:{matched_records:selected.matched_records,outcomes:so},
      deck_patterns:patterns,
      latest_battle_at:typeof item.latest_battle_at==='string'&&item.latest_battle_at.length<=40?item.latest_battle_at:null
    });
  }
  const actions=new Set(['deck','suggestions','style','overview']);
  const outcomes=new Set(['improved','same','worse','not_tried']);
  const practice=value=>{
    if(!value||typeof value!=='object'||!actions.has(value.action)||typeof value.created_at!=='string'||
      value.created_at.length>40||!Number.isFinite(Date.parse(value.created_at)))return null;
    const ids=Array.isArray(value.deck_card_ids)?value.deck_card_ids.slice(0,8):[];
    if(ids.length!==8||!ids.every(id=>Number.isSafeInteger(id)&&id>0&&id<=1000000000)||new Set(ids).size!==8)return null;
    const countBundle=(raw,total)=>{
      const keys=['wins','losses','draws','unknown'];
      if(!raw||!Number.isInteger(total)||total<0||total>200||!keys.every(k=>Number.isInteger(raw[k])&&raw[k]>=0&&raw[k]<=200))return null;
      const outcomes=Object.fromEntries(keys.map(k=>[k,raw[k]]));
      return keys.reduce((sum,k)=>sum+outcomes[k],0)===total?{matched_records:total,outcomes}:null;
    };
    const baseline=value.baseline==null?null:countBundle(value.baseline.outcomes,value.baseline.matched_records);
    const progress=value.progress==null?{matched_records:0,outcomes:{wins:0,losses:0,draws:0,unknown:0}}:countBundle(value.progress.outcomes,value.progress.matched_records);
    if(value.baseline!=null&&!baseline||!progress)return null;
    const validDate=x=>typeof x==='string'&&x.length<=40&&Number.isFinite(Date.parse(x))?x:null;
    const since=validDate(value.since_battle_at),last=validDate(value.last_battle_at);
    if(value.since_battle_at!=null&&!since||value.last_battle_at!=null&&!last)return null;
    if(last&&since&&Date.parse(last)<Date.parse(since))return null;
    if(value.target_kind!=null&&!['current_deck','suggested_deck'].includes(value.target_kind)||value.target_kind==='suggested_deck'&&value.action!=='suggestions')return null;
    const target_kind=value.target_kind==='suggested_deck'?'suggested_deck':'current_deck';
    return {action:value.action,target_kind,deck_card_ids:ids,created_at:value.created_at,baseline,progress,since_battle_at:since,last_battle_at:last};
  };
  const pending=practice(value.pending_practice);
  const feedback=(Array.isArray(value.practice_feedback)?value.practice_feedback:[]).slice(0,3).map(item=>{
    const clean=practice(item);
    return clean&&outcomes.has(item.outcome)&&typeof item.recorded_at==='string'&&item.recorded_at.length<=40&&Number.isFinite(Date.parse(item.recorded_at))?
      {...clean,outcome:item.outcome,recorded_at:item.recorded_at}:null;
  }).filter(Boolean);
  return {version:1,focus:focuses.has(value.focus)?value.focus:'balanced',snapshots,pending_practice:pending,practice_feedback:feedback};
}
export function patchCoachCore(source){
  // Source transformation candidate; no deployment. Every anchor must match once.
  let s=patchCoachIdentity(source);
  const once=(old,nu)=>{if(s.split(old).length!==2)throw new Error('Coach core anchor mismatch');s=s.replace(old,()=>nu);};
  const declaration=[coachIntent,coachInferencePlan,coachValidatedEvidence,coachMemoryContext].map(fn=>fn.toString()).join('\n');
  once('async function previewChat(request,env) {',declaration+'\nasync function previewChat(request,env) {');
  once('  const evidence={};','  let evidence={};');
  once('  const personal=personalCoachEvidence(data.personal);','  let personal=personalCoachEvidence(data.personal);\n  const checked=coachValidatedEvidence(evidence,personal);evidence=checked.battles;personal=checked.personal;\n  const coachMemory=coachMemoryContext(data.personal&&data.personal.coach_memory);if(coachMemory)personal.coach_memory=coachMemory;\n  const coachPlan=coachInferencePlan(question,action);');
  once('  if(action)personal.style_summary=guidedStyleEvidence(data.personal&&data.personal.style);','  personal.style_summary=guidedStyleEvidence(data.personal&&data.personal.style);');
  const questionAnchor='content:(action?"ابزار انتخاب‌شده: "+action+"\\nوظیفه ثابت سرور: ":"سؤال: ")+question';
  once(questionAnchor,'content:"نوع درخواست پیشنهادی (فقط راهنما): "+coachPlan.intent+"\\n"+(action?"ابزار انتخاب‌شده: "+action+"\\nوظیفه ثابت سرور: ":"سؤال: ")+question');
  once('max_completion_tokens:720','max_completion_tokens:coachPlan.maxTokens');
  return patchCoachRouter(patchCoachQuality(patchCoachKnowledge(s)));
}
