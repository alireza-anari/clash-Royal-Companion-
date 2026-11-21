/* Pure Battle Log intelligence for official summary data; never fabricate replay evidence. */
(function(root){
  'use strict';
  const VERSION='battle-summary-0.3';
  const safeArray=value=>Array.isArray(value)?value:[];
  const isNumber=value=>typeof value==='number'&&Number.isFinite(value);
  function tag(value){
    if(typeof value!=='string')return null;
    const t=value.trim().toUpperCase().replace(/^#/,'');
    return /^[A-Z0-9]{3,16}$/.test(t)?'#'+t:null;
  }
  function date(value){
    if(typeof value!=='string')return null;
    const compact=/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(?:\.\d+)?Z$/.exec(value);
    const standard=/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?Z$/.exec(value);
    const m=compact||standard;
    if(!m)return null;
    const parsed=new Date(m[1]+'-'+m[2]+'-'+m[3]+'T'+m[4]+':'+m[5]+':'+m[6]+'Z');
    if(Number.isNaN(parsed.valueOf()))return null;
    // Reject silently normalized impossible dates (e.g. 2026-02-31).
    if(parsed.toISOString().slice(0,10)!==m[1]+'-'+m[2]+'-'+m[3])return null;
    return parsed.toISOString();
  }
  function readDeck(cards,supportCards){
    const valid=safeArray(cards).filter(c=>c&&Number.isSafeInteger(c.id)&&c.id>0);
    if(valid.length!==8||new Set(valid.map(c=>c.id)).size!==8)return null;
    const support=safeArray(supportCards).filter(c=>c&&Number.isSafeInteger(c.id)&&c.id>0).map(c=>c.id);
    return {
      card_ids:valid.map(c=>c.id),
      support_ids:support,
      // A missing support list is not proof that no tower troop was used.
      support_known:Array.isArray(supportCards),
      key:valid.map(c=>c.id).sort((a,b)=>a-b).join(':')+'|'+(Array.isArray(supportCards)?support.sort((a,b)=>a-b).join(':'):'unknown')
    };
  }
  function one(raw, playerTag){
    const battle=raw&&typeof raw==='object'&&!Array.isArray(raw)?raw:{};
    const teams=safeArray(battle.team).filter(p=>p&&typeof p==='object'&&!Array.isArray(p));
    const opponents=safeArray(battle.opponent).filter(p=>p&&typeof p==='object'&&!Array.isArray(p));
    const requested=tag(playerTag);
    let side=null, self=null, attribution='unknown';
    if(requested){
      self=teams.find(p=>tag(p.tag)===requested);
      if(self){side='team';attribution='matched_tag';}
      if(!self){
        self=opponents.find(p=>tag(p.tag)===requested);
        if(self){side='opponent';attribution='matched_tag';}
      }
    }else if(teams.length===1){
      self=teams[0];side='team';attribution='single_team_assumed';
    }
    const rivalSide=side==='team'?opponents:side==='opponent'?teams:[];
    // Only infer an individual result from an unambiguous 1v1.
    const oneVsOne=teams.length===1&&opponents.length===1;
    const rival=oneVsOne?rivalSide[0]:null;
    const myCrowns=self&&Number.isInteger(self.crowns)&&self.crowns>=0?self.crowns:null;
    const rivalCrowns=rival&&Number.isInteger(rival.crowns)&&rival.crowns>=0?rival.crowns:null;
    const outcome=!oneVsOne||myCrowns===null||rivalCrowns===null?'unknown':myCrowns>rivalCrowns?'win':myCrowns<rivalCrowns?'loss':'draw';
    const elixir=self&&isNumber(self.elixirLeaked)&&self.elixirLeaked>=0?self.elixirLeaked:null;
    const rivalElixir=rival&&isNumber(rival.elixirLeaked)&&rival.elixirLeaked>=0?rival.elixirLeaked:null;
    const isEvent=battle.deckSelection==='eventDeck';
    return {
      battle_time:date(battle.battleTime),
      raw_battle_time:battle.battleTime||null,
      classification:isEvent?'event':'unclassified',
      classification_reason:isEvent?'eventDeck':'no_confirmed_category',
      game_mode:battle.gameMode&&typeof battle.gameMode.name==='string'?battle.gameMode.name:null,
      event_tag:battle.eventTag||null,
      deck_selection:battle.deckSelection||null,
      outcome,
      attribution,
      self_name:self&&typeof self.name==='string'?self.name:null,
      opponent_name:rival&&typeof rival.name==='string'?rival.name:null,
      crowns:myCrowns,
      opponent_crowns:rivalCrowns,
      elixir_leaked:elixir,
      opponent_elixir_leaked:rivalElixir,
      deck:self?readDeck(self.cards,self.supportCards):null,
      support_present:!!(self&&Array.isArray(self.supportCards)),
      has_replay_events:false
    };
  }
  function summarize(rawBattles, playerTag, selected){
    const entries=safeArray(rawBattles).slice(0,200).map(b=>one(b,playerTag));
    const filtered=entries.filter(e=>selected==='event'?e.classification==='event':selected==='other'?e.classification!=='event':true);
    const counts={win:0,loss:0,draw:0,unknown:0};
    filtered.forEach(e=>{counts[e.outcome]++;});
    const leaks=filtered.map(e=>e.elixir_leaked).filter(isNumber);
    const avgLeak=leaks.length?leaks.reduce((a,b)=>a+b,0)/leaks.length:null;
    const decks=new Map();
    filtered.forEach(e=>{
      if(!e.deck)return;
      const key=e.deck.key;
      let group=decks.get(key);
      if(!group){group={key,card_ids:e.deck.card_ids,support_ids:e.deck.support_ids,support_known:e.deck.support_known,plays:0,win:0,loss:0,draw:0,unknown:0,event_plays:0};decks.set(key,group);}
      group.plays++;
      group[e.outcome]++;
      if(e.classification==='event')group.event_plays++;
    });
    return {
      version:VERSION, source:'imported-official-summary', saved_on_server:false,
      total_entries:entries.length, filtered_count:filtered.length,
      entries:filtered,
      event_count:filtered.filter(e=>e.classification==='event').length,
      unclassified_count:filtered.filter(e=>e.classification==='unclassified').length,
      unidentified_count:filtered.filter(e=>e.attribution==='unknown').length,
      assumed_count:filtered.filter(e=>e.attribution==='single_team_assumed').length,
      counts, average_elixir_leaked:avgLeak, elixir_sample_count:leaks.length,
      decks:Array.from(decks.values()).sort((a,b)=>b.plays-a.plays||a.key.localeCompare(b.key)).slice(0,10),
      limitations:[
        'Only imported Battle Log entries; not the complete player history.',
        'No card placement, replay timeline or mistakes can be reconstructed.',
        'Unclassified matches must not be silently treated as Trophy Road.',
        'Elixir leaked is a reported metric and does not prove a specific tactical error.'
      ]
    };
  }
  root.CRCBattleIntelligence=Object.freeze({VERSION,one,summarize,date,tag,readDeck});
})(typeof window!=='undefined'?window:globalThis);
