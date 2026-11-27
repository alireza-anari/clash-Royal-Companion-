// Curated official announcements, not a live in-game schedule. Never trust event data from a client or model.
export const COACH_EVENTS_VERSION='crc-events-v1';
const source=(id,title,url,published_at)=>({id,title,url,published_at,verified_at:'2026-11-26',publisher:'Supercell',authority:'official-support'});
export const COACH_EVENT_SOURCES=Object.freeze({
 K03:source('K03','Card Evolution','https://support.supercell.com/clash-royale/en/articles/card-evolution-8.html',null),
 K04:source('K04','What’s New — November 2026','https://support.supercell.com/clash-royale/en/articles/whats-new-november-2026.html','2026-11'),
 K05:source('K05','Watt’s New — October 2026','https://support.supercell.com/clash-royale/en/articles/watts-new-october-2026.html','2026-10'),
 K06:source('K06','New Season: King vs. King!','https://supercell.com/en/games/clashroyale/blog/release-notes/new-season-king-vs-king/','2026-10-27'),
 K07:source('K07','Challenges','https://support.supercell.com/clash-royale/en/articles/special-challenges-6.html',null),
 K08:source('K08','Cards & Decks','https://support.supercell.com/clash-royale/en/articles/cards-and-decks-6.html',null),
 K09:source('K09','Pass Royale','https://support.supercell.com/clash-royale/en/articles/pass-royale-11.html',null)
});
export const COACH_EVENT_CATALOG=Object.freeze([
 {id:'king-cards',name:'King of Cards',start:'2026-11-09',end:'2026-12-07',precision:'date',source_id:'K06',description:'رویداد تمرین شرط‌های برد؛ در اطلاعیه، Crown Tokens و جوایز دیگر ذکر شده‌اند.',deck_mode:'unknown'},
 {id:'quick-wit',name:'Quick Wit Challenge',start:'2026-11-16',end:'2026-11-23',precision:'date',source_id:'K06',description:'چالش اعلام‌شده در فصل نوامبر؛ قوانین دقیق و جدول جوایز در این منبع مشخص نشده است.',deck_mode:'unknown'},
 {id:'beatdown',name:'Beatdown Challenge',start:'2026-11-23',end:'2026-11-30',precision:'date',source_id:'K06',description:'چالش مرتبط با هفته چهارم شرط‌های برد. ترکیب مجاز و جوایز دقیق تأیید نشده‌اند.',deck_mode:'unknown',theme_cards:[{id:26000060,name:'Goblin Giant'},{id:26000056,name:'Skeleton Barrel'},{id:26000009,name:'Golem'},{id:26000085,name:'Electro Giant'},{id:26000029,name:'Lava Hound'},{id:26000067,name:'Elixir Golem'}]},
 {id:'siege-chip',name:'Siege & Chip Challenge',start:'2026-11-30',end:'2026-12-07',precision:'date',source_id:'K06',description:'چالش مرتبط با هفته پنجم شرط‌های برد. ترکیب مجاز و جوایز دقیق تأیید نشده‌اند.',deck_mode:'unknown',theme_cards:[{id:27000008,name:'X-Bow'},{id:26000032,name:'Miner'},{id:28000010,name:'Graveyard'},{id:27000013,name:'Goblin Drill'}]},
 {id:'daily-puzzles-first',name:'Daily Puzzles (سری اول)',start:'2026-11-02',end:'2026-11-08',precision:'date',source_id:'K06',description:'سناریوهای تمرینی با کارت‌های از پیش تعیین‌شده؛ هر کارت فقط یک بار قابل استفاده است. سری دوم اعلام شده، اما تاریخ دقیق آن در این اطلاعیه نیامده است.',deck_mode:'preset'},
 {id:'daily-puzzles-second',name:'Daily Puzzles (سری دوم)',start:null,end:null,precision:'unknown',source_id:'K06',description:'سری دوم در اطلاعیه ذکر شده؛ تاریخ دقیق و وضعیت فعلی مشخص نیست.',deck_mode:'preset'},
 {id:'royal-market',name:'Royal Market',start:'2026-11-09',end:'2026-12-07',precision:'date',source_id:'K06',description:'بازار فصلی با Crown Tokens؛ موجودی فعلی و امکان دریافت جایزه برای این حساب مشخص نیست.',deck_mode:'none'}
]);
export function coachEventValidate(e){
 if(!e||typeof e!=='object'||!Object.hasOwn(COACH_EVENT_SOURCES,e.source_id)||!/^[a-z0-9-]{1,60}$/.test(e.id||'')||typeof e.name!=='string'||!e.name.trim()||e.name.length>100||typeof e.description!=='string'||e.description.length>400||!['unknown','preset','personal','none'].includes(e.deck_mode))return null;
 const parse=x=>{
  if(typeof x!=='string')return NaN;
  if(e.precision==='date'){
   if(!/^\d{4}-\d{2}-\d{2}$/.test(x))return NaN;
   const t=Date.parse(x+'T00:00:00Z');return Number.isFinite(t)&&new Date(t).toISOString().slice(0,10)===x?t:NaN;
  }
  if(!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(x))return NaN;
  const t=Date.parse(x);return Number.isFinite(t)&&new Date(t).toISOString().replace('.000Z','Z')===x?t:NaN;
 };
 if(e.precision==='unknown'){if(e.start!==null||e.end!==null)return null;}
 else if(!['date','utc'].includes(e.precision)||!Number.isFinite(parse(e.start))||!Number.isFinite(parse(e.end))||parse(e.start)>=parse(e.end)||parse(e.end)-parse(e.start)>92*86400000)return null;
 const cards=e.theme_cards??[];
 if(!Array.isArray(cards)||cards.length>12||cards.some(c=>!c||!Number.isSafeInteger(c.id)||c.id<=0||typeof c.name!=='string'||!/^[A-Za-z0-9 .,'()&-]{1,65}$/.test(c.name))||new Set(cards.map(c=>c.id)).size!==cards.length)return null;
 return {...e,theme_cards:cards};
}
export function coachEventStatus(raw,now=Date.now()){
 const e=coachEventValidate(raw);if(!e||!Number.isFinite(now)||e.precision==='unknown')return 'unknown';
 // Date-only announcements never imply exact UTC times or verified availability.
 const start=Date.parse(e.start),end=Date.parse(e.end);
 if(e.precision==='date'){
  if(now<start-86400000)return 'announced_upcoming';
  if(now>=end+2*86400000)return 'announced_past';
  return 'announced_window';
 }
 return now<start?'scheduled_upcoming':now>=end?'scheduled_ended':'scheduled_window';
}
export function coachEventFit(e,personal){
 const cards=Array.isArray(personal?.deck_cards)?personal.deck_cards:[];
 const candidates=Array.isArray(personal?.owned_candidates)?personal.owned_candidates:[];
 const theme=e.theme_cards||[],current=[],other=[];
 for(const c of theme){
  if(cards.some(x=>x?.id===c.id))current.push(c.name);
  else if(candidates.some(x=>x?.id===c.id))other.push(c.name);
 }
 return {current,other,eligibility:'unknown'};
}
export function coachEventAnswer(question,personal,now=Date.now()){
 const q=String(question||'').toLowerCase().replace(/ي/g,'ی').replace(/ك/g,'ک'),sources=new Set();
 const add=(id)=>sources.add(id);
 const finish=answer=>({answer,sources:[...sources].slice(0,3).map(id=>COACH_EVENT_SOURCES[id])});
 const note='وضعیت زنده، ساعت دقیق یا موجودی جایزه برای حساب تو قابل تأیید نیست؛ داخل بازی بررسی کن.';
 if(/daily\s*puzzles?|پازل|معمای روزانه/.test(q)){
  add('K04');add('K06');return finish('## Daily Puzzles\nدر اطلاعیه نوامبر ۲۰۲۶، سناریوهای نبرد با کارت‌های از پیش تعیین‌شده معرفی شدند. یک تلاش تمرینی داری و تلاش‌های بعدی ثبت می‌شوند. سری اول برای ۲ تا ۸ نوامبر اعلام شد؛ سری دوم تاریخ دقیق اعلام‌شده ندارد. این خبر فعال بودن دائمی یا فعلی آن را ثابت نمی‌کند. دک شخصی پیشنهاد نمی‌دهم؛ ابتدا ترکیب همان معما را بررسی کن.');
 }
 if(/electro wizard|الکترو ویزارد/.test(q)&&/hero|هیرو|قهرمان/.test(q)){
  add('K05');return finish('در اطلاعیه اکتبر ۲۰۲۶، دریافت Hero Electro Wizard با Hero Coins یا انتخاب جایزه در مسیر ویژه Pass Royale معرفی شد. نمی‌توان تأیید کرد این پیشنهاد یا رویداد هنوز فعال است؛ موجودی سکه و امکان دریافت برای حساب تو معلوم نیست.');
 }
 if(/(event\s*deck|ایونت|رویداد|چالش)/.test(q)&&/evolution|ایوو|تکامل/.test(q)&&/محدود|قانون|همه|restrict/.test(q)){
  add('K03');return finish('بعضی رویدادها و چالش‌هایی که از Event Deck استفاده می‌کنند ممکن است جایگاه یا کارت Evolution را محدود کنند؛ این قانون برای همه رویدادها یکسان نیست. فرم بازشده در حساب به‌تنهایی مجوز استفاده در رویداد را ثابت نمی‌کند.');
 }
 if(/(دریافت|باز.?کردن|گرفتن|unlock|obtain|acquir)/.test(q)&&/evolution|hero|هیرو|ایوو|تکامل|کارت|card/.test(q)){
  add('K03');add('K09');add('K08');
  return finish('## مسیر دریافت کارت و فرم ویژه\n- کارت‌های پایه: صندوق‌ها، فروشگاه، مسیر جام و بعضی رویدادها از مسیرهای اعلام‌شده‌اند؛ شرایط هر کارت متفاوت است.\n- Evolution: برای تکمیل فرم، شش Shard همان کارت لازم است؛ Wild Shard می‌تواند کمک کند.\n- Hero: مسیر رایگان Pass Royale شامل Hero Coins است؛ انتخاب جوایز ویژه به شرایط همان فصل وابسته است.\nموجودی شارد، سکه، منابع و شرایط حساب از داده فعلی مشخص نیست؛ نمی‌توان تضمین کرد کارت دلخواه اکنون قابل دریافت است. بخش Collection و جایزه‌های داخل بازی را بررسی کن.');
 }
 const catalog=COACH_EVENT_CATALOG.map(coachEventValidate).filter(Boolean);
 const names=[['beatdown',/beatdown|بیت.?داون/],['siege-chip',/siege|chip|سیج/],['quick-wit',/quick wit|کوئیک/],['king-cards',/king of cards|کینگ آو کارد/],['royal-market',/royal market|رویال مارکت/]];
 const matches=names.filter(x=>x[1].test(q)).map(x=>x[0]);
 const specific=matches.length>0;
 const rows=catalog.filter(e=>specific?matches.includes(e.id):['announced_window','scheduled_window','announced_upcoming','scheduled_upcoming'].includes(coachEventStatus(e,now))).slice(0,5);
 if(!rows.length)return finish('برنامه به‌روز یا زمان‌بندی تأییدشده‌ای برای این رویداد در دسترس نیست. ساعت شروع و پایان، قوانین و جایزه را از بخش رویدادهای داخل بازی بررسی کن.');
 add('K06');
 const labels={announced_window:'در حوالی بازه اعلام‌شده؛ فعال بودن تأیید نشده',announced_upcoming:'طبق برنامه اعلام‌شده در آینده',announced_past:'بازه اعلام‌شده گذشته است',scheduled_upcoming:'طبق زمان‌بندی هنوز شروع نشده',scheduled_window:'در بازه زمان‌بندی؛ نه تأیید زنده',scheduled_ended:'زمان‌بندی اعلام‌شده پایان یافته',unknown:'زمان نامشخص'};
 const lines=['## رویدادها — اطلاعیه رسمی ۲۷ اکتبر ۲۰۲۶','فهرست زیر فقط بخشی از برنامه منتشرشده است؛ برنامه زنده کامل نیست.'];
 for(const e of rows){
  lines.push('- '+e.name+' | '+(e.start?e.start+' تا '+e.end:'زمان نامشخص')+' | '+labels[coachEventStatus(e,now)]);
  if(specific){lines.push(e.description);const fit=coachEventFit(e,personal);
   if(fit.current.length)lines.push('کارت مرتبط در دک ارسالی: '+fit.current.join('، '));
   if(fit.other.length)lines.push('کارت مرتبط در زیرمجموعه گزینه‌های ارسالی: '+fit.other.join('، '));
   if(e.theme_cards.length&&!fit.current.length&&!fit.other.length)lines.push('کارت مرتبط در داده محدود ارسالی پیدا نشد؛ به معنی نداشتن آن نیست.');
   if(e.deck_mode==='unknown')lines.push('پیشنهاد دک قطعی ممکن نیست؛ ابتدا محدودیت Event Deck و فرم‌ها را داخل بازی بررسی کن.');
  }
 }
 lines.push(note);return finish(lines.join('\n'));
}
export function coachEventDeclarations(){
 return ['const COACH_EVENTS_VERSION='+JSON.stringify(COACH_EVENTS_VERSION)+';','const COACH_EVENT_SOURCES='+JSON.stringify(COACH_EVENT_SOURCES)+';','const COACH_EVENT_CATALOG='+JSON.stringify(COACH_EVENT_CATALOG)+';',coachEventValidate.toString(),coachEventStatus.toString(),coachEventFit.toString(),coachEventAnswer.toString()].join('\n');
}
