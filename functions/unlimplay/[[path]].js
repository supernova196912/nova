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

const PLAYER_REMOTE_SCRIPT = `<script data-cinenova-player-bridge>
(() => {
  const send = type => { try { window.parent.postMessage({type}, "*"); } catch (_) {} };
  const install = doc => {
    if (!doc?.documentElement || doc.documentElement.dataset.cinenovaPlayerBridge) return;
    doc.documentElement.dataset.cinenovaPlayerBridge = "1";
    const style = doc.createElement("style");
    style.textContent = 'button,a,select,[role="button"],[role="menuitem"],[role="option"],[class*="episode" i],[class*="server" i],[class*="dropdown" i]{opacity:1!important;visibility:visible!important;pointer-events:auto!important}button:focus,a:focus,select:focus,[role="button"]:focus,[role="menuitem"]:focus,[role="option"]:focus,[onclick]:focus,[tabindex]:focus,li:focus{outline:3px solid #74a0ff!important;outline-offset:2px!important;border-radius:8px!important;background-color:rgba(76,130,255,.25)!important}';
    (doc.head || doc.documentElement).appendChild(style);
    const controlSelector = 'button,a,select,[role="button"],[role="menuitem"],[role="option"],[onclick],[tabindex],li,.item';
    const menuSelector = '[role="menu"],[role="listbox"],.dropdown-menu,[class*="language-menu" i],[class*="server-menu" i]';
    const visibleControls = () => [...doc.querySelectorAll(controlSelector)]
      .filter(el => !el.matches("iframe,video") && el.getClientRects().length && el.getBoundingClientRect().width > 12 && el.getBoundingClientRect().height > 12 && (()=>{const s=doc.defaultView.getComputedStyle(el);return s.visibility !== "hidden" && s.display !== "none" && !el.hidden && el.getAttribute("aria-hidden") !== "true";})());
    const promoteVisibleControls = () => visibleControls().forEach(el => { if (el.tabIndex !== 0) el.tabIndex = 0; });
    promoteVisibleControls();
    new MutationObserver(promoteVisibleControls).observe(doc.documentElement,{subtree:true,childList:true,attributes:true,attributeFilter:["class","style","hidden","aria-hidden"]});
    const view = doc.defaultView;
    const movePlayerFocus = direction => {
      const controls = visibleControls();
      const active = doc.activeElement || doc.body;
      const focused = active.closest?.(controlSelector);
      if (!controls.length) return;
      if (!controls.includes(focused)) { controls[0].focus({preventScroll:true}); return; }
      const rect = focused.getBoundingClientRect();
      const top = Math.min(...controls.map(el => el.getBoundingClientRect().top));
      const topRow = rect.top <= top + Math.max(40, rect.height * .8);
      const row = controls.filter(el => Math.abs(el.getBoundingClientRect().top - rect.top) < Math.max(30, rect.height * .7));
      if ((direction === "ArrowUp" && topRow) || (direction === "ArrowRight" && topRow && row.indexOf(focused) === row.length - 1)) { send("cinenova-player-exit-focus"); return; }
      const dx = direction === "ArrowLeft" ? -1 : direction === "ArrowRight" ? 1 : 0;
      const dy = direction === "ArrowUp" ? -1 : direction === "ArrowDown" ? 1 : 0;
      const cx = rect.left + rect.width / 2, cy = rect.top + rect.height / 2;
      const nextControl = controls.filter(el => el !== focused).map(el => {
        const r = el.getBoundingClientRect(), x = r.left + r.width / 2, y = r.top + r.height / 2;
        const primary = dx ? (x - cx) * dx : (y - cy) * dy;
        const cross = dx ? Math.abs(y - cy) : Math.abs(x - cx);
        return {el, score:primary + cross * 1.5, primary};
      }).filter(item => item.primary > 4).sort((a,b) => a.score - b.score)[0]?.el;
      nextControl?.focus({preventScroll:true});
    };
    const activatePlayerControl = () => {
      const active = doc.activeElement || doc.body;
      const focusedElement = active.closest?.(controlSelector);
      const video = doc.querySelector("video");
      if (focusedElement && visibleControls().includes(focusedElement)) {
        const before = new Set(visibleControls());
        focusedElement.click();
        requestAnimationFrame(() => {
          const opened = visibleControls().filter(el => !before.has(el));
          const firstOption = opened.find(el => el.matches('button,a,[role="option"],[role="menuitem"],[onclick]')) || opened.find(el => el.closest?.(menuSelector) || el.matches('.item,li'));
          firstOption?.focus({preventScroll:true});
        });
      } else if (video) {
        if (video.paused) video.play?.().catch?.(() => {}); else video.pause();
      }
    };
    const arrows = ["ArrowLeft","ArrowRight","ArrowUp","ArrowDown"];
    view.addEventListener("keyup", event => { if (arrows.includes(event.key)) { event.preventDefault(); event.stopImmediatePropagation(); } }, true);
    view.addEventListener("keypress", event => { if (arrows.includes(event.key)) { event.preventDefault(); event.stopImmediatePropagation(); } }, true);
    view.addEventListener("keydown", event => {
      if (arrows.includes(event.key)) { event.preventDefault(); event.stopImmediatePropagation(); send("cinenova-player-activity"); movePlayerFocus(event.key); return; }
      if (["Escape", "Backspace", "BrowserBack"].includes(event.key)) { event.preventDefault(); event.stopImmediatePropagation(); send("cinenova-exit-player"); return; }
      if (["Enter", " ", "MediaPlayPause"].includes(event.key)) { event.preventDefault(); event.stopImmediatePropagation(); send("cinenova-player-activity"); activatePlayerControl(); }
    }, true);
    let lastFocusedControl = null;
    const observeFrame = frame => {
      frame.tabIndex = -1;
      if (frame.dataset.cinenovaTvObserved) return;
      frame.dataset.cinenovaTvObserved = "1";
      frame.addEventListener("load", () => { try { install(frame.contentDocument); } catch (_) {} });
      try { if (frame.contentDocument?.readyState === "complete") install(frame.contentDocument); } catch (_) {}
    };
    doc.querySelectorAll("iframe").forEach(observeFrame);
    doc.addEventListener("focusin", event => { if (event.target.matches?.('button,a,select,input,[role="button"],[role="menuitem"],[role="option"],[tabindex],[onclick],li,.item') && !event.target.matches("iframe")) lastFocusedControl=event.target; }, true);
    doc.addEventListener("focus", event => {
      const frame=event.target;
      if (!frame.matches?.("iframe")) return;
      let crossOrigin=false; try { void frame.contentDocument?.documentElement; } catch (_) { crossOrigin=true; }
      if (!crossOrigin) return;
      frame.blur?.(); (lastFocusedControl?.isConnected ? lastFocusedControl : visibleControls()[0])?.focus({preventScroll:true});
    }, true);
    new MutationObserver(() => doc.querySelectorAll("iframe").forEach(observeFrame)).observe(doc.documentElement, {childList:true,subtree:true});
    view.addEventListener("message", event => {
      if (event.source !== window.parent) return;
      if (["cinenova-player-focus", "cinenova-player-autoplay"].includes(event.data?.type)) {
        const play = doc.querySelector('#pbtn,.pbtn,.play-overlay,[class*="play-overlay" i],[aria-label*="play" i],[title*="play" i],video');
        if (play && play.tagName !== "VIDEO") { play.focus?.({preventScroll:true}); if (event.data.type === "cinenova-player-autoplay") play.click?.(); }
        else if (play?.tagName === "VIDEO") { if (event.data.type === "cinenova-player-autoplay") play.play?.().catch?.(() => {}); doc.body.tabIndex = -1; doc.body.focus({preventScroll:true}); }
        return;
      }
      if (event.data?.type !== "cinenova-player-key") return;
      const key=event.data.key;
      if (!["ArrowLeft","ArrowRight","ArrowUp","ArrowDown","Enter"," ","MediaPlayPause"].includes(key)) return;
      if (arrows.includes(key)) { movePlayerFocus(key); return; }
      activatePlayerControl();
    });
  };
  install(document);
})();
</script>`;

const TV_PLAYER_CONTROLS_SCRIPT = `<script data-cinenova-tv-controls>
(() => {
  const hideSelector = [
    '.vjs-fullscreen-control','.vjs-playback-rate','.vjs-settings-button',
    '.plyr__control[data-plyr="fullscreen"]','.plyr__control[data-plyr="speed"]',
    '.jw-icon-fullscreen','.jw-settings-submenu-button','.shaka-fullscreen-button',
    '[aria-label*="fullscreen" i]','[title*="fullscreen" i]','[aria-label*="pantalla completa" i]','[title*="pantalla completa" i]','[aria-label*="expandir" i]','[title*="expandir" i]','[aria-label*="maximizar" i]','[title*="maximizar" i]',
    '[aria-label*="velocidad" i]','[title*="velocidad" i]','[aria-label*="playback rate" i]','[title*="playback rate" i]',
    '[aria-label*="speed" i]','[title*="speed" i]','[aria-label*="settings" i]','[title*="settings" i]',
    '[aria-label*="configuración" i]','[title*="configuración" i]','[aria-label*="ajustes" i]','[title*="ajustes" i]'
  ].join(',');
  const hiddenLabel = /(fullscreen|full.?screen|pantalla completa|expandir|maximizar|playback.?rate|velocidad|speed|settings?|config|configuraci[oó]n|ajustes|gear)/i;
  const concealControls = () => {
    document.querySelectorAll(hideSelector).forEach(el => {
      const control = el.closest('button,a,[role="button"],[tabindex],[onclick]') || el;
      control.style.setProperty('display', 'none', 'important');
      control.setAttribute('aria-hidden', 'true');
      control.tabIndex = -1;
      if (control === document.activeElement) control.blur?.();
    });
    document.querySelectorAll('button,a,[role="button"],[tabindex],[onclick]').forEach(control => {
      const label = [control.getAttribute('aria-label'),control.getAttribute('title'),control.getAttribute('data-title'),control.getAttribute('data-tooltip'),control.className,control.id,control.textContent].join(' ');
      if (!hiddenLabel.test(label)) return;
      control.style.setProperty('display', 'none', 'important');
      control.setAttribute('aria-hidden', 'true'); control.tabIndex = -1;
      if (control === document.activeElement) control.blur?.();
    });
  };
  concealControls();
  new MutationObserver(concealControls).observe(document.documentElement, {subtree:true,childList:true});
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
  const requestURL = new URL(requestUrl);
  const tvPlayer = requestURL.searchParams.get("cn_tv") === "1";
  if (/text\/html/i.test(contentType) && requestURL.pathname.startsWith("/unlimplay/")) {
    const embed = requestURL.pathname.startsWith("/unlimplay/f/embed/");
    const scripts = (tvPlayer ? PLAYER_REMOTE_SCRIPT + (embed ? TV_PLAYER_CONTROLS_SCRIPT : "") : "") + (embed ? AD_FILTER_SCRIPT : "");
    if (scripts) {
      const htmlStart = /<html\b[^>]*>/i.exec(rewritten);
      const doctype = /^\s*<!doctype[^>]*>/i.exec(rewritten);
      const insertAt = htmlStart ? htmlStart.index + htmlStart[0].length : doctype ? doctype[0].length : 0;
      rewritten = rewritten.slice(0, insertAt) + scripts + rewritten.slice(insertAt);
    }
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
  upstreamUrl.searchParams.delete("cn_tv");
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
