import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createServer } from 'node:http';
import path from 'node:path';
const root=path.resolve('site');
const types={'.html':'text/html','.js':'application/javascript','.css':'text/css','.json':'application/json','.svg':'image/svg+xml'};
const server=createServer(async(req,res)=>{try{let p=new URL(req.url,'http://localhost').pathname;if(p==='/api/v1/capabilities'){res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({schema_version:'1.0',live_lookup_enabled:false,ai_coach_enabled:false}));return;}if(p==='/')p='/index.html';let f=path.resolve(root,'.'+p);if(!f.startsWith(root+path.sep))throw Error('path');res.writeHead(200,{'Content-Type':types[path.extname(f)]||'application/octet-stream'});res.end(await fs.readFile(f));}catch{res.end();}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser=await chromium.launch({headless:true});
await fs.mkdir('visual-check',{recursive:true});
try{
 for(const [name,viewport] of [['mobile',{width:390,height:844}],['desktop',{width:1440,height:900}]]){
  const page=await browser.newPage({viewport});
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/*',route=>route.request().url().startsWith('http://127.0.0.1:')?route.continue():route.abort());
  await page.goto('http://127.0.0.1:'+server.address().port+'/');
  await page.locator('#homeDeck .deck-slot').first().waitFor();
  assert.equal(await page.locator('#homeDeck .deck-slot').count(),8);
  for(const view of ['home','coach','deck','cards','battles','player','roadmap']){
    await page.evaluate(v=>location.hash=v,view);
    await page.locator('#page-'+view+'.active').waitFor();
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+2),'horizontal overflow: '+view+' '+name);
    await page.screenshot({path:'visual-check/'+name+'-'+view+'.png',fullPage:true});
  }
  await page.evaluate(()=>location.hash='deck');await page.locator('#page-deck.active').waitFor();
  await page.locator('#crcEditDeck').click();assert.equal(await page.locator('#crcDeckEditor').isVisible(),true);
  await page.locator('#crcSaveCurrent').click();await page.locator('#crcSavedDecks').click();assert.equal(await page.locator('#crcSavedList [data-saved-load]').count(),1);
  await page.evaluate(()=>location.hash='coach');await page.locator('#page-coach.active').waitFor();
  const welcome=page.locator('#crcChatWelcome'),toggle=page.locator('#crcCoachToolsToggle'),menu=page.locator('#crcCoachTools');
  assert.equal(await welcome.isVisible(),true);assert.equal(await menu.isVisible(),false);
  await page.locator('#crcChatWelcome [data-coach-jump="coachMetrics"]').click();
  assert.equal(await page.locator('#coachChatMessages .is-user').count(),1);assert.equal(await welcome.isVisible(),false);
  assert.equal(await page.locator('#coachChatMessages .is-status').count(),1);
  await toggle.click();assert.equal(await menu.isVisible(),true);assert.equal(await toggle.getAttribute('aria-expanded'),'true');
  await page.screenshot({path:'visual-check/'+name+'-coach-tools.png'});
  await page.keyboard.press('Escape');assert.equal(await menu.isVisible(),false);
  await toggle.click();await menu.locator('[data-coach-jump="coachReport"]').click();
  assert.equal(await menu.isVisible(),false);assert.equal(await page.locator('#coachChatMessages .is-user').count(),2);
  await page.locator('#coachChatQuestion').fill('تست گفتگو');await page.locator('#coachChatForm [type=submit]').click();
  assert.equal(await page.locator('#coachChatMessages .is-user').count(),3);
  assert.ok(await page.locator('#coachChatForm').evaluate(el=>{const r=el.getBoundingClientRect();const nav=document.querySelector('.bottom-nav');const n=nav.getBoundingClientRect();return r.top>=0&&r.bottom<=innerHeight+1&&(getComputedStyle(nav).display==='none'||r.bottom<=n.top+1);}));
  await page.screenshot({path:'visual-check/'+name+'-coach-chat.png'});
  await page.locator('#clearCoachChat').click();assert.equal(await welcome.isVisible(),true);assert.equal(await page.locator('#coachChatMessages .is-user').count(),0);
  await page.evaluate(()=>location.hash='player');await page.locator('#page-player.active').waitFor();await page.locator('#crcChangeAccount').click();await page.locator('#crcNext').click();await page.locator('#crcNext2').click();await page.locator('#crcConnect').click();assert.ok(await page.locator('#crcError').textContent());
  await page.screenshot({path:'visual-check/'+name+'-onboarding.png'});
  assert.deepEqual(errors,[]);
  await page.close();
 }
}finally{await browser.close();server.close();}
