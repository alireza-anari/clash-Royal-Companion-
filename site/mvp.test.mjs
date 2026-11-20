import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import test from 'node:test';
import {fileURLToPath} from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const source=fs.readFileSync(path.join(root,'deploy/cloudflare/mvp-worker.js'),'utf8');
let onFetch;
const box={URL,Map,Set,Request,Response,addEventListener(name,callback){if(name==='fetch')onFetch=callback;}};
vm.runInNewContext(source,box,{filename:'mvp-worker.js'});
assert.equal(typeof onFetch,'function');

async function request(uri,options){
 let pending;onFetch({request:new Request('https://example.test'+uri,options),respondWith(x){pending=x;}});
 assert.ok(pending);return pending;
}
async function post(uri,value){
 return request(uri,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(value)});
}
test('staging site has actual page sections and no false live API claim',async()=>{
 const res=await request('/');
 const body=await res.text();
 assert.equal(res.status,200);
 for(const id of ['page-home','page-deck','page-coach','page-cards','page-player','page-battles','page-roadmap'])assert.ok(body.includes('id="'+id+'"'),id);
 assert.ok(body.includes('اتصال خودکار به Supercell هنوز فعال نیست'));
 assert.equal(res.headers.get('x-robots-tag'),'noindex, nofollow');
 assert.ok(res.headers.get('content-security-policy').includes("connect-src 'self'"));
});
test('static CSS, JS, and catalog are available',async()=>{
 const a=await request('/styles.css');assert.equal(a.status,200);assert.match(a.headers.get('content-type'),/text\/css/);
 const b=await request('/app.js');assert.equal(b.status,200);assert.match(b.headers.get('content-type'),/javascript/);
 const c=await request('/catalog.json');const data=await c.json();assert.ok(data.cards.length>=120);
 assert.equal(data.mode,'sample');
 assert.equal(data.cards.find(x=>x.name==='Mirror').elixir,null);
 assert.equal(data.cards.filter(x=>x.type==='support').length,2);
});
test('heavy demo metrics calculate exact values',async()=>{
 const c=await (await request('/catalog.json')).json();
 const res=await post('/api/v1/analyses',{deck:{card_ids:c.predefined.heavy}});
 const data=await res.json();
 assert.equal(res.status,200);
 assert.equal(data.facts.average_elixir,4);
 assert.equal(data.facts.cycle_cost_four_cheapest,11);
 assert.deepEqual(data.findings,[]);
});
test('hog demo metrics calculate exact values',async()=>{
 const c=await (await request('/catalog.json')).json();
 const res=await post('/api/v1/decks/validate',{card_ids:c.predefined.hog});
 const data=await res.json();
 assert.equal(res.status,200);
 assert.equal(data.metrics.average_elixir,2.625);
 assert.equal(data.metrics.cycle_cost_four_cheapest,6);
});
test('bad or duplicate cards are rejected',async()=>{
 for(const ids of [[1,1,2,3,4,5,6,7],[1,2],[1,2,3,4,5,6,7,8]]){
 const res=await post('/api/analyze',{card_ids:ids});assert.equal(res.status,422);
 }
});
test('Mirror dynamic cost stays unknown rather than invented',async()=>{
 const c=await (await request('/catalog.json')).json();
 const ids=c.predefined.hog.slice();ids[0]=28000006;
 const res=await post('/api/v1/analyses',{deck:{card_ids:ids}});
 const data=await res.json();
 assert.equal(res.status,200);
 assert.equal(data.facts.average_elixir,null);
 assert.ok(data.facts.unknown_card_ids.includes(28000006));
});
test('official player lookup correctly fails closed on Cloudflare free',async()=>{
 const res=await request('/api/v1/players/%23TEST123');
 const data=await res.json();
 assert.equal(res.status,503);
 assert.equal(data.error.code,'LIVE_BACKEND_NOT_CONFIGURED');
 assert.equal(data.supercell_live,false);
});
test('health reports non-live staging',async()=>{
 const data=await (await request('/health')).json();
 assert.equal(data.status,'ok');assert.equal(data.supercell_live,false);
});
test('browser script parses without executing it',()=>{
 const frontend=fs.readFileSync(path.join(root,'site/app.js'),'utf8');
 new Function(frontend);
 assert.ok(frontend.includes('file.text()'));
 assert.ok(frontend.includes('function renderBattles'));
 assert.ok(frontend.includes('function renderCoach'));
});

test('curated coaching guides are present and clearly unreviewed',async()=>{
 const response=await request('/guides.json');
 assert.equal(response.status,200);
 const data=await response.json();
 assert.equal(data.status,'editorial-draft-unreviewed');
 assert.ok(Object.keys(data.guides).length>=12);
});
test('manifest, icon and static-only service worker are served',async()=>{
 const m=await request('/manifest.webmanifest');assert.equal(m.status,200);
 const manifest=await m.json();assert.equal(manifest.display,'standalone');
 assert.equal(manifest.lang,'fa');assert.ok(manifest.icons.length);
 const icon=await request('/icon.svg');assert.equal(icon.status,200);
 assert.match(await icon.text(),/<svg/);
 const sw=await request('/sw.js');assert.equal(sw.status,200);
 const body=await sw.text();
 assert.match(body,/\/catalog\.json/);
 assert.doesNotMatch(body,/\/api\/v1\/players/);
 assert.doesNotMatch(body,/\/api\/v1\/analyses/);
});

test('Battle Intelligence module is independently served and linked by UI',async()=>{
 const page=await (await request('/')).text();
 assert.match(page,/src="\/battle-insights\.js"/);
 const res=await request('/battle-insights.js');
 assert.equal(res.status,200);
 assert.match(await res.text(),/CRCBattleIntelligence/);
});
