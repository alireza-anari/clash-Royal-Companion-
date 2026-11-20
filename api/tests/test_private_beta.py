import pytest

from crc_api.security.private_beta import PrivateBetaAdmission
from crc_api.security.cloudflare_access import AccessDenied
from crc_api.security.shared_quota import QuotaDenied


@pytest.mark.asyncio
async def test_only_verified_identity_reaches_shared_quota():
    calls = []
    class Verifier:
        async def verify(self, token):
            calls.append(("verify", token))
            return "signed-opaque-subject"
    class Quota:
        async def reserve(self, connection, subject):
            calls.append(("quota", subject))
            return {"member_count": 1, "global_count": 1}
    service = PrivateBetaAdmission(Verifier(), Quota())
    result = await service.admit("SIGNED_TOKEN", object())
    assert result["subject"] == "signed-opaque-subject"
    assert calls == [("verify", "SIGNED_TOKEN"), ("quota", "signed-opaque-subject")]


@pytest.mark.asyncio
async def test_invalid_access_token_cannot_consume_quota():
    class Verifier:
        async def verify(self, token):
            raise AccessDenied("ACCESS_TOKEN_INVALID")
    class Quota:
        async def reserve(self, connection, subject):
            raise AssertionError("Must not charge before verifying Access JWT")
    with pytest.raises(AccessDenied):
        await PrivateBetaAdmission(Verifier(), Quota()).admit("BAD", object())


@pytest.mark.asyncio
async def test_shared_quota_denial_stops_access_without_returning_a_subject():
    class Verifier:
        async def verify(self, token):
            return "signed-opaque-subject"
    class Quota:
        async def reserve(self, connection, subject):
            raise QuotaDenied("GLOBAL_QUOTA_EXCEEDED", 20)
    with pytest.raises(QuotaDenied) as exc:
        await PrivateBetaAdmission(Verifier(), Quota()).admit("SIGNED_TOKEN", object())
    assert exc.value.retry_after_seconds == 20
