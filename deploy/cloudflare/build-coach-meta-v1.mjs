// Offline aggregation of authorized, anonymized and normalized 1v1 observations.
// Does not collect, fetch, publish, or edit the active snapshot module.
import {readFileSync,statSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import {coachMetaValidate} from './coach-meta-v1.mjs';
export function buildCoachMeta(input){
  const fail=message=>{throw new Error('Meta input rejected: '+message);};
  if(!input||input.version!==1||input.source!=='supercell_api_own_aggregate'||input.reviewed!==true||
      !Array.isArray(input.battles)||!input.battles.length||input.battles.length>100000||
      !['ranked','trophy_road','grand_challenge','classic_challenge'].includes(input.mode))fail('contract');
  const start=Date.parse(input.window_start),end=Date.parse(input.window_end);
  if(!Number.isFinite(start)||!Number.isFinite(end)||start>=end)fail('window');
  const seen=new Map(),groups=new Map(),names=new Map();
  for(const battle of input.battles){
    if(!battle||typeof battle.battle_key!=='string'||!/^[a-f0-9]{64}$/.test(battle.battle_key)||
        battle.mode!==input.mode||typeof battle.at!=='string'||!Number.isFinite(Date.parse(battle.at))||
        Date.parse(battle.at)<start||Date.parse(battle.at)>end||!Array.isArray(battle.players)||battle.players.length!==2)fail('battle identity, mode or window');
    const players=battle.players.map(player=>{
      if(!player||!['win','loss','draw'].includes(player.outcome)||!Array.isArray(player.cards)||player.cards.length!==8)fail('participant');
      const cards=player.cards.map(c=>{
        if(!c||!Number.isSafeInteger(c.id)||c.id<=0||c.id>1000000000||typeof c.name!=='string'||!/^[A-Za-z0-9 .,'()&-]{1,65}$/.test(c.name)||
            ![0,1,2].includes(c.active_form)||!Number.isInteger(c.display_level)||c.display_level<1||c.display_level>16)fail('card evidence');
        if(names.has(c.id)&&names.get(c.id)!==c.name)fail('inconsistent card name');names.set(c.id,c.name);
        return {id:c.id,name:c.name,required_form:c.active_form,min_display_level:c.display_level};
      }).sort((a,b)=>a.id-b.id);
      if(new Set(cards.map(c=>c.id)).size!==8)fail('duplicate card');
      return {outcome:player.outcome,cards};
    }).sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b)));
    const outcomes=players.map(p=>p.outcome).sort().join(':');
    if(!['loss:win','draw:draw'].includes(outcomes))fail('inconsistent results');
    const canonical=JSON.stringify([new Date(Date.parse(battle.at)).toISOString(),players]);
    if(seen.has(battle.battle_key)){
      if(seen.get(battle.battle_key)!==canonical)fail('conflicting duplicate battle');
      continue;
    }
    seen.set(battle.battle_key,canonical);
    for(const player of players){
      const key=player.cards.map(c=>c.id+':'+c.required_form).join('|');
      let row=groups.get(key);
      if(!row){row={cards:player.cards.map(c=>({...c})),plays:0,wins:0,losses:0,draws:0};groups.set(key,row);}
      row.plays++;row[{win:'wins',loss:'losses',draw:'draws'}[player.outcome]]++;
      row.cards.forEach((c,i)=>{c.min_display_level=Math.min(c.min_display_level,player.cards[i].min_display_level);});
    }
  }
  const decks=[...groups.entries()].filter(([,row])=>row.plays>=30).sort((a,b)=>b[1].plays-a[1].plays||a[0].localeCompare(b[0])).slice(0,50).map(([,row])=>row);
  const snapshot=coachMetaValidate({version:1,source:input.source,reviewed:true,mode:input.mode,cohort:input.cohort,window_start:input.window_start,window_end:input.window_end,generated_at:input.generated_at,total_deck_observations:seen.size*2,decks});
  if(!snapshot)fail('sample too small, no eligible deck, or invalid snapshot metadata');
  // Reviewed is kept explicitly for maintainer publication. Runtime validator also checks it.
  return {...snapshot,reviewed:true};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  const file=process.argv[2];
  if(!file||process.argv.length!==3)throw new Error('Usage: node build-coach-meta-v1.mjs normalized-reviewed-input.json');
  if(statSync(file).size>64*1024*1024)throw new Error('Input exceeds 64 MiB');
  process.stdout.write(JSON.stringify(buildCoachMeta(JSON.parse(readFileSync(file,'utf8'))),null,2)+'\n');
}
