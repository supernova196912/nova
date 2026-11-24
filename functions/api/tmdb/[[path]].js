const DEFAULT_ALLOWED_ORIGINS = new Set([
  "https://nova-2yi.pages.dev",
  "http://127.0.0.1",
  "https://127.0.0.1",
  "https://localhost",
  "http://localhost",
  "capacitor://localhost",
]);

function originAllowed(request, env) {
  const allowed = new Set(DEFAULT_ALLOWED_ORIGINS);
  for (const item of (env.CINENOVA_ALLOWED_ORIGINS || "").split(",")) {
    const value = item.trim();
    if (value) { try { allowed.add(new URL(value).origin); } catch {} }
  }
  const supplied = [request.headers.get("Origin"), request.headers.get("Referer")].filter(Boolean);
  const parsed = supplied.map((value) => { try { return new URL(value); } catch { return null; } });
  return parsed.length > 0 && parsed.every((url) => url && (allowed.has(url.origin) || ((url.protocol === "http:" || url.protocol === "https:") && ["localhost", "127.0.0.1"].includes(url.hostname))));
}

function addCorsHeaders(headers, request, env) {
  const origin = request.headers.get("Origin");
  if (origin && originAllowed(request, env)) {
    headers.set("Access-Control-Allow-Origin", origin);
    headers.append("Vary", "Origin");
  }
}

function jsonResponse(payload, status, request, env) {
  const headers = new Headers({
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
    "X-Frame-Options": "SAMEORIGIN",
  });
  addCorsHeaders(headers, request, env);
  return new Response(JSON.stringify(payload), { status, headers });
}

export function onRequestOptions({ request, env }) {
  if (!originAllowed(request, env)) return new Response(null, { status: 403 });
  const headers = new Headers({
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Accept, Content-Type",
    "Access-Control-Max-Age": "86400",
  });
  addCorsHeaders(headers, request, env);
  return new Response(null, { status: 204, headers });
}

export async function onRequestGet({ request, env, params }) {
  if (!originAllowed(request, env)) return jsonResponse({ error: "forbidden" }, 403, request, env);
  const apiKey = String(env.TMDB_API_KEY || "").trim();
  if (!apiKey) {
    return jsonResponse({ error: "tmdb_not_configured" }, 503, request, env);
  }

  const rawPath = params.path || "";
  const path = Array.isArray(rawPath) ? rawPath.join("/") : String(rawPath);
  if (!path || path.split("/").some((part) => part === "..") || !/^[A-Za-z0-9_./-]+$/.test(path)) {
    return jsonResponse({ error: "invalid_tmdb_path" }, 400, request, env);
  }

  const incomingUrl = new URL(request.url);
  if (incomingUrl.search.length > 4096 || [...incomingUrl.searchParams].length > 40 || [...incomingUrl.searchParams].some(([k, v]) => !/^[A-Za-z0-9_.-]{1,64}$/.test(k) || v.length > 500 || /[\u0000-\u001f]/.test(v))) {
    return jsonResponse({ error: "invalid_query" }, 400, request, env);
  }
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

export async function onRequestHead(context) {
  const response = await onRequestGet(context);
  return new Response(null, { status: response.status, headers: response.headers });
}

export function onRequest(context) {
  return new Response("Method not allowed", { status: 405, headers: { Allow: "GET, HEAD, OPTIONS", "X-Content-Type-Options": "nosniff" } });
}
