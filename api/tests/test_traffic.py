import pytest

from crc_api.traffic import AdmissionError, LocalAdmission


@pytest.mark.asyncio
async def test_only_immediate_loopback_peer_is_allowed():
    gate = LocalAdmission(limit=3)
    assert gate.is_local_peer("127.0.0.1")
    assert gate.is_local_peer("::1")
    assert not gate.is_local_peer("198.51.100.42")
    assert not gate.is_local_peer("localhost")  # DNS names are not trusted peers.
    with pytest.raises(AdmissionError) as exc:
        await gate.admit("198.51.100.42")
    assert exc.value.code == "LOCAL_ONLY"
    assert exc.value.status == 403


@pytest.mark.asyncio
async def test_local_request_limiter_and_window_reset():
    clock = [100.0]
    gate = LocalAdmission(limit=2, window_seconds=10, clock=lambda: clock[0])
    await gate.admit("127.0.0.1")
    await gate.admit("127.0.0.1")
    with pytest.raises(AdmissionError) as exc:
        await gate.admit("127.0.0.1")
    assert exc.value.code == "LOCAL_LIMITED"
    assert exc.value.retry_after >= 1
    clock[0] += 11
    await gate.admit("127.0.0.1")


@pytest.mark.asyncio
async def test_optional_internal_secret_is_constant_time_compared():
    gate = LocalAdmission(secret="some-local-private-secret")
    with pytest.raises(AdmissionError) as exc:
        await gate.admit("127.0.0.1")
    assert exc.value.code == "INTERNAL_ACCESS_DENIED"
    await gate.admit("127.0.0.1", "some-local-private-secret")


def test_api_rejects_remote_peer_before_upstream_and_ignores_spoofed_headers():
    from fastapi.testclient import TestClient
    from crc_api.main import create_app
    from crc_api.supercell import SupercellClient

    # Starlette TestClient can emulate the immediate socket peer for this test.
    with TestClient(
        create_app(SupercellClient(token="unused-test-token")),
        client=("198.51.100.44", 54321),
    ) as client:
        response = client.get(
            "/api/v1/players/%23TEST123",
            headers={"X-Forwarded-For": "127.0.0.1", "Host": "localhost"},
        )
    assert response.status_code == 403
    assert response.json()["error"]["code"] == "LOCAL_ONLY"
    assert response.headers["Cache-Control"] == "no-store"


def test_api_limit_is_enforced_before_routes(monkeypatch):
    from fastapi.testclient import TestClient
    from crc_api.main import create_app
    from crc_api.supercell import SupercellClient

    monkeypatch.setenv("CRC_LOCAL_RPM", "2")
    with TestClient(create_app(SupercellClient(token=""))) as client:
        assert client.get("/api/v1/health/live").status_code == 200
        assert client.get("/api/v1/health/live").status_code == 200
        blocked = client.get("/api/v1/health/live")
    assert blocked.status_code == 429
    assert blocked.json()["error"]["code"] == "LOCAL_LIMITED"
    assert int(blocked.headers["Retry-After"]) >= 1


def test_internal_header_not_optional_when_secret_is_configured(monkeypatch):
    from fastapi.testclient import TestClient
    from crc_api.main import create_app
    from crc_api.supercell import SupercellClient

    monkeypatch.setenv("CRC_INTERNAL_ACCESS_TOKEN", "local-test-secret")
    with TestClient(create_app(SupercellClient(token=""))) as client:
        rejected = client.get("/api/v1/capabilities")
        permitted = client.get(
            "/api/v1/capabilities", headers={"X-CRC-Internal-Token": "local-test-secret"}
        )
    assert rejected.status_code == 403
    assert rejected.json()["error"]["code"] == "INTERNAL_ACCESS_DENIED"
    assert permitted.status_code == 200
    assert "local-test-secret" not in rejected.text + permitted.text
