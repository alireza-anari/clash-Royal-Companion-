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
    "BETA_ALLOW_WORKERS_DEV", "BETA_AI_CHAT_ENABLED", "BETA_SESSION_HMAC_HEX",
    "BETA_ASSERTION_HMAC_HEX", "BETA_INVITE_CODES_JSON", "PRIVATE_API",
  ]) assert.equal(bindings[name].type, "inherit", name);
  assert.ok(bindings.ASSETS);
  assert.equal(bindings.LEGACY_LIVE.type, "service");
  assert.equal(bindings.LEGACY_LIVE.service, LEGACY_LIVE_WORKER_NAME);
  assert.equal(metadata.keep_bindings.includes("vpc_service"), true);
  assert.equal(PRIVATE_API_SERVICE_ID, "01a202d5-1889-72d3-9a12-4a2838612589");
  assert.equal(LEGACY_LIVE_WORKER_NAME, "crc-mvp-live-test-20261123");
  assert.equal(metadata.assets.config.not_found_handling, "404-page");
  assert.throws(() => buildWorkerMetadata(""));
});

test("private beta assets include the login and browser session resources", () => {
  for (const file of ["index.html", "beta-session.js", "beta-login.html", "beta-login.js", "backend-client.js"])
    assert.ok(ASSET_PATHS.includes(file));
  assert.equal(ASSET_PATHS.includes("sw.js"), false);
});
