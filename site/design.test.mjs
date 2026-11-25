import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const css = fs.readFileSync(new URL('./styles.css', import.meta.url), 'utf8');
const html = fs.readFileSync(new URL('./index.html', import.meta.url), 'utf8');
const sw = fs.readFileSync(new URL('./sw.js', import.meta.url), 'utf8');

test('Persian display prefers locally licensed Yekan Bakh and keeps readable fallback', () => {
  assert.match(css, /font-family:\s*["']CRC Yekan Bakh["']/);
  assert.match(css, /src:\s*local\(["']Yekan Bakh["']\)/);
  assert.match(css, /"CRC Yekan Bakh",\s*Vazirmatn/);
  assert.doesNotMatch(css, /@import\s+url\([^)]*(?:yekan-bakh|YekanBakh)/i,
    'Do not pull proprietary font from unverified public CDNs');
});

test('design system has readable surfaces, mobile controls and reduced-motion support', () => {
  assert.match(css, /--radius-card:\s*24px/);
  assert.match(css, /--focus-ring:\s*#[a-fA-F0-9]{6}/);
  assert.match(css, /\.coach-action-grid\s*\{/);
  assert.match(css, /\.bottom-nav a:focus-visible/);
  assert.match(css, /prefers-reduced-motion:\s*reduce/);
  assert.match(css, /min-height:\s*44px/);
  assert.match(html, /class="coach-action-grid"/);
});

test('theme and service worker cache are refreshed for the new CSS', () => {
  assert.match(html, /name="theme-color" content="#080f1e"/);
  assert.match(sw, /crc-mvp-static-v12/);
});

test('action-first dashboard preserves report targets, mobile battles and consent', () => {
  assert.match(html, /id="homePlayerAction"/);
  for (const id of ['coachMetrics','coachOwnedOptions','coachBattleReport','coachReport']) {
    assert.ok(html.includes('data-coach-jump="'+id+'"'));
    assert.ok(html.includes('id="'+id+'"'));
  }
  assert.match(html, /<details class="panel coach-chat"/);
  assert.match(html, /id="coachAIConsent"/);
  assert.match(html.slice(html.indexOf('class="bottom-nav"')), /data-nav="battles"/);
  assert.match(html, /class="avatar profile-link" href="#player"/);
});

test('approved UI has all five mobile destinations and a separate report for each coach action', () => {
  const mobile = html.slice(html.indexOf('class="bottom-nav"'), html.indexOf('id="toast"'));
  for (const name of ['home','player','coach','battles','cards']) assert.ok(mobile.includes('data-nav="'+name+'"'));
  for (const key of ['coachMetrics','coachOwnedOptions','coachBattleReport']) assert.ok(html.includes('data-report-group="'+key+'"'));
  assert.match(html, /id="coachReportTitle"/);
  assert.equal((html.match(/id="profileSummary"/g)||[]).length,1);
  assert.match(css, /grid-template-columns:repeat\(8,minmax\(0,1fr\)\)/);
});

test('coach choices show only the selected report and preserve accessible selection', () => {
  const app = fs.readFileSync(new URL('./app.js', import.meta.url), 'utf8');
  const fn = app.match(/function selectCoachReport\(key,move\)\{[\s\S]*?\n\}/)?.[0];
  assert.ok(fn);
  const keys = ['coachMetrics','coachOwnedOptions','coachBattleReport'];
  const groups = keys.map(reportGroup => ({dataset:{reportGroup},hidden:false}));
  const buttons = [...keys,'coachReport'].map(coachJump => ({
    dataset:{coachJump}, pressed:null, setAttribute(name,value){assert.equal(name,'aria-pressed');this.pressed=value;}
  }));
  const title = {textContent:''};
  let focused=0, scrolled=0;
  const report={focus(){focused++;},scrollIntoView(){scrolled++;}};
  const document={querySelectorAll(selector){return selector==='[data-report-group]'?groups:buttons;}};
  const select = new Function('$','document',fn+';return selectCoachReport;')(id=>id==='coachReportTitle'?title:report,document);
  for(const key of [...keys,'coachReport']){
    select(key,true);
    assert.ok(groups.every(g=>g.hidden===(key!=='coachReport'&&g.dataset.reportGroup!==key)));
    assert.ok(buttons.every(b=>b.pressed===String(b.dataset.coachJump===key)));
    assert.ok(title.textContent.length>0);
  }
  assert.equal(focused,4);
  assert.equal(scrolled,4);
});

test('onboarding and coach keep consent, loading and local state',()=>{const app=fs.readFileSync(new URL('./app.js',import.meta.url),'utf8');for(const id of ['crcOnboard','crcTag','crcConnect','crcConnectLocal','crcLoadProfile','crcLoadBattles','crcChangeAccount','crcSavedDecks','crcBattleHistory','crcBattleAnalysis'])assert.ok(html.includes('id="'+id+'"'),id);assert.match(app,/localStorage.setItem\("crc.playerTag",tag\)/);assert.match(app,/if\(!crcConsent\)return/);assert.match(app,/crcLiveBusy/);assert.match(app,/crcQuickAction/);});
