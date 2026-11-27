// Server-owned, reviewed aggregate data only. No client snapshot, scraping or automatic API calls.
export const COACH_META_VERSION='crc-meta-v1';
// Intentionally empty until an authorized sample and documented collection methodology exist.
// A maintainer may add reviewed aggregate snapshots using the contract in docs/COACH_META_V1.md.
export const COACH_META_SNAPSHOTS=Object.freeze([]);
export function coachMetaMode(question){
  const q=String(question||'').toLowerCase().replace(/ي/g,'ی').replace(/ك/g,'ک');
  const matches=[['ranked',/رنک(?:د|ینگ)?|رتبه.?ای|\branked\b|\bpath of legends\b/],['trophy_road',/مسیر جام|تروفی|ترافی|\btrophy road\b/],['grand_challenge',/چالش بزرگ|\bgrand challenge\b/],['classic_challenge',/چالش کلاسیک|\bclassic challenge\b/]].filter(x=>x[1].test(q));
  return matches.length===1?matches[0][0]:null;
}
export function coachMetaValidate(value){
  if(!value||typeof value!=='object'||value.version!==1||value.source!=='supercell_api_own_aggregate'||value.reviewed!==true||
     !['ranked','trophy_road','grand_challenge','classic_challenge'].includes(value.mode))return null;
  const date=x=>typeof x==='string'&&/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(x)&&Number.isFinite(Date.parse(x))?Date.parse(x):NaN;
  const start=date(value.window_start),end=date(value.window_end),created=date(value.generated_at);
  if(![start,end,created].every(Number.isFinite)||start>=end||end>created||end-start>14*86400000||created-end>86400000)return null;
  const total=value.total_deck_observations;
  if(!Number.isSafeInteger(total)||total<200||total>10000000||!Array.isArray(value.decks)||!value.decks.length||value.decks.length>50)return null;
  if(typeof value.cohort!=='string'||!/^[a-z0-9 _-]{1,60}$/.test(value.cohort))return null;
  const decks=[],keys=new Set();let sum=0;
  for(const row of value.decks){
    if(!row||!Array.isArray(row.cards)||row.cards.length!==8||!Number.isInteger(row.plays)||row.plays<30||row.plays>total||
       !['wins','losses','draws'].every(k=>Number.isInteger(row[k])&&row[k]>=0&&row[k]<=row.plays)||row.wins+row.losses+row.draws!==row.plays)return null;
    const cards=[];
    for(const card of row.cards){
      if(!card||!Number.isSafeInteger(card.id)||card.id<=0||card.id>1000000000||
        typeof card.name!=='string'||!/^[A-Za-z0-9 .,'()&-]{1,65}$/.test(card.name)||
        ![0,1,2].includes(card.required_form)||!Number.isInteger(card.min_display_level)||card.min_display_level<1||card.min_display_level>16)return null;
      cards.push({id:card.id,name:card.name,required_form:card.required_form,min_display_level:card.min_display_level});
    }
    if(new Set(cards.map(c=>c.id)).size!==8)return null;
    cards.sort((a,b)=>a.id-b.id);
    const key=cards.map(c=>c.id+':'+c.required_form).join('|');
    if(keys.has(key))return null;keys.add(key);sum+=row.plays;
    if(sum>total)return null;
    decks.push({cards,plays:row.plays,wins:row.wins,losses:row.losses,draws:row.draws});
  }
  return {version:1,source:value.source,mode:value.mode,cohort:value.cohort,window_start:value.window_start,window_end:value.window_end,generated_at:value.generated_at,total_deck_observations:total,decks};
}
export function coachMetaSelect(snapshots,mode,now=Date.now()){
  if(!mode)return {status:'mode_required',snapshot:null};
  const valid=(Array.isArray(snapshots)?snapshots:[]).slice(0,20).map(coachMetaValidate).filter(s=>s&&s.mode===mode&&Date.parse(s.generated_at)<=now);
  valid.sort((a,b)=>Date.parse(b.window_end)-Date.parse(a.window_end)||Date.parse(b.generated_at)-Date.parse(a.generated_at));
  const newest=valid[0];
  if(!newest)return {status:'unavailable',snapshot:null};
  if(now-Date.parse(newest.window_end)>48*3600000)return {status:'stale',snapshot:null};
  return {status:'recent_sample',snapshot:newest};
}
export function coachMetaFit(row,personal){
  // Only a limited client-submitted subset is available, not the entire collection or proof of ownership.
  const owned=new Map(),conflicts=new Set();
  for(const card of [...(Array.isArray(personal?.deck_cards)?personal.deck_cards:[]),...(Array.isArray(personal?.owned_candidates)?personal.owned_candidates:[])].slice(0,16)){
    if(!card||!Number.isSafeInteger(card.id)||card.id<=0)continue;
    if(owned.has(card.id))conflicts.add(card.id);owned.set(card.id,card);
  }
  const missing=[],unknown=[],below=[],locked=[];
  for(const need of row.cards){
    const card=owned.get(need.id);
    if(!card||conflicts.has(need.id)){missing.push(need.id);continue;}
    if(!Number.isInteger(card.display_level)||card.display_level<1||card.display_level>16)unknown.push(need.id);
    else if(card.display_level<need.min_display_level)below.push(need.id);
    if(need.required_form){
      if(!Number.isInteger(card.unlocked_forms)||card.unlocked_forms<0||card.unlocked_forms>3)unknown.push(need.id);
      else if(!(card.unlocked_forms&need.required_form))locked.push(need.id);
    }
  }
  return {compatible:!missing.length&&!unknown.length&&!below.length&&!locked.length,not_in_submitted_subset:missing,unknown:[...new Set(unknown)],below_level:below,form_not_recorded:locked};
}
export function coachMetaAnswer(question,personal,now=Date.now(),snapshots=COACH_META_SNAPSHOTS){
  const mode=coachMetaMode(question),selection=coachMetaSelect(snapshots,mode,now);
  const unavailable='داده زنده و تاییدشده متا در این مسیر تحلیل در دسترس نیست؛ نمی‌توانم بهترین دک روز، محبوبیت یا نرخ برد فعلی را تایید کنم.';
  if(!Array.isArray(snapshots)||!snapshots.length)return unavailable;
  if(selection.status==='mode_required')return unavailable+'\nبرای بررسی نمونه معتبر، یک حالت را مشخص کن: Ranked، مسیر جام، چالش بزرگ یا چالش کلاسیک.';
  if(selection.status==='stale')return unavailable+'\nآخرین نمونه این حالت قدیمی است؛ آمار آن را به عنوان متای فعلی نمایش نمی‌دهم.';
  if(!selection.snapshot)return unavailable;
  const s=selection.snapshot;
  const labels={ranked:'Ranked',trophy_road:'مسیر جام',grand_challenge:'چالش بزرگ',classic_challenge:'چالش کلاسیک'};
  const ranked=s.decks.map(row=>({row,fit:coachMetaFit(row,personal)})).sort((a,b)=>Number(b.fit.compatible)-Number(a.fit.compatible)||b.row.plays-a.row.plays||b.row.wins/b.row.plays-a.row.wins/a.row.plays).slice(0,3);
  const rate=(n,d)=>(100*n/d).toFixed(1)+'٪';
  const lines=['## نمونه اخیر متا — '+labels[mode],'منبع: نمونه گردآوری‌شده از API رسمی Supercell؛ آمار کل بازی نیست. گروه نمونه: '+s.cohort,'بازه UTC: '+s.window_start+' تا '+s.window_end+'؛ تعداد مشاهده دک: '+s.total_deck_observations,'ترتیب: سازگاری با کارت‌های ارسالی، سپس تعداد مشاهده در همین نمونه.'];
  for(const {row,fit} of ranked){
    const names=row.cards.map(c=>c.name+(c.required_form===1?' (Evolution)':c.required_form===2?' (Hero)':'')).join('، ');
    lines.push('- '+names+' | مشاهده: '+row.plays+' | سهم مشاهده: '+rate(row.plays,s.total_deck_observations)+' | نرخ برد نمونه: '+rate(row.wins,row.plays)+' | '+(fit.compatible?'سطح و فرم لازم در زیرمجموعه کارت‌های ارسالی دیده شده است؛ اسلات و قوانین دک هنوز باید بررسی شوند.':'سازگاری کامل با داده کارت‌های ارسالی تایید نشده است؛ نبود کارت در این زیرمجموعه به معنی نداشتن آن نیست.'));
  }
  lines.push('این داده دک برتر قطعی، ضد دک یا احتمال برد آینده را ثابت نمی‌کند. سطح بازیکنان، فرم فعال، Tower Troop و قوانین حالت بازی می‌توانند نتیجه را تغییر دهند.');
  return lines.join('\n');
}
export function coachMetaDeclarations(){
  return ['const COACH_META_VERSION='+JSON.stringify(COACH_META_VERSION)+';','const COACH_META_SNAPSHOTS='+JSON.stringify(COACH_META_SNAPSHOTS)+';',coachMetaMode.toString(),coachMetaValidate.toString(),coachMetaSelect.toString(),coachMetaFit.toString(),coachMetaAnswer.toString()].join('\n');
}
