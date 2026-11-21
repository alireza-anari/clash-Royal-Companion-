import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';

const sandbox = {Intl, Date};
vm.runInNewContext(fs.readFileSync(new URL('./battle-insights.js', import.meta.url), 'utf8'), sandbox);
vm.runInNewContext(fs.readFileSync(new URL('./offline-coach.js', import.meta.url), 'utf8'), sandbox);
const engine = sandbox.CRCOfflineCoach;
const ids = [26000010,26000014,26000021,27000000,26000038,26000030,28000000,28000011];
const p = (tag, crowns, leak) => ({
  tag, name: tag === '#MYTAG' ? 'SECRET_USER_NAME' : 'OPPONENT_PRIVATE',
  crowns, elixirLeaked: leak, cards: ids.map(id => ({id}))
});
const event = {
  battleTime: '20261120T120719.000Z', deckSelection: 'eventDeck',
  team: [p('#MYTAG', 2, 2.4)], opponent: [p('#RIVAL', 1, 0.3)]
};
const ordinary = {
  battleTime: '20261120T120720.000Z',
  team: [p('#MYTAG', 0, 1.6)], opponent: [p('#RIVAL', 3, 0.1)]
};

test('evidence is aggregated without tag, identity or battle timestamps', () => {
  const result = engine.evidence([event, ordinary], '#MYTAG', 'all', ids);
  assert.equal(result.matched_records, 2);
  assert.equal(result.outcomes.wins, 1);
  assert.equal(result.outcomes.losses, 1);
  assert.equal(result.reported_elixir_leaked.average, 2);
  assert.equal(result.selected_deck.observed_outcomes.total, 2);
  assert.equal(result.selected_deck.tower_troop_not_compared, true);
  const serialized = JSON.stringify(result);
  for(const forbidden of ['#MYTAG', '#RIVAL', 'SECRET_USER_NAME', 'OPPONENT_PRIVATE', '20261120']) {
    assert.equal(serialized.includes(forbidden), false, forbidden);
  }
});

test('scope isolates event matches and does not infer user identity from missing tag', () => {
  const out=engine.evidence([event, ordinary], '#MYTAG', 'event', ids);
  assert.equal(out.matched_records, 1);
  assert.equal(out.outcomes.wins, 1);
  assert.equal(out.battle_modes.unclassified.total, 0);
  assert.equal(engine.evidence([event], '#NO_MATCH', 'all', ids), null);
  assert.equal(engine.evidence([event], '', 'all', ids), null);
  assert.equal(engine.evidence([], '#MYTAG', 'all', ids), null);
});
