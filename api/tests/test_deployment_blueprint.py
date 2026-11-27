"""Safety invariants of the deliberately nondeployable beta blueprint."""
from pathlib import Path
import json


ROOT = Path(__file__).resolve().parents[2]
BLUEPRINT = ROOT / "deploy" / "release" / "beta-deployment.blueprint.json"


def test_beta_deployment_blueprint_is_non_deployable_and_separate():
    config = json.loads(BLUEPRINT.read_text(encoding="utf-8"))
    assert config["status"] == "NOT_CONFIGURED_NOT_DEPLOYABLE"
    assert config["purpose"] == "private-beta-only"
    assert config["cloudflare"]["edge_enabled"] is False
    assert config["backend"]["live_lookup_enabled"] is False
    assert config["backend"]["origin_isolated"] is False
    assert config["operations"]["owner_approved"] is False
    assert config["cloudflare"]["custom_hostname"] is None
    assert config["cloudflare"]["vpc_service_binding"]["service_id"] is None


def test_blueprint_declares_pinned_private_bindings_and_no_credentials():
    config = json.loads(BLUEPRINT.read_text(encoding="utf-8"))
    assert config["cloudflare"]["static_assets_binding"]["name"] == "ASSETS"
    assert config["cloudflare"]["static_assets_binding"]["worker_first"] is True
    assert config["cloudflare"]["vpc_service_binding"]["name"] == "PRIVATE_API"
    assert config["backend"]["app_factory"] == "crc_api.beta_gateway:create_beta_app"
    assert config["database"]["tls_mode"] == "verify-full"
    serialized = json.dumps(config)
    assert "sk_test_" not in serialized
    assert "Bearer " not in serialized
    assert "postgresql://" not in serialized
    assert "CF_Authorization=" not in serialized
    assert config["database"]["cleanup_job_installed"] is False
