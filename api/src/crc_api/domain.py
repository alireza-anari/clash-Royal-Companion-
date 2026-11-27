"""Pure and testable transformations; no network and no secrets."""
from __future__ import annotations

import re
from datetime import datetime, timezone
from typing import Any

TAG_PATTERN = re.compile(r"^[A-Z0-9]{3,16}$")


def normalize_tag(value: str) -> str:
    value = value.strip().upper()
    if value.startswith("#"):
        value = value[1:]
    if not TAG_PATTERN.fullmatch(value):
        raise ValueError("Invalid player tag")
    return f"#{value}"


def timestamp() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def source_metadata() -> dict[str, Any]:
    return {"provider": "supercell", "fetched_at": timestamp(), "stale": False}


def card_summary(card: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": card.get("id"),
        "name": card.get("name"),
        "rarity": card.get("rarity"),
        "elixir_cost": card.get("elixirCost"),
        "level_raw": card.get("level"),
        "max_level_raw": card.get("maxLevel"),
        "evolution_level": card.get("evolutionLevel"),
        "max_evolution_level": card.get("maxEvolutionLevel"),
        "star_level": card.get("starLevel"),
        "count": card.get("count"),
        "icon_url": (card.get("iconUrls") or {}).get("medium"),
    }


def deck_from_cards(cards: Any, source: str) -> dict[str, Any] | None:
    if not isinstance(cards, list):
        return None
    return {"source": source, "card_ids": [c["id"] for c in cards if isinstance(c, dict) and "id" in c]}


def normalize_profile(raw: dict[str, Any]) -> dict[str, Any]:
    current = deck_from_cards(raw.get("currentDeck"), "profile_current")
    if current is not None:
        support = deck_from_cards(raw.get("currentDeckSupportCards"), "profile_support")
        current["support_card_ids"] = support["card_ids"] if support else []
    return {
        "profile": {
            "tag": raw["tag"],
            "display_name": raw.get("name", ""),
            "trophies": raw.get("trophies"),
            "king_tower_level": raw.get("kingTowerLevel"),
            "collection_level": raw.get("collectionLevel"),
            "arena": raw.get("arena"),
            "ownership_status": "unverified_public_tag",
        },
        "current_deck": current,
    }


def classify_battle(raw: dict[str, Any]) -> tuple[str, str]:
    # Intentionally conservative: an unrecognized type is NOT ordinary ladder.
    if raw.get("deckSelection") == "eventDeck":
        return "event", "event_deck_selection"
    return "unknown", "insufficient_mode_evidence"


def normalize_battle_time(value: Any) -> str | None:
    """Convert Supercell compact UTC timestamps to RFC 3339; never guess missing values."""
    if not isinstance(value, str):
        return None
    for fmt in ("%Y%m%dT%H%M%S.%fZ", "%Y%m%dT%H%M%SZ"):
        try:
            return datetime.strptime(value, fmt).replace(tzinfo=timezone.utc).isoformat().replace("+00:00", "Z")
        except ValueError:
            pass
    return None


def normalize_battle(raw: dict[str, Any]) -> dict[str, Any]:
    classification, reason = classify_battle(raw)
    participants = []
    for side in ("team", "opponent"):
        for ordinal, p in enumerate(raw.get(side) or []):
            if not isinstance(p, dict):
                continue
            participants.append({
                "side": side,
                "ordinal": ordinal,
                "tag": p.get("tag"),
                "name": p.get("name"),
                "crowns": p.get("crowns"),
                "elixir_leaked": p.get("elixirLeaked"),
                "trophy_change": p.get("trophyChange"),
                "tower_hp": {
                    "king": p.get("kingTowerHitPoints"),
                    "princess": p.get("princessTowersHitPoints"),
                },
                "deck": deck_from_cards(p.get("cards"), f"battle_{side}"),
                "support_cards": deck_from_cards(p.get("supportCards"), f"battle_{side}_support"),
            })
    return {
        "battle_time": normalize_battle_time(raw.get("battleTime")),
        "type": raw.get("type"),
        "game_mode": raw.get("gameMode"),
        "deck_selection": raw.get("deckSelection"),
        "classification": classification,
        "classification_reason": reason,
        "classification_version": "battle-classifier-0.1",
        "is_ladder_tournament": raw.get("isLadderTournament"),
        "participants": participants,
    }


def validate_deck_ids(card_ids: list[int]) -> list[dict[str, str]]:
    errors = []
    if len(card_ids) != 8:
        errors.append({"code": "CARD_COUNT", "message": "دک باید دقیقاً ۸ کارت داشته باشد."})
    if len(set(card_ids)) != len(card_ids):
        errors.append({"code": "DUPLICATE_CARD", "message": "شناسه کارت تکراری است."})
    if any(x <= 0 for x in card_ids):
        errors.append({"code": "INVALID_CARD_ID", "message": "شناسه کارت نامعتبر است."})
    return errors


def deck_metrics(card_ids: list[int], catalog: dict[int, dict[str, Any]]) -> dict[str, Any]:
    # Never guess elixir costs; Mirror and future dynamic cards can lack elixirCost.
    selected = [catalog.get(card_id) for card_id in card_ids]
    missing_ids = [cid for cid, card in zip(card_ids, selected) if not card]
    if missing_ids:
        return {"average_elixir": None, "cycle_cost_four_cheapest": None, "unknown_card_ids": missing_ids}
    costs = [card.get("elixirCost") for card in selected if card]
    invalid_cost_ids = [
        card_id for card_id, cost in zip(card_ids, costs)
        if isinstance(cost, bool) or not isinstance(cost, int) or cost < 0
    ]
    if invalid_cost_ids:
        return {"average_elixir": None, "cycle_cost_four_cheapest": None, "unknown_card_ids": invalid_cost_ids}
    return {
        "average_elixir": sum(costs)/8,
        "cycle_cost_four_cheapest": sum(sorted(costs)[:4]),
        "unknown_card_ids": [],
    }
