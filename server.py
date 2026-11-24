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
  const sendData = data => { try { window.parent.postMessage(data, "*"); } catch (_) {} };
  const install = doc => {
    if (!doc?.documentElement || doc.documentElement.dataset.cinenovaPlayerBridge) return;
    doc.documentElement.dataset.cinenovaPlayerBridge = "1";
    let lastTimePost = 0;
    const postPlayerTime = video => {
      const now = Date.now();
      if (now - lastTimePost < 900) return;
      lastTimePost = now;
      try { window.parent.postMessage({type:"cinenova-player-time",currentTime:video.currentTime,duration:Number.isFinite(video.duration) ? video.duration : 0},"*"); } catch (_) {}
    };
    const bindVideoTime = () => doc.querySelectorAll("video").forEach(video => {
      if (video.dataset.cinenovaTimeBound) return;
      video.dataset.cinenovaTimeBound = "1";
      ["timeupdate","loadedmetadata","durationchange","play","seeked"].forEach(type => video.addEventListener(type, () => postPlayerTime(video)));
    });
    const style = doc.createElement("style");
    style.textContent = 'button,a,select,[role="button"],[role="menuitem"],[role="option"],[class*="episode" i],[class*="server" i],[class*="dropdown" i]{opacity:1!important;visibility:visible!important;pointer-events:auto!important}.cn-volume-hidden:not(video):not(iframe){display:none!important}video,iframe{display:block!important;visibility:visible!important;opacity:1!important;pointer-events:auto!important}.player-cc-btn{right:24px!important;bottom:18px!important;left:auto!important}button:focus,a:focus,select:focus,[role="button"]:focus,[role="menuitem"]:focus,[role="option"]:focus,[onclick]:focus,[tabindex]:focus,li:focus{outline:3px solid #74a0ff!important;outline-offset:2px!important;border-radius:8px!important;background-color:rgba(76,130,255,.25)!important}html.cn-hud-hidden [data-cn-hud-control="1"]{opacity:0!important;visibility:hidden!important;pointer-events:none!important;transition:opacity .25s ease!important}html.cn-hud-hidden video::-webkit-media-controls,html.cn-hud-hidden video::-webkit-media-controls-enclosure,html.cn-hud-hidden video::-webkit-media-controls-panel{display:none!important;opacity:0!important;visibility:hidden!important;-webkit-appearance:none!important}video::-webkit-media-controls,video::-webkit-media-controls-enclosure,video::-webkit-media-controls-panel,video::-webkit-media-controls-overlay-play-button{display:none!important;-webkit-appearance:none!important}';
    (doc.head || doc.documentElement).appendChild(style);
    const controlSelector = 'button,a,select,[role="button"],[role="menuitem"],[role="option"],[onclick],[tabindex],li,.item';
    const menuSelector = '[role="menu"],[role="listbox"],.dropdown-menu,[class*="language-menu" i],[class*="server-menu" i]';
    const visibleControls = () => [...doc.querySelectorAll(controlSelector)]
      .filter(el => !el.matches("iframe,video") && el.getClientRects().length && el.getBoundingClientRect().width > 12 && el.getBoundingClientRect().height > 12 && (()=>{const s=doc.defaultView.getComputedStyle(el);return s.visibility !== "hidden" && s.display !== "none" && !el.hidden && el.getAttribute("aria-hidden") !== "true";})());
    const progressSelector = 'input[type="range"],[role="slider"],.vjs-progress-control,.plyr__progress,.jw-slider-time,[class*="progress" i],[id*="progress" i],[class*="seek" i],[id*="seek" i],[class*="timeline" i],[id*="timeline" i],[class*="scrubber" i],[id*="scrubber" i]';
    const isSeekbar = element => {
      if (!element) return false;
      if (isVolumeControl(element)) return false;
      const candidate = element.closest?.(progressSelector), childRange = element.querySelector?.('input[type="range"],[role="slider"]');
      if (candidate || childRange) return true;
      const rect = element.getBoundingClientRect?.(), marker = (element.className?.baseVal || element.className || "") + " " + (element.id || "");
      return !!rect && rect.width > rect.height && rect.top > view.innerHeight * .5 && /progress|seek|timeline|scrubber|bar/i.test(marker);
    };
    const seekProgress = (element, key) => {
      const video = doc.querySelector("video");
      if (!video) return;
      const duration = video.duration || 1e9, delta = key === "ArrowLeft" ? -10 : key === "ArrowRight" ? 10 : 0;
      video.currentTime = Math.max(0, Math.min(duration, video.currentTime + delta));
      const bar = element.closest?.(progressSelector) || element;
      const range = element.matches?.('input[type="range"]') ? element : element.querySelector?.('input[type="range"]') || bar.querySelector?.('input[type="range"]');
      if (range) {
        const min = Number(range.min || 0), max = Number(range.max || duration);
        range.value = String(min + (Math.max(0, Math.min(duration, video.currentTime)) / duration) * (max - min));
        range.dispatchEvent(new view.Event("input", {bubbles:true}));
        range.dispatchEvent(new view.Event("change", {bubbles:true}));
      }
      const rect = bar.getBoundingClientRect(), x = rect.left + (video.currentTime / duration) * rect.width, y = rect.top + rect.height / 2;
      const target = range || bar, init = {bubbles:true,cancelable:true,clientX:x,clientY:y};
      if (view.PointerEvent) { target.dispatchEvent(new view.PointerEvent("pointerdown",init)); target.dispatchEvent(new view.PointerEvent("pointerup",init)); }
      ["mousedown","mouseup","click"].forEach(type => target.dispatchEvent(new view.MouseEvent(type,init)));
    };
    const volumeSelector = '[aria-label*="mute" i],[aria-label*="volumen" i],[aria-label*="volume" i],[title*="mute" i],[title*="volumen" i],[class*="volume" i],[class*="mute" i]';
    const isVolumeControl = element => !!element?.closest?.(volumeSelector);
    const adjustVolume = (element, key) => {
      const video = doc.querySelector("video"); if (!video) return;
      video.volume = Math.max(0, Math.min(1, video.volume + (key === "ArrowUp" ? .1 : -.1)));
      if (video.volume > 0) video.muted = false;
      const container = element.closest?.(volumeSelector)?.parentElement || element.parentElement;
      const range = container?.querySelector?.('input[type="range"]');
      if (range) {
        range.value = String(Math.round(video.volume * 100));
        range.hidden = false; range.style.setProperty("visibility","visible","important"); range.style.setProperty("opacity","1","important");
        range.dispatchEvent(new view.Event("input",{bubbles:true})); range.dispatchEvent(new view.Event("change",{bubbles:true}));
      }
    };
    const hideNativeVideoControls = () => doc.querySelectorAll("video").forEach(video => {
      if (video.controls) video.controls = false;
      video.removeAttribute("controls");
      if (!video.hasAttribute("controlslist")) video.setAttribute("controlslist","nodownload noplaybackrate noremoteplayback");
    });
    const hideVolumeControls = () => doc.querySelectorAll(volumeSelector).forEach(el => {
      const owner=el.closest("button,[role='button'],label,input[type='range'],[role='slider']");
      [el,owner].filter(Boolean).filter(target => !target.matches("video,iframe") && !target.querySelector?.("video,iframe")).forEach(target => target.classList.add("cn-volume-hidden"));
    });
    const promoteVisibleControls = () => visibleControls().forEach(el => { if (el.tabIndex !== 0) el.tabIndex = 0; });
    const refreshPlayerControls = () => { hideNativeVideoControls(); hideVolumeControls(); promoteVisibleControls(); bindVideoTime(); };
    refreshPlayerControls();
    new MutationObserver(refreshPlayerControls).observe(doc.documentElement,{subtree:true,childList:true,attributes:true,attributeFilter:["class","style","hidden","aria-hidden","controls"]});
    const view = doc.defaultView;
    const diag = { error: "" };
    const diagPath = input => {
      try {
        const raw = typeof input === "string" ? input : input && input.url ? input.url : "";
        const url = new URL(raw, view.location.href);
        return url.pathname + url.search;
      } catch (_) { return "recurso interno"; }
    };
    const diagError = message => {
      if (!diag.error) diag.error = String(message || "Error de red").slice(0, 180);
    };
    const nativeFetch = view.fetch;
    if (typeof nativeFetch === "function") view.fetch = function(...args) {
      return nativeFetch.apply(view, args).then(response => {
        if (response && response.status >= 400) diagError("Error " + response.status + " en " + diagPath(args[0]));
        return response;
      }, error => {
        diagError("Fallo de red en " + diagPath(args[0]) + (error && error.message ? ": " + error.message : ""));
        throw error;
      });
    };
    const NativeXHR = view.XMLHttpRequest;
    if (NativeXHR && NativeXHR.prototype) {
      const originalOpen = NativeXHR.prototype.open, originalSend = NativeXHR.prototype.send;
      NativeXHR.prototype.open = function(method, url, ...rest) { this.__cnUrl = url; return originalOpen.call(this, method, url, ...rest); };
      NativeXHR.prototype.send = function(...args) {
        this.addEventListener("load", () => { if (this.status >= 400) diagError("Error " + this.status + " en " + diagPath(this.__cnUrl)); });
        this.addEventListener("error", () => diagError("Fallo de red en " + diagPath(this.__cnUrl)));
        return originalSend.apply(this, args);
      };
    }
    view.addEventListener("error", event => { if (event.message || event.error) diagError(event.message || "Error de JavaScript"); }, true);
    view.addEventListener("unhandledrejection", event => diagError(event.reason && event.reason.message ? event.reason.message : event.reason || "Promesa rechazada"), true);
    setTimeout(() => {
      if (!diag.error || doc.querySelector("[data-cn-diagnostic]")) return;
      const text = ((doc.body && doc.body.innerText) || "").toLocaleLowerCase("es");
      if (!text.includes("verificando servidores") && !text.includes("espere")) return;
      const box = doc.createElement("div");
      box.setAttribute("data-cn-diagnostic", "1");
      box.textContent = diag.error;
      box.style.cssText = "position:fixed;left:24px;bottom:64px;z-index:2147483647;max-width:60vw;padding:8px 12px;border:1px solid #a44;border-radius:8px;background:rgba(20,8,8,.92);color:#fff;font:14px/1.3 sans-serif;pointer-events:none";
      (doc.body || doc.documentElement).appendChild(box);
    }, 10000);
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
      const dx = direction === "ArrowLeft" ? -1 : direction === "ArrowRight" ? 1 : 0;
      const dy = direction === "ArrowUp" ? -1 : direction === "ArrowDown" ? 1 : 0;
      const cx = rect.left + rect.width / 2, cy = rect.top + rect.height / 2;
      const nextControl = controls.filter(el => el !== focused).map(el => {
        const r = el.getBoundingClientRect(), x = r.left + r.width / 2, y = r.top + r.height / 2;
        const primary = dx ? (x - cx) * dx : (y - cy) * dy;
        const cross = dx ? Math.abs(y - cy) : Math.abs(x - cx);
        return {el, score:primary + cross * 1.5, primary};
      }).filter(item => item.primary > 4).sort((a,b) => a.score - b.score)[0]?.el;
      if (!nextControl && ((direction === "ArrowUp" && topRow) || (direction === "ArrowRight" && topRow))) { send("cinenova-player-subtitle-focus"); return; }
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
    const toggleVideoPlayback = () => {
      const video = doc.querySelector("video"); if (!video) return false;
      if (video.paused) video.play?.().catch?.(() => {}); else video.pause();
      return true;
    };
    let subtitlesEnabled = false;
    const toggleSubtitles = (enabled, language = "auto") => {
      let tracks = [];
      try { tracks = [...doc.querySelectorAll("video")].flatMap(video => Array.from(video.textTracks || []).map(track => ({video,track}))); } catch (_) { tracks = []; }
      if (tracks.length) {
        const preferred = language && language !== "auto"
          ? tracks.find(({track}) => (track.language || "").toLowerCase().startsWith(language.toLowerCase()))
          : tracks.find(({track}) => /^(es|spa|lat)(-|$)/i.test(track.language || "")) || tracks[0];
        tracks.forEach(item => { try { item.track.mode = enabled && item === preferred ? "showing" : "disabled"; } catch (_) {} });
      }
      if (!tracks.length) {
        const selector='[aria-label*="subt" i],[aria-label*="caption" i],[title*="subt" i],[title*="caption" i],.vjs-subs-caps-button,[class*="subtitle" i],[class*="caption" i]';
        const button=[...doc.querySelectorAll(selector)].find(el => el.getClientRects().length && !el.disabled);
        if (button && subtitlesEnabled !== enabled) button.click();
      }
      subtitlesEnabled = enabled;
      doc.querySelectorAll("iframe").forEach(frame => { try { frame.contentWindow?.postMessage({type:"cinenova-toggle-subtitles",enabled,language}, "*"); } catch (_) {} });
    };
    let hudTimer = 0, skipNextForwardedKey = null, lastBackPressAt = 0;
    const backKeys = ["Escape","Backspace","BrowserBack"];
    const requestPlayerBack = () => {
      const now = Date.now();
      if (now - lastBackPressAt <= 1400) { lastBackPressAt = 0; send("cinenova-exit-player"); }
      else { lastBackPressAt = now; send("cinenova-player-back-confirmation"); }
    };
    const hudSelector = 'header,nav,button,a,select,input,[role="button"],[role="menuitem"],[role="option"],[role="slider"],[role="tab"],[aria-label],[onclick],[tabindex],li,.item,[class*="control" i],[class*="menu" i],[class*="server" i],[class*="language" i],[class*="episode" i],[class*="toolbar" i],[class*="subtitle" i],[class*="progress" i],[class*="volume" i],[class*="seek" i],[class*="overlay" i],[class*="duration" i],[class*="timestamp" i],[id*="control" i],[id*="progress" i],[id*="volume" i],[id*="subtitle" i],[id*="time" i]';
    const collectHudControls = () => [...doc.querySelectorAll(hudSelector)].filter(el => {
      if (el.matches("html,body,iframe,video") || !el.getClientRects().length) return false;
      const style = doc.defaultView.getComputedStyle(el);
      if (style.display === "none" || style.visibility === "hidden") return false;
      return true;
    });
    const dispatchWake = target => {
      if (!target?.dispatchEvent) return;
      const rect = target.getBoundingClientRect?.() || {left:1,top:1,width:2,height:2};
      const init = {bubbles:true,cancelable:false,clientX:rect.left+Math.min(rect.width/2,4),clientY:rect.top+Math.min(rect.height/2,4)};
      try { target.dispatchEvent(new view.MouseEvent("mousemove",init)); } catch (_) {}
      try { if (view.PointerEvent) target.dispatchEvent(new view.PointerEvent("pointermove",init)); } catch (_) {}
    };
    const wakePlayerHud = () => {
      doc.documentElement.classList.remove("cn-hud-hidden");
      collectHudControls().forEach(el => el.setAttribute("data-cn-hud-control","1"));
      dispatchWake(doc);
      doc.querySelectorAll("video,iframe").forEach(frame => {
        dispatchWake(frame);
        try {
          const child = frame.contentDocument;
          if (child) { dispatchWake(child); child.querySelectorAll("video").forEach(dispatchWake); }
          else frame.contentWindow?.postMessage({type:"cinenova-show-controls"},"*");
        } catch (_) { frame.contentWindow?.postMessage({type:"cinenova-show-controls"},"*"); }
      });
      clearTimeout(hudTimer);
      hudTimer = setTimeout(() => {
        doc.documentElement.classList.add("cn-hud-hidden");
      },3500);
    };
    const arrows = ["ArrowLeft","ArrowRight","ArrowUp","ArrowDown"];
    view.addEventListener("keyup", event => { if (arrows.includes(event.key)) { event.preventDefault(); event.stopImmediatePropagation(); } }, true);
    view.addEventListener("keypress", event => { if (arrows.includes(event.key)) { event.preventDefault(); event.stopImmediatePropagation(); } }, true);
    view.addEventListener("keydown", event => {
      if (!backKeys.includes(event.key)) lastBackPressAt = 0;
      const hudWasHidden = doc.documentElement.classList.contains("cn-hud-hidden");
      wakePlayerHud();
      send("cinenova-player-activity");
      if (backKeys.includes(event.key)) { event.preventDefault(); event.stopImmediatePropagation(); requestPlayerBack(); return; }
      if (event.key === " " || event.key === "Space" || event.code === "Space") { event.preventDefault(); event.stopImmediatePropagation(); if (!toggleVideoPlayback()) activatePlayerControl(); return; }
      if (hudWasHidden) { event.preventDefault(); event.stopImmediatePropagation(); visibleControls()[0]?.focus({preventScroll:true}); return; }
      if (event.key === "Enter" && isSeekbar(doc.activeElement)) { event.preventDefault(); event.stopImmediatePropagation(); seekProgress(doc.activeElement,"Enter"); return; }
      if ((event.key === "ArrowLeft" || event.key === "ArrowRight") && isSeekbar(doc.activeElement)) { event.preventDefault(); event.stopImmediatePropagation(); seekProgress(doc.activeElement, event.key); return; }
      if (arrows.includes(event.key)) { event.preventDefault(); event.stopImmediatePropagation(); send("cinenova-player-activity"); movePlayerFocus(event.key); return; }
      if (event.key === "Enter") { event.preventDefault(); event.stopImmediatePropagation(); send("cinenova-player-activity"); activatePlayerControl(); }
      else if (event.key === "MediaPlayPause") { event.preventDefault(); event.stopImmediatePropagation(); send("cinenova-player-activity"); toggleVideoPlayback(); }
    }, true);
    ["pointermove","mousemove"].forEach(type => view.addEventListener(type, event => {
      if (!event.isTrusted) return;
      wakePlayerHud(); send("cinenova-player-activity");
    }, {passive:true}));
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
      if (event.source !== view.parent) {
        if (event.data?.type === "cinenova-player-time") sendData(event.data);
        else if (event.data?.type === "cinenova-subtitle-options") send("cinenova-subtitle-options");
        return;
      }
      if (event.data?.type === "cinenova-player-context") {
        doc.querySelectorAll("iframe").forEach(frame=>{try{frame.contentWindow?.postMessage(event.data,"*");}catch(_){}}); return;
      }
      if (event.data?.type === "cinenova-toggle-subtitles") { toggleSubtitles(Boolean(event.data.enabled), event.data.language || "auto"); return; }
      if (event.data?.type === "cinenova-show-controls") {
        const hudWasHidden = doc.documentElement.classList.contains("cn-hud-hidden");
        wakePlayerHud();
        if (hudWasHidden) {
          visibleControls()[0]?.focus({preventScroll:true});
          if (typeof event.data.key === "string" && event.data.key !== " " && event.data.key !== "Space") skipNextForwardedKey = event.data.key;
        }
        return;
      }
      if (["cinenova-player-focus", "cinenova-player-autoplay"].includes(event.data?.type)) {
        const play = doc.querySelector('#pbtn,.pbtn,.play-overlay,[class*="play-overlay" i],[aria-label*="play" i],[title*="play" i],video');
        if (play && play.tagName !== "VIDEO") { play.focus?.({preventScroll:true}); if (event.data.type === "cinenova-player-autoplay") play.click?.(); }
        else if (play?.tagName === "VIDEO") { if (event.data.type === "cinenova-player-autoplay") play.play?.().catch?.(() => {}); doc.body.tabIndex = -1; doc.body.focus({preventScroll:true}); }
        return;
      }
      if (event.data?.type !== "cinenova-player-key") return;
      const key=event.data.key;
      if (!backKeys.includes(key)) lastBackPressAt = 0;
      if (skipNextForwardedKey === key) { skipNextForwardedKey = null; return; }
      const hudWasHidden = doc.documentElement.classList.contains("cn-hud-hidden");
      wakePlayerHud();
      if (backKeys.includes(key)) { requestPlayerBack(); return; }
      if (key === " " || key === "Space") { if (!toggleVideoPlayback()) activatePlayerControl(); return; }
      if (hudWasHidden) { visibleControls()[0]?.focus({preventScroll:true}); return; }
      if (key === "Enter" && isSeekbar(doc.activeElement)) { seekProgress(doc.activeElement,"Enter"); return; }
      if (!["ArrowLeft","ArrowRight","ArrowUp","ArrowDown","Enter"," ","MediaPlayPause"].includes(key)) return;
      if ((key === "ArrowLeft" || key === "ArrowRight") && isSeekbar(doc.activeElement)) { seekProgress(doc.activeElement, key); return; }
      if (arrows.includes(key)) { movePlayerFocus(key); return; }
      activatePlayerControl();
    });
  };
  install(document);
  wakePlayerHud();
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
                    text = re.sub(r"(?P<q>[\"'`])(?P<slash>\\?)/(?!/|unlimplay/)(?=[A-Za-z0-9_.-])",
                                  lambda m: m.group("q") + m.group("slash") + "/unlimplay/", text)
                    text = re.sub(r"(?P<prefix>\burl\(\s*)(?P<q>[\"'`]?)(?P<slash>\\?)/(?!/|unlimplay/)(?=[A-Za-z0-9_.-])",
                                  lambda m: m.group("prefix") + m.group("q") + m.group("slash") + "/unlimplay/", text, flags=re.I)
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
