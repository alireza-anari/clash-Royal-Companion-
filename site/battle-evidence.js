/* Aggregates verified battle-log evidence for the online coach request. No advice or model runs locally. */
(function(root) {
  "use strict";
  function evidence(rawBattles, playerTag, scope, selectedDeck) {
    const engine = root.CRCBattleIntelligence;
    if (!engine || !Array.isArray(rawBattles) || rawBattles.length === 0) return null;
    const normalizedTag = engine.tag(playerTag);
    if (!normalizedTag) return null;

    const mode = scope === "event" || scope === "other" ? scope : "all";
    const report = engine.summarize(rawBattles, normalizedTag, mode);
    const matched = report.entries.filter(entry => entry.attribution === "matched_tag");
    if (!matched.length) return null;

    function counts(entries) {
      return {
        total: entries.length,
        wins: entries.filter(e => e.outcome === "win").length,
        losses: entries.filter(e => e.outcome === "loss").length,
        draws: entries.filter(e => e.outcome === "draw").length,
        unknown: entries.filter(e => e.outcome === "unknown").length
      };
    }

    const validDeck = Array.isArray(selectedDeck) &&
      selectedDeck.length === 8 &&
      selectedDeck.every(id => Number.isSafeInteger(id) && id > 0) &&
      new Set(selectedDeck).size === 8;
    const selectedIds = validDeck ? selectedDeck.slice().sort((a,b) => a-b) : null;
    const deckKey = selectedIds ? selectedIds.join(":") : null;
    const observed = deckKey ? matched.filter(e =>
      e.deck && e.deck.card_ids.slice().sort((a,b) => a-b).join(":") === deckKey
    ) : [];
    const leaks = matched.map(e => e.elixir_leaked)
      .filter(n => Number.isFinite(n) && n >= 0);
    const averageLeak = leaks.length
      ? Math.round(leaks.reduce((a,b) => a+b, 0) / leaks.length * 100) / 100
      : null;

    return {
      schema_version: "1.0",
      generator: "crc-battle-evidence",
      filter: mode,
      analyzed_records: report.filtered_count,
      matched_records: matched.length,
      nonmatching_records: report.filtered_count - matched.length,
      outcomes: counts(matched),
      battle_modes: {
        event: counts(matched.filter(e => e.classification === "event")),
        unclassified: counts(matched.filter(e => e.classification === "unclassified"))
      },
      selected_deck: selectedIds ? {
        main_card_ids: selectedIds,
        observed_outcomes: counts(observed),
        tower_troop_not_compared: true
      } : null,
      reported_elixir_leaked: {
        sample_size: leaks.length,
        average: averageLeak
      },
      limitations: [
        "Partial battle history only",
        "Player ownership not verified",
        "Unclassified modes are not Trophy Road by default",
        "No replay events or card placements",
        "No prediction of future win rate"
      ]
    };
  }
  root.CRCBattleEvidence = Object.freeze({evidence});
})(typeof window !== "undefined" ? window : globalThis);
