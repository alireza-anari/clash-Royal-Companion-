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
    assert.equal(await page.locator('.content > .footer').isVisible(),view!=='coach','footer visibility: '+view);
    if(view==='player'){assert.ok(await page.locator('#crcProgressPanel').isVisible());assert.match(await page.locator('#crcProgressPanel').textContent(),/رصد پیشرفت/);}
    if(view==='coach')assert.ok(await page.locator('#page-coach').evaluate(el=>{const r=el.getBoundingClientRect();const p=el.parentElement;const cs=getComputedStyle(p);return Math.abs(r.width-Math.min(900,p.clientWidth-parseFloat(cs.paddingLeft)-parseFloat(cs.paddingRight)))<=2;}),'coach uses full available width: '+name);
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
  assert.equal(await menu.locator('#crcCoachMemoryEnabled').isChecked(),false);assert.equal(await menu.locator('#crcCoachMemoryEnabled').isDisabled(),true);
  await page.screenshot({path:'visual-check/'+name+'-coach-tools.png'});
  await page.keyboard.press('Escape');assert.equal(await menu.isVisible(),false);
  await toggle.click();await menu.locator('[data-coach-jump="coachReport"]').click();
  assert.equal(await menu.isVisible(),false);assert.equal(await page.locator('#coachChatMessages .is-user').count(),2);
  await page.locator('#coachChatQuestion').fill('تست گفتگو');await page.locator('#coachChatForm [type=submit]').click();
  assert.equal(await page.locator('#coachChatMessages .is-user').count(),3);
  assert.ok(await page.locator('#coachChatForm').evaluate(el=>{const r=el.getBoundingClientRect();const nav=document.querySelector('.bottom-nav');const n=nav.getBoundingClientRect();return r.top>=0&&r.bottom<=innerHeight+1&&(getComputedStyle(nav).display==='none'||r.bottom<=n.top+1);}));
  assert.equal(await page.locator('.content > .footer').isVisible(),false);
  assert.ok(await page.locator('#coachChatForm').evaluate(el=>Math.abs(el.getBoundingClientRect().width-document.querySelector('#page-coach').getBoundingClientRect().width)<=2),'composer takes full coach width');
  await page.screenshot({path:'visual-check/'+name+'-coach-chat.png'});
  assert.equal(await page.locator('#crcCoachPending').count(),0,'no spinner for unavailable coach');
  // Test pending, success and failure with a deferred mock of the online coach.
  const injected=await fs.readFile(path.join(root,'app.js'),'utf8');
  const harness=injected.replace(/\}\)\(\);\s*$/, "window.__crcPendingTest={run:async function(fail){coachAICap={ai_coach_enabled:true};window.CRCBetaSession={enabled:true,fetch:()=>new Promise((resolve,reject)=>{window.__crcPendingTest.finish=()=>fail?reject(new Error(\"test failure\")):resolve({ok:true,json:async()=>({answer:\"پاسخ آزمایشی\",model:\"@cf/google/gemma-4-26b-a4b-it\",external_inference:true,replay_analyzed:false,evidence_status:\"client_submitted_unverified\"})});})};return askCoachChat(\"تست انتظار\",\"overview\");}};})();");
  const loadingPage=await browser.newPage({viewport});
  await loadingPage.route('**/*',route=>route.request().url().endsWith('/app.js')?route.fulfill({contentType:'application/javascript',body:harness}):route.request().url().startsWith('http://127.0.0.1:')?route.continue():route.abort());
  await loadingPage.goto('http://127.0.0.1:'+server.address().port+'/#coach');
  await loadingPage.locator('#crcChatWelcome').waitFor();
  for(const fail of [false,true]){
    await loadingPage.evaluate(f=>{window.__crcPendingTest.run(f);},fail);
    await loadingPage.locator('#crcCoachPending').waitFor();
    assert.equal(await loadingPage.locator('.crc-pending-dots i').count(),3);
    await loadingPage.waitForFunction(()=>typeof window.__crcPendingTest.finish==='function');
    if(!fail)await loadingPage.screenshot({path:'visual-check/'+name+'-coach-loading.png'});
    await loadingPage.evaluate(()=>{const finish=window.__crcPendingTest.finish;delete window.__crcPendingTest.finish;finish();});
    await loadingPage.locator('#crcCoachPending').waitFor({state:'detached'});
    assert.ok(await loadingPage.locator(fail?'#coachChatMessages .is-status':'#coachChatMessages .is-coach').count());
  }
  await loadingPage.close();
  await page.locator('#clearCoachChat').click();assert.equal(await welcome.isVisible(),true);assert.equal(await page.locator('#coachChatMessages .is-user').count(),0);
  await page.evaluate(()=>location.hash='player');await page.locator('#page-player.active').waitFor();await page.locator('#crcChangeAccount').click();await page.locator('#crcNext').click();await page.locator('#crcNext2').click();await page.locator('#crcConnect').click();assert.ok(await page.locator('#crcError').textContent());
  await page.screenshot({path:'visual-check/'+name+'-onboarding.png'});
  assert.deepEqual(errors,[]);
  await page.close();
 }
}finally{await browser.close();server.close();}
