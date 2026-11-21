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
        ACCESS_LOGIN_REQUIRED:'نشست ورود منقضی شده است؛ دوباره وارد شو.',
        ACCESS_TOKEN_MISSING:'ابتدا از طریق Cloudflare Access وارد شو.',
        ACCESS_TOKEN_INVALID:'نشست دسترسی معتبر نیست؛ دوباره وارد شو.',
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
    if(Number.isInteger(value.star_level))c.starLevel=value.star_level;
    if(Number.isInteger(value.count))c.count=value.count;
    if(typeof value.rarity==='string')c.rarity=value.rarity;
    if(typeof value.icon_url==='string'&&value.icon_url.startsWith('https://api-assets.clashroyale.com/'))
      c.iconUrls={medium:value.icon_url};
    return c;
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
  function coachPayload(question,facts,evidence){
    const q=String(question||'').trim();
    if(q.length<3||q.length>280)throw new BackendError('INVALID_INPUT','سؤال باید بین ۳ و ۲۸۰ نویسه باشد.');
    const payload={consent_to_external_ai:true,question:q};
    if(facts&&Array.isArray(facts.errors)&&!facts.errors.length&&Array.isArray(facts.items)&&facts.items.length===8){
      payload.deck={selected_card_count:8};
      if(Number.isFinite(facts.average)&&facts.average>=0&&facts.average<=10)payload.deck.average_elixir=facts.average;
      if(Number.isFinite(facts.cycle)&&facts.cycle>=0&&facts.cycle<=40)payload.deck.cycle_cost_four_cheapest=facts.cycle;
    }
    if(evidence&&['all','event','other'].includes(evidence.filter)&&evidence.outcomes){
      const c=evidence.outcomes,n=evidence.matched_records;
      const counts=[c.wins,c.losses,c.draws,c.unknown];
      if(Number.isInteger(n)&&n>0&&n<=200&&counts.every(x=>Number.isInteger(x)&&x>=0&&x<=200)&&counts.reduce((a,b)=>a+b,0)<=n)
        payload.battles={filter:evidence.filter,matched_records:n,wins:c.wins,losses:c.losses,draws:c.draws,unknown:c.unknown};
    }
    return payload;
  }
  async function askAI(session,question,facts,evidence,consent,cap){
    if(consent!==true)throw new BackendError('AI_CONSENT_REQUIRED','رضایت ارسال داده لازم است.',403);
    if(!session||session.enabled!==true||typeof session.fetch!=='function'||!cap||cap.ai_coach_enabled!==true)
      throw new BackendError('AI_DISABLED','مربی آنلاین فعال نیست.',503);
    const payload=coachPayload(question,facts,evidence);
    let response;
    try{response=await session.fetch('/api/v1/coach/chat',{method:'POST',body:JSON.stringify(payload)});}
    catch(e){throw new BackendError('AI_UNAVAILABLE','ارتباط با مربی آنلاین برقرار نشد.',503);}
    if(!response||!response.ok)throw new BackendError('AI_UNAVAILABLE','مربی آنلاین موقتاً در دسترس نیست.',response&&response.status);
    let data;
    try{data=await response.json();}catch(e){throw new BackendError('BAD_RESPONSE','پاسخ مربی معتبر نیست.');}
    const allowed=['google/gemma-4-31b-it:free','google/gemma-4-26b-a4b-it:free'];
    if(!data||data.external_inference!==true||data.replay_analyzed!==false||
       data.evidence_status!=='client_submitted_unverified'||!allowed.includes(data.model)||
       typeof data.answer!=='string'||!data.answer.trim()||data.answer.length>2200)
      throw new BackendError('BAD_RESPONSE','پاسخ مربی معتبر نیست.');
    return {answer:data.answer,model:data.model};
  }
  root.CRCBackendClient=Object.freeze({VERSION,BackendError,normalizeTag,route,capabilities,loadPlayer,normalizedToProfile,normalizedToBattles,coachPayload,askAI});
})(typeof window!=='undefined'?window:globalThis);
