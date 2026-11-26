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
  assert.match(sw, /crc-mvp-static-v16/);
});

test('coach is online-only and no per-message approval or local fallback is exposed',()=>{
  const app=fs.readFileSync(new URL('./app.js',import.meta.url),'utf8');
  assert.match(html,/id="coachChatPanel"/);assert.match(html,/id="coachChatForm"/);assert.match(html,/id="coachAIStatus"/);assert.match(html,/id="crcCoachDataNotice"/);
  assert.match(html,/مربی آنلاین/);
  for(const old of ['coachAIConsent','coachAIOptions','crcReportDetails','crcConnectLocal','آفلاین پیش‌فرض','مربی آفلاین','coach-chat.js','offline-coach.js'])assert.ok(!html.includes(old),old);
  for(const key of ['coachMetrics','coachOwnedOptions','coachBattleReport','coachReport'])assert.ok(html.includes('data-coach-jump="'+key+'"'));
  assert.match(app,/CRCBackendClient\.askAI/);assert.match(app,/CRCBattleEvidence\.evidence/);
  for(const old of ['CRCChatCoach','CRCOfflineCoach','پاسخ آفلاین','coachAIConsent','crcConsent','crcConnectLocal','selectCoachReport'])assert.ok(!app.includes(old),old);
  assert.match(app,/function crcQuickAction/);
  assert.match(html.slice(html.indexOf('class="bottom-nav"'),html.indexOf('id="toast"')),/data-nav="battles"/);
  assert.match(html,/class="avatar profile-link" href="#player"/);
});
test('online coach actions send directly and errors never fall back to local advice',()=>{
  const app=fs.readFileSync(new URL('./app.js',import.meta.url),'utf8');
  const ask=app.match(/async function askCoachChat\(question,action\)\{[\s\S]*?\n\}/)?.[0];
  assert.ok(ask);assert.match(ask,/CRCBackendClient\.askAI/);assert.match(ask,/addCoachChatMessage\("status"/);
  assert.doesNotMatch(ask,/CRCChatCoach|CRCOfflineCoach|پاسخ آفلاین/);
  assert.match(app,/askCoachChat\(question,action\)/);assert.doesNotMatch(app,/coachAIOptions|coachAIConsent|explicitConsent/);
});
test('onboarding has a single profile-fetch path and prepares the online coach without a local mode',()=>{
  const app=fs.readFileSync(new URL('./app.js',import.meta.url),'utf8');
  for(const id of ['crcOnboard','crcTag','crcConnect','crcLoadProfile','crcLoadBattles','crcChangeAccount','crcSavedDecks','crcBattleHistory','crcBattleAnalysis'])assert.ok(html.includes('id="'+id+'"'),id);
  assert.ok(!html.includes('crcConnectLocal'));assert.match(app,/localStorage\.setItem\("crc.playerTag",tag\)/);assert.match(app,/crcLiveBusy/);assert.doesNotMatch(app,/crcConsent|crcAnalyze\(/);
});
test('battle evidence is shipped as a support module, not an offline coach',()=>{
  assert.match(html,/src="\/battle-evidence\.js"/);assert.doesNotMatch(html,/offline-coach\.js|coach-chat\.js/);
  assert.match(sw,/crc-mvp-static-v16/);assert.match(sw,/\/battle-evidence\.js/);assert.doesNotMatch(sw,/offline-coach\.js|coach-chat\.js/);
});

test('minimal coach keeps composer and tools separate from the welcome state',()=>{const app=fs.readFileSync(new URL('./app.js',import.meta.url),'utf8');for(const id of ['crcChatWelcome','crcChatScroll','crcCoachToolsToggle','crcCoachTools','coachChatQuestion','clearCoachChat'])assert.ok(html.includes('id="'+id+'"'),id);assert.match(html,/aria-expanded="false" aria-controls="crcCoachTools"/);assert.match(app,/\$\("crcChatWelcome"\)\.hidden=true/);assert.match(app,/\$\("crcChatWelcome"\)\.hidden=false/);assert.match(css,/body\.crc-coach-view/);assert.match(css,/\.crc-chat-scroll\{[^}]*overflow:auto/);});

test('global footer never competes for coach conversation width',()=>{assert.match(css,/body\.crc-coach-view \.content > \.footer\{display:none!important\}/);assert.match(css,/body\.crc-coach-view \.content\{flex-direction:column;min-width:0\}/);assert.match(html,/<footer class="footer">/);});

test('online coach pending indicator follows actual request lifecycle',()=>{const app=fs.readFileSync(new URL('./app.js',import.meta.url),'utf8');const ask=app.match(/async function askCoachChat\(question,action\)\{[\s\S]*?\n\}/)?.[0];assert.ok(ask);assert.ok(ask.indexOf('crcCoachPending(true)')<ask.indexOf('await window.CRCBackendClient.askAI'));assert.match(ask,/crcCoachPending\(false\);\s*addCoachChatMessage\("ai"/);assert.match(ask,/catch\(e\)\{\s*crcCoachPending\(false\)/);assert.match(ask,/finally\{\s*crcCoachPending\(false\)/);assert.match(css,/@keyframes crcPendingOrbit/);assert.match(css,/@keyframes crcPendingDot/);});
