from fastapi.testclient import TestClient

from crc_api.main import create_app
from crc_api.supercell import SupercellClient


def test_capability_is_disabled_by_default_even_with_api_key(monkeypatch):
    monkeypatch.delenv("CRC_LIVE_LOOKUP_ENABLED", raising=False)
    with TestClient(create_app(SupercellClient(token="test-secret"))) as client:
        response = client.get("/api/v1/capabilities")
        assert response.status_code == 200
        data = response.json()
        assert data["live_lookup_enabled"] is False
        assert data["safe_public_exposure"] is False
        assert data["player_tag_verifies_ownership"] is False
        assert "test-secret" not in response.text


def test_capability_requires_both_explicit_opt_in_and_server_key(monkeypatch):
    monkeypatch.setenv("CRC_LIVE_LOOKUP_ENABLED", "true")
    with TestClient(create_app(SupercellClient(token=""))) as client:
        assert client.get("/api/v1/capabilities").json()["live_lookup_enabled"] is False
    with TestClient(create_app(SupercellClient(token="test-secret"))) as client:
        data = client.get("/api/v1/capabilities").json()
        assert data["live_lookup_enabled"] is True
        assert data["provider"] == "supercell"
        assert data["safe_public_exposure"] is False
        assert "test-secret" not in str(data)
