import {
  refreshMetaPipeline,
  readMetaSnapshot,
  readMetaStatus,
  readMetaCatalog,
  readMetaHistory
} from "./meta-pipeline.js";

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff"
    }
  });
}

function errorResponse(code, message, status) {
  return jsonResponse({ error: { code, message } }, status);
}

export async function handleMetaRequest(request, env) {
  if (request.method !== "GET") {
    return errorResponse("METHOD_NOT_ALLOWED", "Only GET is supported for Meta Intelligence.", 405);
  }

  const url = new URL(request.url);
  switch (url.pathname) {
    case "/api/v1/meta/current": {
      const snapshot = await readMetaSnapshot(env);
      if (!snapshot) {
        return errorResponse("META_NOT_READY", "The first automatic meta snapshot is not ready yet.", 503);
      }
      return jsonResponse({ snapshot });
    }
    case "/api/v1/meta/status":
      return jsonResponse(await readMetaStatus(env));
    case "/api/v1/meta/catalog": {
      const catalog = await readMetaCatalog(env);
      if (!catalog) {
        return errorResponse("META_CATALOG_NOT_READY", "The official card catalog has not been collected yet.", 503);
      }
      return jsonResponse(catalog);
    }
    case "/api/v1/meta/history": {
      const limit = Number(url.searchParams.get("limit") || 10);
      return jsonResponse({ items: await readMetaHistory(env, limit) });
    }
    default:
      return errorResponse("NOT_FOUND", "Meta endpoint not found.", 404);
  }
}

export async function handleMetaScheduled(controller, env) {
  return refreshMetaPipeline(env);
}
