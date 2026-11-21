/* CRC guided offline chat — deterministic explanations only; no model, fetch, or data upload. */
(function(root){
  "use strict";
  const PROMPTS=Object.freeze([
    Object.freeze({label:"اکسیر دک من",question:"میانگین اکسیر دکم چقدر است؟"}),
    Object.freeze({label:"نکات دک",question:"چه نکاتی در دک فعلی من قابل بررسی است؟"}),
    Object.freeze({label:"خلاصه نبردها",question:"چند برد و باخت در Battle Log من ثبت شده است؟"}),
    Object.freeze({label:"تمرین بعدی",question:"برای بهتر بازی کردن چه تمرینی پیشنهاد می‌کنی؟"})
  ]);
  const fa=n=>new Intl.NumberFormat("fa-IR",{maximumFractionDigits:2}).format(n);
  const matches=(s,pattern)=>pattern.test(s);
  const result=(kind,text,source)=>({kind,text,source});
  function respond(question,context){
    const state=context&&typeof context==="object"?context:{};
    const f=state.facts&&typeof state.facts==="object"?state.facts:{};
    const findings=Array.isArray(state.findings)?state.findings:[];
    const battle=state.battleEvidence&&typeof state.battleEvidence==="object"?state.battleEvidence:null;
    const q=String(question==null?"":question).trim().slice(0,280)
      .replace(/ي/g,"ی").replace(/ك/g,"ک").replace(/\u200c/g," ").toLowerCase();
    if(!q)return result("missing","یک سؤال کوتاه درباره دک، آمار نبردها یا تمرین بپرس.","راهنمای نسخه آفلاین");
    if(matches(q,/وید[یئئو]|ریپلی|replay|video|جایگذاری|زمان ?بندی کارت|اشتباه(?:ات)? (?:داخل|در) (?:بازی|نبرد)/i)){
      return result("unsupported",
        "در این نسخه داده Replay، ویدئو و رویدادهای جایگذاری کارت را نداریم؛ نمی‌توان اشتباه یا زمان‌بندی واقعی بازی را از Battle Log حدس زد. این قابلیت در فاز جداگانه توسعه پیدا می‌کند.",
        "محدودیت داده و قابلیت فعلی");
    }
    const wantsLeak=matches(q,/نشت|leaked|هدر ?رفت|اتلاف اکسیر/i);
    const wantsBattles=matches(q,/نبرد|مبارز|بازی ?ها|نتایج|نتیجه|برد|باخت|پیروزی|شکست|battle|match|کارنامه/i);
    const wantsCost=matches(q,/اکسیر|elixir|چرخه|هزینه|cycle|گران|ارزان/i);
    const wantsPractice=matches(q,/تمرین|یادگیری|بهتر بازی|پیشرفت|چطور بازی|چگونه بازی|آموزش|practice/i);
    const wantsDeck=matches(q,/دک|deck|ترکیب|کارت|نقطه قوت|نقطه ضعف|نکته|پوشش|دفاع|حمله|پیشنهاد/i);
    if(wantsLeak||wantsBattles){
      if(!battle||!Number.isFinite(battle.matched_records)||battle.matched_records<=0){
        return result("missing",
          "برای پاسخ مستند، فایل Battle Log و Player Tag معتبر را در صفحه بازیکن/نبردها وارد کن. بدون تطبیق تگ، هیچ برد یا شکستی را به تو نسبت نمی‌دهیم.",
          "نیاز به Battle Log و Player Tag");
      }
      const c=battle.outcomes||{};
      const scope=battle.filter==="event"?"نبردهای رویدادی":battle.filter==="other"?"نبردهای با حالت نامشخص (نه لزوماً Trophy Road)":"همه حالت‌های ثبت‌شده";
      const base="در نمونه "+scope+"، "+fa(battle.matched_records)+" نبرد از "+fa(battle.analyzed_records)+" مورد به Player Tag واردشده قابل انتساب است: "+
        fa(c.wins||0)+" برد، "+fa(c.losses||0)+" شکست، "+fa(c.draws||0)+" مساوی و "+fa(c.unknown||0)+" نتیجه نامشخص.";
      let more="";
      const leak=battle.reported_elixir_leaked;
      if(wantsLeak&&leak&&Number.isFinite(leak.average)&&Number.isFinite(leak.sample_size)&&leak.sample_size>0){
        more=" میانگین Elixir Leaked گزارش‌شده "+fa(leak.average)+" در "+fa(leak.sample_size)+" نبرد دارای داده است؛ بدون Replay علت آن معلوم نیست.";
      }else if(wantsLeak){
        more=" برای Elixir Leaked در این نمونه داده عددی کافی نداریم.";
      }
      return result("battles",base+more+" این فقط بخشی از تاریخچه است، مالکیت حساب را اثبات نمی‌کند و مبنای پیش‌بینی نرخ برد نیست.","خلاصه تجمیعی Battle Log واردشده در مرورگر");
    }
    if(wantsPractice){
      return result("practice",
        "برای تمرین، یک دک ثابت انتخاب کن و پس از هر چند نبرد فقط نتیجه و هزینه میانگین اکسیر را از داده‌های قابل‌دسترس مرور کن. برای بررسی جایگذاری و زمان‌بندی کارت‌ها، Replay واقعی لازم است؛ اینجا اشتباه شخصی تو را حدس نمی‌زنیم.",
        "راهنمای عمومی، نه تحلیل شخصی Replay");
    }
    if(wantsCost){
      if(!Array.isArray(f.errors)||f.errors.length){
        return result("missing","ابتدا در دک‌ساز هشت کارت معتبر و بدون تکرار انتخاب کن تا میانگین اکسیر را محاسبه کنم.","دک فعلی هنوز کامل نیست");
      }
      if(!Number.isFinite(f.average)){
        return result("missing","هزینه یک یا چند کارت در داده‌های فعلی مشخص نیست؛ برای میانگین اکسیر عدد حدسی تولید نمی‌کنم.","داده ناقص هزینه کارت‌ها");
      }
      const cycle=Number.isFinite(f.cycle)?" هزینه چهار کارت ارزان‌تر "+fa(f.cycle)+" اکسیر است.":" هزینه چرخه چهار کارت مشخص نیست.";
      return result("deck","میانگین اکسیر هشت کارت دک فعلی "+fa(f.average)+" است."+cycle+" این‌ها شاخص‌های حسابی هستند و به‌تنهایی سرعت واقعی بازی یا شانس برد را پیش‌بینی نمی‌کنند.","محاسبات قطعی از کارت‌های دک فعلی");
    }
    if(wantsDeck){
      if(!Array.isArray(f.errors)||f.errors.length){
        return result("missing","برای بررسی دک، ابتدا هشت کارت معتبر در دک‌ساز انتخاب کن.","نیاز به دک کامل");
      }
      const valid=findings.filter(x=>x&&typeof x.title==="string"&&typeof x.text==="string").slice(0,2);
      if(!valid.length)return result("deck","در قواعد اولیه فعلی مشاهده قابل‌اتکای بیشتری درباره دک پیدا نشد؛ این به معنی بی‌نقص‌بودن دک نیست.","برچسب‌های مقدماتی کارت‌ها، بدون بازبینی تخصصی");
      return result("deck","دو نکته برای بررسی در دک فعلی: "+valid.map((x,i)=>(i+1)+") "+x.title+" — "+x.text).join(" ")+" این‌ها هشدار قطعی یا پیش‌بینی نتیجه نبرد نیستند.","قواعد اولیه دک؛ بازبینی تخصصی هنوز کامل نشده است");
    }
    return result("unsupported",
      "فعلاً این مربی یک راهنمای آفلاین مبتنی بر قواعد است، نه مدل زبانی مولد. می‌توانم درباره اکسیر دک، نکات اولیه ترکیب، آمار Battle Log و تمرین عمومی پاسخ مستند بدهم؛ یکی از پرسش‌های آماده را انتخاب کن.",
      "دامنه پاسخ‌های نسخه آفلاین");
  }
  root.CRCChatCoach=Object.freeze({VERSION:"guided-offline-0.1",PROMPTS,respond});
})(typeof window!=="undefined"?window:globalThis);
