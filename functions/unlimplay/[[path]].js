const AD_DOMAINS = [
  "doubleclick.net", "googlesyndication.com", "googleadservices.com",
  "imasdk.googleapis.com", "adnxs.com", "popads.net", "popcash.net",
  "exoclick.com", "juicyads.com", "adsterra.com", "highperformanceformat.com",
  "monetag.com", "onclickalgo.com", "acscdn.com", "taboola.com", "outbrain.com",
  "mgid.com", "adform.net", "adsrvr.org", "rubiconproject.com", "pubmatic.com",
  "openx.net", "criteo.com", "smartadserver.com", "propellerads.com", "clickadu.com",
  "evadav.com", "trafficstars.com", "hilltopads.com", "googletagservices.com",
  "adservice.google.com", "adskeeper.com", "adkernel.com", "bashirian.biz",
  "21wiz.com", "morencius.com", "servetraff.com",
];

const AD_FILTER_SCRIPT = `<script data-cinenova-ad-filter>
(() => {
  const brandStyle = document.createElement('style');
  brandStyle.textContent = '.ulp-logo-img,.ulp-logo-svg{display:none!important}';
  (document.head || document.documentElement).appendChild(brandStyle);
  const blocked = ${JSON.stringify(AD_DOMAINS)};
  const isAd = value => {
    try {
      const url = new URL(value instanceof Request ? value.url : value, location.href);
      if (/\\.(m3u8|mp4|ts|vtt)$/i.test(url.pathname)) return false;
      return blocked.some(domain => url.hostname === domain || url.hostname.endsWith('.' + domain));
    } catch (_) { return false; }
  };
  const nativeFetch = window.fetch.bind(window);
  window.fetch = (input, init) => isAd(input)
    ? Promise.resolve(new Response(null, { status: 204 }))
    : nativeFetch(input, init);
  const nativeOpen = XMLHttpRequest.prototype.open;
  const nativeSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function(method, url, ...rest) {
    this.__cinenovaBlocked = isAd(url);
    if (!this.__cinenovaBlocked) return nativeOpen.call(this, method, url, ...rest);
  };
  XMLHttpRequest.prototype.send = function(...args) {
    if (!this.__cinenovaBlocked) return nativeSend.apply(this, args);
    queueMicrotask(() => { this.dispatchEvent(new ProgressEvent('error')); this.dispatchEvent(new ProgressEvent('loadend')); });
  };
  const nativeSetAttribute = Element.prototype.setAttribute;
  Element.prototype.setAttribute = function(name, value) {
    if (/^(src|href)$/i.test(name) && isAd(value))
      return nativeSetAttribute.call(this, name, this.tagName === 'A' ? '#' : 'about:blank');
    return nativeSetAttribute.call(this, name, value);
  };
  const nativeWindowOpen = window.open;
  window.open = (url, ...args) => isAd(url) ? null : nativeWindowOpen.call(window, url, ...args);
  document.addEventListener('click', event => {
    const link = event.target.closest && event.target.closest('a[href]');
    if (link && isAd(link.href)) { event.preventDefault(); event.stopImmediatePropagation(); }
  }, true);
  const skipAds = () => {
    const button = document.getElementById('btn-skip');
    if (button && !button.disabled && !/\\d+\\s*s/i.test(button.innerText || '') && button.getClientRects().length) button.click();
  };
  setInterval(skipAds, 250);
})();
</script>`;

function rewriteText(text, contentType, requestUrl) {
  const proxyOrigin = new URL(requestUrl).origin + "/unlimplay";
  let rewritten = text
    .replaceAll("https://unlimplay.com", proxyOrigin)
    .replaceAll("http://unlimplay.com", proxyOrigin)
    .replaceAll("https:\\/\\/unlimplay.com", proxyOrigin.replaceAll("/", "\\/"))
    .replaceAll("http:\\/\\/unlimplay.com", proxyOrigin.replaceAll("/", "\\/"));
  rewritten = rewritten.replace(/(["'`])\/(?=(?:f\.php|sw-adblock\.js|img\/|cdn-cgi\/))/g, "$1/unlimplay/");
  rewritten = rewritten.replace(/scope\s*:\s*(["'])\/(["'])/g, "scope: $1/unlimplay/$2");
  if (/text\/html/i.test(contentType) && new URL(requestUrl).pathname.startsWith("/unlimplay/f/embed/")) {
    rewritten = rewritten.replace(/<head([^>]*)>/i, (head) => head + AD_FILTER_SCRIPT);
  }
  return rewritten;
}

export async function onRequest({ request, params }) {
  if (!["GET", "HEAD", "POST"].includes(request.method)) {
    return new Response("Method not allowed", { status: 405, headers: { Allow: "GET, HEAD, POST" } });
  }

  const rawPath = params.path || "";
  const path = Array.isArray(rawPath) ? rawPath.join("/") : String(rawPath);
  if (!path || path.split("/").some(part => part === "..") || !/^[A-Za-z0-9_./-]+$/.test(path)) {
    return new Response("Invalid UnLimPlay path", { status: 400 });
  }

  const incomingUrl = new URL(request.url);
  const upstreamUrl = new URL(`https://unlimplay.com/${path}`);
  upstreamUrl.search = incomingUrl.search;
  const headers = new Headers();
  for (const name of ["Accept", "Accept-Language", "Cookie", "Range", "If-Range", "If-None-Match", "If-Modified-Since", "Content-Type", "X-ULP-Token", "User-Agent"]) {
    const value = request.headers.get(name);
    if (value) headers.set(name, value);
  }
  headers.set("Referer", "https://unlimplay.com/f/embed/");
  if (request.headers.has("Origin")) headers.set("Origin", "https://unlimplay.com");

  try {
    const upstream = await fetch(upstreamUrl, {
      method: request.method,
      headers,
      body: request.method === "POST" ? request.body : undefined,
      redirect: "manual",
    });
    const responseHeaders = new Headers(upstream.headers);
    for (const name of ["content-length", "content-encoding", "transfer-encoding", "content-security-policy", "x-frame-options"]) {
      responseHeaders.delete(name);
    }
    const proxyOrigin = incomingUrl.origin + "/unlimplay";
    const location = responseHeaders.get("Location");
    if (location) {
      try {
        const redirectUrl = new URL(location, upstreamUrl);
        if (redirectUrl.hostname === "unlimplay.com") {
          responseHeaders.set("Location", proxyOrigin + redirectUrl.pathname + redirectUrl.search + redirectUrl.hash);
        }
      } catch {
        // Keep malformed or non-HTTP redirect values unchanged.
      }
    }
    const cookies = upstream.headers.getSetCookie?.() || [];
    if (cookies.length) {
      responseHeaders.delete("Set-Cookie");
      for (const cookie of cookies) responseHeaders.append("Set-Cookie", cookie.replace(/;\s*domain=[^;]+/i, ""));
    }
    if (incomingUrl.searchParams.has("_sw")) responseHeaders.set("Service-Worker-Allowed", "/unlimplay/");

    const contentType = responseHeaders.get("Content-Type") || "application/octet-stream";
    const isText = /(?:text\/|javascript|json|xml|svg)/i.test(contentType);
    if (request.method !== "HEAD" && isText) {
      const text = await upstream.text();
      const body = rewriteText(text, contentType, request.url);
      responseHeaders.set("Content-Length", String(new TextEncoder().encode(body).length));
      return new Response(body, { status: upstream.status, headers: responseHeaders });
    }
    return new Response(request.method === "HEAD" ? null : upstream.body, { status: upstream.status, headers: responseHeaders });
  } catch {
    return new Response("UnLimPlay proxy unavailable", { status: 502 });
  }
}
