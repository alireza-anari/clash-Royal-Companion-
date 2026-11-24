const META_BASE_URL = "https://proxy.royaleapi.dev/v1";
const META_CRON = "*/2 * * * *";
const META_REFRESH_MS = 12 * 60 * 60 * 1000;
const META_JOB_TTL = 60 * 60;
const META_HISTORY_TTL = 90 * 24 * 60 * 60;
const META_BATCH_SIZE = 32;
const META_CONCURRENCY = 4;

const KEYS = Object.freeze({
  current: "meta:current",
  previous: "meta:previous",
  status: "meta:status",
  job: "meta:job",
  catalog: "meta:catalog",
  historyPrefix: "meta:history:"
});

class MetaPipelineError extends Error {
  constructor(code, status = 0) {
    super(code);
    this.name = "MetaPipelineError";
    this.code = code;
    this.status = status;
  }
}

function isoNow() {
  return new Date().toISOString();
}

function safeJsonParse(value) {
  if (typeof value !== "string" || !value) return null;
  try {
    return JSON.parse(value);
  } catch (_) {
    return null;
  }
}

async function kvJson(kv, key) {
  if (!kv || typeof kv.get !== "function") return null;
  return safeJsonParse(await kv.get(key, { cacheTtl: 30 }));
}

async function saveJson(kv, key, value, expirationTtl) {
  const options = Number.isInteger(expirationTtl) ? { expirationTtl } : undefined;
  await kv.put(key, JSON.stringify(value), options);
}

function cleanApiToken(value) {
  const raw = typeof value === "string" ? value.trim() : "";
  const token = raw.slice(0, 7).toLowerCase() === "bearer " ? raw.slice(7).trim() : raw;
  if (!token || /[\s]/.test(token) || token.length < 16) {
    throw new MetaPipelineError("MISSING_OR_INVALID_API_TOKEN", 403);
  }
  return token;
}

async function officialGet(path, token) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12000);
  let response;
  try {
    response = await fetch(META_BASE_URL + path, {
      method: "GET",
      headers: {
        Authorization: "Bearer " + token,
        auth: token,
        Accept: "application/json",
        "Cache-Control": "no-cache"
      },
      cache: "no-store",
      redirect: "manual",
      signal: controller.signal
    });
    if (response.status >= 300 && response.status < 400) {
      throw new MetaPipelineError("UPSTREAM_REDIRECT", response.status);
    }
    if (!response.ok) {
      const code = response.status === 429
        ? "UPSTREAM_RATE_LIMITED"
        : response.status === 403
          ? "UPSTREAM_FORBIDDEN"
          : "UPSTREAM_HTTP_" + response.status;
      throw new MetaPipelineError(code, response.status);
    }
    const body = await response.text();
    let payload;
    try {
      payload = JSON.parse(body);
    } catch (_) {
      throw new MetaPipelineError("UPSTREAM_INVALID_JSON", response.status);
    }
    return payload;
  } catch (error) {
    if (error instanceof MetaPipelineError) throw error;
    throw new MetaPipelineError(controller.signal.aborted ? "UPSTREAM_TIMEOUT" : "UPSTREAM_NETWORK_ERROR", 0);
  } finally {
    clearTimeout(timeout);
  }
}

async function mapLimit(items, limit, callback) {
  const results = new Array(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const index = cursor++;
      if (index >= items.length) return;
      try {
        results[index] = await callback(items[index], index);
      } catch (error) {
        results[index] = { ok: false, code: error && error.code ? error.code : "UPSTREAM_NETWORK_ERROR", status: error && error.status ? error.status : 0 };
      }
    }
  });
  await Promise.all(workers);
  return results;
}

function normalizePlayerTag(value) {
  if (typeof value !== "string") return null;
  const tag = value.trim().toUpperCase().replace(/^#/, "");
  return /^[A-Z0-9]{3,16}$/.test(tag) ? "#" + tag : null;
}

function normalizeBattleTime(value) {
  if (typeof value !== "string") return null;
  const match = value.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(?:\.(\d{3}))?Z$/);
  if (!match) return null;
  return match[1] + "-" + match[2] + "-" + match[3] + "T" +
    match[4] + ":" + match[5] + ":" + match[6] + "." + (match[7] || "000") + "Z";
}

function normalizeCatalog(payload) {
  const items = Array.isArray(payload) ? payload :
    Array.isArray(payload && payload.items) ? payload.items :
    Array.isArray(payload && payload.cards) ? payload.cards : [];
  const result = {};
  for (const item of items) {
    if (!item || !Number.isSafeInteger(item.id) || typeof item.name !== "string") continue;
    const icon = item.iconUrls && (item.iconUrls.medium || item.iconUrls.evolutionMedium);
    result[String(item.id)] = {
      id: item.id,
      name: item.name,
      rarity: typeof item.rarity === "string" ? item.rarity.toLowerCase() : null,
      max_level: Number.isInteger(item.maxLevel) ? item.maxLevel : null,
      elixir_cost: Number.isInteger(item.elixirCost) ? item.elixirCost : null,
      icon_url: typeof icon === "string" && icon.startsWith("https://api-assets.clashroyale.com/") ? icon : null
    };
  }
  return result;
}

function normalizeBattleCard(card, catalog) {
  if (!card || !Number.isSafeInteger(card.id)) return null;
  const catalogCard = catalog[String(card.id)] || {};
  const name = typeof card.name === "string" && card.name ? card.name : catalogCard.name;
  if (typeof name !== "string" || !name) return null;
  const evolutionLevel = Number.isInteger(card.evolutionLevel) && card.evolutionLevel > 0 ? card.evolutionLevel : 0;
  const heroLevel = Number.isInteger(card.heroLevel) && card.heroLevel > 0 ? card.heroLevel : 0;
  const suppliedIcon = card.iconUrls && (card.iconUrls.medium || card.iconUrls.evolutionMedium);
  const icon = catalogCard.icon_url || (typeof suppliedIcon === "string" && suppliedIcon.startsWith("https://api-assets.clashroyale.com/") ? suppliedIcon : null);
  return {
    id: card.id,
    name,
    evolution_level: evolutionLevel,
    hero_level: heroLevel,
    rarity: catalogCard.rarity || null,
    elixir_cost: Number.isInteger(catalogCard.elixir_cost) ? catalogCard.elixir_cost : null,
    icon_url: icon
  };
}

function cardKey(card) {
  return card.id + ":" + (card.evolution_level || 0) + ":" + (card.hero_level || 0);
}

function normalizeDeck(player, catalog) {
  if (!player || !Array.isArray(player.cards) || player.cards.length !== 8) return null;
  const cards = player.cards.map(card => normalizeBattleCard(card, catalog));
  if (cards.some(card => !card)) return null;
  const signature = cards.map(cardKey).sort().join("|");
  return { cards, signature };
}

function shortHash(value) {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return "deck-" + (hash >>> 0).toString(36);
}

function hasCard(names, target) {
  return names.some(name => name.toLowerCase().includes(target.toLowerCase()));
}

function classifyArchetype(names) {
  if (hasCard(names, "Lava Hound")) return hasCard(names, "Balloon") ? "Lava Hound / Balloon" : "Air Beatdown";
  if (hasCard(names, "Hog Rider")) return "Hog Rider / Fast Cycle";
  if (hasCard(names, "Graveyard")) return "Graveyard Control";
  if (hasCard(names, "Goblin Drill")) return "Goblin Drill Control";
  if (hasCard(names, "Goblin Barrel")) return "Log Bait";
  if (hasCard(names, "X-Bow") || hasCard(names, "Mortar")) return "Siege";
  if (hasCard(names, "Battle Ram")) return "Bridge Spam";
  if (hasCard(names, "Royal Hogs")) return "Royal Hogs Pressure";
  if (hasCard(names, "Royal Giant")) return "Royal Giant Control";
  if (hasCard(names, "Electro Giant")) return "Electro Giant Beatdown";
  if (hasCard(names, "Golem")) return "Golem Beatdown";
  if (hasCard(names, "Giant")) return "Giant Beatdown";
  if (hasCard(names, "Miner")) return "Miner Control";
  if (hasCard(names, "Balloon")) return "Balloon Beatdown";
  if (hasCard(names, "Mega Knight")) return "Mega Knight Pressure";
  return "Mixed / Control";
}

function labelDeck(names, archetype) {
  if (hasCard(names, "Lava Hound") && hasCard(names, "Balloon")) return "Lava Hound + Balloon";
  if (hasCard(names, "Graveyard") && hasCard(names, "Giant")) return "Graveyard + Giant";
  if (hasCard(names, "Goblin Barrel") && hasCard(names, "Wall Breakers")) return "Goblin Barrel + Wall Breakers";
  const winConditions = ["Hog Rider", "Battle Ram", "Royal Hogs", "Royal Giant", "Goblin Drill", "Electro Giant", "Golem", "Giant", "Graveyard", "X-Bow", "Mortar", "Miner", "Balloon", "Lava Hound"];
  for (const name of winConditions) if (hasCard(names, name)) return name;
  return archetype;
}

function emptyAggregate() {
  return {
    seen_battle_keys: {},
    decks: {},
    cards: {},
    unique_battles: 0,
    deck_appearances: 0,
    sample_start: null,
    sample_end: null
  };
}

function incrementResult(target, result) {
  if (result === "win") target.wins++;
  else if (result === "loss") target.losses++;
  else if (result === "draw") target.draws++;
  else target.unknown++;
}

function addAppearance(aggregate, deck, result) {
  let row = aggregate.decks[deck.signature];
  if (!row) {
    const names = deck.cards.map(card => card.name);
    const archetype = classifyArchetype(names);
    row = aggregate.decks[deck.signature] = {
      id: shortHash(deck.signature),
      signature: deck.signature,
      name: labelDeck(names, archetype),
      archetype,
      cards: names,
      card_details: deck.cards,
      appearances: 0,
      wins: 0,
      losses: 0,
      draws: 0,
      unknown: 0
    };
  }
  row.appearances++;
  incrementResult(row, result);
  aggregate.deck_appearances++;

  for (const card of deck.cards) {
    const key = cardKey(card);
    let cardRow = aggregate.cards[key];
    if (!cardRow) {
      cardRow = aggregate.cards[key] = {
        key,
        id: card.id,
        name: card.name,
        evolution_level: card.evolution_level,
        hero_level: card.hero_level,
        icon_url: card.icon_url,
        appearances: 0,
        wins: 0,
        losses: 0,
        draws: 0,
        unknown: 0
      };
    }
    cardRow.appearances++;
    incrementResult(cardRow, result);
  }
}

function addRankedBattle(aggregate, battle, catalog) {
  if (!battle || battle.type !== "pathOfLegend") return false;
  if (!Array.isArray(battle.team) || battle.team.length !== 1 || !Array.isArray(battle.opponent) || battle.opponent.length !== 1) return false;
  const team = battle.team[0], opponent = battle.opponent[0];
  const teamDeck = normalizeDeck(team, catalog), opponentDeck = normalizeDeck(opponent, catalog);
  const battleTime = normalizeBattleTime(battle.battleTime);
  if (!teamDeck || !opponentDeck || !battleTime) return false;

  const tags = [normalizePlayerTag(team.tag), normalizePlayerTag(opponent.tag)].filter(Boolean).sort();
  const pairKey = tags.length === 2 ? tags.join("|") : [teamDeck.signature, opponentDeck.signature].sort().join("|");
  const battleKey = battleTime + "|" + pairKey;
  if (aggregate.seen_battle_keys[battleKey]) return false;
  aggregate.seen_battle_keys[battleKey] = true;

  aggregate.unique_battles++;
  if (!aggregate.sample_start || battleTime < aggregate.sample_start) aggregate.sample_start = battleTime;
  if (!aggregate.sample_end || battleTime > aggregate.sample_end) aggregate.sample_end = battleTime;

  const teamCrowns = Number.isInteger(team.crowns) ? team.crowns : null;
  const opponentCrowns = Number.isInteger(opponent.crowns) ? opponent.crowns : null;
  let teamResult = "unknown", opponentResult = "unknown";
  if (teamCrowns !== null && opponentCrowns !== null) {
    if (teamCrowns > opponentCrowns) {
      teamResult = "win";
      opponentResult = "loss";
    } else if (teamCrowns < opponentCrowns) {
      teamResult = "loss";
      opponentResult = "win";
    } else {
      teamResult = "draw";
      opponentResult = "draw";
    }
  }
  addAppearance(aggregate, teamDeck, teamResult);
  addAppearance(aggregate, opponentDeck, opponentResult);
  return true;
}

function rate(wins, losses) {
  const decided = wins + losses;
  return decided > 0 ? Math.round((wins / decided) * 10000) / 100 : null;
}

function usage(appearances, total) {
  return total > 0 ? Math.round((appearances / total) * 10000) / 100 : 0;
}

function buildSnapshot(job, previous) {
  const aggregate = job.aggregate;
  const totalDecks = aggregate.deck_appearances;
  const deckRows = Object.values(aggregate.decks).map(row => {
    const average = row.card_details.every(card => Number.isInteger(card.elixir_cost))
      ? Math.round(row.card_details.reduce((sum, card) => sum + card.elixir_cost, 0) / 8 * 100) / 100
      : null;
    return {
      id: row.id,
      name: row.name,
      archetype: row.archetype,
      cards: row.cards,
      card_details: row.card_details,
      card_ids: row.card_details.map(card => card.id),
      battles: row.appearances,
      appearances: row.appearances,
      wins: row.wins,
      losses: row.losses,
      draws: row.draws,
      win_rate: rate(row.wins, row.losses),
      usage_rate: usage(row.appearances, totalDecks),
      average_elixir: average
    };
  }).sort((a, b) => b.appearances - a.appearances || (b.win_rate || 0) - (a.win_rate || 0) || a.name.localeCompare(b.name));

  const decks = deckRows.slice(0, 20).map((row, index) => ({ ...row, rank: index + 1 }));
  const cardUsage = Object.values(aggregate.cards).map(row => ({
    key: row.key,
    id: row.id,
    name: row.name,
    evolution_level: row.evolution_level,
    hero_level: row.hero_level,
    icon_url: row.icon_url,
    appearances: row.appearances,
    usage_rate: usage(row.appearances, totalDecks),
    win_rate: rate(row.wins, row.losses),
    wins: row.wins,
    losses: row.losses,
    draws: row.draws
  })).sort((a, b) => b.appearances - a.appearances || a.name.localeCompare(b.name));

  const previousCards = new Map(
    previous && previous.meta_pipeline_version === "1.0" && Array.isArray(previous.card_usage)
      ? previous.card_usage.map(card => [card.key, card])
      : []
  );
  const deltas = cardUsage
    .filter(card => previousCards.has(card.key))
    .map(card => ({
      name: card.name + (card.evolution_level > 0 ? " Evolution" : card.hero_level > 0 ? " Hero" : ""),
      id: card.id,
      delta: Math.round((card.usage_rate - previousCards.get(card.key).usage_rate) * 100) / 100,
      usage_rate: card.usage_rate
    }));
  const rising = deltas.filter(card => card.delta > 0).sort((a, b) => b.delta - a.delta).slice(0, 5);
  const falling = deltas.filter(card => card.delta < 0).sort((a, b) => a.delta - b.delta).slice(0, 5);

  const archetypeMap = {};
  for (const row of deckRows) {
    const key = row.archetype;
    if (!archetypeMap[key]) archetypeMap[key] = { name: key, appearances: 0, wins: 0, losses: 0, draws: 0 };
    archetypeMap[key].appearances += row.appearances;
    archetypeMap[key].wins += row.wins;
    archetypeMap[key].losses += row.losses;
    archetypeMap[key].draws += row.draws;
  }
  const archetypes = Object.values(archetypeMap)
    .map(row => ({
      name: row.name,
      share: usage(row.appearances, totalDecks),
      win_rate: rate(row.wins, row.losses),
      delta: null,
      appearances: row.appearances
    }))
    .sort((a, b) => b.share - a.share)
    .slice(0, 10);

  const now = isoNow();
  return {
    schema_version: "1.0",
    meta_pipeline_version: "1.0",
    generated_at: now,
    report_date: now.slice(0, 10),
    source_name: "Supercell Official Clash Royale API",
    source_url: "https://developer.clashroyale.com/#/documentation",
    transport: "RoyaleAPI proxy",
    cohort: "Top global Ranked / Path of Legend leaderboard",
    players: job.player_tags.length,
    players_successful: job.players_successful,
    players_failed: job.players_failed,
    battles: aggregate.unique_battles,
    decks_sampled: totalDecks,
    catalog_count: Object.keys(job.card_catalog).length,
    sample_start: aggregate.sample_start,
    sample_end: aggregate.sample_end,
    sample_window: "Recent public battle logs; not a fixed seven-day window",
    trend_baseline_available: previousCards.size > 0,
    refresh_interval_hours: 12,
    methodology: "Top global Path of Legend players; only type=pathOfLegend 1v1 battles; both eight-card decks counted once per battle; duplicate observations deduplicated by battle time and player tags; win rate excludes draws.",
    decks,
    card_usage: cardUsage,
    rising,
    falling,
    archetypes
  };
}

async function setFailure(kv, code, current, details = {}) {
  const now = Date.now();
  const cooldown = code === "UPSTREAM_FORBIDDEN" || code === "MISSING_OR_INVALID_API_TOKEN"
    ? 6 * 60 * 60 * 1000
    : code === "UPSTREAM_RATE_LIMITED"
      ? 30 * 60 * 1000
      : 10 * 60 * 1000;
  const status = {
    state: "error",
    error_code: code,
    failed_at: new Date(now).toISOString(),
    retry_after: new Date(now + cooldown).toISOString(),
    last_success_at: current && current.generated_at ? current.generated_at : null,
    source: "supercell_official_api",
    ...details
  };
  await kv.delete(KEYS.job);
  await saveJson(kv, KEYS.status, status, META_HISTORY_TTL);
  return { state: "error", error_code: code };
}

async function beginJob(kv, env, current) {
  let token;
  try {
    token = cleanApiToken(env.SUPERCELL_API_TOKEN);
  } catch (error) {
    return setFailure(kv, error.code || "MISSING_OR_INVALID_API_TOKEN", current);
  }

  let leaderboard;
  try {
    leaderboard = await officialGet("/locations/global/pathoflegend/players?limit=200", token);
  } catch (error) {
    return setFailure(kv, error.code || "UPSTREAM_NETWORK_ERROR", current);
  }

  const items = Array.isArray(leaderboard && leaderboard.items) ? leaderboard.items : [];
  const playerTags = [...new Set(items.map(item => normalizePlayerTag(item && item.tag)).filter(Boolean))].slice(0, 200);
  if (playerTags.length < 100) {
    return setFailure(kv, "LEADERBOARD_SAMPLE_TOO_SMALL", current, { leaderboard_players: playerTags.length });
  }

  let cardCatalog = {};
  try {
    cardCatalog = normalizeCatalog(await officialGet("/cards", token));
  } catch (_) {
    // Meta rankings remain usable without elixir costs or artwork.
  }

  const job = {
    id: "meta-" + Date.now().toString(36),
    started_at: isoNow(),
    player_tags: playerTags,
    next_index: 0,
    players_successful: 0,
    players_failed: 0,
    failed_codes: {},
    card_catalog: cardCatalog,
    aggregate: emptyAggregate()
  };
  await saveJson(kv, KEYS.job, job, META_JOB_TTL);
  await saveJson(kv, KEYS.status, {
    state: "collecting",
    job_id: job.id,
    started_at: job.started_at,
    players_total: playerTags.length,
    players_processed: 0,
    players_successful: 0,
    players_failed: 0,
    progress_percent: 0,
    last_success_at: current && current.generated_at ? current.generated_at : null
  }, META_JOB_TTL);
  return { state: "started", job };
}

async function processNextBatch(kv, env, job, current) {
  let token;
  try {
    token = cleanApiToken(env.SUPERCELL_API_TOKEN);
  } catch (error) {
    return setFailure(kv, error.code || "MISSING_OR_INVALID_API_TOKEN", current);
  }

  const tags = job.player_tags.slice(job.next_index, job.next_index + META_BATCH_SIZE);
  const results = await mapLimit(tags, META_CONCURRENCY, async tag => {
    const payload = await officialGet("/players/" + encodeURIComponent(tag) + "/battlelog", token);
    if (!Array.isArray(payload)) throw new MetaPipelineError("BATTLELOG_SCHEMA_MISMATCH", 0);
    return { ok: true, battles: payload };
  });

  for (let index = 0; index < results.length; index++) {
    const result = results[index];
    if (result && result.ok) {
      job.players_successful++;
      for (const battle of result.battles) addRankedBattle(job.aggregate, battle, job.card_catalog);
    } else {
      job.players_failed++;
      const code = result && result.code ? result.code : "UPSTREAM_NETWORK_ERROR";
      job.failed_codes[code] = (job.failed_codes[code] || 0) + 1;
      if (code === "UPSTREAM_FORBIDDEN" || code === "UPSTREAM_RATE_LIMITED") {
        return setFailure(kv, code, current, {
          players_processed: job.next_index + tags.length,
          players_successful: job.players_successful,
          players_failed: job.players_failed
        });
      }
    }
  }

  job.next_index += tags.length;
  job.updated_at = isoNow();

  if (job.next_index < job.player_tags.length) {
    await saveJson(kv, KEYS.job, job, META_JOB_TTL);
    await saveJson(kv, KEYS.status, {
      state: "collecting",
      job_id: job.id,
      started_at: job.started_at,
      updated_at: job.updated_at,
      players_total: job.player_tags.length,
      players_processed: job.next_index,
      players_successful: job.players_successful,
      players_failed: job.players_failed,
      progress_percent: Math.round(job.next_index / job.player_tags.length * 100),
      last_success_at: current && current.generated_at ? current.generated_at : null
    }, META_JOB_TTL);
    return {
      state: "collecting",
      players_processed: job.next_index,
      players_total: job.player_tags.length,
      players_successful: job.players_successful,
      players_failed: job.players_failed
    };
  }

  const coverage = job.players_successful / job.player_tags.length;
  if (coverage < 0.65 || job.aggregate.unique_battles < 200 || job.aggregate.deck_appearances < 400) {
    return setFailure(kv, "INSUFFICIENT_SAMPLE", current, {
      players_total: job.player_tags.length,
      players_successful: job.players_successful,
      players_failed: job.players_failed,
      battles: job.aggregate.unique_battles,
      decks_sampled: job.aggregate.deck_appearances,
      coverage: Math.round(coverage * 10000) / 100
    });
  }

  const previous = current && current.meta_pipeline_version === "1.0"
    ? current
    : await kvJson(kv, KEYS.previous);
  const snapshot = buildSnapshot(job, previous);
  const historyKey = KEYS.historyPrefix + snapshot.generated_at.replace(/[:.]/g, "-");

  if (current) await saveJson(kv, KEYS.previous, current, META_HISTORY_TTL);
  await saveJson(kv, KEYS.catalog, {
    updated_at: snapshot.generated_at,
    provider: "Supercell Official Clash Royale API",
    count: Object.keys(job.card_catalog).length,
    cards: Object.values(job.card_catalog)
  }, META_HISTORY_TTL);
  await saveJson(kv, historyKey, snapshot, META_HISTORY_TTL);
  await saveJson(kv, KEYS.current, snapshot);
  await saveJson(kv, KEYS.status, {
    state: "ready",
    last_attempt_at: snapshot.generated_at,
    last_success_at: snapshot.generated_at,
    next_refresh_due: new Date(Date.now() + META_REFRESH_MS).toISOString(),
    players_total: snapshot.players,
    players_processed: snapshot.players,
    players_successful: snapshot.players_successful,
    players_failed: snapshot.players_failed,
    battles: snapshot.battles,
    decks_sampled: snapshot.decks_sampled,
    catalog_count: snapshot.catalog_count,
    trend_baseline_available: snapshot.trend_baseline_available,
    error_code: null
  }, META_HISTORY_TTL);
  await kv.delete(KEYS.job);

  return {
    state: "ready",
    generated_at: snapshot.generated_at,
    players: snapshot.players_successful + snapshot.players_failed,
    battles: snapshot.battles,
    decks_sampled: snapshot.decks_sampled,
    top_decks: snapshot.decks.length
  };
}

export async function refreshMetaPipeline(env) {
  const kv = env && env.META_KV;
  if (!kv || typeof kv.get !== "function" || typeof kv.put !== "function") {
    return { state: "error", error_code: "META_KV_BINDING_MISSING" };
  }

  const [current, status, job] = await Promise.all([
    kvJson(kv, KEYS.current),
    kvJson(kv, KEYS.status),
    kvJson(kv, KEYS.job)
  ]);
  const now = Date.now();

  if (job && job.started_at && now - Date.parse(job.started_at) > 45 * 60 * 1000) {
    await kv.delete(KEYS.job);
  } else if (job && Array.isArray(job.player_tags) && job.aggregate) {
    return processNextBatch(kv, env, job, current);
  }

  const retryAfter = status && status.retry_after ? Date.parse(status.retry_after) : 0;
  if (retryAfter > now) return { state: "cooldown", retry_after: status.retry_after };

  const lastSuccess = current && current.generated_at ? Date.parse(current.generated_at) : 0;
  if (lastSuccess && now - lastSuccess < META_REFRESH_MS) {
    return { state: "fresh", last_success_at: current.generated_at };
  }

  const started = await beginJob(kv, env, current);
  if (started.state !== "started") return started;
  return processNextBatch(kv, env, started.job, current);
}

export async function readMetaSnapshot(env) {
  return kvJson(env && env.META_KV, KEYS.current);
}

export async function readMetaStatus(env) {
  return (await kvJson(env && env.META_KV, KEYS.status)) || {
    state: "not_started",
    refresh_interval_hours: 12,
    source: "supercell_official_api"
  };
}

export async function readMetaCatalog(env) {
  return kvJson(env && env.META_KV, KEYS.catalog);
}

export async function readMetaHistory(env, limit = 10) {
  const kv = env && env.META_KV;
  if (!kv || typeof kv.list !== "function") return [];
  const safeLimit = Number.isInteger(limit) ? Math.min(20, Math.max(1, limit)) : 10;
  const listing = await kv.list({ prefix: KEYS.historyPrefix, limit: safeLimit });
  const names = (listing && Array.isArray(listing.keys) ? listing.keys : [])
    .map(key => key.name)
    .sort()
    .reverse();
  const records = await Promise.all(names.map(name => kvJson(kv, name)));
  return records.filter(Boolean);
}
