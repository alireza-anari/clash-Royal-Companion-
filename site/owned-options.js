/* Candidate cards the player actually owns, with explicit uncertainty and no fabricated swap. */
(function(root){
  'use strict';
  const VERSION='owned-options-0.1';
  const asArray=x=>Array.isArray(x)?x:[];
  function ownedOptions(deckIds, catalog, collection){
    if(!Array.isArray(deckIds)||deckIds.length!==8||new Set(deckIds).size!==8)
      return {version:VERSION,candidates:[],reason:'invalid_deck'};
    if(!Array.isArray(collection)||!collection.length)
      return {version:VERSION,candidates:[],reason:'missing_collection'};
    const cardIndex=new Map(asArray(catalog).filter(c=>c&&Number.isSafeInteger(c.id)).map(c=>[c.id,c]));
    const deck=deckIds.map(id=>cardIndex.get(id));
    if(deck.some(c=>!c))return {version:VERSION,candidates:[],reason:'unknown_deck_cards'};
    const costKnown=deck.every(c=>Number.isInteger(c.elixir)&&c.elixir>=0);
    const average=costKnown?deck.reduce((s,c)=>s+c.elixir,0)/8:null;
    const roleCoverageKnown=deck.every(c=>Array.isArray(c.roles)&&c.roles.length>0);
    const deckSet=new Set(deckIds);
    const enoughAir=deck.some(c=>c.type==='troop'&&asArray(c.roles).includes('air'));
    const spellCount=deck.filter(c=>c.type==='spell').length;
    const buildingCount=deck.filter(c=>c.type==='building').length;
    const patterns=[];
    if(roleCoverageKnown&&!enoughAir)patterns.push('air');
    if(spellCount===0)patterns.push('spell');
    if(average!==null&&average>=4.0)patterns.push('cycle');
    // The lack of a defensive building is never by itself called a weakness.
    if(buildingCount===0)patterns.push('optional_building');
    if(!patterns.length)return {version:VERSION,candidates:[],reason:'no_simple_candidates'};
    const results=[];
    const seen=new Set();
    const owned=asArray(collection).filter(c=>c&&Number.isSafeInteger(c.id));
    for(const card of owned){
      if(seen.has(card.id)||deckSet.has(card.id))continue;
      seen.add(card.id);
      const c=cardIndex.get(card.id);
      if(!c||c.type==='support'||!Array.isArray(c.roles)||!c.roles.length||!Number.isInteger(c.elixir)||c.elixir<0)continue;
      const reasons=[];
      const roles=c.roles;
      if(patterns.includes('air')&&c.type==='troop'&&roles.includes('air'))
        reasons.push('این کارت می‌تواند یکی از گزینه‌های پوشش هوایی باشد؛ کیفیت پاسخ به حریف وابسته است.');
      if(patterns.includes('spell')&&c.type==='spell')
        reasons.push('می‌تواند جای خالی یک طلسم را در ترکیب پر کند؛ لازم است نقش طلسم بررسی شود.');
      if(patterns.includes('cycle')&&c.elixir<=2&&roles.includes('cycle'))
        reasons.push('هزینه این کارت پایین است و شاید چرخه پرهزینه دک را سبک‌تر کند.');
      if(patterns.includes('optional_building')&&c.type==='building')
        reasons.push('اگر با تانک‌های زمینی مشکل داری، یک ساختمان دفاعی را هم می‌توان بررسی کرد؛ داشتن ساختمان الزامی نیست.');
      if(!reasons.length)continue;
      results.push({id:c.id,name:c.name,elixir_cost:c.elixir,level_raw:Number.isInteger(card.level)?card.level:null,
        reasons,provisional:true,tradeoff:'برای پیشنهاد تعویض قطعی باید نقش کارت حذف‌شونده، Level واقعی و Matchup بررسی شود.',
        score:reasons.length*100+(c.elixir<=2?8:0)});
    }
    results.sort((a,b)=>b.score-a.score||a.elixir_cost-b.elixir_cost||a.id-b.id);
    return {version:VERSION,candidates:results.slice(0,3),reason:results.length?'provisional_options':'no_role_verified_candidates',patterns,
      metadata:{average_elixir:average,role_coverage_known:roleCoverageKnown,owned_candidate_count:results.length},
      disclaimer:'Raw card levels are not comparable across rarities; candidate ordering does not use level. No win-rate estimates.'};
  }
  root.CRCOwnedOptions=Object.freeze({VERSION,ownedOptions});
})(typeof window!=='undefined'?window:globalThis);
