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
  assert.match(sw, /crc-mvp-static-v10/);
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
