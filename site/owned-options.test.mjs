import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const dir=path.dirname(fileURLToPath(import.meta.url));
const ctx={};
vm.runInNewContext(fs.readFileSync(path.join(dir,'owned-options.js'),'utf8'),ctx);
const options=ctx.CRCOwnedOptions.ownedOptions;
const make=(id,elixir,type,roles)=>({id,name:'Card '+id,elixir,type,roles});
const catalog=[
 make(1,7,'troop',['ground','tank']),make(2,5,'troop',['ground']),
 make(3,5,'troop',['ground']),make(4,5,'troop',['ground']),
 make(5,4,'troop',['ground']),make(6,4,'troop',['ground']),
 make(7,3,'troop',['ground']),make(8,3,'troop',['ground']),
 make(9,4,'troop',['air']),make(10,2,'troop',['cycle','ground']),
 make(11,3,'spell',['spell_small']),make(12,3,'building',['building','ground']),
 make(13,null,'spell',['spell_small']),make(159000000,null,'support',[])
];
const deck=[1,2,3,4,5,6,7,8];
test('requires actual inventory and does not fabricate ownership',()=>{
 assert.equal(options(deck,catalog,null).reason,'missing_collection');
 assert.equal(options(deck,catalog,[{id:200}]).candidates.length,0);
});
test('unknown deck and duplicates never yield suggestions',()=>{
 assert.equal(options([1,1,2,3,4,5,6,7],catalog,[{id:9}]).reason,'invalid_deck');
 assert.equal(options([1,2,3,4,5,6,7,999],catalog,[{id:9}]).reason,'unknown_deck_cards');
});
test('requires owned and identified candidates, not cards already in deck',()=>{
 const r=options(deck,catalog,[{id:9,level:9},{id:10,level:3},{id:1,level:16},{id:12,level:5}]);
 assert.ok(r.candidates.length>0);
 assert.ok(r.candidates.every(c=>[9,10,12].includes(c.id)));
 assert.ok(!r.candidates.some(c=>c.id===1));
 assert.ok(r.candidates.some(c=>c.id===9));
 assert.ok(r.candidates.some(c=>c.id===10));
 assert.ok(r.candidates.every(c=>c.provisional===true));
});
test('levels do not change sorting or get converted across rarities',()=>{
 const low=options(deck,catalog,[{id:9,level:1},{id:10,level:16},{id:12,level:8}]);
 const high=options(deck,catalog,[{id:9,level:16},{id:10,level:1},{id:12,level:8}]);
 assert.deepEqual(Array.from(low.candidates,x=>x.id),Array.from(high.candidates,x=>x.id));
 assert.equal(low.disclaimer.includes('not comparable'),true);
});
test('empty or unknown role tagging is excluded from recommendations',()=>{
 const r=options(deck,catalog,[{id:13,level:12},{id:159000000,level:9}]);
 assert.equal(r.candidates.length,0);
});
test('no replacement slot, win prediction or actual performance estimate is invented',()=>{
 const r=options(deck,catalog,[{id:9,level:9},{id:11,level:12}]);
 assert.ok(r.candidates.length>0);
 for(const c of r.candidates){
   assert.equal(Object.hasOwn(c,'replace_id'),false);
   assert.equal(Object.hasOwn(c,'win_rate'),false);
   assert.ok(c.tradeoff.length>20);
 }
});

test('does not propose cards with unlocked Evolution or Hero forms without slot-aware planning',()=>{
 const r=options(deck,catalog,[{id:9,level:12,evolutionLevel:1},{id:10,level:12,evolutionLevel:2},{id:12,level:12,evolutionLevel:0}]);
 assert.ok(!r.candidates.some(c=>c.id===9));
 assert.ok(!r.candidates.some(c=>c.id===10));
});
