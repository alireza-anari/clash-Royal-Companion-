/* Read-only Supercell backend adapter. Credentials NEVER cross this boundary. */
(function(root){
  'use strict';
  const VERSION='backend-contract-0.1';
  class BackendError extends Error{
    constructor(code,message,status){super(message);this.name='BackendError';this.code=code;this.status=status||0;}
  }
  function normalizeTag(value){
    if(typeof value!=='string')return null;
    const s=value.trim().toUpperCase().replace(/^#/,'');
    return /^[A-Z0-9]{3,16}$/.test(s)?'#'+s:null;
  }
  function route(tag,suffix=''){
    const valid=normalizeTag(tag);
    if(!valid)throw new BackendError('INVALID_TAG','Player Tag معتبر نیست.',422);
    return '/api/v1/players/'+encodeURIComponent(valid)+suffix;
  }
  async function json(fetchFn,url){
    let response;
    try{response=await fetchFn(url,{method:'GET',headers:{Accept:'application/json'},credentials:'omit',cache:'no-store'});}
    catch(e){throw new BackendError('NETWORK_UNAVAILABLE','ارتباط با Backend برقرار نشد.');}
    if(!response||typeof response.json!=='function')throw new BackendError('BAD_RESPONSE','پاسخ Backend قابل خواندن نیست.');
    if(!response.ok){
      let payload=null;
      try{payload=await response.json();}catch(e){}
      const code=payload&&payload.error&&typeof payload.error.code==='string'?payload.error.code:'HTTP_'+response.status;
      const messages={
        LIVE_BACKEND_NOT_CONFIGURED:'اتصال زنده در این محیط غیرفعال است.',
        PLAYER_NOT_FOUND:'بازیکنی با این Tag پیدا نشد.',
        UPSTREAM_FORBIDDEN:'اتصال سرور به Supercell مجاز نیست؛ تنظیم IP یا کلید بررسی شود.',
        UPSTREAM_RATE_LIMITED:'سرویس موقتاً محدودیت درخواست دارد.',
        UPSTREAM_TIMEOUT:'پاسخ Supercell دیر رسید؛ دوباره تلاش کن.',
        INVALID_PLAYER_TAG:'Player Tag نامعتبر است.',
        INVITE_SESSION_REQUIRED:'نشست ورود منقضی شده است؛ دوباره با کد دعوت وارد شو.',
        WORKER_ASSERTION_MISSING:'نشست معتبر نیست؛ دوباره با کد دعوت وارد شو.',
        WORKER_ASSERTION_INVALID:'نشست معتبر نیست؛ دوباره با کد دعوت وارد شو.',
        ACCESS_NOT_INVITED:'حساب فعلی در فهرست دعوت‌شدگان بتا نیست.',
        MEMBER_QUOTA_EXCEEDED:'سهمیه درخواست‌های این نشست به پایان رسیده است.',
        GLOBAL_QUOTA_EXCEEDED:'سقف درخواست‌های بتا موقتاً پر شده است.',
        BETA_ADMISSION_UNAVAILABLE:'خدمات ورود یا سهمیه بتا موقتاً در دسترس نیست.'
      };
      throw new BackendError(code,messages[code]||'درخواست Backend موفق نبود.',response.status);
    }
    let data;
    try{data=await response.json();}catch(e){throw new BackendError('BAD_JSON','پاسخ JSON نامعتبر است.');}
    if(!data||typeof data!=='object')throw new BackendError('BAD_RESPONSE','ساختار پاسخ Backend معتبر نیست.');
    return data;
  }
  async function capabilities(fetchFn){
    let result;
    try{result=await json(fetchFn,'/api/v1/capabilities');}
    catch(e){return {live_lookup_enabled:false,available:false,reason:e.code||'UNAVAILABLE'};}
    const valid=result.schema_version==='1.0';
    const live=valid&&result.live_lookup_enabled===true;
    return {live_lookup_enabled:live,ai_coach_enabled:valid&&result.ai_coach_enabled===true&&result.ai_external_data_requires_consent===true,available:valid,reason:live?null:'DISABLED'};
  }
  function toRawCard(value){
    if(!value||!Number.isSafeInteger(value.id)||typeof value.name!=='string')
      throw new BackendError('SCHEMA_MISMATCH','ساختار کارت دریافت‌شده سازگار نیست.');
    const c={id:value.id,name:value.name};
    if(Number.isInteger(value.elixir_cost)&&value.elixir_cost>=0)c.elixirCost=value.elixir_cost;
    if(Number.isInteger(value.level_raw))c.level=value.level_raw;
    if(Number.isInteger(value.max_level_raw))c.maxLevel=value.max_level_raw;
    if(Number.isInteger(value.evolution_level))c.evolutionLevel=value.evolution_level;
    if(Number.isInteger(value.max_evolution_level)&&value.max_evolution_level>=0&&value.max_evolution_level<=3)c.maxEvolutionLevel=value.max_evolution_level;
    if(Number.isInteger(value.star_level))c.starLevel=value.star_level;
    if(Number.isInteger(value.count))c.count=value.count;
    if(typeof value.rarity==='string')c.rarity=value.rarity;
    const icons={};
    const safeAsset=(url,prefix)=>typeof url==='string'&&url.startsWith('https://api-assets.clashroyale.com/'+prefix+'/')?url:null;
    const medium=safeAsset(value.icon_url,'cards');
    const hero=safeAsset(value.hero_icon_url,'cardheroes');
    const evolution=safeAsset(value.evolution_icon_url,'cardevolutions');
    if(medium)icons.medium=medium;
    if(hero)icons.heroMedium=hero;
    if(evolution)icons.evolutionMedium=evolution;
    if(value.max_evolution_level==null&&(hero||evolution))c.maxEvolutionLevel=(evolution?1:0)|(hero?2:0);
    if(Object.keys(icons).length)c.iconUrls=icons;
    return c;
  }
  function cardFormProgress(card){
    const available=Number.isInteger(card?.maxEvolutionLevel)&&card.maxEvolutionLevel>=0&&card.maxEvolutionLevel<=3?card.maxEvolutionLevel:0;
    const unlocked=Number.isInteger(card?.evolutionLevel)&&card.evolutionLevel>=0&&card.evolutionLevel<=3?card.evolutionLevel:0;
    return {
      evolution_available:(available&1)!==0,hero_available:(available&2)!==0,
      evolution_unlocked:(unlocked&1)!==0,hero_unlocked:(unlocked&2)!==0
    };
  }
  function collectionLevel(profile){
    const cards=[...(Array.isArray(profile?.cards)?profile.cards:[]),...(Array.isArray(profile?.supportCards)?profile.supportCards:[])];
    const unique=[...new Map(cards.filter(c=>c&&Number.isSafeInteger(c.id)).map(c=>[c.id,c])).values()];
    if(!unique.length)return null;
    const caps={common:16,rare:14,epic:11,legendary:8,champion:6};
    let base=0,evolutions=0,heroes=0;
    for(const card of unique){
      const rarity=typeof card.rarity==='string'?card.rarity.toLowerCase():'';
      const max=Number.isInteger(card.maxLevel)?card.maxLevel:caps[rarity];
      if(!Number.isInteger(card.level)||card.level<1||!Number.isInteger(max)||![6,8,11,14,16].includes(max)||card.level>max)return null;
      if(card.maxEvolutionLevel!=null&&(!Number.isInteger(card.maxEvolutionLevel)||card.maxEvolutionLevel<0||card.maxEvolutionLevel>3))return null;
      if(card.evolutionLevel!=null&&(!Number.isInteger(card.evolutionLevel)||card.evolutionLevel<0||card.evolutionLevel>3))return null;
      base+=card.level+16-max;
      const forms=cardFormProgress(card);
      if(forms.evolution_unlocked)evolutions++;
      if(forms.hero_unlocked)heroes++;
    }
    return {level:base+5*(evolutions+heroes),base_levels:base,card_count:unique.length,evolutions,heroes};
  }
  function normalizedToProfile(profileResponse,cardsResponse){
    if(!profileResponse||!profileResponse.profile||!cardsResponse||
       !Array.isArray(cardsResponse.items)||!Array.isArray(cardsResponse.support_items))
      throw new BackendError('SCHEMA_MISMATCH','پروفایل با قرارداد فعلی سازگار نیست.');
    const src=profileResponse.profile;
    if(!normalizeTag(src.tag))throw new BackendError('SCHEMA_MISMATCH','Tag پروفایل در پاسخ معتبر نیست.');
    const cards=cardsResponse.items.map(toRawCard);
    const supports=cardsResponse.support_items.map(toRawCard);
    const lookup=new Map(cards.concat(supports).map(c=>[c.id,c]));
    const ids=profileResponse.current_deck&&profileResponse.current_deck.card_ids;
    const supportIds=profileResponse.current_deck&&profileResponse.current_deck.support_card_ids;
    const lookupOrStub=id=>lookup.get(id)||{id,name:'Card '+id};
    const result={
      tag:src.tag,name:src.display_name||'',trophies:src.trophies,
      kingTowerLevel:src.king_tower_level,arena:src.arena||null,
      cards,supportCards:supports
    };
    if(Array.isArray(ids)&&ids.length===8&&ids.every(Number.isSafeInteger))
      result.currentDeck=ids.map(lookupOrStub);
    if(Array.isArray(supportIds))result.currentDeckSupportCards=supportIds.map(lookupOrStub);
    return result;
  }
  function participantToRaw(value){
    const ids=value&&value.deck&&value.deck.card_ids;
    const supports=value&&value.support_cards&&value.support_cards.card_ids;
    const p={
      tag:value.tag||null,name:value.name||null,crowns:value.crowns,
      elixirLeaked:value.elixir_leaked,trophyChange:value.trophy_change,
      kingTowerHitPoints:value.tower_hp&&value.tower_hp.king,
      princessTowersHitPoints:value.tower_hp&&value.tower_hp.princess,
      cards:Array.isArray(ids)?ids.map(id=>({id})):[],
    };
    if(Array.isArray(supports))p.supportCards=supports.map(id=>({id}));
    return p;
  }
  function normalizedToBattles(data){
    if(!data||!Array.isArray(data.items))throw new BackendError('SCHEMA_MISMATCH','ساختار Battle Log سازگار نیست.');
    return data.items.map(raw=>{
      if(!raw||!Array.isArray(raw.participants))throw new BackendError('SCHEMA_MISMATCH','شرکت‌کنندگان نبرد معتبر نیستند.');
      const result={
        battleTime:raw.battle_time||null,type:raw.type||null,
        deckSelection:raw.deck_selection||null,gameMode:raw.game_mode||null,
        team:[],opponent:[]
      };
      raw.participants.forEach(p=>{
        if(p.side==='team')result.team.push(participantToRaw(p));
        else if(p.side==='opponent')result.opponent.push(participantToRaw(p));
      });
      return result;
    });
  }
  async function loadPlayer(fetchFn,tag){
    const valid=normalizeTag(tag);
    if(!valid)throw new BackendError('INVALID_TAG','Player Tag نامعتبر است.',422);
    const cap=await capabilities(fetchFn);
    if(!cap.live_lookup_enabled)throw new BackendError('NOT_ENABLED','اتصال زنده هنوز در این محیط فعال نشده است.',503);
    const base=route(valid);
    // New backend: a single internal response, requiring only one upstream
    // profile call and one Battle Log call. Older local backends fall back.
    let snapshot=null;
    try{snapshot=await json(fetchFn,base+'/snapshot?limit=25');}
    catch(e){
      if(e.status!==404||!['HTTP_404','NOT_FOUND'].includes(e.code))throw e;
    }
    if(snapshot){
      const prof=normalizedToProfile(
        {profile:snapshot.profile,current_deck:snapshot.current_deck,source:snapshot.source},
        {items:snapshot.cards,support_items:snapshot.support_items}
      );
      if(normalizeTag(prof.tag)!==valid)
        throw new BackendError('TAG_MISMATCH','پروفایل دریافتی با Tag درخواستی مطابقت ندارد.');
      if(!Array.isArray(snapshot.battles))
        throw new BackendError('SCHEMA_MISMATCH','نبردهای تجمیعی معتبر نیستند.');
      const battleData=normalizedToBattles({items:snapshot.battles});
      return {
        tag:valid,profile:prof,battles:battleData,partial:snapshot.partial===true,
        source:'live-supercell-backend',fetched_at:snapshot.source&&snapshot.source.fetched_at||null,
        full_history:false,ownership_verified:false
      };
    }
    const [p,c,b]=await Promise.allSettled([
      json(fetchFn,base),json(fetchFn,base+'/cards'),json(fetchFn,base+'/battles?limit=25')
    ]);
    if(p.status!=='fulfilled')throw p.reason;
    if(c.status!=='fulfilled')throw c.reason;
    const profile=p.value;
    const normalized=normalizedToProfile(profile,c.value);
    if(normalizeTag(normalized.tag)!==valid)
      throw new BackendError('TAG_MISMATCH','پروفایل دریافتی با Tag درخواستی مطابقت ندارد.');
    let battles=[],partial=b.status==='rejected';
    if(b.status==='fulfilled'){
      try{battles=normalizedToBattles(b.value);}
      catch(e){partial=true;}
    }
    return {
      tag:valid,profile:normalized,battles,partial,
      source:'live-supercell-backend',fetched_at:profile.source&&profile.source.fetched_at||null,
      full_history:false,ownership_verified:false
    };
  }
  // Only card metadata and aggregated battle evidence, never player identity.
  function personalCoachContext(facts, profile, catalog, candidateIds, deckSource, entries){
    const selected=facts&&Array.isArray(facts.items)&&!facts.errors?.length?facts.items:[];
    const owned=new Map((profile?.cards||[]).filter(c=>c&&Number.isSafeInteger(c.id)).map(c=>[c.id,c]));
    const catalogById=new Map((catalog||[]).map(c=>[c.id,c]));
    const ids=new Set(selected.map(c=>c.id));
    const caps={common:16,rare:14,epic:11,legendary:8,champion:6};
    const describe=c=>{
      const o=owned.get(c.id)||{};
      const rarity=typeof o.rarity==="string"?o.rarity.toLowerCase():null;
      const item={id:c.id,name:String(c.name||"").slice(0,65),elixir:Number.isInteger(c.elixir)?c.elixir:null,rarity,active_form:"unknown"};
      if(Number.isInteger(o.level)&&caps[rarity]===o.maxLevel&&o.level>=1&&o.level<=o.maxLevel)item.display_level=o.level+16-o.maxLevel;
      if(Number.isInteger(o.evolutionLevel)&&o.evolutionLevel>=0&&o.evolutionLevel<=3)item.unlocked_forms=o.evolutionLevel;
      if(Number.isInteger(o.maxEvolutionLevel)&&o.maxEvolutionLevel>=0&&o.maxEvolutionLevel<=3)item.max_evolution_level=o.maxEvolutionLevel;
      if(Number.isInteger(o.starLevel)&&o.starLevel>=0&&o.starLevel<=3)item.star_level=o.starLevel;
      return item;
    };
    const candidates=[...new Set(candidateIds||[])].filter(id=>owned.has(id)&&!ids.has(id)&&catalogById.has(id)&&catalogById.get(id).type!=="support").slice(0,6).map(id=>describe(catalogById.get(id)));
    const counts={wins:0,losses:0,draws:0,unknown:0};
    const key=selected.length===8?[...ids].sort((a,b)=>a-b).join(":"):null;
    const matched=(entries||[]).filter(e=>e.attribution==="matched_tag").slice(0,200);
    const groups=new Map(),leak=[],winLeak=[],lossLeak=[];
    for(const e of matched){
      const id=Array.isArray(e.deck?.card_ids)?e.deck.card_ids.slice().sort((a,b)=>a-b).join(":"):null;
      if(id)groups.set(id,(groups.get(id)||0)+1);
      if(Number.isFinite(e.elixir_leaked)&&e.elixir_leaked>=0&&e.elixir_leaked<=1000){leak.push(e.elixir_leaked);if(e.outcome==='win')winLeak.push(e.elixir_leaked);if(e.outcome==='loss')lossLeak.push(e.elixir_leaked);}
      if(key&&id===key)counts[{win:"wins",loss:"losses",draw:"draws",unknown:"unknown"}[e.outcome]||"unknown"]++;
    }
    const avg=xs=>xs.length?Math.round(xs.reduce((s,n)=>s+n,0)/xs.length*100)/100:null;
    return {deck_source:deckSource,deck_cards:selected.map(describe),owned_candidates:candidates,selected_deck_results:counts,style:{records:matched.length,distinct_decks:groups.size,most_used_deck_matches:Math.max(0,...groups.values()),elixir_leaked_sample:leak.length,elixir_leaked_average:avg(leak),win_leaked_sample:winLeak.length,win_leaked_average:avg(winLeak),loss_leaked_sample:lossLeak.length,loss_leaked_average:avg(lossLeak)}};
  }
  // Opt-in, device-local memory. It stores compact snapshots only: no raw Battle Log, tags in values, or chat text.
  const COACH_MEMORY_VERSION=1;
  const COACH_MEMORY_FOCI=new Set(['balanced','cycle','elixir','defense','pressure','deck']);
  const COACH_MEMORY_SOURCES=new Set(['live','imported']);
  const COACH_MEMORY_DECK_SOURCES=new Set(['profile-live','profile-import','profile-edited','manual','sample','battle-event-import','battle-import']);
  function cleanCoachMemoryCounts(value,total){
    const keys=['wins','losses','draws','unknown'];
    if(!value||!Number.isInteger(total)||total<0||total>200||!keys.every(k=>Number.isInteger(value[k])&&value[k]>=0&&value[k]<=200))return null;
    const out=Object.fromEntries(keys.map(k=>[k,value[k]]));
    return keys.reduce((sum,k)=>sum+out[k],0)===total?out:null;
  }
  function cleanCoachMemorySnapshot(value){
    if(!value||typeof value!=='object'||Array.isArray(value))return null;
    const captured=typeof value.captured_at==='string'&&value.captured_at.length<=40&&Number.isFinite(Date.parse(value.captured_at))?value.captured_at:null;
    const deck=Array.isArray(value.deck_card_ids)?value.deck_card_ids.slice(0,8):[];
    if(!captured||deck.length!==8||!deck.every(id=>Number.isSafeInteger(id)&&id>0&&id<=1000000000)||new Set(deck).size!==8)return null;
    const cards=Array.isArray(value.cards)?value.cards.slice(0,8):[];
    if(cards.length!==8||new Set(cards.map(c=>c?.id)).size!==8||cards.some(c=>!c||!deck.includes(c.id)))return null;
    const cleanCards=cards.map(c=>{
      const item={id:c.id};
      if(Number.isInteger(c.level)&&c.level>=1&&c.level<=16)item.level=c.level;
      if(['common','rare','epic','legendary','champion'].includes(c.rarity))item.rarity=c.rarity;
      if(Number.isInteger(c.evolution_level)&&c.evolution_level>=0&&c.evolution_level<=3)item.evolution_level=c.evolution_level;
      if(Number.isInteger(c.max_evolution_level)&&c.max_evolution_level>=0&&c.max_evolution_level<=3)item.max_evolution_level=c.max_evolution_level;
      if(Number.isInteger(c.star_level)&&c.star_level>=0&&c.star_level<=3)item.star_level=c.star_level;
      return item;
    }).sort((a,b)=>deck.indexOf(a.id)-deck.indexOf(b.id));
    const b=value.battles,bc=cleanCoachMemoryCounts(b?.outcomes,b?.matched_records);
    if(!bc||!Number.isInteger(b.elixir_leak_sample)||b.elixir_leak_sample<0||b.elixir_leak_sample>b.matched_records||
       !(b.avg_elixir_leaked===null||(typeof b.avg_elixir_leaked==='number'&&Number.isFinite(b.avg_elixir_leaked)&&b.avg_elixir_leaked>=0&&b.avg_elixir_leaked<=1000)))return null;
    const selected=value.selected_deck,sc=cleanCoachMemoryCounts(selected?.outcomes,selected?.matched_records);
    if(!sc||selected.matched_records>b.matched_records)return null;
    const patterns=Array.isArray(value.deck_patterns)?value.deck_patterns.slice(0,3):[];
    const cleanPatterns=[];
    for(const p of patterns){
      const ids=Array.isArray(p?.deck_card_ids)?p.deck_card_ids.slice(0,8):[];
      const outcomes=cleanCoachMemoryCounts(p?.outcomes,p?.plays);
      if(ids.length!==8||!ids.every(id=>Number.isSafeInteger(id)&&id>0&&id<=1000000000)||new Set(ids).size!==8||!outcomes||
         !Number.isInteger(p.event_plays)||p.event_plays<0||p.event_plays>p.plays)continue;
      cleanPatterns.push({deck_card_ids:ids,plays:p.plays,outcomes,event_plays:p.event_plays});
    }
    const source=COACH_MEMORY_SOURCES.has(value.source)?value.source:'imported';
    const deckSource=COACH_MEMORY_DECK_SOURCES.has(value.deck_source)?value.deck_source:'manual';
    const latest=typeof value.latest_battle_at==='string'&&value.latest_battle_at.length<=40?value.latest_battle_at:null;
    return {
      captured_at:captured,source,deck_source:deckSource,deck_card_ids:deck,cards:cleanCards,
      battles:{matched_records:b.matched_records,outcomes:bc,elixir_leak_sample:b.elixir_leak_sample,avg_elixir_leaked:b.avg_elixir_leaked},
      selected_deck:{matched_records:selected.matched_records,outcomes:sc},
      deck_patterns:cleanPatterns,latest_battle_at:latest
    };
  }
  const COACH_MEMORY_ACTIONS=new Set(['deck','suggestions','style','overview']);
  const COACH_MEMORY_OUTCOMES=new Set(['improved','same','worse','not_tried']);
  function cleanCoachPractice(value){
    if(!value||typeof value!=='object'||!COACH_MEMORY_ACTIONS.has(value.action)||
      typeof value.created_at!=='string'||value.created_at.length>40||!Number.isFinite(Date.parse(value.created_at)))return null;
    const ids=Array.isArray(value.deck_card_ids)?value.deck_card_ids.slice(0,8):[];
    if(ids.length!==8||!ids.every(id=>Number.isSafeInteger(id)&&id>0&&id<=1000000000)||new Set(ids).size!==8)return null;
    const zero={wins:0,losses:0,draws:0,unknown:0};
    const counts=(raw,total)=>{
      const clean=cleanCoachMemoryCounts(raw,total);
      return clean?{matched_records:total,outcomes:clean}:null;
    };
    const baseline=value.baseline==null?null:counts(value.baseline.outcomes,value.baseline.matched_records);
    const progress=value.progress==null?{matched_records:0,outcomes:zero}:counts(value.progress.outcomes,value.progress.matched_records);
    if(value.baseline!=null&&!baseline||!progress)return null;
    const validDate=x=>typeof x==='string'&&x.length<=40&&Number.isFinite(Date.parse(x))?x:null;
    const since=validDate(value.since_battle_at),last=validDate(value.last_battle_at);
    if(value.since_battle_at!=null&&!since||value.last_battle_at!=null&&!last)return null;
    if(last&&since&&Date.parse(last)<Date.parse(since))return null;
    const targetKind=value.target_kind==='suggested_deck'&&value.action==='suggestions'?'suggested_deck':'current_deck';
    if(value.target_kind!=null&&!['current_deck','suggested_deck'].includes(value.target_kind)||value.target_kind==='suggested_deck'&&value.action!=='suggestions')return null;
    return {action:value.action,target_kind:targetKind,deck_card_ids:ids,created_at:value.created_at,baseline,progress,since_battle_at:since,last_battle_at:last};
  }
  function cleanCoachFeedback(value){
    const pending=cleanCoachPractice(value);
    return pending&&COACH_MEMORY_OUTCOMES.has(value.outcome)&&typeof value.recorded_at==='string'&&value.recorded_at.length<=40&&Number.isFinite(Date.parse(value.recorded_at))?
      {...pending,outcome:value.outcome,recorded_at:value.recorded_at}:null;
  }
  // Timestamp-based conservative deduplication; a timestamp is not a battle ID.
  function coachDistinctBattles(entries){
    const groups=new Map(),conflicts=new Set();
    for(const e of (Array.isArray(entries)?entries:[]).slice(0,200)){
      if(!e||e.attribution!=='matched_tag'||typeof e.battle_time!=='string'||
        !Number.isFinite(Date.parse(e.battle_time))||!['win','loss','draw','unknown'].includes(e.outcome))continue;
      const stamp=new Date(Date.parse(e.battle_time)).toISOString();
      const ids=e.deck?.card_ids;
      const key=Array.isArray(ids)&&ids.length===8&&ids.every(id=>Number.isSafeInteger(id)&&id>0)&&new Set(ids).size===8?ids.slice().sort((a,b)=>a-b).join(':'):null;
      const fingerprint=JSON.stringify([key,e.outcome,e.classification??null,e.game_mode??null,e.elixir_leaked??null]);
      if(groups.has(stamp)&&groups.get(stamp).fingerprint!==fingerprint)conflicts.add(stamp);
      else if(!groups.has(stamp))groups.set(stamp,{fingerprint,entry:{...e,battle_time:stamp}});
    }
    return [...groups].filter(([stamp])=>!conflicts.has(stamp)).map(([,value])=>value.entry).sort((a,b)=>a.battle_time.localeCompare(b.battle_time));
  }
  function coachPracticeDelta(entries,pending){
    const task=cleanCoachPractice(pending);
    if(!task||!Array.isArray(entries))return null;
    const watermark=Math.max(...[task.created_at,task.since_battle_at,task.last_battle_at].filter(Boolean).map(Date.parse));
    const key=task.deck_card_ids.slice().sort((a,b)=>a-b).join(':');
    const remaining=200-task.progress.matched_records;
    if(remaining<=0)return null;
    const fresh=coachDistinctBattles(entries).filter(e=>
      e.deck&&Array.isArray(e.deck.card_ids)&&e.deck.card_ids.length===8&&
      e.deck.card_ids.slice().sort((a,b)=>a-b).join(':')===key&&Date.parse(e.battle_time)>watermark).slice(0,remaining);
    if(!fresh.length)return null;
    const outcomes={wins:0,losses:0,draws:0,unknown:0};
    fresh.forEach(e=>{outcomes[{win:'wins',loss:'losses',draw:'draws',unknown:'unknown'}[e.outcome]]++;});
    return {matched_records:fresh.length,outcomes,last_battle_at:fresh[fresh.length-1].battle_time};
  }
  // Five known results is a practice checkpoint, not statistical confidence.
  function coachPracticePlan(memory){
    const clean=cleanCoachMemory(memory);
    if(!clean)return null;
    const task=clean.pending_practice,feedback=clean.practice_feedback[0],focus=clean.focus;
    const steps={
      balanced:['با یک دک ثابت بازی کن و پس از هر نبرد یک نکته برای مرور انتخاب کن.','نتیجه را بدون نسبت دادن علت به مربی ثبت کن.'],
      cycle:['یک کارت کلیدی حریف را انتخاب کن و چرخه آن را در طول بازی دنبال کن.','پیش از حمله، به در دسترس بودن پاسخ دفاعی توجه کن.'],
      elixir:['پس از دفاع، قبل از سرمایه‌گذاری برای حمله اکسیر خود را بررسی کن.','اکسیر هدررفته گزارش‌شده را فقط در نبردهای دارای این داده مرور کن.'],
      defense:['پاسخ دفاعی اصلی دک را برای تهدید مناسب نگه دار.','پس از دفاع موفق، فقط در صورت داشتن اکسیر کافی ضدحمله کن.'],
      pressure:['شرط برد دک را با نیروهای باقی‌مانده از دفاع هماهنگ کن.','اگر دفاع کافی نداری، فشار را متوقف کن.'],
      deck:['در هر دوره فقط یک تغییر تأییدشده را آزمایش کن؛ فرم‌های ویژه را بدون داده کافی عوض نکن.','اگر پیشنهادی معتبر نیست، همان دک را نگه دار و سؤال دقیق‌تر بپرس.']
    };
    const known=task?task.progress.outcomes.wins+task.progress.outcomes.losses+task.progress.outcomes.draws:0;
    return {focus,steps:steps[focus].slice(),target:5,known,remaining:Math.max(0,5-known),
      status:!task?'ready':known>=5?'review':'practice',
      follow_up:feedback?.outcome==='worse'?'در بازبینی بعدی توضیح بده کدام بخش تمرین دشوار بود؛ این بازخورد به‌تنهایی افت عملکرد را اثبات نمی‌کند.':null};
  }
  // Proactive prompts are deterministic local hints, never AI replies or automatic requests.
  function coachProactiveHint(profile,deckIds,entries,memory,now=Date.now()){
    if(!normalizeTag(profile?.tag))return null;
    const clean=cleanCoachMemory(memory),task=clean?.pending_practice;
    const plan=clean&&coachPracticePlan(clean);
    if(task&&plan?.status==='review')return {key:'review:'+task.created_at,kind:'review',icon:'✓',title:'وقت مرور تمرین است',detail:'به نقطه بازبینی تمرین رسیده‌ای؛ نتیجه‌ای که تجربه کردی ثبت کن.',action:'review'};
    const keyFor=ids=>Array.isArray(ids)&&ids.length===8&&ids.every(id=>Number.isSafeInteger(id)&&id>0)&&new Set(ids).size===8?ids.slice().sort((x,y)=>x-y).join(':'):null;
    const key=keyFor(deckIds),actual=keyFor(Array.isArray(profile.currentDeck)?profile.currentDeck.map(x=>x?.id):null);
    if(!key||key!==actual||!Array.isArray(profile.cards))return null;
    const owned=new Map(),duplicates=new Set();
    for(const card of profile.cards.slice(0,400)){
      if(!card||!Number.isSafeInteger(card.id))continue;
      if(owned.has(card.id))duplicates.add(card.id);
      owned.set(card.id,card);
    }
    const cards=deckIds.map(id=>owned.get(id));
    if(cards.some(x=>!x||duplicates.has(x.id)))return null;
    // Only explicitly reported unlocked/capability fields; never infer from icon or rarity.
    for(const card of cards.slice().sort((x,y)=>x.id-y.id)){
      const available=card.maxEvolutionLevel,unlocked=card.evolutionLevel;
      if(!Number.isInteger(available)||available<0||available>3||!Number.isInteger(unlocked)||unlocked<0||unlocked>3||(unlocked&~available)!==0)continue;
      const locked=available&~unlocked;
      if(locked){const form=(locked&1)?'Evolution':'Hero';
        return {key:'form:'+card.id+':'+available+':'+unlocked,kind:'form',icon:'✦',title:'فرم ویژه قابل بررسی',detail:'در اطلاعات پروفایل، این کارت قابلیت '+form+' دارد اما باز شدن این فرم ثبت نشده است. منابع لازم را جداگانه بررسی کن.',card_id:card.id,action:'ask',
          question:'فرم‌های ویژه کارت‌های دک فعلی من را بر اساس داده‌های موجود بررسی کن. اولویت بررسی Evolution یا Hero چیست؟ منابع یا امکان خرید را فرض نکن.'};
      }
    }
    const caps={common:16,rare:14,epic:11,legendary:8,champion:6};
    const levels=cards.map(card=>{
      const cap=caps[String(card.rarity||'').toLowerCase()];
      return Number.isInteger(cap)&&card.maxLevel===cap&&Number.isInteger(card.level)&&card.level>=1&&card.level<=cap?{id:card.id,level:card.level+16-cap}:null;
    });
    if(levels.every(Boolean)){
      const ordered=levels.slice().sort((x,y)=>x.level-y.level||x.id-y.id),lowest=ordered[0],median=(ordered[3].level+ordered[4].level)/2;
      if(median-lowest.level>=2)return {key:'level:'+lowest.id+':'+lowest.level,kind:'level',icon:'↑',title:'اولویت ارتقا را بررسی کن',detail:'سطح این کارت در داده فعلی از سطح میانی دک پایین‌تر است. این فقط دلیل بررسی است، نه دستور ارتقا یا تضمین برد.',card_id:lowest.id,action:'ask',
        question:'سطح کارت‌های دک فعلی من را با توجه به نقش و منابع نامشخص بررسی کن؛ کدام کارت اولویت بررسی برای ارتقا دارد؟'};
    }
    const recent=coachDistinctBattles(entries).filter(e=>keyFor(e.deck?.card_ids)===key&&['win','loss','draw'].includes(e.outcome)&&typeof e.game_mode==='string'&&e.game_mode.trim()&&e.game_mode.length<=100&&Date.parse(e.battle_time)<=now&&now-Date.parse(e.battle_time)<=7*86400000).slice(-3);
    if(recent.length===3&&recent.every(e=>e.outcome==='loss'&&e.game_mode===recent[0].game_mode&&e.classification===recent[0].classification)){
      return {key:'review-deck:'+key,kind:'battle',icon:'⚔',title:'فرصت بازبینی دک',detail:'سه نتیجه اخیر قابل مقایسه از همین ترکیب در یک حالت، باخت بوده‌اند. علت شکست از Battle Log مشخص نیست.',action:'ask',
        question:'نتایج اخیر دک فعلی مرا بررسی کن و یک تمرین عملی پیشنهاد بده. علت شکست یا اتفاقات ریپلی را حدس نزن.'};
    }
    return null;
  }
  function createCoachHintSession(){
    const dismissed=new Map();
    return Object.freeze({
      visible(tag,hint){const key=normalizeTag(tag);return key&&hint&&!dismissed.get(key)?.includes(hint.key)?hint:null;},
      dismiss(tag,hint){const key=normalizeTag(tag);if(!key||!hint||typeof hint.key!=='string'||hint.key.length>160)return false;
        const previous=dismissed.get(key)||[];dismissed.delete(key);dismissed.set(key,[...new Set([...previous,hint.key])].slice(-24));
        while(dismissed.size>16)dismissed.delete(dismissed.keys().next().value);
        return true;}
    });
  }
  function cleanCoachMemory(value){
    if(!value||typeof value!=='object'||Array.isArray(value)||value.version!==COACH_MEMORY_VERSION)return null;
    const focus=COACH_MEMORY_FOCI.has(value.focus)?value.focus:'balanced';
    const snapshots=(Array.isArray(value.snapshots)?value.snapshots:[]).slice(0,2).map(cleanCoachMemorySnapshot).filter(Boolean);
    const pending=cleanCoachPractice(value.pending_practice);
    const feedback=(Array.isArray(value.practice_feedback)?value.practice_feedback:[]).slice(0,3).map(cleanCoachFeedback).filter(Boolean);
    return {version:COACH_MEMORY_VERSION,focus,snapshots,pending_practice:pending,practice_feedback:feedback};
  }
  function createCoachMemory(storage){
    const validTag=value=>normalizeTag(value);
    const key=tag=>'crc.coach.memory.v1.'+validTag(tag).slice(1);
    const readStored=tag=>{
      if(!validTag(tag)||!storage||typeof storage.getItem!=='function')return null;
      try{
        const raw=storage.getItem(key(tag));if(!raw||raw.length>24000)return null;
        const value=JSON.parse(raw);
        if(!value||value.version!==COACH_MEMORY_VERSION||typeof value.enabled!=='boolean')return null;
        return {version:COACH_MEMORY_VERSION,enabled:value.enabled,focus:COACH_MEMORY_FOCI.has(value.focus)?value.focus:'balanced',
          snapshots:(Array.isArray(value.snapshots)?value.snapshots:[]).slice(0,3).map(cleanCoachMemorySnapshot).filter(Boolean),
          pending_practice:cleanCoachPractice(value.pending_practice),practice_feedback:(Array.isArray(value.practice_feedback)?value.practice_feedback:[]).slice(0,3).map(cleanCoachFeedback).filter(Boolean)};
      }catch{return null;}
    };
    const write=(tag,value)=>{
      if(!validTag(tag)||!storage||typeof storage.setItem!=='function')return false;
      try{storage.setItem(key(tag),JSON.stringify(value));return true;}catch{return false;}
    };
    return Object.freeze({
      isEnabled(tag){return readStored(tag)?.enabled===true;},
      setEnabled(tag,enabled){
        if(!validTag(tag)||typeof enabled!=='boolean')return false;
        const old=readStored(tag)||{version:COACH_MEMORY_VERSION,enabled:false,focus:'balanced',snapshots:[],pending_practice:null,practice_feedback:[]};
        return write(tag,{...old,enabled});
      },
      read(tag){
        const value=readStored(tag);if(!value?.enabled)return null;
        return cleanCoachMemory({version:COACH_MEMORY_VERSION,focus:value.focus,snapshots:value.snapshots,pending_practice:value.pending_practice,practice_feedback:value.practice_feedback});
      },
      setFocus(tag,focus){
        if(!COACH_MEMORY_FOCI.has(focus))return false;
        const old=readStored(tag);if(!old?.enabled)return false;
        return write(tag,{...old,focus});
      },
      record(tag,snapshot){
        const old=readStored(tag);if(!old?.enabled)return false;
        const clean=cleanCoachMemorySnapshot(snapshot);if(!clean)return false;
        const fingerprint=value=>JSON.stringify({...value,captured_at:null});
        if(old.snapshots[0]&&fingerprint(old.snapshots[0])===fingerprint(clean))return true;
        return write(tag,{...old,snapshots:[clean,...old.snapshots].slice(0,3)});
      },
      recordPractice(tag,action,deckCardIds,baseline,sinceBattleAt,targetKind){
        const old=readStored(tag);if(!old?.enabled||old.pending_practice||!COACH_MEMORY_ACTIONS.has(action))return false;
        const zero={wins:0,losses:0,draws:0,unknown:0};
        const createdAt=new Date().toISOString();
        const clean=cleanCoachPractice({
          action,target_kind:targetKind||'current_deck',deck_card_ids:deckCardIds,created_at:createdAt,
          baseline:baseline&&baseline.outcomes?baseline:null,
          progress:{matched_records:0,outcomes:zero},since_battle_at:sinceBattleAt||null,last_battle_at:sinceBattleAt&&Date.parse(sinceBattleAt)>Date.parse(createdAt)?sinceBattleAt:createdAt
        });
        return clean?write(tag,{...old,pending_practice:clean}):false;
      },
      addPracticeProgress(tag,delta,lastBattleAt){
        const old=readStored(tag),pending=old?.pending_practice;
        if(!old?.enabled||!pending||!delta||!Number.isInteger(delta.matched_records)||delta.matched_records<1||delta.matched_records>200)return false;
        const clean=cleanCoachMemoryCounts(delta.outcomes,delta.matched_records);
        const stamp=typeof lastBattleAt==='string'&&lastBattleAt.length<=40&&Number.isFinite(Date.parse(lastBattleAt))?lastBattleAt:null;
        if(!clean||!stamp||pending.progress.matched_records+delta.matched_records>200)return false;
        const watermark=Math.max(...[pending.created_at,pending.since_battle_at,pending.last_battle_at].filter(Boolean).map(Date.parse));
        if(Date.parse(stamp)<=watermark)return false;
        const outcomes=Object.fromEntries(['wins','losses','draws','unknown'].map(k=>[k,pending.progress.outcomes[k]+clean[k]]));
        const progress={matched_records:pending.progress.matched_records+delta.matched_records,outcomes};
        const next=cleanCoachPractice({...pending,progress,last_battle_at:stamp});
        return next?write(tag,{...old,pending_practice:next}):false;
      },
      submitPracticeFeedback(tag,outcome){
        const old=readStored(tag);if(!old?.enabled||!COACH_MEMORY_OUTCOMES.has(outcome)||!old.pending_practice)return false;
        const feedback=cleanCoachFeedback({...old.pending_practice,outcome,recorded_at:new Date().toISOString()});
        if(!feedback)return false;
        return write(tag,{...old,pending_practice:null,practice_feedback:[feedback,...old.practice_feedback].slice(0,3)});
      },
      clear(tag){
        if(!validTag(tag)||!storage||typeof storage.removeItem!=='function')return false;
        try{storage.removeItem(key(tag));return true;}catch{return false;}
      }
    });
  }
  // Page-local conversation retains only two successful turns.
  function createCoachSession(){
    let scope=null,turns=[];
    function sync(next){if(next!==scope){scope=next;turns=[];return true;}return false;}
    return Object.freeze({
      clear(){turns=[];scope=null;},
      history(next){sync(next);return turns.map(t=>({...t}));},
      record(next,question,answer){
        if(next!==scope||typeof question!=="string"||typeof answer!=="string"||!question.trim()||!answer.trim())return;
        turns=[...turns,{question:question.slice(0,280),answer:answer.slice(0,600)}].slice(-2);
      }
    });
  }
  function cleanCoachHistory(history){
    const redact=(s,max)=>s.replace(/#[A-Z0-9]{3,16}\b/gi,"[tag]").replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi,"[email]").trim().slice(0,max);
    return (Array.isArray(history)?history:[]).slice(-2).filter(t=>t&&typeof t.question==="string"&&typeof t.answer==="string").map(t=>({question:redact(t.question,280),answer:redact(t.answer,600)})).filter(t=>t.question&&t.answer);
  }
  const coachBytes=value=>new TextEncoder().encode(JSON.stringify(value)).length;
  function cleanOutcomeCounts(value){
    const keys=["wins","losses","draws","unknown"];
    if(!value||!keys.every(k=>Number.isInteger(value[k])&&value[k]>=0&&value[k]<=200))return null;
    const counts=Object.fromEntries(keys.map(k=>[k,value[k]]));
    return Object.values(counts).reduce((a,b)=>a+b,0)<=200?counts:null;
  }
  function coachPayload(question,facts,evidence,personal,action){
    const q=String(question||'').trim();
    if(q.length<3||q.length>280)throw new BackendError('INVALID_INPUT','سؤال باید بین ۳ و ۲۸۰ نویسه باشد.');
    const payload={consent_to_external_ai:true,question:q};
    if(['deck','suggestions','style','overview'].includes(action))payload.action=action;
    if(facts&&Array.isArray(facts.errors)&&!facts.errors.length&&Array.isArray(facts.items)&&facts.items.length===8){
      payload.deck={selected_card_count:8};
      if(Number.isFinite(facts.average)&&facts.average>=0&&facts.average<=10)payload.deck.average_elixir=facts.average;
      if(Number.isFinite(facts.cycle)&&facts.cycle>=0&&facts.cycle<=40)payload.deck.cycle_cost_four_cheapest=facts.cycle;
    }
    if(evidence&&['all','event','other'].includes(evidence.filter)&&evidence.outcomes){
      const c=evidence.outcomes,n=evidence.matched_records;
      const counts=[c.wins,c.losses,c.draws,c.unknown];
      if(Number.isInteger(n)&&n>0&&n<=200&&counts.every(x=>Number.isInteger(x)&&x>=0&&x<=200)&&counts.reduce((a,b)=>a+b,0)===n)
        payload.battles={filter:evidence.filter,matched_records:n,wins:c.wins,losses:c.losses,draws:c.draws,unknown:c.unknown};
    }
    if(personal&&typeof personal==="object"){
      const clean={};
      if(["profile-live","profile-import","profile-edited","manual","sample","battle-event-import","battle-import"].includes(personal.deck_source))clean.deck_source=personal.deck_source;
      const card=c=>Object.fromEntries(["id","name","elixir","rarity","active_form","unlocked_forms","available_forms","display_level","star_level"].filter(k=>Object.hasOwn(c,k)).map(k=>[k,c[k]]));
      for(const k of ["deck_cards","owned_candidates"])if(Array.isArray(personal[k]))clean[k]=personal[k].slice(0,8).filter(c=>c&&Number.isSafeInteger(c.id)&&typeof c.name==="string").map(card);
      const outcomes=cleanOutcomeCounts(personal.selected_deck_results);
      if(outcomes&&clean.deck_cards?.length===8&&new Set(clean.deck_cards.map(c=>c.id)).size===8)clean.selected_deck_results=outcomes;
      if(personal.style)clean.style=Object.fromEntries(["records","distinct_decks","most_used_deck_matches","elixir_leaked_sample","elixir_leaked_average","win_leaked_sample","win_leaked_average","loss_leaked_sample","loss_leaked_average"].map(k=>[k,personal.style[k]]));
      const memory=cleanCoachMemory(personal.coach_memory);if(memory)clean.coach_memory=memory;
      payload.personal=clean;
      // Preserve current evidence ahead of optional past conversation.
      if(coachBytes(payload)>4096&&Array.isArray(clean.owned_candidates)){
        while(clean.owned_candidates.length&&coachBytes(payload)>4096)clean.owned_candidates.pop();
      }
      if(coachBytes(payload)>4096&&clean.coach_memory?.snapshots?.length>1)clean.coach_memory.snapshots.pop();
      if(coachBytes(payload)>4096)delete clean.coach_memory;
      if(!payload.action){
        const history=cleanCoachHistory(personal.chat_history);
        for(let i=history.length-1;i>=0;i--){
          clean.chat_history=history.slice(i);
          if(coachBytes(payload)>4096){clean.chat_history=history.slice(i+1);break;}
        }
        if(!clean.chat_history?.length)delete clean.chat_history;
      }
    }
    if(coachBytes(payload)>4096)throw new BackendError("INVALID_INPUT","حجم داده تحلیل بیش از حد مجاز است.",422);
    return payload;
  }
  async function askAI(session,question,facts,evidence,cap,personal,action){
    if(!session||session.enabled!==true||typeof session.fetch!=='function'||!cap||cap.ai_coach_enabled!==true)
      throw new BackendError('AI_DISABLED','مربی آنلاین فعال نیست.',503);
    const payload=coachPayload(question,facts,evidence,personal,action);
    let response;
    try{response=await session.fetch('/api/v1/coach/chat',{method:'POST',body:JSON.stringify(payload)});}
    catch(e){throw new BackendError('AI_UNAVAILABLE','ارتباط با مربی آنلاین برقرار نشد.',503);}
    if(!response||!response.ok){
      let code="AI_UNAVAILABLE";try{const d=await response.json();if(/^[A-Z0-9_]{1,64}$/.test(d?.error?.code||""))code=d.error.code;}catch{}
      throw new BackendError(code,response?.status===429?"سهمیه موقت مربی پر شده است. کمی بعد دوباره امتحان کن.":"مربی آنلاین موقتاً در دسترس نیست.",response?.status);
    }
    let data;
    try{data=await response.json();}catch(e){throw new BackendError('BAD_RESPONSE','پاسخ مربی معتبر نیست.');}
    const allowed=['@cf/google/gemma-4-26b-a4b-it','@cf/zai-org/glm-4.7-flash','google/gemma-4-31b-it:free','google/gemma-4-26b-a4b-it:free'];
    if(!data||data.external_inference!==true||data.replay_analyzed!==false||
       data.evidence_status!=='client_submitted_unverified'||!allowed.includes(data.model)||
       typeof data.answer!=='string'||!data.answer.trim()||data.answer.length>2900)
      throw new BackendError('BAD_RESPONSE','پاسخ مربی معتبر نیست.');
    const sourceUrl=value=>{try{const u=new URL(value);return u.protocol==='https:'&&((u.hostname==='support.supercell.com'&&u.pathname.startsWith('/clash-royale/en/articles/'))||(u.hostname==='supercell.com'&&u.pathname.startsWith('/en/games/clashroyale/')))&&!u.username&&!u.password?u.href:null;}catch{return null;}};
    const sources=Array.isArray(data.knowledge_sources)?data.knowledge_sources.slice(0,3).filter(s=>s&&/^K\d{2}$/.test(s.id||'')&&typeof s.title==='string'&&s.title.length<=140&&sourceUrl(s.url)&&s.authority==='official-support').map(s=>({id:s.id,title:s.title,url:sourceUrl(s.url),publisher:typeof s.publisher==='string'?s.publisher.slice(0,80):'Supercell',verified_at:typeof s.verified_at==='string'?s.verified_at:null,published_at:typeof s.published_at==='string'?s.published_at:null})):[];
    const qualityStatus=data.quality_version==='crc-coach-quality-v1'&&['limited','checked_structure'].includes(data.quality_status)?data.quality_status:null;
    const rawSwap=data.quality_swap;
    const swap=qualityStatus==='checked_structure'&&rawSwap&&Number.isSafeInteger(rawSwap.remove_id)&&rawSwap.remove_id>0&&Number.isSafeInteger(rawSwap.add_id)&&rawSwap.add_id>0&&
      typeof rawSwap.remove==='string'&&rawSwap.remove.length<=65&&typeof rawSwap.add==='string'&&rawSwap.add.length<=65&&
      Array.isArray(rawSwap.gain)&&rawSwap.gain.length<=8&&rawSwap.gain.every(x=>typeof x==='string'&&x.length<=60)&&
      Array.isArray(rawSwap.loss)&&rawSwap.loss.length<=8&&rawSwap.loss.every(x=>typeof x==='string'&&x.length<=60)&&
      Number.isInteger(rawSwap.elixir_delta)&&rawSwap.elixir_delta>=-10&&rawSwap.elixir_delta<=1&&
      (rawSwap.level_gap===null||(Number.isInteger(rawSwap.level_gap)&&rawSwap.level_gap>=-2&&rawSwap.level_gap<=15))?
      {remove_id:rawSwap.remove_id,add_id:rawSwap.add_id,remove:rawSwap.remove,add:rawSwap.add,gain:rawSwap.gain.slice(),loss:rawSwap.loss.slice(),elixir_delta:rawSwap.elixir_delta,level_gap:rawSwap.level_gap}:null;
    return {answer:data.answer,model:data.model,sources,knowledgeVersion:typeof data.knowledge_version==='string'?data.knowledge_version:null,qualityStatus,swap,modelRoute:['fast','quality'].includes(data.model_route)?data.model_route:null,fallbackUsed:typeof data.fallback_used==='boolean'?data.fallback_used:null};
  }
  root.CRCBackendClient=Object.freeze({VERSION,BackendError,normalizeTag,route,capabilities,loadPlayer,normalizedToProfile,normalizedToBattles,personalCoachContext,coachPayload,askAI,createCoachSession,cleanCoachHistory,createCoachMemory,cleanCoachMemory,cleanCoachMemorySnapshot,coachDistinctBattles,coachPracticeDelta,coachPracticePlan,coachProactiveHint,createCoachHintSession,cardFormProgress,collectionLevel,COACH_MEMORY_VERSION});
})(typeof window!=='undefined'?window:globalThis);
