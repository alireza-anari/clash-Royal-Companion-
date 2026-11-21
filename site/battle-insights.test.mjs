import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const dirname=path.dirname(fileURLToPath(import.meta.url));
const code=fs.readFileSync(path.join(dirname,'battle-insights.js'),'utf8');
const context={};
vm.runInNewContext(code,context);
const BI=context.CRCBattleIntelligence;
assert.ok(BI);

const team=(tag,crowns,leaked,ids)=>({tag,name:tag,crowns,elixirLeaked:leaked,cards:ids.map(id=>({id})),supportCards:[{id:159000000}]});
const ids=[26000010,26000014,26000021,27000000,26000038,26000030,28000000,28000011];
const reverse=ids.slice().reverse();
const event={
  type:'trail',deckSelection:'eventDeck',battleTime:'20261120T120719.000Z',gameMode:{name:'Challenge_AllCards_EventDeck_NoSet'},
  team:[team('#AAA123',0,25.8,ids)],opponent:[team('#BBB321',3,1.28,reverse)]
};
const ordinary={type:'PvP',battleTime:'20261120T120720.000Z',team:[team('#AAA123',3,0,reverse)],opponent:[team('#CCC321',1,3,ids)]};

test('event result, date and reported elixir values are correctly parsed',()=>{
 const x=BI.one(event,'#aaa123');
 assert.equal(x.classification,'event');
 assert.equal(x.outcome,'loss');
 assert.equal(x.elixir_leaked,25.8);
 assert.equal(x.opponent_elixir_leaked,1.28);
 assert.equal(x.battle_time,'2026-11-20T12:07:19.000Z');
 assert.equal(x.deck.card_ids.length,8);
 assert.equal(x.has_replay_events,false);
});
test('summary keeps unclassified battles separate from event decks',()=>{
 const result=BI.summarize([ordinary,event],'#AAA123','all');
 assert.equal(result.filtered_count,2);
 assert.equal(result.event_count,1);
 assert.equal(result.unclassified_count,1);
 assert.equal(result.counts.win,1);
 assert.equal(result.counts.loss,1);
 assert.equal(result.average_elixir_leaked,12.9);
 const e=BI.summarize([ordinary,event],'#AAA123','event');
 assert.equal(e.filtered_count,1);
 assert.equal(e.counts.loss,1);
 const o=BI.summarize([ordinary,event],'#AAA123','other');
 assert.equal(o.filtered_count,1);
 assert.equal(o.counts.win,1);
});
test('deck canonical ordering is consistent but support tower choice is not ignored',()=>{
 const sum=BI.summarize([ordinary,event],'#AAA123','all');
 assert.equal(sum.decks.length,1);
 assert.equal(sum.decks[0].plays,2);
 assert.equal(sum.decks[0].event_plays,1);
 const alt={...ordinary,team:[{...ordinary.team[0],supportCards:[{id:159000001}]}]};
 assert.equal(BI.summarize([ordinary,alt],'#AAA123','all').decks.length,2);
});
test('requested player in opponent side is identified and crowns inverted',()=>{
 const v=BI.one(event,'#BBB321');
 assert.equal(v.attribution,'matched_tag');
 assert.equal(v.outcome,'win');
 assert.equal(v.elixir_leaked,1.28);
 assert.equal(v.opponent_crowns,0);
});
test('explicit player tag absent from Battle Log must NOT use team[0]',()=>{
 const result=BI.summarize([event],'#NOTINMATCH','all');
 assert.equal(result.counts.unknown,1);
 assert.equal(result.unidentified_count,1);
 assert.equal(result.average_elixir_leaked,null);
});
test('when tag not provided only single team member can be provisionally identified',()=>{
 assert.equal(BI.one(event,null).attribution,'single_team_assumed');
 const doubles={...event,team:[event.team[0],team('#PARTNER',0,2,reverse)]};
 const report=BI.summarize([doubles],null,'all');
 assert.equal(report.unidentified_count,1);
 assert.equal(report.counts.unknown,1);
});
test('unknown elixir is never treated as zero in averages',()=>{
 const missing={...event,team:[{...event.team[0],elixirLeaked:null}]};
 const res=BI.summarize([missing],'#AAA123','all');
 assert.equal(res.average_elixir_leaked,null);
 assert.equal(res.elixir_sample_count,0);
});
test('invalid dates and malformed deck lists remain unknown',()=>{
 assert.equal(BI.date('20260231T120719.000Z'),null);
 assert.equal(BI.date('2026-11-20'),null);
 const bad={...event,team:[{...event.team[0],cards:[{id:1},{id:1}]}]};
 assert.equal(BI.one(bad,'#AAA123').deck,null);
});
test('missing crown values leave outcomes unknown',()=>{
 const b={...event,opponent:[{...event.opponent[0],crowns:null}]};
 const report=BI.summarize([b],'#AAA123','all');
 assert.equal(report.counts.unknown,1);
});
test('large log never processes more than 200 records',()=>{
 const res=BI.summarize(Array.from({length:210},()=>event),'#AAA123','all');
 assert.equal(res.total_entries,200);
 assert.equal(res.counts.loss,200);
});

test('accepts API normalized RFC3339 time without inventing timezone',()=>{
 const t=BI.date('2026-11-20T12:07:19Z');
 assert.equal(t,'2026-11-20T12:07:19.000Z');
 assert.equal(BI.date('2026-02-31T12:07:19Z'),null);
});
