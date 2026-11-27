import assert from "node:assert/strict";
import test from "node:test";
import {
  ASSET_PATHS,
  PRIVATE_BETA_HOST,
  PRIVATE_API_SERVICE_ID,
  LEGACY_LIVE_WORKER_NAME,
  SCRIPT_NAME,
  buildAssetManifest,
  buildWorkerMetadata,
  verifyGatewaySmokeTests,
} from "./deploy-private-beta.mjs";

test("private beta deploy target is distinct from public sample workers", () => {
  assert.equal(SCRIPT_NAME, "crc-private-beta-gateway");
  assert.equal(PRIVATE_BETA_HOST, "crc-private-beta-gateway.alirezaanari117.workers.dev");
  assert.doesNotMatch(PRIVATE_BETA_HOST, /crc-mvp-stage|crc-coach-ci-stage/);
});

test("asset manifest is deterministic and contains only bounded paths", () => {
  const first = buildAssetManifest([
    ["/index.html", Buffer.from("<h1>CRC</h1>")],
    ["/app.js", Buffer.from("void 0;")],
  ]);
  const second = buildAssetManifest([
    ["/index.html", Buffer.from("<h1>CRC</h1>")],
    ["/app.js", Buffer.from("void 0;")],
  ]);
  assert.deepEqual(first, second);
  assert.match(first["/index.html"].hash, /^[a-f0-9]{32}$/);
  assert.equal(first["/index.html"].size, 12);
  assert.throws(() => buildAssetManifest([["/../secret", Buffer.from("x")]]));
});

test("private beta deployment preserves secrets and attaches isolated live Worker", () => {
  const metadata = buildWorkerMetadata("a-valid-completion-token");
  const bindings = Object.fromEntries(metadata.bindings.map((binding) => [binding.name, binding]));
  for (const name of [
    "BETA_ENABLED", "BETA_HOSTNAME", "BETA_AUTH_ISSUER", "BETA_AUTH_AUDIENCE",
    "BETA_ALLOW_WORKERS_DEV", "BETA_AI_CHAT_ENABLED", "BETA_VISION_ENABLED", "BETA_VISION_WORKER_ENABLED", "BETA_SESSION_HMAC_HEX",
    "BETA_ASSERTION_HMAC_HEX", "BETA_INVITE_CODES_JSON", "PRIVATE_API",
  ]) assert.equal(bindings[name].type, "inherit", name);
  assert.ok(bindings.ASSETS);
  assert.equal(bindings.AI.type, "ai");
  assert.deepEqual(metadata.triggers.crons, ["*/2 * * * *"]);
  assert.equal(bindings.LEGACY_LIVE.type, "service");
  assert.equal(bindings.LEGACY_LIVE.service, LEGACY_LIVE_WORKER_NAME);
  assert.equal(metadata.keep_bindings.includes("vpc_service"), true);
  assert.equal(PRIVATE_API_SERVICE_ID, "01a202d5-1889-72d3-9a12-4a2838612589");
  assert.equal(LEGACY_LIVE_WORKER_NAME, "crc-mvp-live-test-20261123");
  assert.equal(metadata.assets.config.not_found_handling, "404-page");
  assert.throws(() => buildWorkerMetadata(""));
});

test("private beta assets include the login and browser session resources", () => {
  for (const file of ["index.html", "beta-session.js", "beta-login.html", "beta-login.js", "backend-client.js", "battle-evidence.js"])
    assert.ok(ASSET_PATHS.includes(file));
  assert.equal(ASSET_PATHS.includes("sw.js"), false);
  assert.equal(ASSET_PATHS.includes("offline-coach.js"), false);
  assert.equal(ASSET_PATHS.includes("coach-chat.js"), false);
});


test("deployment smoke tests cover live routing, private VPC readiness and AI consent", async () => {
  const calls = [];
  const cookie = "__Host-crc_beta_session=test-session-token";
  const fetchMock = async (url, options = {}) => {
    calls.push({ url, options });
    if (url.endsWith("/")) {
      return new Response("<html>ok</html>", {
        status: 200,
        headers: { "Set-Cookie": cookie + "; Path=/; Secure; HttpOnly; SameSite=Strict" },
      });
    }
    if (url.endsWith("/api/v1/capabilities")) {
      return Response.json({
        schema_version: "1.0",
        live_lookup_enabled: true,
        ai_coach_enabled: true,
        ai_external_data_requires_consent: true,
      });
    }
    if (url.endsWith("/api/v1/health/ready")) {
      return Response.json({ status: "ready_for_authenticated_requests" });
    }
    if (url.endsWith("/api/v1/coach/chat")) {
      return Response.json({ error: { code: "AI_CONSENT_REQUIRED" } }, { status: 403 });
    }
    throw new Error("Unexpected smoke-test URL.");
  };

  const result = await verifyGatewaySmokeTests(fetchMock);
  assert.deepEqual(result, {
    automatic_session: true,
    live_supercell_capability: true,
    workers_ai_capability: true,
    private_vpc_ready: true,
    ai_consent_guard: true,
  });
  assert.equal(calls.length, 4);
  assert.ok(calls.slice(1).every(({ options }) =>
    options.headers.Cookie === cookie && options.cache === "no-store"));
  assert.equal(calls[3].options.method, "POST");
  assert.equal(JSON.parse(calls[3].options.body).consent_to_external_ai, false);
});

test("deployment smoke test fails closed when the legacy service route is unavailable", async () => {
  const fetchMock = async (url) => {
    if (url.endsWith("/")) {
      return new Response("<html>ok</html>", {
        status: 200,
        headers: { "Set-Cookie": "__Host-crc_beta_session=test; Path=/; Secure; HttpOnly" },
      });
    }
    return Response.json({ error: { code: "SERVICE_UNAVAILABLE" } }, { status: 503 });
  };
  await assert.rejects(verifyGatewaySmokeTests(fetchMock), /capability smoke test failed/);
});
