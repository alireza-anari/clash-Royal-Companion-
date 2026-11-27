import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const SCRIPT_NAME = "crc-private-beta-gateway";
export const PRIVATE_BETA_HOST = "crc-private-beta-gateway.alirezaanari117.workers.dev";
export const PRIVATE_API_SERVICE_ID = "01a202d5-1889-72d3-9a12-4a2838612589";
export const LEGACY_LIVE_WORKER_NAME = "crc-mvp-live-test-20261123";
export const ASSET_PATHS = [
  "index.html",
  "styles.css",
  "app.js",
  "battle-insights.js",
  "battle-evidence.js",
  "owned-options.js",
  "backend-client.js",
  "beta-session.js",
  "beta-login.html",
  "beta-login.js",
  "catalog.json",
  "guides.json",
  "icon.svg",
];

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const API_ROOT = (account) => `https://api.cloudflare.com/client/v4/accounts/${account}`;

function digest(buffer) {
  return createHash("sha256").update(buffer).digest("hex").slice(0, 32);
}

export function buildAssetManifest(entries) {
  const manifest = {};
  for (const [pathname, bytes] of entries) {
    if (!pathname.startsWith("/") || pathname.includes("..") || pathname.includes("\\"))
      throw new Error("Unsafe static asset path.");
    if (!Buffer.isBuffer(bytes)) throw new Error("Static asset bytes must be Buffers.");
    manifest[pathname] = { hash: digest(bytes), size: bytes.byteLength };
  }
  if (!Object.keys(manifest).length) throw new Error("Private beta asset manifest is empty.");
  return manifest;
}

export function buildWorkerMetadata(assetJwt) {
  if (typeof assetJwt !== "string" || assetJwt.length < 16)
    throw new Error("Cloudflare asset completion token is missing.");
  const inherited = [
    "BETA_ENABLED",
    "BETA_HOSTNAME",
    "BETA_AUTH_ISSUER",
    "BETA_AUTH_AUDIENCE",
    "BETA_ALLOW_WORKERS_DEV",
    "BETA_AI_CHAT_ENABLED",
    "BETA_VISION_ENABLED",
    "BETA_VISION_WORKER_ENABLED",
    "BETA_IDENTITY_EXCHANGE_SUBJECT",
    "BETA_SESSION_HMAC_HEX",
    "BETA_ASSERTION_HMAC_HEX",
    "BETA_INVITE_CODES_JSON",
    "PRIVATE_API",
  ];
  const bindings = [
    { name: "ASSETS", type: "assets" },
    { name: "AI", type: "ai" },
    ...inherited.map((name) => ({ name, type: "inherit" })),
    { name: "LEGACY_LIVE", type: "service", service: LEGACY_LIVE_WORKER_NAME },
  ];
  return {
    main_module: "worker.js",
    compatibility_date: "2026-11-22",
    usage_model: "standard",
    bindings,
    triggers: { crons: ["*/2 * * * *"] },
    keep_bindings: ["vpc_service"],
    assets: {
      jwt: assetJwt,
      config: { html_handling: "none", not_found_handling: "404-page" },
    },
    annotations: {
      "workers/message": "Private beta gateway update; preserve existing secrets and VPC origin, route live Supercell and Workers AI through isolated service binding",
    },
  };
}

export async function verifyGatewaySmokeTests(fetchImpl = fetch) {
  const root = await fetchImpl(`https://${PRIVATE_BETA_HOST}/`, {
    redirect: "manual",
    cache: "no-store",
  });
  const setCookie = root.headers.get("Set-Cookie") || "";
  if (root.status !== 200 || !setCookie.startsWith("__Host-crc_beta_session="))
    throw new Error("Private beta root did not issue its automatic session.");

  const sessionCookie = setCookie.split(";", 1)[0];
  const headers = { Accept: "application/json", Cookie: sessionCookie };
  const capabilitiesResponse = await fetchImpl(
    `https://${PRIVATE_BETA_HOST}/api/v1/capabilities`,
    { headers, redirect: "manual", cache: "no-store" },
  );
  const capabilities = await capabilitiesResponse.json().catch(() => null);
  if (capabilitiesResponse.status !== 200 ||
      capabilities?.schema_version !== "1.0" ||
      capabilities?.live_lookup_enabled !== true ||
      capabilities?.ai_coach_enabled !== true ||
      capabilities?.ai_external_data_requires_consent !== true) {
    throw new Error("Live Supercell or consent-gated AI capability smoke test failed.");
  }

  const readinessResponse = await fetchImpl(
    `https://${PRIVATE_BETA_HOST}/api/v1/health/ready`,
    { headers, redirect: "manual", cache: "no-store" },
  );
  const readiness = await readinessResponse.json().catch(() => null);
  if (readinessResponse.status !== 200 ||
      readiness?.status !== "ready_for_authenticated_requests") {
    throw new Error("Private VPC backend readiness smoke test failed.");
  }

  const consentResponse = await fetchImpl(
    `https://${PRIVATE_BETA_HOST}/api/v1/coach/chat`,
    {
      method: "POST",
      headers: {
        ...headers,
        Origin: `https://${PRIVATE_BETA_HOST}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        question: "deployment smoke test",
        consent_to_external_ai: false,
      }),
      redirect: "manual",
      cache: "no-store",
    },
  );
  const consent = await consentResponse.json().catch(() => null);
  if (consentResponse.status !== 403 || consent?.error?.code !== "AI_CONSENT_REQUIRED")
    throw new Error("External-AI consent guard smoke test failed.");

  return {
    automatic_session: true,
    live_supercell_capability: true,
    workers_ai_capability: true,
    private_vpc_ready: true,
    ai_consent_guard: true,
  };
}

async function cloudflareRequest(url, token, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: { Authorization: `Bearer ${token}`, ...(options.headers || {}) },
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload || payload.success !== true) {
    const codes = Array.isArray(payload?.errors)
      ? payload.errors.map((e) => String(e.code || "CF_ERROR")).join(",")
      : "CF_REQUEST_FAILED";
    throw new Error(`Cloudflare API request failed (${response.status}; ${codes}).`);
  }
  return payload.result;
}

async function uploadAssets(account, token, entries) {
  const manifest = buildAssetManifest(entries);
  const session = await cloudflareRequest(
    `${API_ROOT(account)}/workers/scripts/${SCRIPT_NAME}/assets-upload-session`,
    token,
    { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ manifest }) },
  );
  if (typeof session?.jwt !== "string" || !Array.isArray(session.buckets))
    throw new Error("Cloudflare did not return a valid asset upload session.");

  const byHash = new Map(entries.map(([pathname, bytes]) => [manifest[pathname].hash, bytes]));
  let completionJwt = session.jwt;
  for (const bucket of session.buckets) {
    if (!Array.isArray(bucket) || bucket.some((hash) => !byHash.has(hash)))
      throw new Error("Cloudflare returned an unexpected asset upload bucket.");
    const form = new FormData();
    for (const hash of bucket) form.append(hash, byHash.get(hash).toString("base64"));
    const response = await fetch(
      `${API_ROOT(account)}/workers/assets/upload?base64=true`,
      { method: "POST", headers: { Authorization: `Bearer ${session.jwt}` }, body: form },
    );
    const payload = await response.json().catch(() => null);
    if (!response.ok || !payload || payload.success !== true) {
      const codes = Array.isArray(payload?.errors)
        ? payload.errors.map((e) => String(e.code || "CF_ERROR")).join(",")
        : "ASSET_UPLOAD_FAILED";
      throw new Error(`Cloudflare asset upload failed (${response.status}; ${codes}).`);
    }
    if (typeof payload.result?.jwt === "string") {
      completionJwt = payload.result.jwt;
    } else if (response.status !== 202) {
      throw new Error(`Cloudflare asset upload did not return a completion token (${response.status}).`);
    }
  }
  if (typeof completionJwt !== "string" || completionJwt.length < 16)
    throw new Error("Cloudflare asset upload did not complete every manifest bucket.");
  return completionJwt;
}

async function deploy(account, token, workerSource, assetJwt) {
  const metadata = buildWorkerMetadata(assetJwt);
  const form = new FormData();
  form.append("metadata", new Blob([JSON.stringify(metadata)], { type: "application/json" }));
  form.append("worker.js", new Blob([workerSource], { type: "application/javascript+module" }), "worker.js");
  return cloudflareRequest(
    `${API_ROOT(account)}/workers/scripts/${SCRIPT_NAME}`,
    token,
    { method: "PUT", body: form },
  );
}

export async function runPrivateBetaDeployment(env = process.env) {
  const account = env.CRC_CLOUDFLARE_ACCOUNT_ID || env.CF_ACCOUNT_ID || "";
  const token = env.CRC_CLOUDFLARE_API_TOKEN || env.CF_API_TOKEN || "";
  if (!/^[a-f0-9]{32}$/.test(account) || token.length < 20)
    throw new Error("Cloudflare deployment credentials are unavailable.");

  const subdomain = await cloudflareRequest(
    `${API_ROOT(account)}/workers/scripts/${SCRIPT_NAME}/subdomain`, token,
  );
  if (subdomain?.enabled !== true || subdomain?.previews_enabled !== false)
    throw new Error("Private beta Worker subdomain must be enabled and previews disabled.");

  const legacyBefore = await cloudflareRequest(
    `${API_ROOT(account)}/workers/scripts/${LEGACY_LIVE_WORKER_NAME}/subdomain`, token,
  );
  if (legacyBefore?.enabled !== false || legacyBefore?.previews_enabled !== false)
    throw new Error("Legacy service privacy preflight failed; no deployment attempted.");

  const entries = await Promise.all(ASSET_PATHS.map(async (name) => {
    const bytes = await readFile(path.join(REPO_ROOT, "site", name));
    return [`/${name}`, bytes];
  }));
  const workerSource = await readFile(path.join(REPO_ROOT, "deploy/cloudflare/beta-edge-worker.mjs"), "utf8");
  if (!workerSource.includes('env?.BETA_ENABLED!=="true"') || !workerSource.includes("env.LEGACY_LIVE"))
    throw new Error("Private beta Worker is missing its activation guard or legacy live service route.");

  const assetJwt = await uploadAssets(account, token, entries);
  await deploy(account, token, workerSource, assetJwt);

  const settings = await cloudflareRequest(
    `${API_ROOT(account)}/workers/scripts/${SCRIPT_NAME}/settings`, token,
  );
  const bindings = Array.isArray(settings?.bindings) ? settings.bindings : [];
  const names = bindings.map((binding) => binding.name);
  if (!names.includes("ASSETS") ||
      bindings.find((binding) => binding.name === "PRIVATE_API")?.service_id !== PRIVATE_API_SERVICE_ID ||
      bindings.find((binding) => binding.name === "LEGACY_LIVE")?.service !== LEGACY_LIVE_WORKER_NAME ||
      bindings.find((binding) => binding.name === "BETA_ENABLED")?.text !== "true" ||
      bindings.find((binding) => binding.name === "BETA_AI_CHAT_ENABLED")?.text !== "true" ||
      bindings.find((binding) => binding.name === "BETA_VISION_WORKER_ENABLED")?.text === "true" ||
      !bindings.some((binding) => binding.name === "AI" && binding.type === "ai")) {
    throw new Error("Deployed private beta Worker bindings failed the active-service check.");
  }

  const smoke = await verifyGatewaySmokeTests(fetch);

  // Frontend releases must not write settings to the existing live service.
  const legacySubdomain = await cloudflareRequest(
    `${API_ROOT(account)}/workers/scripts/${LEGACY_LIVE_WORKER_NAME}/subdomain`,
    token,
  );
  if (legacySubdomain?.enabled !== false || legacySubdomain?.previews_enabled !== false) {
    throw new Error("Legacy live Worker is not private; refusing to modify its settings.");
  }

  return {
    script: SCRIPT_NAME,
    host: PRIVATE_BETA_HOST,
    deployed_enabled: true,
    assets: entries.length,
    bindings: names,
    ...smoke,
    legacy_worker_private: true,
    response_status: 200,
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  runPrivateBetaDeployment()
    .then((result) => {
      console.log(JSON.stringify(result));
    })
    .catch((error) => {
      console.error(error instanceof Error ? error.message : "Private beta deployment failed.");
      process.exitCode = 1;
    });
}
