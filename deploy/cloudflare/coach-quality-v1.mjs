// Deterministic output checks; not a semantic fact checker.
export const QUALITY_VERSION='crc-coach-quality-v1';
export function coachQualityFacts(battles,personal){
  const out={};
  const keys=['wins','losses','draws','unknown'];
  const count=x=>Number.isInteger(x)&&x>=0&&x<=200;
  const valid=x=>x&&keys.every(k=>count(x[k]))&&keys.reduce((s,k)=>s+x[k],0)<=200;
  const format=(x,label)=>{
    const total=keys.reduce((s,k)=>s+x[k],0),known=x.wins+x.losses+x.draws;
    return label+' — نمونه: '+total+'؛ برد: '+x.wins+'؛ باخت: '+x.losses+'؛ مساوی: '+x.draws+'؛ نامشخص: '+x.unknown+'؛ نرخ برد: '+(known?(100*x.wins/known).toFixed(1)+'٪ از '+known+' نتیجه مشخص':'قابل محاسبه نیست');
  };
  if(valid(battles)&&count(battles.matched_records)&&battles.matched_records>0&&keys.reduce((s,k)=>s+battles[k],0)===battles.matched_records)
    out.overall=format(battles,'کل نبردهای ارسالی');
  const deck=Array.isArray(personal?.deck_cards)?personal.deck_cards:[];
  const complete=deck.length===8&&deck.every(c=>Number.isSafeInteger(c?.id)&&c.id>0)&&new Set(deck.map(c=>c.id)).size===8;
  const selected=personal?.selected_deck_results;
  if(complete&&out.overall&&valid(selected)&&keys.every(k=>selected[k]<=battles[k])){
    out.selected=keys.reduce((s,k)=>s+selected[k],0)>0?format(selected,'همین دک انتخاب‌شده'):'همین دک: هیچ نبرد قابل انتساب در نمونه وجود ندارد.';
  }
  if(complete&&deck.every(c=>Number.isInteger(c.elixir)&&c.elixir>=0&&c.elixir<=10)){
    const costs=deck.map(c=>c.elixir);
    out.elixir='میانگین اکسیر ثبت‌شده: '+(costs.reduce((s,c)=>s+c,0)/8).toFixed(2)+'؛ هزینه چهار کارت ارزان‌تر: '+costs.sort((a,b)=>a-b).slice(0,4).reduce((s,c)=>s+c,0);
  }
  const memory=personal?.coach_memory;
  if(memory&&memory.version===1&&Array.isArray(memory.snapshots)&&memory.snapshots.length){
    const snapshot=memory.snapshots[0],focusLabels={balanced:'بدون اولویت خاص',cycle:'چرخه کارت',elixir:'مدیریت اکسیر',defense:'دفاع',pressure:'فشار و ضدحمله',deck:'تعادل دک'};
    const ids=Array.isArray(snapshot.deck_card_ids)&&snapshot.deck_card_ids.length===8&&snapshot.deck_card_ids.every(id=>Number.isSafeInteger(id)&&id>0)?snapshot.deck_card_ids:null;
    const battle=snapshot.battles,selectedMemory=snapshot.selected_deck;
    const countsOk=(x,total)=>x&&keys.every(k=>count(x[k]))&&keys.reduce((sum,k)=>sum+x[k],0)===total;
    if(ids&&battle&&Number.isInteger(battle.matched_records)&&battle.matched_records>=0&&battle.matched_records<=200&&countsOk(battle.outcomes,battle.matched_records)&&
      selectedMemory&&Number.isInteger(selectedMemory.matched_records)&&selectedMemory.matched_records>=0&&selectedMemory.matched_records<=battle.matched_records&&countsOk(selectedMemory.outcomes,selectedMemory.matched_records)){
      const historical=['حافظه تاریخی محلی (غیرزنده و مالکیت تأییدنشده)؛ آخرین ثبت: '+String(snapshot.captured_at||'نامشخص'),
        'تمرکز تمرین انتخابی: '+(focusLabels[memory.focus]||focusLabels.balanced),
        'دک ذخیره‌شده با شناسه کارت‌ها: '+ids.join(', '),
        'نبردهای قابل انتساب در آن ثبت: '+battle.matched_records+'؛ برد: '+battle.outcomes.wins+'؛ باخت: '+battle.outcomes.losses+'؛ مساوی: '+battle.outcomes.draws+'؛ نامشخص: '+battle.outcomes.unknown,
        'نتیجه همان دک در ثبت تاریخی: '+selectedMemory.matched_records+' نبرد؛ برد: '+selectedMemory.outcomes.wins+'؛ باخت: '+selectedMemory.outcomes.losses+'؛ مساوی: '+selectedMemory.outcomes.draws+'؛ نامشخص: '+selectedMemory.outcomes.unknown];
      if(Number.isInteger(battle.elixir_leak_sample)&&battle.elixir_leak_sample>0&&typeof battle.avg_elixir_leaked==='number'&&Number.isFinite(battle.avg_elixir_leaked))
        historical.push('میانگین اکسیر هدررفته گزارش‌شده در آن ثبت: '+battle.avg_elixir_leaked+' از نمونه '+battle.elixir_leak_sample+' نبرد؛ علت تاکتیکی را ثابت نمی‌کند.');
      const previous=memory.snapshots[1];
      if(previous&&Array.isArray(previous.deck_card_ids)&&previous.deck_card_ids.length===8&&previous.deck_card_ids.every(Number.isSafeInteger)&&previous.deck_card_ids.join(':')!==ids.join(':'))
        historical.push('ترکیب دک در دو ثبت محلی متفاوت است؛ این تفاوت به‌تنهایی بهبود یا افت عملکرد را ثابت نمی‌کند.');
      const feedback=Array.isArray(memory.practice_feedback)?memory.practice_feedback[0]:null;
      const feedbackLabels={improved:'بهتر شد',same:'تفاوتی نداشت',worse:'بدتر شد',not_tried:'هنوز امتحان نشده'};
      const actionLabels={deck:'تحلیل دک',suggestions:'پیشنهاد تعویض',style:'تحلیل سبک بازی',overview:'برنامه پیشرفت'};
      if(feedback&&feedbackLabels[feedback.outcome]&&actionLabels[feedback.action])historical.push('آخرین بازخورد خوداظهاری بازیکن درباره '+actionLabels[feedback.action]+': '+feedbackLabels[feedback.outcome]+'؛ این گزارش ذهنی است و نتیجه آماری را اثبات نمی‌کند.');
      out.memory=historical.join('؛ ');
    }
  }
  const pending=memory&&memory.version===1?memory.pending_practice:null;
  const actionLabels={deck:'تحلیل دک',suggestions:'پیشنهاد تعویض',style:'تحلیل سبک بازی',overview:'برنامه پیشرفت'};
  if(pending&&actionLabels[pending.action]&&Array.isArray(pending.deck_card_ids)&&pending.deck_card_ids.length===8&&
    pending.deck_card_ids.every(id=>Number.isSafeInteger(id)&&id>0)&&new Set(pending.deck_card_ids).size===8){
    const bundle=(x)=>{
      if(!x||!Number.isInteger(x.matched_records)||x.matched_records<0||x.matched_records>200||!valid(x.outcomes)||
        keys.reduce((sum,k)=>sum+x.outcomes[k],0)!==x.matched_records)return null;
      return x;
    };
    const before=bundle(pending.baseline),after=bundle(pending.progress);
    if(before||after){
      const parts=['پیگیری ساختاریافته پس از '+actionLabels[pending.action]+'؛ نوع دک: '+(pending.target_kind==='suggested_deck'?'دک پیشنهادی':'دک فعلی')+'؛ شناسه کارت‌ها: '+pending.deck_card_ids.join(', ')];
      if(before)parts.push('نمونه پیش از کار مربی: '+format(before.outcomes,'نبردهای همان دک'));
      if(after)parts.push('نبردهای جدیدتر با همان دک که پس از کار مربی در Battle Log مشاهده شدند: '+format(after.outcomes,'نمونه پس از کار مربی'));
      parts.push('این مقایسه فقط هم‌زمانی و ترکیب دک را ثبت می‌کند؛ اثبات اجرای پیشنهاد یا اثر علّی مربی نیست.');
      out.practice=parts.join('؛ ');
    }
  }
  return out;
}
export function coachQualitySwap(personal,index){
  if(!Number.isInteger(index)||index<0||index>=4)return null;
  const deck=Array.isArray(personal?.deck_cards)?personal.deck_cards:[];
  const swaps=Array.isArray(personal?.allowed_single_swaps)?personal.allowed_single_swaps:[];
  const candidate=swaps[index];
  if(deck.length!==8||deck.some(c=>!Number.isSafeInteger(c?.id)||c.id<=0)||new Set(deck.map(c=>c.id)).size!==8||!candidate)return null;
  const out=deck.find(c=>c.id===candidate.remove_id);
  if(!out||!Number.isSafeInteger(candidate.add_id)||candidate.add_id<=0||deck.some(c=>c.id===candidate.add_id)||out.name!==candidate.remove)return null;
  if(['champion','hero'].includes(out.rarity)||['evo','hero','ambiguous'].includes(out.active_form)||(out.active_form==='unknown'&&out.unlocked_forms>0))return null;
  if(typeof candidate.add!=='string'||!candidate.add.trim()||candidate.add.length>65||!/^[A-Za-z0-9 .,'()&-]+$/.test(candidate.add)||typeof out.name!=='string'||!/^[A-Za-z0-9 .,'()&-]+$/.test(out.name))return null;
  if(!Number.isInteger(candidate.elixir_delta)||candidate.elixir_delta>1||candidate.elixir_delta< -10)return null;
  if(candidate.level_gap!==null&&(!Number.isInteger(candidate.level_gap)||candidate.level_gap< -2||candidate.level_gap>15))return null;
  const labels={win:'فشار به برج',air:'دفاع هوایی',splash:'دفاع در برابر گروه نیروها',tankkill:'مقابله با تانک',pull:'منحرف کردن نیرو',smallspell:'طلسم سبک',damage:'آسیب مستقیم',reset:'قطع حمله یا شارژ'};
  const roles=xs=>Array.isArray(xs)?[...new Set(xs.filter(x=>Object.hasOwn(labels,x)))].map(x=>labels[x]):[];
  const gain=roles(candidate.gain),loss=roles(candidate.loss);
  if(!gain.length)return null;
  return {remove:out.name,add:candidate.add,remove_id:out.id,add_id:candidate.add_id,gain,loss,elixir_delta:candidate.elixir_delta,level_gap:candidate.level_gap};
}
export function coachQualityNumericClaim(text){
  // Conservative lexical screen, not proof of factual accuracy.
  const s=String(text||'').replace(/[۰-۹]/g,c=>String(c.charCodeAt(0)-1776)).replace(/[٠-٩]/g,c=>String(c.charCodeAt(0)-1632)).replace(/ي/g,'ی').replace(/ك/g,'ک');
  const percent=/[0-9]+(?:[.,٫][0-9]+)?\s*[%٪]|[%٪]\s*[0-9]+/;
  const rate=/نرخ\s*برد|درصد\s*برد|احتمال\s*برد|win[\s-]*rate|win[\s-]*chance|winning[\s-]*percentage/i;
  return percent.test(s)&&rate.test(s);
}
export function coachQualityPersonalStatsClaim(text){
  const s=String(text||'').replace(/[۰-۹]/g,c=>String(c.charCodeAt(0)-1776)).replace(/[٠-٩]/g,c=>String(c.charCodeAt(0)-1632)).replace(/ي/g,'ی').replace(/ك/g,'ک');
  const patterns=[
    /(?:میانگین|average)[^\n]{0,50}[0-9]+|[0-9]+[^\n]{0,50}(?:میانگین|average)/i,
    /(?:برد|باخت|مساوی|wins?|losses?|draws?)\s*[:=]?\s*[0-9]+|[0-9]+\s*(?:برد|باخت|مساوی|wins?|losses?|draws?)/i,
    /(?:نبرد|matches?|battles?)\s*[:=]?\s*[0-9]+|[0-9]+\s*(?:نبرد|matches?|battles?)/i
  ];
  return patterns.some(pattern=>pattern.test(s));
}
export function coachQualityEvaluate(raw,context={}){
  const {battles,personal,docs,intent}=context;
  const facts=coachQualityFacts(battles,personal);
  const known=new Map((Array.isArray(docs)?docs:[]).map(d=>[d.id,d]));
  const fallback=(reason)=>({answer:'پاسخ مدل از بررسی ساختار یا شواهد عبور نکرد. اطلاعات تاییدنشده نمایش داده نشد.'+(Object.keys(facts).length?'\n\n## داده‌های ارسالی قابل محاسبه\n'+Object.values(facts).join('\n'):'\nسؤال را دقیق‌تر بپرس یا اطلاعات حساب و دک را بارگذاری کن.'),status:'limited',reason,checks:{schema:false,selected_facts:false,swap:false,source_ids:false},sources:[],swap:null});
  if(typeof raw!=='string'||raw.length>6000)return fallback('INVALID_OUTPUT');
  let v;
  try{v=JSON.parse(raw.trim());}catch{return fallback('INVALID_JSON');}
  const keys=['answer','swap_index','fact_keys','source_ids'];
  if(!v||typeof v!=='object'||Array.isArray(v)||Object.keys(v).length!==keys.length||keys.some(k=>!Object.hasOwn(v,k))||typeof v.answer!=='string'||v.answer.length>1500||(!v.answer.trim()&&intent!=='suggestions')||!Array.isArray(v.fact_keys)||v.fact_keys.length>3||!Array.isArray(v.source_ids)||v.source_ids.length>3||!(v.swap_index===null||Number.isInteger(v.swap_index)))return fallback('INVALID_SCHEMA');
  if(new Set(v.fact_keys).size!==v.fact_keys.length||v.fact_keys.some(k=>typeof k!=='string'||!Object.hasOwn(facts,k)))return fallback('UNKNOWN_FACT');
  if(new Set(v.source_ids).size!==v.source_ids.length||v.source_ids.some(k=>typeof k!=='string'||!known.has(k)))return fallback('UNKNOWN_SOURCE');
  let swap=null;
  if(v.swap_index!==null){
    if(intent!=='suggestions'||!(swap=coachQualitySwap(personal,v.swap_index)))return fallback('INVALID_SWAP');
  }
  if(!['suggestions','meta','vision'].includes(intent)&&coachQualityNumericClaim(v.answer))return fallback('UNVERIFIED_RATE_IN_PROSE');
  if(!['suggestions','meta','vision'].includes(intent)&&coachQualityPersonalStatsClaim(v.answer))return fallback('UNVERIFIED_PERSONAL_STATS_IN_PROSE');
  const sources=v.source_ids.map(id=>known.get(id));
  // The RAG source list says which documents were selected, not that every claim is verified.
  let answer=v.answer.trim().replace(/\[(K\d{2})\]/g,(m,id)=>v.source_ids.includes(id)?m:'');
  if(intent==='suggestions'){
    // Never render model-authored recommendation text for this intent.
    answer=swap?'## پیشنهاد آزمایشی\nحذف: '+swap.remove+'\nافزودن: '+swap.add+'\nمزیت ساختاری: '+swap.gain.join('، ')+'\n'+(swap.loss.length?'بده‌بستان: کاهش پوشش '+swap.loss.join('، ')+'\n':'')+'تغییر هزینه اکسیر: '+swap.elixir_delta+(swap.level_gap===null?'\nاختلاف سطح کارت‌ها مشخص نیست.':'\nاختلاف سطح ثبت‌شده: '+swap.level_gap)+'\nاین گزینه از فهرست کارت‌های ارسالی انتخاب شده، نه مالکیت تاییدشده؛ بهبود ساختاری تضمین برد نیست. چند نبرد آزمایشی انجام بده.':'در داده فعلی پیشنهاد تعویض تاییدشده‌ای برای نمایش ندارم. فعلاً روی تمرین همین دک تمرکز کن.';
  }else if(intent==='meta'){
    answer='داده زنده و تاییدشده متا در این مسیر تحلیل در دسترس نیست؛ نمی‌توانم بهترین دک روز، محبوبیت یا نرخ برد فعلی را تایید کنم.';
  }else if(intent==='vision'){
    answer='بازپخش یا ویدیوی نبرد در این درخواست تحلیل نشده است؛ زمان‌بندی، جایگذاری و علت دقیق باخت از آمار خلاصه قابل اثبات نیست.';
  }
  const chosen=v.fact_keys.map(k=>facts[k]);
  if(chosen.length)answer+='\n\n## داده‌های ارسالی قابل محاسبه\n'+chosen.join('\n');
  if(!answer.trim())return fallback('EMPTY_ANSWER');
  return {answer:answer.slice(0,2900),status:'checked_structure',reason:null,checks:{schema:true,selected_facts:true,swap:true,source_ids:true},sources:['suggestions','meta','vision'].includes(intent)?[]:sources,swap};
}
export function patchCoachQuality(source){
  let s=source;
  const once=(old,nu)=>{if(s.split(old).length!==2)throw new Error('Coach quality anchor mismatch: '+old.slice(0,80));s=s.replace(old,()=>nu);};
  const declarations=['const QUALITY_VERSION='+JSON.stringify(QUALITY_VERSION)+';',coachQualityFacts.toString(),coachQualitySwap.toString(),coachQualityNumericClaim.toString(),coachQualityPersonalStatsClaim.toString(),coachQualityEvaluate.toString()].join('\n');
  once('async function previewChat(request,env) {',declarations+'\nasync function previewChat(request,env) {');
  once('CRC_COACH_IDENTITY_V1','CRC_COACH_IDENTITY_V1. قالب خروجی الزامی: فقط یک شیء JSON معتبر، بدون Markdown یا کدبلاک بیرونی، با چهار کلید answer (متن ساده حداکثر ۱۵۰۰ نویسه)، swap_index (null یا اندیس صفر تا سه از allowed_single_swaps فقط برای پیشنهاد تعویض)، fact_keys (آرایه حداکثر سه کلید از overall,selected,elixir,memory,practice فقط اگر داده موجود است)، source_ids (آرایه حداکثر سه شناسه منبع بازیابی‌شده که واقعاً استفاده کردی). هیچ آمار شخصی مثل تعداد نبرد، برد/باخت یا میانگین اکسیر و نرخ برد را در answer ننویس؛ سرور آن‌ها را محاسبه می‌کند. پیشنهاد تعویض فقط با اندیس، نه متن. اگر شواهد ناکافی است answer را کوتاه و صادقانه بنویس. مثال ساختاری: '+JSON.stringify({answer:'سلام!',swap_index:null,fact_keys:[],source_ids:[]}).replaceAll('"','\\"')+'.');
  once('    answer=coachFormatAnswer(answer,retrievedKnowledge).trim().slice(0,2900);','    const quality=coachQualityEvaluate(answer,{battles:evidence,personal,docs:retrievedKnowledge,intent:coachPlan.intent});\n    answer=quality.answer;');
  once('knowledge_sources:coachKnowledgeSources(retrievedKnowledge)','knowledge_sources:coachKnowledgeSources(quality.sources),quality_version:QUALITY_VERSION,quality_status:quality.status,quality_checks:quality.checks,quality_swap:quality.swap');
  return s;
}
