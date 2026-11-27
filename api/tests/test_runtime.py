import pytest
from fastapi.testclient import TestClient

from crc_api.main import create_app
from crc_api.runtime import (
    UnsafeRuntimeConfiguration, checked_local_cors_origins, checked_runtime_mode,
)
from crc_api.supercell import SupercellClient


@pytest.mark.parametrize("mode", ["production", "staging", "remote", "PUBLIC", "enabled"])
def test_public_runtime_configuration_is_refused(monkeypatch, mode):
    monkeypatch.setenv("CRC_RUNTIME_MODE", mode)
    with pytest.raises(UnsafeRuntimeConfiguration, match="Only local backend runtime"):
        create_app(SupercellClient(token="test-token"))


@pytest.mark.parametrize("origins", [
    "*", "https://example.com:443", "http://192.168.1.10:3000",
    "http://0.0.0.0:3000", "http://localhost",
    "http://localhost:3000/path", "http://localhost:3000?x=1",
    "http://username:password@localhost:3000", "file://localhost:3000",
    "http://localhost:not-a-port",
])
def test_unsafe_cors_configuration_blocks_startup(monkeypatch, origins):
    monkeypatch.setenv("CRC_CORS_ORIGINS", origins)
    with pytest.raises(UnsafeRuntimeConfiguration, match="local HTTP"):
        checked_local_cors_origins()


def test_exact_local_origins_and_default_runtime_are_supported(monkeypatch):
    monkeypatch.delenv("CRC_RUNTIME_MODE", raising=False)
    monkeypatch.setenv("CRC_CORS_ORIGINS",
                       "http://localhost:3000,http://127.0.0.1:3000,http://localhost:3000")
    assert checked_runtime_mode() == "local"
    assert checked_local_cors_origins() == [
        "http://localhost:3000", "http://127.0.0.1:3000"
    ]


def test_untrusted_host_header_is_rejected_before_request_handler():
    with TestClient(create_app(SupercellClient(token=""))) as client:
        attack = client.get(
            "/api/v1/health/live",
            headers={"Host": "malicious.example", "X-Forwarded-Host": "localhost"},
        )
        assert attack.status_code == 400
        allowed = client.get("/api/v1/health/live", headers={"Host": "localhost:8000"})
        assert allowed.status_code == 200


def test_untrusted_browser_origin_is_not_granted_access(monkeypatch):
    monkeypatch.setenv("CRC_CORS_ORIGINS", "http://localhost:3000")
    with TestClient(create_app(SupercellClient(token=""))) as client:
        denied = client.options("/api/v1/capabilities", headers={
            "Origin": "https://evil.example",
            "Access-Control-Request-Method": "GET",
        })
        assert denied.status_code == 400
        granted = client.options("/api/v1/capabilities", headers={
            "Origin": "http://localhost:3000",
            "Access-Control-Request-Method": "GET",
        })
        assert granted.status_code == 200
