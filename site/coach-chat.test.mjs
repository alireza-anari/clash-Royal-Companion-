import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';

const sandbox = { Intl, Number, Object, Array, Set, Math };
const code = fs.readFileSync(new URL('./coach-chat.js', import.meta.url), 'utf8');
vm.runInNewContext(code, sandbox, { filename: 'coach-chat.js' });
const coach = sandbox.CRCChatCoach;
const facts = {
  errors: [], average: 3.25, cycle: 7, spells: 2, defensive: 1,
  items: [], missing: [], cheap: 2, expensive: 1
};
const findings = [{ title:'چرخه کم‌هزینه', text:'فقط یک مشاهده درباره ترکیب کارت‌هاست.' }];
const battleEvidence = {
  filter:'event', analyzed_records:4, matched_records:3, nonmatching_records:1,
  outcomes:{total:3,wins:2,losses:1,draws:0,unknown:0},
  reported_elixir_leaked:{sample_size:2,average:1.4}
};

test('guided offline prompts are short and discoverable',()=>{
  assert.ok(coach.PROMPTS.length >= 4);
  assert.ok(coach.PROMPTS.every(p=>typeof p.label==='string'&&p.label.length<80));
  assert.ok(coach.PROMPTS.every(p=>typeof p.question==='string'&&p.question.length>0));
});

test('deck elixir answer is calculated from current deck and does not predict wins',()=>{
  const res=coach.respond('میانگین اکسیر دکم چقدر است؟',{facts,findings,battleEvidence:null});
  assert.equal(res.kind,'deck');
  assert.match(res.text,/۳[٫.]۲۵|3\.25/);
  assert.match(res.text,/۷|7/);
  assert.doesNotMatch(res.text,/\d+\s*%/);
  assert.ok(res.source.includes('دک'));
});

test('invalid or incomplete decks must not receive invented numbers',()=>{
  const res=coach.respond('هزینه اکسیر دک',{facts:{errors:['دک کامل نیست'],average:null},findings:[],battleEvidence:null});
  assert.equal(res.kind,'missing');
  assert.doesNotMatch(res.text,/۳[٫.]۲۵|3\.25/);
  assert.match(res.text,/دک|کارت/);
});

test('battle reply only reflects attributed summary and notes missing evidence',()=>{
  const res=coach.respond('چند برد و باخت داشتم؟',{facts,findings,battleEvidence});
  assert.equal(res.kind,'battles');
  assert.match(res.text,/۳|3/);
  assert.match(res.text,/۲|2/);
  assert.match(res.text,/۱|1/);
  assert.match(res.text,/رویدادی/);
  assert.match(res.text,/کامل نیست|محدود|نمونه/);
  assert.doesNotMatch(res.text,/درصد برد|نرخ برد شما/);
});

test('missing battle attribution must ask for evidence instead of guessing',()=>{
  const res=coach.respond('بردهایم را بررسی کن',{facts,findings,battleEvidence:null});
  assert.equal(res.kind,'missing');
  assert.match(res.text,/Battle Log/);
  assert.match(res.text,/Player Tag/);
});

test('tactical replay or video request is explicitly unsupported',()=>{
  const res=coach.respond('ویدیو ریپلی را تحلیل کن و اشتباه جایگذاری من را بگو',{facts,findings,battleEvidence});
  assert.equal(res.kind,'unsupported');
  assert.match(res.text,/Replay|ویدئو/);
  assert.match(res.text,/نمی‌توان|نداریم|فعال نیست/);
});

test('free-text unknown request is not hallucinated or echoed as HTML',()=>{
  const question='<img src=x onerror=alert(1)>';
  const res=coach.respond(question,{facts,findings,battleEvidence});
  assert.equal(res.kind,'unsupported');
  assert.ok(!res.text.includes('<img'));
});

test('the page, app, worker and offline cache serve the same local chat module',()=>{
  const html=fs.readFileSync(new URL('./index.html',import.meta.url),'utf8');
  const app=fs.readFileSync(new URL('./app.js',import.meta.url),'utf8');
  const worker=fs.readFileSync(new URL('../deploy/cloudflare/worker-runtime.js',import.meta.url),'utf8');
  const build=fs.readFileSync(new URL('../deploy/cloudflare/build-site.mjs',import.meta.url),'utf8');
  const sw=fs.readFileSync(new URL('./sw.js',import.meta.url),'utf8');
  assert.match(html,/id="coachChatForm"/);
  assert.match(html,/id="coachChatMessages"/);
  assert.match(html,/id="coachChatQuestion"/);
  assert.match(html,/src="\/coach-chat\.js"/);
  assert.match(app,/CRCChatCoach\.respond/);
  assert.match(app,/textContent\s*=/);
  assert.match(worker,/path==="\/coach-chat\.js"/);
  assert.match(build,/var COACH_CHAT/);
  assert.match(sw,/\/coach-chat\.js/);
});

test('online consent explains external routing and data-collection restriction accurately',()=>{
 const html=fs.readFileSync(new URL('./index.html',import.meta.url),'utf8');
 assert.match(html,/data_collection=deny/);
 assert.match(html,/به معنی پردازش محلی یا تضمین حذف فوری نیست/);
 assert.match(html,/رضایت برای هر ارسال جداگانه است/);
});
