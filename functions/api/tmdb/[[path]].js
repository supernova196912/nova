const DEFAULT_ALLOWED_ORIGINS = new Set([
  "https://localhost",
  "http://localhost",
  "capacitor://localhost",
]);

function addCorsHeaders(headers, request, env) {
  const origin = request.headers.get("Origin");
  const allowed = new Set(DEFAULT_ALLOWED_ORIGINS);
  for (const item of (env.CINENOVA_ALLOWED_ORIGINS || "").split(",")) {
    if (item.trim()) allowed.add(item.trim());
  }
  if (origin && allowed.has(origin)) {
    headers.set("Access-Control-Allow-Origin", origin);
    headers.append("Vary", "Origin");
  }
}

function jsonResponse(payload, status, request, env) {
  const headers = new Headers({
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  addCorsHeaders(headers, request, env);
  return new Response(JSON.stringify(payload), { status, headers });
}

export function onRequestOptions({ request, env }) {
  const headers = new Headers({
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Accept, Content-Type",
    "Access-Control-Max-Age": "86400",
  });
  addCorsHeaders(headers, request, env);
  return new Response(null, { status: 204, headers });
}

export async function onRequestGet({ request, env, params }) {
  const apiKey = env.TMDB_API_KEY;
  if (!apiKey) {
    return jsonResponse({ error: "tmdb_not_configured" }, 503, request, env);
  }

  const rawPath = params.path || "";
  const path = Array.isArray(rawPath) ? rawPath.join("/") : String(rawPath);
  if (!path || path.split("/").some((part) => part === "..") || !/^[A-Za-z0-9_./-]+$/.test(path)) {
    return jsonResponse({ error: "invalid_tmdb_path" }, 400, request, env);
  }

  const incomingUrl = new URL(request.url);
  const upstreamUrl = new URL(`https://api.themoviedb.org/3/${path}`);
  upstreamUrl.search = incomingUrl.search;
  const headers = new Headers({ Accept: "application/json" });
  if (apiKey.startsWith("eyJ")) {
    headers.set("Authorization", `Bearer ${apiKey}`);
  } else {
    upstreamUrl.searchParams.set("api_key", apiKey);
  }

  try {
    const upstream = await fetch(upstreamUrl, { headers });
    const responseHeaders = new Headers({
      "Content-Type": upstream.headers.get("Content-Type") || "application/json; charset=utf-8",
      "Cache-Control": upstream.ok ? "public, max-age=300" : "no-store",
    });
    addCorsHeaders(responseHeaders, request, env);
    return new Response(upstream.body, { status: upstream.status, headers: responseHeaders });
  } catch {
    return jsonResponse({ error: "tmdb_unavailable" }, 502, request, env);
  }
}
