import pytest

from crc_api.domain import classify_battle, deck_metrics, normalize_battle_time, normalize_tag, validate_deck_ids


@pytest.mark.parametrize("raw,expected", [
    ("#AbC123", "#ABC123"),
    (" abC123 ", "#ABC123"),
    ("#TESTTAG123", "#TESTTAG123"),
])
def test_player_tag_normalization(raw, expected):
    assert normalize_tag(raw) == expected


@pytest.mark.parametrize("bad", ["", "#", "#A#B", "../../etc/passwd", "#Z!2", "a" * 17])
def test_player_tag_rejects_invalid(bad):
    with pytest.raises(ValueError):
        normalize_tag(bad)


def test_event_battle_not_classified_as_ladder():
    assert classify_battle({"type": "trail", "deckSelection": "eventDeck"}) == ("event", "event_deck_selection")
    assert classify_battle({"type": "challenge"})[0] == "unknown"


def test_metrics_known_and_unknown():
    cards = [11, 12, 13, 14, 15, 16, 17, 18]
    costs = [1, 4, 4, 3, 2, 1, 4, 2]
    catalog = {i: {"id": i, "elixirCost": v} for i, v in zip(cards, costs)}
    assert deck_metrics(cards, catalog)["average_elixir"] == 2.625
    assert deck_metrics(cards, catalog)["cycle_cost_four_cheapest"] == 6
    catalog[12]["elixirCost"] = None  # Example of a dynamic/unknown cost
    m = deck_metrics(cards, catalog)
    assert m["average_elixir"] is None
    assert 12 in m["unknown_card_ids"]
    assert deck_metrics(cards, {})["average_elixir"] is None


def test_structural_deck_validation():
    assert validate_deck_ids([1, 2, 3, 4, 5, 6, 7, 8]) == []
    errors = validate_deck_ids([1, 1, -2])
    assert {e["code"] for e in errors} == {"CARD_COUNT", "DUPLICATE_CARD", "INVALID_CARD_ID"}


@pytest.mark.parametrize("raw,expected", [
    ("20261120T120719.000Z", "2026-11-20T12:07:19Z"),
    ("20261120T120719Z", "2026-11-20T12:07:19Z"),
    ("broken", None),
    (None, None),
])
def test_battle_timestamp_contract(raw, expected):
    assert normalize_battle_time(raw) == expected
\n\ndef test_negative_and_boolean_elixir_costs_remain_unknown():
    cards = list(range(1, 9))
    catalog = {i: {"id": i, "elixirCost": 3} for i in cards}
    catalog[2]["elixirCost"] = -1
    catalog[4]["elixirCost"] = True
    metrics = deck_metrics(cards, catalog)
    assert metrics["average_elixir"] is None
    assert metrics["cycle_cost_four_cheapest"] is None
    assert metrics["unknown_card_ids"] == [2, 4]
