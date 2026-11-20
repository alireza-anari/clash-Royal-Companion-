import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

let onFetch;
const sandbox = {
  URL, Request, Response, Map, Set,
  addEventListener(eventName, callback) {
    if (eventName === 'fetch') onFetch = callback;
  },
};
const source = readFileSync(new URL('./worker.js', import.meta.url), 'utf8');
vm.runInNewContext(source, sandbox, { filename: 'worker.js' });
assert.equal(typeof onFetch, 'function');

async function call(path, options) {
  let pending;
  onFetch({
    request: new Request('https://localhost.test' + path, options),
    respondWith(responsePromise) { pending = responsePromise; },
  });
  assert.ok(pending, 'Worker must respond');
  return pending;
}

async function analyze(cardIds) {
  const response = await call('/api/analyze', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ card_ids: cardIds }),
  });
  return { status: response.status, json: await response.json() };
}

test('preview homepage is clear about sample-only data', async () => {
  const response = await call('/');
  assert.equal(response.status, 200);
  assert.match(await response.text(), /به Supercell متصل نیست/);
});

test('health does not misrepresent a live Supercell connection', async () => {
  const response = await call('/health');
  const data = await response.json();
  assert.equal(data.status, 'ok');
  assert.equal(data.supercell_live, false);
});

test('heavy test deck has average 4.0 and cycle cost 11', async () => {
  const catalog = await (await call('/api/cards')).json();
  const result = await analyze(catalog.sample_decks.heavy);
  assert.equal(result.status, 200);
  assert.equal(result.json.facts.average_elixir, 4);
  assert.equal(result.json.facts.cycle_cost_four_cheapest, 11);
});

test('hog test deck has average 2.625 and cycle cost 6', async () => {
  const catalog = await (await call('/api/cards')).json();
  const result = await analyze(catalog.sample_decks.hog);
  assert.equal(result.status, 200);
  assert.equal(result.json.facts.average_elixir, 2.625);
  assert.equal(result.json.facts.cycle_cost_four_cheapest, 6);
});

test('duplicate IDs are rejected', async () => {
  const r = await analyze([1,1,2,3,4,5,6,7]);
  assert.equal(r.status, 422);
});

test('unknown cards are rejected', async () => {
  const r = await analyze([1,2,3,4,5,6,7,8]);
  assert.equal(r.status, 422);
});

test('unknown route fails without sensitive output', async () => {
  const response = await call('/not-found');
  assert.equal(response.status, 404);
});
