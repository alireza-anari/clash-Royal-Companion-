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
  // Page-local history; scope objects never cross the network.
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
      payload.personal=clean;
      // Preserve current evidence ahead of optional past conversation.
      if(coachBytes(payload)>4096&&Array.isArray(clean.owned_candidates)){
        while(clean.owned_candidates.length&&coachBytes(payload)>4096)clean.owned_candidates.pop();
      }
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
    const allowed=['@cf/google/gemma-4-26b-a4b-it','google/gemma-4-31b-it:free','google/gemma-4-26b-a4b-it:free'];
    if(!data||data.external_inference!==true||data.replay_analyzed!==false||
       data.evidence_status!=='client_submitted_unverified'||!allowed.includes(data.model)||
       typeof data.answer!=='string'||!data.answer.trim()||data.answer.length>2900)
      throw new BackendError('BAD_RESPONSE','پاسخ مربی معتبر نیست.');
    const sourceUrl=value=>{try{const u=new URL(value);return u.protocol==='https:'&&((u.hostname==='support.supercell.com'&&u.pathname.startsWith('/clash-royale/en/articles/'))||(u.hostname==='supercell.com'&&u.pathname.startsWith('/en/games/clashroyale/')))&&!u.username&&!u.password?u.href:null;}catch{return null;}};
    const sources=Array.isArray(data.knowledge_sources)?data.knowledge_sources.slice(0,3).filter(s=>s&&/^K\d{2}$/.test(s.id||'')&&typeof s.title==='string'&&s.title.length<=140&&sourceUrl(s.url)&&s.authority==='official-support').map(s=>({id:s.id,title:s.title,url:sourceUrl(s.url),publisher:typeof s.publisher==='string'?s.publisher.slice(0,80):'Supercell',verified_at:typeof s.verified_at==='string'?s.verified_at:null,published_at:typeof s.published_at==='string'?s.published_at:null})):[];
    const qualityStatus=data.quality_version==='crc-coach-quality-v1'&&['limited','checked_structure'].includes(data.quality_status)?data.quality_status:null;
    return {answer:data.answer,model:data.model,sources,knowledgeVersion:typeof data.knowledge_version==='string'?data.knowledge_version:null,qualityStatus};
  }
  root.CRCBackendClient=Object.freeze({VERSION,BackendError,normalizeTag,route,capabilities,loadPlayer,normalizedToProfile,normalizedToBattles,personalCoachContext,coachPayload,askAI,createCoachSession,cleanCoachHistory});
})(typeof window!=='undefined'?window:globalThis);
