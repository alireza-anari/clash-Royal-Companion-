import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import vm from 'node:vm';
import { chromium } from 'playwright';

const src = await fs.readFile(new URL('../deploy/cloudflare/mvp-worker.js',import.meta.url),'utf8');
let handler;
vm.runInNewContext(src,{URL,Map,Set,Request,Response,addEventListener(name,cb){if(name==='fetch')handler=cb;}});
assert.equal(typeof handler,'function');
const server=http.createServer(async(req,res)=>{
  try{
    let pending;
    handler({request:new Request('http://127.0.0.1'+req.url,{method:req.method,headers:req.headers}),respondWith(p){pending=p;}});
    const response=await pending;
    res.writeHead(response.status,Object.fromEntries(response.headers.entries()));
    res.end(Buffer.from(await response.arrayBuffer()));
  }catch(e){res.writeHead(500);res.end(String(e));}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const base='http://127.0.0.1:'+server.address().port;
let browser;
await fs.mkdir('browser-smoke-output',{recursive:true});
try{
  browser=await chromium.launch({headless:true});
  for(const [label,viewport] of [['desktop',{width:1440,height:900}],['mobile',{width:390,height:844}]]){
    const context=await browser.newContext({viewport,serviceWorkers:'block',isMobile:label==='mobile',hasTouch:label==='mobile'});
    const page=await context.newPage();
    const errors=[];
    page.on('pageerror',e=>errors.push(e.message));
    const nav=label==='mobile'?'.bottom-nav':'.sidebar';
    const go=async id=>{
      await page.locator(nav+' [data-nav="'+id+'"]').click();
      await page.locator('#page-'+id+'.active').waitFor();
    };
    await page.goto(base,{waitUntil:'domcontentloaded'});
    await page.locator('#homeDeck .deck-slot').first().waitFor();
    assert.equal(await page.locator('#homeDeck .deck-slot').count(),8);
    assert.match(await page.locator('#homeDeckElixir').innerText(),/اکسیر/);
    assert.notEqual(await page.locator('#homeDeckElixir').innerText(),'— اکسیر');
    assert.equal(await page.locator('html').getAttribute('dir'),'rtl');
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1),'Home has horizontal overflow');
    const cols=await page.locator('#homeDeck').evaluate(el=>getComputedStyle(el).gridTemplateColumns.split(' ').length);
    assert.equal(cols,label==='mobile'?4:8);
    await page.screenshot({path:'browser-smoke-output/'+label+'-home.png',fullPage:true});
    await go('coach');
    const keys=['coachMetrics','coachOwnedOptions','coachBattleReport','coachReport'];
    for(const key of keys){
      const button=page.locator('[data-coach-jump="'+key+'"]');
      await button.click();
      assert.equal(await button.getAttribute('aria-pressed'),'true');
      const groups=await page.locator('[data-report-group]').evaluateAll(nodes=>nodes.filter(n=>!n.hidden).map(n=>n.dataset.reportGroup));
      assert.deepEqual(groups,key==='coachReport'?keys.slice(0,3):[key]);
      assert.ok((await page.locator('#coachReportTitle').innerText()).length);
    }
    await page.screenshot({path:'browser-smoke-output/'+label+'-coach.png',fullPage:true});
    await page.locator('#coachChatTitle').click();
    await page.locator('#coachChatForm').waitFor();
    assert.equal(await page.locator('#coachAIOptions').isVisible(),false);
    await page.locator('[data-coach-question]').first().click();
    assert.ok(await page.locator('#coachChatMessages article').count()>=2);
    await go('deck');
    await page.locator('#deckSlots [data-slot="0"]').click();
    await page.locator('#deckLibrary .card-option:not(.in-deck)').first().click();
    assert.equal(await page.locator('#deckSlots .deck-slot').count(),8);
    await page.locator('#analyzeDeck').click();
    await page.locator('#page-coach.active').waitFor();
    assert.equal(await page.locator('[data-coach-jump="coachMetrics"]').getAttribute('aria-pressed'),'true');
    await go('battles');
    await page.locator('#battleList').waitFor();
    await go('cards');
    await page.locator('#cardsGrid .catalog-card').first().waitFor();
    if(label==='mobile')await page.locator('.profile-link').click();else await go('player');
    await page.locator('#page-player.active').waitFor();
    assert.equal(await page.locator('#loadLivePlayer').isDisabled(),true);
    assert.equal(errors.length,0,errors.join('\n'));
    await context.close();
    console.log(label+': sample dashboard, 8-card responsive layout, four reports, offline coach, deck edit, battles, cards, profile passed');
  }
}finally{
  if(browser)await browser.close();
  await new Promise(resolve=>server.close(resolve));
}
