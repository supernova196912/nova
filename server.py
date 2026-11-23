#!/usr/bin/env python3
"""Serve Peliskong's local web UI and remote catalog files on localhost."""

from __future__ import annotations

import argparse
import json
import mimetypes
import os
import re
import urllib.error
import urllib.request
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlencode, unquote, urlsplit


PROJECT_ROOT = Path(__file__).resolve().parent
STATIC_ROOTS = {
    "web": (PROJECT_ROOT / "web").resolve(),
    "remote": (PROJECT_ROOT / "remote").resolve(),
}
UNLIMPLAY_PREFIX = "/unlimplay"
TMDB_API_PREFIX = "/api/tmdb"
UNLIMPLAY_AD_DOMAINS = (
    "doubleclick.net", "googlesyndication.com", "googleadservices.com",
    "imasdk.googleapis.com", "adnxs.com", "popads.net", "popcash.net",
    "exoclick.com", "juicyads.com", "adsterra.com", "highperformanceformat.com",
    "monetag.com", "onclickalgo.com", "acscdn.com", "taboola.com", "outbrain.com",
    "mgid.com", "adform.net", "adsrvr.org", "rubiconproject.com", "pubmatic.com",
    "openx.net", "criteo.com", "smartadserver.com", "propellerads.com", "clickadu.com",
    "evadav.com", "trafficstars.com", "hilltopads.com", "googletagservices.com",
    "adservice.google.com", "adskeeper.com", "adkernel.com", "bashirian.biz",
    "21wiz.com", "morencius.com", "servetraff.com",
)

UNLIMPLAY_AD_SCRIPT = """<script data-cinenova-ad-filter>
(() => {
  const brandStyle = document.createElement('style');
  brandStyle.dataset.cinenovaPlayerBranding = '';
  brandStyle.textContent = '.ulp-logo-img,.ulp-logo-svg{display:none!important}';
  (document.head || document.documentElement).appendChild(brandStyle);
  const blocked = %s;
  const isAd = value => {
    try {
      const u = new URL(value instanceof Request ? value.url : value, location.href);
      if (/\\.(m3u8|mp4|ts|vtt)$/i.test(u.pathname)) return false;
      return blocked.some(d => u.hostname === d || u.hostname.endsWith('.' + d));
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
    this.__cinenovaMethod = method;
  };
  XMLHttpRequest.prototype.send = function(...args) {
    if (!this.__cinenovaBlocked) return nativeSend.apply(this, args);
    queueMicrotask(() => {
      this.dispatchEvent(new ProgressEvent('error'));
      this.dispatchEvent(new ProgressEvent('loadend'));
    });
  };
  const nativeSetAttribute = Element.prototype.setAttribute;
  Element.prototype.setAttribute = function(name, value) {
    if (/^(src|href)$/i.test(name) && isAd(value)) {
      if (this.tagName === 'A') return nativeSetAttribute.call(this, name, '#');
      return nativeSetAttribute.call(this, name, 'about:blank');
    }
    return nativeSetAttribute.call(this, name, value);
  };
  const originalOpen = window.open;
  window.open = (url, ...args) => isAd(url) ? null : originalOpen.call(window, url, ...args);
  document.addEventListener('click', event => {
    const link = event.target.closest && event.target.closest('a[href]');
    if (link && isAd(link.href)) { event.preventDefault(); event.stopImmediatePropagation(); }
  }, true);
  const skipAds = () => {
    const button = document.getElementById('btn-skip');
    if (!button || button.disabled || /\\d+\\s*s/i.test(button.innerText || '')) return;
    if (button.getClientRects().length) button.click();
  };
  setInterval(skipAds, 250);
})();
</script>""" % json.dumps(list(UNLIMPLAY_AD_DOMAINS))

UNLIMPLAY_TV_SCRIPT = r'''<script data-cinenova-player-bridge>
(() => {
  const send = type => { try { window.parent.postMessage({type}, "*"); } catch (_) {} };
  const install = doc => {
    if (!doc?.documentElement || doc.documentElement.dataset.cinenovaPlayerBridge) return;
    doc.documentElement.dataset.cinenovaPlayerBridge = "1";
    const style = doc.createElement("style");
    style.textContent = 'button, a, select, [role="button"], [role="menuitem"], [role="option"], [class*="episode" i], [class*="server" i], [class*="dropdown" i]{opacity:1!important;visibility:visible!important;pointer-events:auto!important}button:focus,a:focus,select:focus,input:focus,[role="button"]:focus,[role="menuitem"]:focus,[role="option"]:focus,[tabindex]:focus,li:focus,.item:focus{outline:3px solid #74a0ff!important;outline-offset:2px!important;border-radius:8px!important;box-shadow:0 0 14px rgba(76,130,255,.7)!important}';
    (doc.head || doc.documentElement).appendChild(style);
    const visibleControls = () => [...doc.querySelectorAll('button:not(:disabled),a,select:not(:disabled),input:not(:disabled):not([type="hidden"]),[role="button"],[role="menuitem"],[role="option"],[tabindex],[onclick],li,.item')]
      .filter(el => !el.matches("iframe") && el.getClientRects().length && el.getBoundingClientRect().width > 14 && el.getBoundingClientRect().height > 14 && (()=>{const s=doc.defaultView.getComputedStyle(el);return s.visibility !== "hidden" && s.display !== "none" && el.getAttribute("aria-hidden") !== "true";})());
    const promoteVisibleControls = () => visibleControls().forEach(el => { if (el.tabIndex < 0) el.tabIndex = 0; });
    promoteVisibleControls();
    new MutationObserver(promoteVisibleControls).observe(doc.documentElement,{subtree:true,childList:true,attributes:true,attributeFilter:["class","style","hidden","aria-hidden"]});
    const view = doc.defaultView;
    view.addEventListener("keyup", event => { if (["ArrowLeft","ArrowRight","ArrowUp","ArrowDown"].includes(event.key)) { event.preventDefault(); event.stopImmediatePropagation(); } }, true);
    view.addEventListener("keypress", event => { if (["ArrowLeft","ArrowRight","ArrowUp","ArrowDown"].includes(event.key)) { event.preventDefault(); event.stopImmediatePropagation(); } }, true);
    view.addEventListener("keydown", event => {
      if (["Escape", "Backspace", "BrowserBack"].includes(event.key)) {
        event.preventDefault(); event.stopImmediatePropagation(); send("cinenova-exit-player"); return;
      }
      send("cinenova-player-activity");
      const target = doc.activeElement || doc.body, video = doc.querySelector("video");
      const controls = visibleControls(), focused = target.closest?.('button,a,select,input,[role="button"],[role="menuitem"],[role="option"],[tabindex],[onclick],li,.item');
      const inMenu = !!target.closest?.('[role="menu"],[role="listbox"],.dropdown-menu,[class*="language-menu" i]');
      if (["Enter", " ", "MediaPlayPause"].includes(event.key)) {
        if (event.key === "MediaPlayPause" && inMenu) return;
        if (focused && event.key !== "MediaPlayPause") {
          event.preventDefault(); const before=new Set(controls); focused.click?.();
          requestAnimationFrame(()=>{ const opened=visibleControls().filter(el=>!before.has(el)); const option=opened.find(el=>el.matches('[role="option"],[role="menuitem"]') || el.closest?.('[role="menu"],[role="listbox"],.dropdown-menu,[class*="language-menu" i]')); option?.focus({preventScroll:true}); });
        } else if (video) { event.preventDefault(); if(video.paused) video.play?.().catch?.(()=>{}); else video.pause(); }
        else if (focused) { event.preventDefault(); focused.click?.(); }
        return;
      }
      if (!["ArrowLeft","ArrowRight","ArrowUp","ArrowDown"].includes(event.key)) return;
      event.preventDefault(); event.stopImmediatePropagation();
      if (!controls.includes(focused)){ controls[0]?.focus({preventScroll:true}); return; }
      const rect=focused.getBoundingClientRect(), top=Math.min(...controls.map(el=>el.getBoundingClientRect().top));
      const topRow=rect.top<=top+Math.max(40,rect.height*.8), row=controls.filter(el=>Math.abs(el.getBoundingClientRect().top-rect.top)<Math.max(30,rect.height*.7));
      if ((event.key === "ArrowUp" && topRow) || (event.key === "ArrowRight" && topRow && row.indexOf(focused)===row.length-1)) { event.preventDefault(); send("cinenova-player-exit-focus"); return; }
      const dx=event.key==="ArrowLeft"?-1:event.key==="ArrowRight"?1:0, dy=event.key==="ArrowUp"?-1:event.key==="ArrowDown"?1:0, cx=rect.left+rect.width/2, cy=rect.top+rect.height/2;
      const next=controls.filter(el=>el!==focused).map(el=>{const r=el.getBoundingClientRect(),x=r.left+r.width/2,y=r.top+r.height/2,p=dx?(x-cx)*dx:(y-cy)*dy,c=dx?Math.abs(y-cy):Math.abs(x-cx);return {el,score:p+c*1.5,p};}).filter(x=>x.p>4).sort((a,b)=>a.score-b.score)[0];
      if(next){next.el.focus({preventScroll:true});next.el.scrollIntoView?.({block:"nearest",inline:"nearest"});}
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
      const video = doc.querySelector("video");
      const target=doc.activeElement||doc.body, menuControl=!!target.closest?.('[role="menu"],[role="listbox"],.dropdown-menu,[class*="language-menu" i]');
      const focused=target.closest?.('button,a,select,input,[role="button"],[role="menuitem"],[role="option"],[tabindex],[onclick],li,.item');
      if (video && ["Enter"," ","MediaPlayPause"].includes(key) && !menuControl && !focused) { if(video.paused) video.play?.().catch?.(()=>{}); else video.pause(); }
      else {
        const code={ArrowLeft:37,ArrowUp:38,ArrowRight:39,ArrowDown:40,Enter:13," ":32}[key];
        const input=new doc.defaultView.KeyboardEvent("keydown",{key,code:key === " "?"Space":key,bubbles:true,cancelable:true});
        try{Object.defineProperty(input,"keyCode",{get:()=>code});Object.defineProperty(input,"which",{get:()=>code});}catch(_){}
        target.dispatchEvent(input);
      }
      if (!video && !["ArrowLeft","ArrowRight","ArrowUp","ArrowDown"].includes(key)) doc.querySelectorAll("iframe").forEach(frame=>frame.contentWindow?.postMessage(event.data,"*"));
    });
  };
  install(document);
})();
</script>'''


def _clean_env_value(value: str) -> str:
    return value.strip().lstrip("\ufeff").strip().strip("\"'").strip()


def get_env_value(name: str) -> str:
    """Read a setting from the process environment or the private local .env."""
    value = _clean_env_value(os.environ.get(name, ""))
    if value:
        return value
    env_file = PROJECT_ROOT / ".env"
    if not env_file.is_file():
        return ""
    for line in env_file.read_text(encoding="utf-8-sig").splitlines():
        line = line.strip().lstrip("\ufeff")
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, candidate = line.split("=", 1)
        if key.strip().lstrip("\ufeff") == name:
            return _clean_env_value(candidate)
    return ""

class PeliskongHandler(SimpleHTTPRequestHandler):
    """Expose only web/ and remote/, never the rest of the project tree."""

    def translate_path(self, path: str) -> str:
        request_path = unquote(urlsplit(path).path)
        parts = [part for part in request_path.split("/") if part]

        if not parts or parts[0] not in STATIC_ROOTS:
            return str(PROJECT_ROOT / "__not_found__")

        root = STATIC_ROOTS[parts[0]]
        target = root.joinpath(*parts[1:]).resolve()
        try:
            target.relative_to(root)
        except ValueError:
            return str(PROJECT_ROOT / "__not_found__")

        if target.is_dir():
            target = target / "index.html"
        return str(target)

    def do_GET(self) -> None:
        parsed = urlsplit(self.path)
        if parsed.path == "/":
            self.send_response(302)
            self.send_header("Location", "/web/")
            self.end_headers()
            return

        if parsed.path.startswith(UNLIMPLAY_PREFIX + "/"):
            self.proxy_unlimplay("GET")
            return

        if parsed.path == TMDB_API_PREFIX or parsed.path.startswith(TMDB_API_PREFIX + "/"):
            self.proxy_tmdb()
            return

        if parsed.path == "/api/stream":
            # External embed extraction/proxying is intentionally unsupported.
            payload = {
                "error": "stream_resolution_unavailable",
                "message": "Use a provider-authorized direct media URL.",
            }
            body = json.dumps(payload).encode("utf-8")
            self.send_response(501)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return

        if parsed.path.startswith("/web/") or parsed.path.startswith("/remote/"):
            super().do_GET()
            return

        self.send_error(404, "Not found")

    def do_POST(self) -> None:
        if urlsplit(self.path).path.startswith(UNLIMPLAY_PREFIX + "/"):
            self.proxy_unlimplay("POST")
            return
        self.send_error(404, "Not found")

    def do_HEAD(self) -> None:
        if urlsplit(self.path).path.startswith(UNLIMPLAY_PREFIX + "/"):
            self.proxy_unlimplay("HEAD")
            return
        self.send_error(404, "Not found")

    def do_OPTIONS(self) -> None:
        parsed = urlsplit(self.path)
        if parsed.path == TMDB_API_PREFIX or parsed.path.startswith(TMDB_API_PREFIX + "/"):
            self.send_response(204)
            self.add_tmdb_cors_headers()
            self.send_header("Access-Control-Allow-Methods", "GET, OPTIONS")
            self.send_header("Access-Control-Allow-Headers", "Accept, Content-Type")
            self.send_header("Access-Control-Max-Age", "86400")
            self.end_headers()
            return
        self.send_error(404, "Not found")

    def add_tmdb_cors_headers(self) -> None:
        origin = self.headers.get("Origin", "")
        allowed = {"https://localhost", "http://localhost", "capacitor://localhost"}
        allowed.update(filter(None, (item.strip() for item in get_env_value("CINENOVA_ALLOWED_ORIGINS").split(","))))
        if origin in allowed:
            self.send_header("Access-Control-Allow-Origin", origin)
            self.send_header("Vary", "Origin")

    def proxy_tmdb(self) -> None:
        """Relay read-only TMDB API calls while keeping its credential server-side."""
        parsed = urlsplit(self.path)
        relative_path = parsed.path[len(TMDB_API_PREFIX):]
        if not relative_path or not re.fullmatch(r"/[A-Za-z0-9_./-]+", relative_path) or ".." in relative_path.split("/"):
            self.send_error(400, "Invalid TMDB path")
            return

        api_key = get_env_value("TMDB_API_KEY")
        if not api_key:
            self.send_error(503, "TMDB is not configured on the server")
            return

        upstream_url = "https://api.themoviedb.org/3" + relative_path
        if parsed.query:
            upstream_url += "?" + parsed.query
        headers = {"Accept": "application/json", "User-Agent": "CINENOVA/1.0"}
        if re.fullmatch(r"eyJ[A-Za-z0-9_-]*\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+", api_key):
            headers["Authorization"] = "Bearer " + api_key
        else:
            separator = "&" if "?" in upstream_url else "?"
            upstream_url += separator + urlencode({"api_key": api_key})

        try:
            upstream = urllib.request.urlopen(urllib.request.Request(upstream_url, headers=headers), timeout=20)
        except urllib.error.HTTPError as error:
            upstream = error
        except Exception:
            self.send_error(502, "TMDB is temporarily unavailable")
            return

        try:
            payload = upstream.read(8_000_001)
            if len(payload) > 8_000_000:
                self.send_error(502, "TMDB response is too large")
                return
            self.send_response(getattr(upstream, "status", upstream.code))
            self.send_header("Content-Type", upstream.headers.get("Content-Type", "application/json; charset=utf-8"))
            self.send_header("Content-Length", str(len(payload)))
            self.send_header("Cache-Control", "public, max-age=300")
            self.add_tmdb_cors_headers()
            self.end_headers()
            self.wfile.write(payload)
        except (BrokenPipeError, ConnectionResetError):
            pass
        finally:
            upstream.close()

    def proxy_unlimplay(self, method: str) -> None:
        """Same-origin relay for the UnLimPlay embed and its own API endpoints."""
        parsed = urlsplit(self.path)
        upstream_path = parsed.path[len(UNLIMPLAY_PREFIX):] or "/"
        upstream_url = "https://unlimplay.com" + upstream_path
        if parsed.query:
            upstream_url += "?" + parsed.query

        request_headers = {"Accept-Encoding": "identity"}
        for header in ("User-Agent", "Accept", "Accept-Language", "Cookie", "Range",
                       "If-Range", "If-None-Match", "If-Modified-Since", "Content-Type",
                       "X-ULP-Token"):
            value = self.headers.get(header)
            if value:
                request_headers[header] = value
        request_headers["Referer"] = "https://unlimplay.com/f/embed/"
        if self.headers.get("Origin"):
            request_headers["Origin"] = "https://unlimplay.com"

        body = None
        if method == "POST":
            length = min(int(self.headers.get("Content-Length", "0") or 0), 2_000_000)
            body = self.rfile.read(length) if length else b""

        upstream_request = urllib.request.Request(
            upstream_url, data=body, headers=request_headers, method=method
        )
        try:
            upstream = urllib.request.urlopen(upstream_request, timeout=30)
        except urllib.error.HTTPError as error:
            upstream = error
        except Exception:
            self.send_error(502, "UnLimPlay proxy unavailable")
            return

        try:
            status = getattr(upstream, "status", upstream.code)
            headers = upstream.headers
            content_type = headers.get("Content-Type", "application/octet-stream")
            is_text = any(kind in content_type.lower() for kind in
                          ("text/", "javascript", "json", "xml", "svg"))
            transformed = None
            if method != "HEAD" and is_text:
                payload = upstream.read(16_000_001)
                if len(payload) <= 16_000_000:
                    encoding = "utf-8"
                    match = re.search(r"charset=([\w-]+)", content_type, re.I)
                    if match:
                        encoding = match.group(1)
                    try:
                        text = payload.decode(encoding)
                    except (LookupError, UnicodeDecodeError):
                        text = payload.decode("utf-8", errors="replace")
                    proxy_origin = f"http://{self.headers.get('Host', '127.0.0.1:8000')}{UNLIMPLAY_PREFIX}"
                    text = text.replace("https://unlimplay.com", proxy_origin)
                    text = text.replace("http://unlimplay.com", proxy_origin)
                    text = text.replace("https:\\/\\/unlimplay.com", proxy_origin.replace("/", "\\/"))
                    text = text.replace("http:\\/\\/unlimplay.com", proxy_origin.replace("/", "\\/"))
                    text = re.sub(r"(?P<q>[\"'`])(?P<slash>\\?/)(?=(?:f\.php|sw-adblock\.js|img/|cdn-cgi/))",
                                  lambda m: m.group("q") + m.group("slash") + "unlimplay/", text)
                    text = re.sub(r"scope\s*:\s*([\"'])/([\"'])",
                                  r"scope: \1/unlimplay/\2", text)
                    if "text/html" in content_type.lower() and parsed.path.startswith(UNLIMPLAY_PREFIX + "/"):
                        scripts = UNLIMPLAY_TV_SCRIPT
                        if parsed.path.startswith(UNLIMPLAY_PREFIX + "/f/embed/"):
                            scripts += UNLIMPLAY_AD_SCRIPT
                        html_start = re.search(r"<html\b[^>]*>", text, flags=re.I)
                        if html_start:
                            text = text[:html_start.end()] + scripts + text[html_start.end():]
                        else:
                            doctype = re.match(r"\s*<!doctype[^>]*>", text, flags=re.I)
                            insert_at = doctype.end() if doctype else 0
                            text = text[:insert_at] + scripts + text[insert_at:]
                    transformed = text.encode(encoding, errors="replace")

            self.send_response(status)
            skip_headers = {"connection", "transfer-encoding", "content-encoding", "content-length",
                            "content-security-policy", "x-frame-options", "content-encoding"}
            for key, value in headers.items():
                if key.lower() in skip_headers:
                    continue
                if key.lower() == "location":
                    value = value.replace("https://unlimplay.com", proxy_origin if transformed is not None else
                                          f"http://{self.headers.get('Host', '127.0.0.1:8000')}{UNLIMPLAY_PREFIX}")
                if key.lower() == "set-cookie":
                    value = re.sub(r";\s*domain=[^;]+", "", value, flags=re.I)
                self.send_header(key, value)
            if parsed.query.find("_sw=1") >= 0:
                self.send_header("Service-Worker-Allowed", UNLIMPLAY_PREFIX + "/")
            response_body = transformed
            if response_body is not None:
                self.send_header("Content-Length", str(len(response_body)))
            elif method != "HEAD" and is_text:
                self.send_header("Content-Length", str(len(payload)))
            self.end_headers()

            if method == "HEAD":
                return
            if response_body is not None:
                self.wfile.write(response_body)
            elif is_text:
                self.wfile.write(payload)
            else:
                while True:
                    chunk = upstream.read(64 * 1024)
                    if not chunk:
                        break
                    self.wfile.write(chunk)
        except (BrokenPipeError, ConnectionResetError):
            pass
        finally:
            upstream.close()

    def end_headers(self) -> None:
        self.send_header("Cache-Control", "no-cache")
        super().end_headers()


def main() -> None:
    parser = argparse.ArgumentParser(description="Serve Peliskong web and remote assets locally.")
    parser.add_argument("--host", default="127.0.0.1", help="Bind address (default: localhost only)")
    parser.add_argument("--port", type=int, default=8000, help="HTTP port (default: 8000)")
    args = parser.parse_args()

    # In the standalone nova copy the remote catalog folder is optional.
    missing = [name for name in ("web",) if not STATIC_ROOTS[name].is_dir()]
    if missing:
        parser.error("missing required directory/directories: " + ", ".join(missing))

    mimetypes.add_type("application/json", ".json")
    server = ThreadingHTTPServer((args.host, args.port), PeliskongHandler)
    print(f"Peliskong local server: http://{args.host}:{args.port}/web/")
    print("Serving /web/, /remote/, /api/tmdb/, and /unlimplay/. Press Ctrl+C to stop.")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopping server...")
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
