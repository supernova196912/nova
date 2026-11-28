"use strict";
const CONFIG = { LANG: "es-MX", REGION: "AR" };

const IMG = "https://image.tmdb.org/t/p/";
const REGIONS = {AR:"Argentina",MX:"México",ES:"España",CL:"Chile",CO:"Colombia",PE:"Perú",UY:"Uruguay",PY:"Paraguay",VE:"Venezuela",EC:"Ecuador",US:"Estados Unidos"};
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const store = {
  get(k, d){ try{ const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); }catch(e){ return d; } },
  set(k, v){ try{ localStorage.setItem(k, JSON.stringify(v)); }catch(e){} }
};
let API_BASE_URL = location.origin;
const VIDEO_GATEWAY_DEFAULT = "https://vg-core.novapelis.workers.dev";
const GATEWAY_URL_KEY = "cinenova_video_gateway_url";
const REMOTE_GATEWAY_CONFIG_KEY = "cinenova_remote_config_url";
let VIDEO_GATEWAY_URL = VIDEO_GATEWAY_DEFAULT;
let REGION = CONFIG.REGION;
const GENRES = { movie:{}, tv:{} };
const ITEMS = new Map();          // datos mínimos para "Mi lista"
const cleanup = [];
let routeToken = 0;
let episodeRequestToken = 0;
const VAULT_MIN_FREE_BYTES = 2500000000;
const GATE_DEVICE_ID_KEY = "cinenova_gate_device_id";
const RENEW_OFFLINE_MESSAGE = "Conéctate a internet unos segundos para ver 1 anuncio y habilitar la película por 24 horas más";
let offlineDownloads = [];
let releaseGateBusy = false;
let downloadTicker = 0;
const app = $("#app");
const KIDS_MODE_KEY = "cinenova-kids-mode";
const KIDS_PIN_KEY = "cinenova-parent-pin";
const KIDS_MOVIE_GENRES = "16,10751";
const KIDS_TV_GENRES = "16,10762";
const KIDS_EXCLUDED_GENRES = "27,80,53,10752";
let kidsModeEnabled = store.get(KIDS_MODE_KEY, false) === true;
let currentDetailContext = null;
let currentEpisodeCount = 1;
function setSeo(title, description, path = "/", schema = null, robots = "index, follow") {
  document.title = title;
  const desc = $("meta[name='description']"); if (desc) desc.content = description.slice(0, 300);
  const robot = $("meta[name='robots']"); if (robot) robot.content = robots;
  const canonical = $("link[rel='canonical']"); if (canonical) canonical.href = new URL(path, location.origin).href;
  const ogTitle = $("meta[property='og:title']"); if (ogTitle) ogTitle.content = title;
  const ogDesc = $("meta[property='og:description']"); if (ogDesc) ogDesc.content = description.slice(0, 300);
  const ld = $("#structuredData"); if (ld) ld.textContent = JSON.stringify(schema || {"@context":"https://schema.org","@type":"WebSite",name:"CINENOVA",url:location.origin,description, potentialAction:{"@type":"SearchAction",target:location.origin+"/#/buscar?q={search_term_string}","query-input":"required name=search_term_string"}});
}
let isTvMode = false;
let nativeDpadTvMode = false;
let lastPlaybackTrigger = null;
let suppressPlayerNativeFullscreenExit = false;
let lastPlayerBackTime = 0;
let playerHudTimer = 0;
let subtitlesEnabled = false;
let currentPlayerContext = null;
const playerDebugErrors = [];
window.addEventListener("error", e => { playerDebugErrors.push(String(e.message || e.error || "Error de script")); }, true);
window.addEventListener("unhandledrejection", e => { playerDebugErrors.push(String(e.reason?.message || e.reason || "Promesa rechazada")); }, true);
function isNativeApp(){
  return Boolean((window.Capacitor && window.Capacitor.isNativePlatform?.())
    || (location.hostname === "localhost" && /Android/i.test(navigator.userAgent || "")));
}
function canUseOfflineDownloads(){ return isNativeApp() && !isTvMode && Boolean(window.CinenovaVault?.isMobileDownloadsSupported?.()); }
function updateDeviceMode(){
  const ua = navigator.userAgent || "";
  const nativeApp = isNativeApp();
  const tvUa = /Android TV|SmartTV|BRAVIA|AFT|Chromecast|GoogleTV|HbbTV/i.test(ua);
  let nativeTv = false;
  try { nativeTv = window.CinenovaTvRemote?.isTelevisionDevice?.() === true; } catch(e) {}
  const forced = new URLSearchParams(location.search).get("tv") === "1";
  const coarseLarge = matchMedia("(min-width: 1024px) and (pointer: coarse)").matches;
  isTvMode = forced || tvUa || coarseLarge || nativeTv || (nativeApp && nativeDpadTvMode);
  document.body.classList.toggle("native-app", nativeApp);
  document.body.classList.toggle("tv-mode", isTvMode);
  document.body.classList.toggle("kids-mode", kidsModeEnabled);
  const badge = $("#kidsBadge"); if (badge) badge.hidden = !kidsModeEnabled;
  const downloadsTab = $('[data-r="descargas"]');
  const offlineReady = canUseOfflineDownloads();
  if (downloadsTab){ downloadsTab.hidden = !offlineReady; downloadsTab.style.display = offlineReady ? "" : "none"; }
  updateDownloadBadge();
}
function activateNativeTvMode(){
  if (!isNativeApp()) return false;
  nativeDpadTvMode = true;
  updateDeviceMode();
  document.body.classList.add("tv-mode");
  const player = $(".player-frame.player-fullscreen"), frame = player?.querySelector("iframe");
  if (player && frame) { createPlayerHud(player, frame); showPlayerHud(); }
  return true;
}
updateDeviceMode();
window.addEventListener("resize", updateDeviceMode, {passive:true});
window.addEventListener("orientationchange", updateDeviceMode, {passive:true});
$("#tvCollapse").onclick = () => {
  const collapsed = document.body.classList.toggle("tv-sidebar-collapsed");
  $("#tvCollapse").textContent = collapsed ? "›" : "‹";
  $("#tvCollapse").setAttribute("aria-label", collapsed ? "Expandir menú" : "Contraer menú");
};

/* ===== API ===== */
const cache = new Map();
function kidsApiParams(path, params){
  if (!kidsModeEnabled) return params;
  const out = {...params, include_adult:false};
  const listPath = /\/discover\/|\/trending\/|\/search\/|\/movie\/(popular|top_rated|now_playing|upcoming)|\/tv\/(popular|top_rated|on_the_air|airing_today)/.test(path);
  if (listPath){
    out.with_genres = /^\/(tv|discover\/tv|trending\/tv|search\/tv)(\/|$)/.test(path) ? KIDS_TV_GENRES : KIDS_MOVIE_GENRES;
    out.without_genres = KIDS_EXCLUDED_GENRES;
  }
  return out;
}
function api(path, params = {}){
  const u = new URL(API_BASE_URL.replace(/\/$/, "") + "/api/tmdb" + path);
  u.searchParams.set("language", CONFIG.LANG);
  for (const [k, v] of Object.entries(kidsApiParams(path, params))) if (v !== undefined && v !== null && v !== "") u.searchParams.set(k, v);
  const ck = u.toString();
  if (cache.has(ck)) return cache.get(ck);
  const p = fetch(u, { headers: { accept: "application/json" } })
    .then(async r => {
      if (!r.ok) throw new Error("HTTP " + r.status);
      return r.json();
    })
    .catch(e => { cache.delete(ck); throw e; });
  cache.set(ck, p);
  return p;
}
function unlimplayUrl(path){ return API_BASE_URL.replace(/\/$/, "") + "/unlimplay/" + path; }
function normalizeGatewayUrl(value){
  const text = String(value ?? "").trim().replace(/^["']|["']$/g, "").replace(/\/+$/, "");
  return /^https?:\/\/\S+$/i.test(text) ? text : "";
}
function gatewayUrlOverride(){
  try { return normalizeGatewayUrl(localStorage.getItem(GATEWAY_URL_KEY)); } catch(e) { return ""; }
}
function gatewayEmbedSrc(type, id, season, episode){
  const base = VIDEO_GATEWAY_URL.replace(/\/+$/, "");
  if (!base) return "";
  const path = type === "tv" ? `/embed/tv/${id}/${season}/${episode}` : `/embed/movie/${id}`;
  const u = new URL(base + path, location.href);
  if (isTvMode) u.searchParams.set("cn_tv", "1");
  return u.href;
}
async function applyGatewayConfig(data = {}){
  VIDEO_GATEWAY_URL = normalizeGatewayUrl(data.videoGatewayUrl ?? VIDEO_GATEWAY_DEFAULT);
  const override = gatewayUrlOverride(); if (override) VIDEO_GATEWAY_URL = override;
  let remoteUrl = normalizeGatewayUrl(data.remoteConfigUrl || data.videoGatewayConfigUrl);
  if (!remoteUrl){ try { remoteUrl = normalizeGatewayUrl(localStorage.getItem(REMOTE_GATEWAY_CONFIG_KEY)); } catch(e) {} }
  if (remoteUrl){
    try{
      const r = await fetch(remoteUrl, {headers:{accept:"application/json"}});
      if (r.ok){
        const remote = await r.json();
        const fromRemote = normalizeGatewayUrl(remote.videoGatewayUrl ?? remote.video_gateway_url ?? remote.gatewayUrl);
        if (fromRemote) VIDEO_GATEWAY_URL = fromRemote;
      }
    }catch(e){}
  }
  const finalOverride = gatewayUrlOverride(); if (finalOverride) VIDEO_GATEWAY_URL = finalOverride;
}

/* ===== BÓVEDA OFFLINE (SOLO ANDROID MÓVIL) ===== */
function vaultCall(name, ...args){
  try { return window.CinenovaVault?.[name]?.(...args) ?? ""; } catch(e) { return ""; }
}
function vaultJson(raw, fallback){
  try { const parsed = JSON.parse(raw || ""); return parsed ?? fallback; } catch(e) { return fallback; }
}
function vaultResult(raw){
  const data = vaultJson(raw, {});
  return data && typeof data === "object" ? data : {};
}
function loadOfflineDownloads(){
  if (!canUseOfflineDownloads()){ offlineDownloads = []; updateDownloadBadge(); return; }
  const parsed = vaultJson(vaultCall("listDownloads"), []);
  offlineDownloads = Array.isArray(parsed) ? parsed : [];
  updateDownloadBadge();
  updateDownloadButtons();
}
function refreshDownloads(){
  if (canUseOfflineDownloads() && (parseHash().parts[0] || "") === "descargas") renderDownloads();
  else loadOfflineDownloads();
}
function fmtDownloadBytes(value){
  const bytes = Math.max(0, Number(value) || 0);
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
  if (bytes >= 1024 ** 2) return `${Math.max(1, Math.round(bytes / 1024 ** 2))} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${Math.round(bytes)} B`;
}
function fmtStorageGb(value){ return `${((Number(value) || 0) / 1000000000).toFixed(1)} GB`; }
function remainingText(expiresAt){
  const left = (Number(expiresAt) || 0) - Date.now();
  if (left <= 0) return "Disponible por 0h 0m";
  const hours = Math.floor(left / 3600000);
  const minutes = Math.floor((left % 3600000) / 60000);
  return `Disponible por ${hours}h ${minutes}m`;
}
function downloadErrorText(reason){
  const text = String(reason || "");
  const known = {
    stream_unavailable:"No se pudo obtener el video",
    source_write_failed:"No se pudo guardar el video",
    source_unavailable:"No se pudo reanudar",
    insufficient_storage:"Espacio insuficiente",
    invalid_metadata:"Datos inválidos",
    duplicate:"Ya existe esta descarga"
  };
  return known[text] || (text ? text.slice(0, 80) : "Falló la descarga");
}
function sameOfflineItem(a, b){
  if (!a || !b) return false;
  if (Number(a.tmdbId) !== Number(b.tmdbId)) return false;
  const mediaType = (a.mediaType === "tv" || b.mediaType === "tv") ? "tv" : "movie";
  if ((a.mediaType || mediaType) !== mediaType || (b.mediaType || mediaType) !== mediaType) return false;
  if (mediaType === "tv") return Number(a.season) === Number(b.season) && Number(a.episode) === Number(b.episode);
  return true;
}
function findOfflineDownload(meta){ return offlineDownloads.find(item => sameOfflineItem(item, meta)) || null; }
function offlineMetaFromElement(el){
  return {
    itemId: el.dataset.itemId || "",
    tmdbId: Number(el.dataset.tmdbId) || 0,
    mediaType: el.dataset.mediaType === "tv" ? "tv" : "movie",
    season: Number(el.dataset.season) || 0,
    episode: Number(el.dataset.episode) || 0,
    title: el.dataset.title || "",
    posterPath: el.dataset.posterPath || ""
  };
}
function offlineMetaFromItem(item){
  return {
    itemId: item.itemId || "", tmdbId: item.tmdbId, mediaType: item.mediaType,
    season: item.season, episode: item.episode, title: item.title, posterPath: item.posterPath
  };
}
function gateDeviceId(){
  let id = "";
  try { id = String(localStorage.getItem(GATE_DEVICE_ID_KEY) || "").trim(); } catch(e) {}
  if (!id){
    try { id = window.crypto?.randomUUID?.() || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`; } catch(e) { id = `${Date.now()}-${Math.random()}`; }
    try { localStorage.setItem(GATE_DEVICE_ID_KEY, id); } catch(e) {}
  }
  return id;
}
function gateSafeUrl(value){
  const url = String(value || "").trim();
  return /^https?:\/\//i.test(url) ? url : "";
}
function gateFirePixels(urls, fired){
  (Array.isArray(urls) ? urls : []).forEach(value => {
    const url = String(value || "");
    if (!url || fired[url]) return;
    fired[url] = true;
    try {
      const pending = fetch(url, { mode: "no-cors", keepalive: true });
      if (pending && pending.catch) pending.catch(() => { try { new Image().src = url; } catch(e) {} });
    } catch(e) {
      try { new Image().src = url; } catch(e2) {}
    }
  });
}
async function postGate(path, payload){
  const base = VIDEO_GATEWAY_URL.replace(/\/+$/, "");
  const response = await fetch(base + path, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify(payload)
  });
  let data = {};
  try { data = await response.json(); } catch(e) {}
  if (!response.ok || data.ok === false){ const error = new Error(data.error || `HTTP ${response.status}`); error.data = data; error.status = response.status; throw error; }
  return data;
}
function gateBody(action, item){
  const body = {
    action,
    tmdbId: Number(item.tmdbId) || 0,
    mediaType: item.mediaType === "tv" ? "tv" : "movie",
    deviceId: gateDeviceId()
  };
  if (body.mediaType === "tv"){
    if (Number(item.season) > 0) body.season = Number(item.season);
    if (Number(item.episode) > 0) body.episode = Number(item.episode);
  }
  return body;
}
function updateDownloadBadge(){
  const tab = $('[data-r="descargas"]');
  const badge = tab && $(".download-count", tab);
  if (!badge) return;
  const count = offlineDownloads.filter(item => ["downloading", "paused", "ready"].includes(item.status)).length;
  badge.textContent = String(count);
  badge.hidden = count <= 0;
}
function offlineButtonLabel(record){
  if (!record) return "⬇ Descargar";
  if (record.status === "downloading" || record.status === "paused") return `Descargando ${Math.max(0, Math.min(100, Number(record.progress) || 0))}%`;
  return "✓ En Descargas";
}
function offlineDownloadButton(meta){
  const record = findOfflineDownload(meta);
  const state = !record ? "new" : (["downloading", "paused"].includes(record.status) ? "active" : "saved");
  return `<button type="button" class="btn ghost offline-download-btn" data-offline-download-btn data-state="${state}" data-act="${record ? "open-downloads" : "offline-download"}" data-item-id="${esc(record?.itemId || "")}" data-tmdb-id="${esc(meta.tmdbId)}" data-media-type="${esc(meta.mediaType)}" data-season="${esc(meta.season || 0)}" data-episode="${esc(meta.episode || 0)}" data-title="${esc(meta.title || "")}" data-poster-path="${esc(meta.posterPath || "")}">${offlineButtonLabel(record)}</button>`;
}
function updateDownloadButtons(){
  $$("[data-offline-download-btn]").forEach(button => {
    const record = findOfflineDownload(offlineMetaFromElement(button));
    button.dataset.itemId = record?.itemId || "";
    button.dataset.state = !record ? "new" : (["downloading", "paused"].includes(record.status) ? "active" : "saved");
    button.dataset.act = record ? "open-downloads" : "offline-download";
    button.textContent = offlineButtonLabel(record);
  });
}
async function startOfflineDownload(meta){
  if (!canUseOfflineDownloads()) return;
  if (releaseGateBusy) return toast("Hay una operación en curso.");
  const tmdbId = Number(meta.tmdbId) || 0;
  if (!tmdbId) return toast("No se pudo identificar este título.");
  const storage = vaultJson(vaultCall("getStorageInfo"), {});
  if ((Number(storage.freeBytes) || 0) < VAULT_MIN_FREE_BYTES) return toast("Espacio insuficiente en el dispositivo (se requieren al menos 2.5 GB libres)");
  const mediaType = meta.mediaType === "tv" ? "tv" : "movie";
  const season = Number(meta.season) || 0;
  const episode = Number(meta.episode) || 0;
  const embedUrl = gatewayEmbedSrc(mediaType, tmdbId, season, episode);
  if (!embedUrl) return toast("No se pudo preparar la descarga.");
  await runReleaseGate("download", meta, async (releaseToken) => {
    const deviceId = gateDeviceId();
    const separator = embedUrl.includes("?") ? "&" : "?";
    const downloadUrl = `${embedUrl}${separator}rt=${encodeURIComponent(releaseToken)}&deviceId=${encodeURIComponent(deviceId)}`;
    const payload = {
      itemId: meta.itemId || "", tmdbId, mediaType, season, episode,
      title: String(meta.title || ""), posterPath: String(meta.posterPath || "")
    };
    const result = vaultResult(vaultCall("startDownload", JSON.stringify(payload), downloadUrl));
    if (!result.ok){
      toast(result.reason === "duplicate" ? "Este título ya está en Descargas"
        : result.reason === "insufficient_storage" ? "Espacio insuficiente en el dispositivo (se requieren al menos 2.5 GB libres)"
        : "No se pudo iniciar la descarga.");
      return false;
    }
    toast("Descarga iniciada en segundo plano");
    refreshDownloads();
    return true;
  });
}
async function runReleaseGate(action, item, onRelease, failureMessage){
  if (releaseGateBusy) return false;
  releaseGateBusy = true;
  let start;
  try { start = await postGate("/v1/stream/gate/start", gateBody(action, item)); }
  catch(e){ releaseGateBusy = false; toast(failureMessage || "No se pudo iniciar la compuerta. Intentá de nuevo."); return false; }
  return new Promise(resolve => {
    let currentStep = Number(start.currentStep) || 1;
    let totalSteps = Math.max(1, Number(start.totalSteps) || 1);
    let clip = start.clip || {};
    let activeClip = {};
    let firedImpressions = {};
    let firedClicks = {};
    let seconds = Math.max(1, Number(start.skipAfterSeconds) || 5);
    let timer = 0, ready = false, ended = false, advancing = false, settled = false;
    openModal(`<section class="release-gate-modal">
      <h2>${action === "renew" ? "Renovar disponibilidad" : "Preparar descarga"}</h2>
      <p class="muted">Mirá ${action === "renew" ? "1 video" : "los 2 videos"} para continuar.</p>
      <div class="release-stage"><video id="gateVideo" autoplay playsinline title="Abrir enlace del patrocinador" style="cursor:pointer"></video>
        <div class="release-info"><span id="gateStepLabel">Anuncio 1 de ${totalSteps}</span><span id="gateCountdown">${seconds}s</span></div>
      </div>
      <a id="gateClick" class="btn ghost" href="#" target="_blank" rel="noopener noreferrer" hidden>Visitar anunciante</a>
      <button id="gateSkip" class="btn primary" type="button" disabled>Saltar anuncio en ${seconds}s</button>
    </section>`, "release-gate-modal", true);
    const label = $("#gateStepLabel"), counter = $("#gateCountdown"), skip = $("#gateSkip"), video = $("#gateVideo"), clickLink = $("#gateClick");
    const stopTimer = () => { if (timer){ clearInterval(timer); timer = 0; } };
    const settle = async (ok, message) => {
      if (settled) return;
      settled = true; stopTimer(); video.onplaying = null;
      releaseGateBusy = false; modalLocked = false; closeModal();
      if (message) toast(message);
      resolve(Boolean(ok));
    };
    const openClip = () => {
      const destination = gateSafeUrl(activeClip.clickUrl);
      if (!destination) return;
      gateFirePixels(activeClip.clickTrackingUrls, firedClicks);
      try {
        const opened = window.open(destination, "_blank", "noopener,noreferrer");
        if (!opened) location.href = destination;
      } catch(e) { try { location.href = destination; } catch(e2) {} }
    };
    video.addEventListener("click", openClip);
    clickLink.addEventListener("click", event => { event.preventDefault(); openClip(); });
    const advance = async () => {
      if (advancing || !ready || settled) return;
      advancing = true; stopTimer(); skip.disabled = true;
      try {
        const next = await postGate("/v1/stream/gate/next", { sessionId: start.sessionId, stepCompleted: currentStep });
        if (next.completed){
          let ok = false;
          try { ok = Boolean(await onRelease(next.releaseToken)); } catch(e) { ok = false; }
          await settle(ok);
          return;
        }
        currentStep = Number(next.currentStep) || currentStep + 1;
        totalSteps = Math.max(1, Number(next.totalSteps) || totalSteps);
        clip = next.clip || {};
        seconds = Math.max(1, Number(next.skipAfterSeconds) || seconds);
        ready = false; ended = false; advancing = false;
        showStep();
      } catch(e){
        await settle(false, failureMessage || "No se pudo completar la compuerta. Intentá de nuevo.");
      }
    };
    const showStep = () => {
      label.textContent = `Anuncio ${currentStep} de ${totalSteps}`;
      counter.textContent = `${seconds}s`;
      skip.textContent = `Saltar anuncio en ${seconds}s`;
      skip.disabled = true;
      activeClip = clip || {};
      firedImpressions = {};
      firedClicks = {};
      const destination = gateSafeUrl(activeClip.clickUrl);
      if (destination){
        clickLink.href = destination;
        clickLink.hidden = false;
      } else {
        clickLink.removeAttribute("href");
        clickLink.hidden = true;
      }
      video.onplaying = () => gateFirePixels(activeClip.impressionUrls, firedImpressions);
      video.src = String(activeClip.url || "");
      try { video.play?.().catch?.(() => {}); } catch(e) {}
      let remaining = seconds;
      stopTimer();
      timer = setInterval(() => {
        remaining -= 1;
        if (remaining > 0){ counter.textContent = `${remaining}s`; skip.textContent = `Saltar anuncio en ${remaining}s`; return; }
        stopTimer(); ready = true; counter.textContent = "0s"; skip.textContent = "Saltar anuncio"; skip.disabled = false;
        if (ended) advance();
      }, 1000);
    };
    skip.addEventListener("click", advance);
    video.addEventListener("ended", () => { ended = true; if (ready) advance(); });
    video.addEventListener("error", () => { ended = true; if (ready) advance(); });
    showStep();
  });
}
async function renewExpiredItem(item){
  if (!canUseOfflineDownloads()) return;
  if (navigator.onLine === false) return toast(RENEW_OFFLINE_MESSAGE);
  await runReleaseGate("renew", item, async () => {
    const result = vaultResult(vaultCall("renewDownload", item.itemId));
    if (!result.ok){ toast("No se pudo renovar la descarga."); return false; }
    toast("Disponible por 24 horas más");
    refreshDownloads();
    return true;
  }, RENEW_OFFLINE_MESSAGE);
}
async function retryDownload(item){
  if (!canUseOfflineDownloads()) return;
  const resumed = vaultResult(vaultCall("resumeDownload", item.itemId));
  if (resumed.ok){ toast("Descarga reanudada"); refreshDownloads(); return; }
  vaultCall("deleteDownload", item.itemId);
  toast("Reintentando descarga");
  startOfflineDownload(offlineMetaFromItem(item));
}
function playOfflineDownload(item){
  if (!canUseOfflineDownloads() || !item) return;
  const url = vaultCall("getPlaybackUrl", item.itemId);
  if (!url){ refreshDownloads(); toast("Esta descarga venció. Renovala para seguir viéndola."); return; }
  window.cinenovaExitPlayerFullscreen?.();
  const player = document.createElement("div");
  player.className = "player-frame player-fullscreen app-player-overlay offline-player-overlay";
  player.dataset.title = String(item.title || "");
  const video = document.createElement("video");
  video.controls = true; video.autoplay = true; video.playsInline = true; video.tabIndex = 0;
  video.setAttribute("playsinline", ""); video.preload = "auto"; video.src = String(url);
  const hud = document.createElement("div"); hud.className = "player-hud visible";
  const exit = document.createElement("button");
  exit.type = "button"; exit.className = "player-exit-btn"; exit.textContent = "← Salir";
  exit.setAttribute("aria-label", "Salir del reproductor");
  exit.addEventListener("click", exitPlayerFullscreen);
  hud.append(exit); player.append(video, hud); document.body.append(player);
  window.CinenovaTvRemote?.setPlayerFullscreen(true);
  try { video.play?.().catch?.(() => {}); } catch(e) {}
  requestAnimationFrame(() => video.focus({preventScroll:true}));
}
function downloadCardHTML(item){
  const status = ["downloading", "paused", "ready", "expired", "error"].includes(item.status) ? item.status : "error";
  const active = status === "downloading" || status === "paused";
  const title = String(item.title || "Descarga");
  const poster = item.posterPath
    ? `<img loading="lazy" src="${img(item.posterPath, "w342")}" alt="">`
    : `<div class="noimg">${esc(title)}</div>`;
  const subtitle = item.mediaType === "tv" ? `T${Number(item.season) || 1} · E${Number(item.episode) || 1}` : "Película";
  const progress = Math.max(0, Math.min(100, Number(item.progress) || 0));
  const reasonText = esc(downloadErrorText(item.errorReason));
  const reasonHTML = item.errorReason ? `<span class="download-error">${reasonText}</span>` : "";
  let stateHTML = "", controlsHTML = "";
  if (active){
    stateHTML = `<div class="download-progress"><div class="download-bar"><i style="width:${progress}%"></i></div><span class="download-progress-text"><b data-dl-progress>${progress}%</b> · <span data-dl-bytes>${fmtDownloadBytes(item.bytesDownloaded)} / ${fmtDownloadBytes(item.totalBytes)}</span></span></div>${status === "paused" ? reasonHTML : ""}`;
    controlsHTML = `<button class="btn ghost" data-vault="${status === "paused" ? "resume" : "pause"}" data-item-id="${esc(item.itemId)}" type="button">${status === "paused" ? "Reanudar" : "Pausar"}</button>
      <button class="btn ghost download-remove" data-vault="delete" data-item-id="${esc(item.itemId)}" type="button">✕ Cancelar y borrar</button>`;
  } else if (status === "ready"){
    stateHTML = `<span class="download-state dl-ready">Lista para ver</span><span class="download-time" data-dl-time>${remainingText(item.expiresAt)}</span>`;
    controlsHTML = `<button class="btn primary" data-vault="watch" data-item-id="${esc(item.itemId)}" type="button">▶ Ver ahora</button>
      <button class="btn ghost download-remove" data-vault="delete" data-item-id="${esc(item.itemId)}" type="button">🗑 Borrar</button>`;
  } else if (status === "expired"){
    stateHTML = `<span class="download-state dl-expired">Vencida (24h cumplidas)</span>`;
    controlsHTML = `<button class="btn primary" data-vault="renew" data-item-id="${esc(item.itemId)}" type="button">↻ Renovar (1 anuncio)</button>
      <button class="btn ghost download-remove" data-vault="delete" data-item-id="${esc(item.itemId)}" type="button">🗑 Borrar</button>`;
  } else {
    stateHTML = `<span class="download-state dl-error">Error</span><span class="download-error">${reasonText}</span>`;
    controlsHTML = `<button class="btn primary" data-vault="retry" data-item-id="${esc(item.itemId)}" type="button">↻ Reintentar</button>
      <button class="btn ghost download-remove" data-vault="delete" data-item-id="${esc(item.itemId)}" type="button">🗑 Borrar</button>`;
  }
  return `<article class="download-card" data-download-item="${esc(item.itemId)}" data-status="${status}">
    <div class="download-poster">${poster}</div>
    <div class="download-info"><h3>${esc(title)}</h3><p class="muted">${esc(subtitle)} · ${fmtDownloadBytes(item.totalBytes)}</p>
      <div class="download-state-line" data-dl-state>${active ? (status === "paused" ? "Pausada" : "Descargando") : ""}</div>
      ${stateHTML}<div class="download-controls">${controlsHTML}</div>
    </div>
  </article>`;
}
function renderDownloads(){
  if (!canUseOfflineDownloads()) return notFound();
  loadOfflineDownloads();
  clearInterval(downloadTicker); downloadTicker = 0;
  const storage = vaultJson(vaultCall("getStorageInfo"), {});
  const expiredCount = offlineDownloads.filter(item => item.status === "expired").length;
  app.innerHTML = `<div class="page downloads-page">
    <div class="downloads-head"><div><h1>Descargas</h1><p class="muted">${fmtStorageGb(storage.vaultUsedBytes)} usados · ${fmtStorageGb(storage.freeBytes)} libres</p></div>
      <div class="downloads-head-actions">
        ${expiredCount ? '<button class="btn ghost" data-vault="delete-expired" type="button">Borrar vencidas</button>' : ""}
        ${offlineDownloads.length ? '<button class="btn ghost download-remove" data-vault="clear-all" type="button">Vaciar todo</button>' : ""}
      </div>
    </div>
    ${offlineDownloads.length ? `<div class="download-list">${offlineDownloads.map(downloadCardHTML).join("")}</div>` : '<p class="muted">Todavía no descargaste nada. Usá «⬇ Descargar» en una película o episodio.</p>'}
  </div>`;
  downloadTicker = setInterval(() => {
    if ((parseHash().parts[0] || "") !== "descargas") return;
    $$("[data-dl-time]").forEach(node => {
      const row = node.closest("[data-download-item]");
      const item = offlineDownloads.find(x => x.itemId === row?.dataset.downloadItem);
      if (item) node.textContent = remainingText(item.expiresAt);
    });
  }, 60000);
  cleanup.push(() => clearInterval(downloadTicker));
}
function downloadsView(){
  setSeo("Descargas — CINENOVA", "Gestiona tus descargas offline protegidas.", "/descargas", null, "noindex, follow");
  renderDownloads();
}
function updateDownloadView(info){
  if (!info?.itemId || (parseHash().parts[0] || "") !== "descargas") return;
  const row = $$("[data-download-item]").find(node => node.dataset.downloadItem === info.itemId);
  if (!row || row.dataset.status !== info.status){ renderDownloads(); return; }
  const progress = Math.max(0, Math.min(100, Number(info.progress) || 0));
  const bar = $(".download-bar i", row); if (bar) bar.style.width = `${progress}%`;
  const label = $("[data-dl-progress]", row); if (label) label.textContent = `${progress}%`;
  const bytes = $("[data-dl-bytes]", row); if (bytes) bytes.textContent = `${fmtDownloadBytes(info.bytesDownloaded)} / ${fmtDownloadBytes(info.totalBytes)}`;
  const time = $("[data-dl-time]", row); if (time) time.textContent = remainingText(info.expiresAt);
  const state = $("[data-dl-state]", row); if (state) state.textContent = info.status === "paused" ? "Pausada" : info.status === "downloading" ? "Descargando" : "";
}
function handleVaultAction(button){
  if (!canUseOfflineDownloads()) return;
  const action = button.dataset.vault, itemId = button.dataset.itemId || "";
  const item = offlineDownloads.find(entry => entry.itemId === itemId);
  if (action === "delete"){
    if (!window.confirm("¿Eliminar esta descarga y liberar espacio?")) return;
    vaultCall("deleteDownload", itemId); toast("Descarga eliminada"); refreshDownloads(); return;
  }
  if (action === "clear-all"){
    if (!window.confirm("¿Eliminar esta descarga y liberar espacio?")) return;
    vaultCall("deleteAllDownloads"); toast("Descargas eliminadas"); refreshDownloads(); return;
  }
  if (action === "delete-expired"){
    vaultCall("deleteExpiredDownloads"); toast("Vencidas eliminadas"); refreshDownloads(); return;
  }
  if (action === "pause"){ vaultCall("pauseDownload", itemId); toast("Descarga pausada"); refreshDownloads(); return; }
  if (action === "resume"){ vaultCall("resumeDownload", itemId); toast("Descarga reanudada"); refreshDownloads(); return; }
  if (action === "watch"){ playOfflineDownload(item); return; }
  if (action === "renew"){ renewExpiredItem(item); return; }
  if (action === "retry"){ retryDownload(item); }
}
window.addEventListener("cinenova-download-progress", event => {
  if (!canUseOfflineDownloads() || !event.detail?.itemId) return;
  const info = event.detail;
  const at = offlineDownloads.findIndex(item => item.itemId === info.itemId);
  if (at >= 0) offlineDownloads[at] = {...offlineDownloads[at], ...info};
  else offlineDownloads.push({...info});
  updateDownloadBadge(); updateDownloadButtons(); updateDownloadView(info);
});
window.addEventListener("cinenova-download-deleted", event => {
  const id = event.detail?.itemId;
  if (!id) return;
  offlineDownloads = offlineDownloads.filter(item => item.itemId !== id);
  updateDownloadBadge(); updateDownloadButtons(); refreshDownloads();
});
async function loadGenres(){
  const [m, t] = await Promise.all([api("/genre/movie/list"), api("/genre/tv/list")]);
  m.genres.forEach(g => GENRES.movie[g.id] = g.name);
  t.genres.forEach(g => GENRES.tv[g.id] = g.name);
}

/* ===== HELPERS ===== */
const titleOf = it => it.title || it.name || "";
const year = it => (it.release_date || it.first_air_date || "").slice(0, 4);
const typeOf = (it, t) => it.media_type || t;
const score = v => v ? Number(v).toFixed(1) : "N/A";
const img = (p, s) => p ? IMG + s + p : "";
const typeName = t => t === "tv" ? "Serie" : "Película";
function fmtDate(s){ if (!s) return "—"; try{ return new Date(s + "T00:00:00").toLocaleDateString("es-AR", {day:"numeric", month:"long", year:"numeric"}); }catch(e){ return s; } }
function fmtRuntime(m){ if (!m) return ""; const h = Math.floor(m / 60), r = m % 60; return h ? `${h} h ${r} min` : `${r} min`; }
const money = n => n ? new Intl.NumberFormat("es-AR", {style:"currency", currency:"USD", maximumFractionDigits:0}).format(n) : "—";
function remember(it, t){ const type = typeOf(it, t); ITEMS.set(type + ":" + it.id, {id:it.id, type, title:titleOf(it), poster_path:it.poster_path, vote_average:it.vote_average, release_date:it.release_date, first_air_date:it.first_air_date, genre_ids:it.genre_ids || (it.genres || []).map(g => g.id)}); }
function genreNames(it, t){ const map = GENRES[typeOf(it, t)] || {}; return (it.genre_ids || []).map(id => map[id]).filter(Boolean).slice(0, 3).join(" · "); }

function posterImg(it){ const src = img(it.poster_path, "w342"); return src ? `<img loading="lazy" src="${src}" alt="${esc(titleOf(it))}">` : `<div class="noimg">${esc(titleOf(it))}</div>`; }
function card(it, t){
  const type = typeOf(it, t);
  if (type === "person") return personCard(it);
  return `<a class="card" href="${detailHref(type,it)}"><div class="poster">${posterImg(it)}<span class="badge">★ ${score(it.vote_average)}</span><span class="tbadge">${typeName(type)}</span></div><div class="ctitle">${esc(titleOf(it))}</div><div class="cmeta">${year(it) || "—"}</div></a>`;
}
function slugifyTitle(text){ return String(text || "").normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,"") || "titulo"; }
function detailHref(type,it){ return `#/${type}/${it.id}-${encodeURIComponent(slugifyTitle(titleOf(it)))}`; }
function personCard(p, sub){
  return `<a class="card person" href="#/person/${p.id}"><div class="poster round">${p.profile_path ? `<img loading="lazy" src="${img(p.profile_path, "w185")}" alt="">` : `<div class="noimg">👤</div>`}</div><div class="ctitle">${esc(p.name)}</div><div class="cmeta">${esc(sub ?? p.character ?? p.known_for_department ?? "")}</div></a>`;
}
function topCard(it, i, t){ return `<a class="card" href="${detailHref(typeOf(it,t),it)}"><span class="num">${i + 1}</span><div class="poster">${posterImg(it)}<span class="badge">★ ${score(it.vote_average)}</span></div></a>`; }
const skel = n => Array.from({length:n}, () => `<div class="card sk"><div class="poster"></div></div>`).join("");
function staticRow(title, inner, extra = ""){ return inner ? `<section class="block"><div class="rhead"><h2>${esc(title)}</h2>${extra}</div><div class="rwrap"><button class="arr l" tabindex="-1" aria-hidden="true" hidden>‹</button><div class="scroller">${inner}</div><button class="arr r" tabindex="-1" aria-hidden="true" hidden>›</button></div></section>` : ""; }

/* ===== LISTAS ===== */
const today = new Date().toISOString().slice(0, 10);
const LISTS = {
  "top-peliculas":     {t:"Top películas hoy", type:"movie", path:"/trending/movie/day", top:true},
  "top-series":        {t:"Top series hoy", type:"tv", path:"/trending/tv/day", top:true},
  "estrenos":          {t:"En cines ahora", type:"movie", path:"/movie/now_playing", p:() => ({region:REGION})},
  "proximamente":      {t:"Próximamente", type:"movie", path:"/movie/upcoming", p:() => ({region:REGION})},
  "populares-peliculas":{t:"Películas populares", type:"movie", path:"/movie/popular"},
  "mejor-peliculas":   {t:"Películas mejor valoradas", type:"movie", path:"/movie/top_rated"},
  "populares-series":  {t:"Series populares", type:"tv", path:"/tv/popular"},
  "mejor-series":      {t:"Series mejor valoradas", type:"tv", path:"/tv/top_rated"},
  "en-emision":        {t:"Series en emisión", type:"tv", path:"/tv/on_the_air"},
  "netflix":           {t:"Series de Netflix", type:"tv", path:"/discover/tv", p:() => ({with_networks:213, sort_by:"popularity.desc"})},
  "disney":            {t:"Series de Disney+", type:"tv", path:"/discover/tv", p:() => ({with_networks:2739, sort_by:"popularity.desc"})},
  "hbo":               {t:"Series de HBO / Max", type:"tv", path:"/discover/tv", p:() => ({with_networks:"49|3186", sort_by:"popularity.desc"})},
  "prime":             {t:"Series de Prime Video", type:"tv", path:"/discover/tv", p:() => ({with_networks:1024, sort_by:"popularity.desc"})},
  "anime":             {t:"Anime", type:"tv", path:"/discover/tv", p:() => ({with_genres:16, with_original_language:"ja", sort_by:"popularity.desc"}), tabs:["anime","anime-peliculas"]},
  "anime-peliculas":   {t:"Películas de anime", type:"movie", path:"/discover/movie", p:() => ({with_genres:16, with_original_language:"ja", sort_by:"popularity.desc"}), tabs:["anime","anime-peliculas"]},
  "doramas":           {t:"Doramas coreanos", type:"tv", path:"/discover/tv", p:() => ({with_original_language:"ko", without_genres:16, sort_by:"popularity.desc"}), tabs:["doramas","peliculas-coreanas","doramas-chinos","doramas-japoneses"]},
  "peliculas-coreanas":{t:"Películas coreanas", type:"movie", path:"/discover/movie", p:() => ({with_original_language:"ko", sort_by:"popularity.desc"}), tabs:["doramas","peliculas-coreanas","doramas-chinos","doramas-japoneses"]},
  "doramas-chinos":    {t:"Doramas chinos", type:"tv", path:"/discover/tv", p:() => ({with_original_language:"zh", without_genres:16, sort_by:"popularity.desc"}), tabs:["doramas","peliculas-coreanas","doramas-chinos","doramas-japoneses"]},
  "doramas-japoneses": {t:"Doramas japoneses", type:"tv", path:"/discover/tv", p:() => ({with_original_language:"ja", without_genres:16, sort_by:"popularity.desc"}), tabs:["doramas","peliculas-coreanas","doramas-chinos","doramas-japoneses"]},
  "argentinas":        {t:"Cine argentino", type:"movie", path:"/discover/movie", p:() => ({with_origin_country:"AR", sort_by:"popularity.desc"})},
  "latinas":           {t:"Series latinoamericanas", type:"tv", path:"/discover/tv", p:() => ({with_origin_country:"AR|MX|CO|CL|BR", sort_by:"popularity.desc"})},
  "infantiles":        {t:"Películas infantiles", type:"movie", path:"/discover/movie", p:() => ({with_genres:10751, include_adult:false, certification_country:"AR", "certification.lte":"ATP", region:"AR", sort_by:"popularity.desc"}), tabs:["infantiles","infantiles-series","infantiles-animacion","infantiles-dibujos"]},
  "infantiles-series": {t:"Series infantiles", type:"tv", path:"/discover/tv", p:() => ({with_genres:10762, include_adult:false, sort_by:"popularity.desc"}), tabs:["infantiles","infantiles-series","infantiles-animacion","infantiles-dibujos"]},
  "infantiles-animacion":{t:"Animación familiar", type:"movie", path:"/discover/movie", p:() => ({with_genres:"16,10751", include_adult:false, sort_by:"popularity.desc"}), tabs:["infantiles","infantiles-series","infantiles-animacion","infantiles-dibujos"]},
  "infantiles-dibujos":{t:"Dibujos animados", type:"tv", path:"/discover/tv", p:() => ({with_genres:"16,10762", include_adult:false, sort_by:"popularity.desc"}), tabs:["infantiles","infantiles-series","infantiles-animacion","infantiles-dibujos"]},
  "telenovelas":       {t:"Telenovelas", type:"tv", path:"/discover/tv", p:() => ({with_genres:10766, sort_by:"popularity.desc"})},
  "guerra-politica":   {t:"Guerra y política", type:"tv", path:"/discover/tv", p:() => ({with_genres:10768, sort_by:"popularity.desc"})},
  "documentales-series":{t:"Series documentales", type:"tv", path:"/discover/tv", p:() => ({with_genres:99, sort_by:"popularity.desc"})},
};
const GENRE_ROWS = [[28,"Acción"],[35,"Comedia"],[27,"Terror"],[10749,"Romance"],[12,"Aventura"],[878,"Ciencia ficción"],[14,"Fantasía"],[53,"Suspenso"],[9648,"Misterio"],[80,"Crimen"],[18,"Drama"],[10751,"Familia"],[16,"Animación"],[99,"Documental"],[36,"Historia"],[10402,"Música"],[10752,"Bélicas"],[37,"Western"]];
GENRE_ROWS.forEach(([g, n]) => LISTS["genero-" + g] = {t:n, type:"movie", path:"/discover/movie", p:() => ({with_genres:g, sort_by:"popularity.desc", "vote_count.gte":50})});

function rowsHTML(keys){
  return keys.map(k => { const L = LISTS[k];
    return `<section class="row ${L.top ? "top" : ""}" data-list="${k}"><div class="rhead"><h2>${esc(L.t)}</h2><a href="#/lista/${k}">Ver todo ›</a></div><div class="rwrap"><button class="arr l" tabindex="-1" aria-hidden="true" hidden>‹</button><div class="scroller">${skel(L.top ? 6 : 8)}</div><button class="arr r" tabindex="-1" aria-hidden="true" hidden>›</button></div></section>`;
  }).join("");
}
function isChildCatalogItem(item, type = item.media_type){
  if (!item || type === "person" || item.adult) return false;
  const media = type === "tv" || type === "movie" ? type : item.media_type;
  if (media !== "tv" && media !== "movie") return false;
  const genres = item.genre_ids || (item.genres || []).map(g => g.id) || [];
  const allowed = media === "tv" ? [16, 10762] : [16, 10751];
  return genres.some(id => allowed.includes(id)) && !genres.some(id => [27, 80, 53, 10752].includes(id));
}
async function fillRow(sec){
  const L = LISTS[sec.dataset.list], sc = $(".scroller", sec);
  try{
    const d = await api(L.path, L.p ? L.p() : {});
    const items = (d.results || []).filter(x => x.poster_path && (!kidsModeEnabled || isChildCatalogItem(x, L.type)));
    if (!items.length){ sec.remove(); return; }
    sc.innerHTML = L.top ? items.slice(0, 10).map((it, i) => topCard(it, i, L.type)).join("") : items.map(it => card(it, L.type)).join("");
    updateRowArrows(sec);
  }catch(e){ sc.innerHTML = `<div class="err">No se pudo cargar esta sección.</div>`; updateRowArrows(sec); }
}
function updateRowArrows(sec){
  const sc = $(".scroller", sec); if (!sc) return;
  const max = Math.max(0, sc.scrollWidth - sc.clientWidth);
  const left = $(".arr.l", sec), right = $(".arr.r", sec);
  if (left) left.hidden = max <= 4 || sc.scrollLeft <= 4;
  if (right) right.hidden = max <= 4 || sc.scrollLeft >= max - 4;
}
function observeRows(root){
  const io = new IntersectionObserver(es => es.forEach(e => { if (e.isIntersecting){ io.unobserve(e.target); fillRow(e.target); } }), {rootMargin:"700px"});
  $$("section.row[data-list]", root).forEach(s => io.observe(s));
  $$("section.row[data-list] .scroller", root).forEach(sc => sc.addEventListener("scroll", () => updateRowArrows(sc.closest(".row")), {passive:true}));
  const onResize = () => $$("section.row[data-list]", root).forEach(updateRowArrows);
  window.addEventListener("resize", onResize, {passive:true});
  cleanup.push(() => { io.disconnect(); window.removeEventListener("resize", onResize); });
}

/* ===== GRILLA CON SCROLL INFINITO ===== */
function infiniteGrid(grid, path, params, type, filter, onFirstPage){
  let page = 1, total = 1, loading = false;
  const t = routeToken;
  const sentinel = document.createElement("div");
  sentinel.className = "sentinel";
  grid.after(sentinel);
  async function load(){
    if (loading || page > total || page > 500 || t !== routeToken) return;
    loading = true;
    sentinel.innerHTML = '<div class="spinner"></div>';
    try{
      const d = await api(path, {...params, page});
      if (t !== routeToken) return;
      total = d.total_pages || 1;
      let items = d.results || [];
      if (filter) items = items.filter(filter);
      if (kidsModeEnabled) items = items.filter(x => isChildCatalogItem(x, type || x.media_type));
      if (page === 1 && !items.length) grid.innerHTML = '<div class="empty">No se encontraron resultados.</div>';
      grid.insertAdjacentHTML("beforeend", items.map(x => card(x, type)).join(""));
      if (page === 1) onFirstPage?.(grid, items);
      page++;
      sentinel.innerHTML = "";
    }catch(e){
      sentinel.innerHTML = '<button class="btn ghost" data-retry>Reintentar</button>';
      loading = false; return;
    }
    loading = false;
    if (page <= total && sentinel.getBoundingClientRect().top < innerHeight + 800) load();
  }
  sentinel.addEventListener("click", e => { if (e.target.closest("[data-retry]")) load(); });
  const io = new IntersectionObserver(es => { if (es[0].isIntersecting) load(); }, {rootMargin:"800px"});
  io.observe(sentinel);
  cleanup.push(() => io.disconnect());
}

/* ===== PÁGINAS ===== */
async function home(){
  const t = routeToken;
  document.title = "CINENOVA — Películas y series";
  setSeo("CINENOVA — Películas y series", "Descubre películas, series, tendencias y fichas de entretenimiento con metadatos de TMDB.", "/");
  app.innerHTML = `<section class="hero" id="hero"></section>` + rowsHTML(kidsModeEnabled ? ["infantiles","infantiles-series","infantiles-animacion","infantiles-dibujos"] : [
    "top-peliculas","top-series","estrenos","netflix","mejor-series","populares-peliculas","anime","doramas",
    "disney","hbo","prime","peliculas-coreanas","argentinas","latinas","proximamente",
    ...GENRE_ROWS.map(g => "genero-" + g[0]),
    "infantiles","infantiles-series","telenovelas","guerra-politica","documentales-series","mejor-peliculas","en-emision"]);
  observeRows(app);
  try{
    const d = await api(kidsModeEnabled ? "/discover/movie" : "/trending/all/day", kidsModeEnabled ? {with_genres:10751,certification_country:"AR","certification.lte":"ATP",include_adult:false,sort_by:"popularity.desc"} : {});
    if (t !== routeToken) return;
    renderHero(d.results.filter(x => x.backdrop_path && x.media_type !== "person" && (!kidsModeEnabled || isChildCatalogItem(x, x.media_type || "movie"))).slice(0, 7));
  }catch(e){
    $("#hero").remove();
    if (isTvMode) requestAnimationFrame(() => $("#tvSidebar [data-r='']")?.focus());
  }
}

function renderHero(items){
  const hero = $("#hero"); if (!hero || !items.length) return;
  items.forEach(it => remember(it));
  hero.setAttribute("role", "region");
  hero.setAttribute("aria-roledescription", "carrusel");
  hero.setAttribute("aria-label", "Películas y series destacadas");
  hero.innerHTML = items.map((it, i) => `<div class="slide ${i ? "" : "on"}" role="img" aria-label="${esc(titleOf(it))}" style="background-image:url('${img(it.backdrop_path, "original")}')"></div>`).join("") + `<div id="hc"></div>`;
  let cur = 0;
  let timer;
  const stopTimer = () => clearInterval(timer);
  const startTimer = () => {
    stopTimer();
    if (items.length > 1) timer = setInterval(() => show((cur + 1) % items.length), 8000);
  };
  const show = i => {
    const oldFocus = document.activeElement?.closest("#hc [data-hero-action], #hc [data-slide]");
    const oldAction = oldFocus?.dataset.heroAction, oldSlide = oldFocus?.dataset.slide;
    cur = (i + items.length) % items.length;
    $$(".slide", hero).forEach((s, k) => {
      s.classList.toggle("on", k === cur);
      s.setAttribute("aria-hidden", String(k !== cur));
    });
    const it = items[cur], type = typeOf(it,"movie"), fav = isFav(type, it.id);
    const ov = (it.overview || "").length > 230 ? it.overview.slice(0, 230).trim() + "…" : (it.overview || "");
    $("#hc").innerHTML = `<div class="hcontent" key="${cur}">
      <div class="hero-meta"><span class="hero-type-pill">${typeName(it)}</span><span class="hero-score">★ ${score(it.vote_average)}</span><span class="hero-year">${year(it)}</span></div>
      <h1>${esc(titleOf(it))}</h1>
      <div class="hgen">${esc(genreNames(it))}</div>
      <p>${esc(ov)}</p>
      <div class="actions">
        <a class="btn" data-hero-action="watch" href="${detailHref(type,it)}">▶ Ver ahora</a>
        <button class="btn ghost" data-hero-action="trailer" data-act="trailer" data-type="${type}" data-id="${it.id}">Tráiler</button>
        <button class="btn ghost ${fav ? "fav-on" : ""}" data-hero-action="favorite" data-act="fav" data-type="${type}" data-id="${it.id}">${fav ? "✓ En Mi lista" : "+ Mi lista"}</button>
      </div>
    <div class="hero-carousel-controls" aria-label="Destacados">
        <button class="hero-arrow" type="button" data-hero-step="-1" aria-label="Destacado anterior">‹</button>
        <div class="hero-indicators hero-thumbnails" role="group" aria-label="Elegir destacado">
          ${items.map((x, k) => `<button class="hero-thumb ${k === cur ? "active" : ""}" type="button" data-slide="${k}" aria-label="Mostrar ${esc(titleOf(x))}" aria-pressed="${k === cur}"><img loading="lazy" src="${img(x.poster_path, "w185")}" alt=""><span>${esc(titleOf(x))}</span></button>`).join("")}
        </div>
        <button class="hero-arrow" type="button" data-hero-step="1" aria-label="Siguiente destacado">›</button>
    </div>`;
    if (isTvMode && (oldAction || oldSlide !== undefined)) requestAnimationFrame(() =>
      (oldAction ? $(`#hc [data-hero-action="${oldAction}"]`) : $(`#hc [data-slide="${oldSlide}"]`))?.focus({preventScroll:true})
    );
  };
  show(0);
  startTimer();
  if (isTvMode) requestAnimationFrame(() => $("#hc .actions a.btn")?.focus({preventScroll:true}));
  hero.addEventListener("click", e => {
    const dot = e.target.closest("[data-slide]"), step = e.target.closest("[data-hero-step]");
    if (!dot && !step) return;
    const stepDirection = step ? Number(step.dataset.heroStep) : null;
    const dotIndex = dot ? Number(dot.dataset.slide) : null;
    show(step ? cur + stepDirection : dotIndex);
    startTimer();
    const selector = step ? `[data-hero-step="${stepDirection}"]` : `[data-slide="${dotIndex}"]`;
    $(selector, hero)?.focus({ preventScroll: true });
  });
  hero.addEventListener("mouseenter", stopTimer);
  hero.addEventListener("mouseleave", () => { if (!hero.matches(":focus-within")) startTimer(); });
  let touchStartX = 0;
  hero.addEventListener("touchstart", e => { touchStartX = e.changedTouches[0]?.clientX || 0; }, {passive:true});
  hero.addEventListener("touchend", e => {
    const delta = (e.changedTouches[0]?.clientX || touchStartX) - touchStartX;
    if (Math.abs(delta) < 48) return;
    show(cur + (delta < 0 ? 1 : -1));
    startTimer();
  }, {passive:true});
  cleanup.push(stopTimer);
}

function explore(type, q){
  const label = type === "movie" ? "Películas" : "Series";
  document.title = label + " — CINENOVA";
  setSeo(label + " — CINENOVA", `Explora películas y series, filtra por género, idioma y año.`, type === "movie" ? "/peliculas" : "/series");
  const genre = q.get("genero") || "", yr = q.get("anio") || "", sort = q.get("orden") || "popularity.desc", lang = q.get("idioma") || "";
  const dateKey = type === "movie" ? "primary_release_date" : "first_air_date";
  const sorts = [["popularity.desc","Más populares"],["vote_average.desc","Mejor valoradas"],[dateKey + ".desc","Más recientes"],["vote_count.desc","Más votadas"]];
  if (type === "movie") sorts.push(["revenue.desc","Más taquilleras"]);
  const langs = [["","Todos los idiomas"],["es","Español"],["en","Inglés"],["ja","Japonés"],["ko","Coreano"],["zh","Chino"],["fr","Francés"],["it","Italiano"],["de","Alemán"],["pt","Portugués"],["hi","Hindi"],["tr","Turco"]];
  const years = [""]; for (let y = new Date().getFullYear() + 1; y >= 1940; y--) years.push(String(y));
  const base = type === "movie" ? "peliculas" : "series";
  const link = ch => { const p = new URLSearchParams({genero:genre, anio:yr, orden:sort, idioma:lang, ...ch}); [...p.keys()].forEach(k => { if (!p.get(k)) p.delete(k); }); const s = p.toString(); return `#/${base}${s ? "?" + s : ""}`; };
  app.innerHTML = `<div class="page"><h1>${label}</h1>
    <div class="filters">
      <select id="fSort">${sorts.map(([v, n]) => `<option value="${v}" ${v === sort ? "selected" : ""}>${n}</option>`).join("")}</select>
      <select id="fYear">${years.map(y => `<option value="${y}" ${y === yr ? "selected" : ""}>${y || "Todos los años"}</option>`).join("")}</select>
      <select id="fLang">${langs.map(([v, n]) => `<option value="${v}" ${v === lang ? "selected" : ""}>${n}</option>`).join("")}</select>
    </div>
    <div class="chips"><a class="chip ${genre ? "" : "on"}" href="${link({genero:""})}">Todos</a>${Object.entries(GENRES[type]).map(([id, n]) => `<a class="chip ${id === genre ? "on" : ""}" href="${link({genero:id})}">${esc(n)}</a>`).join("")}</div>
    <div class="grid" id="grid"></div></div>`;
  $("#fSort").onchange = e => location.hash = link({orden:e.target.value});
  $("#fYear").onchange = e => location.hash = link({anio:e.target.value});
  $("#fLang").onchange = e => location.hash = link({idioma:e.target.value});
  const params = {sort_by:sort, with_genres:genre, with_original_language:lang, include_adult:false};
  if (yr) params[type === "movie" ? "primary_release_year" : "first_air_date_year"] = yr;
  if (sort.startsWith("vote_average")) params["vote_count.gte"] = 300;
  if (sort.startsWith(dateKey)) params[dateKey + ".lte"] = today;
  infiniteGrid($("#grid"), "/discover/" + type, params, type, x => x.poster_path);
}

function trending(q){
  document.title = "Tendencias — CINENOVA";
  setSeo("Tendencias — CINENOVA", "Consulta las películas y series más populares del momento.", "/tendencias");
  const win = q.get("periodo") === "semana" ? "week" : "day";
  const media = ["movie","tv"].includes(q.get("tipo")) ? q.get("tipo") : "all";
  const l = (p, t) => `#/tendencias?periodo=${p}&tipo=${t}`;
  const pw = win === "week" ? "semana" : "hoy";
  app.innerHTML = `<div class="page"><h1>Tendencias</h1>
    <div class="tabs"><a class="chip ${win === "day" ? "on" : ""}" href="${l("hoy", media)}">Hoy</a><a class="chip ${win === "week" ? "on" : ""}" href="${l("semana", media)}">Esta semana</a></div>
    <div class="tabs"><a class="chip ${media === "all" ? "on" : ""}" href="${l(pw, "all")}">Todo</a><a class="chip ${media === "movie" ? "on" : ""}" href="${l(pw, "movie")}">Películas</a><a class="chip ${media === "tv" ? "on" : ""}" href="${l(pw, "tv")}">Series</a></div>
    <div class="grid" id="grid"></div></div>`;
  infiniteGrid($("#grid"), `/trending/${media}/${win}`, {}, media === "all" ? undefined : media, x => x.poster_path && x.media_type !== "person");
}

function listPage(k){
  const L = LISTS[k];
  if (!L) return notFound();
  document.title = L.t + " — CINENOVA";
  setSeo(L.t + " — CINENOVA", `Explora ${L.t} en CINENOVA.`, k === "infantiles" ? "/lista/infantiles" : "/" + k);
  const tabs = L.tabs ? `<div class="tabs">${L.tabs.map(x => `<a class="chip ${x === k ? "on" : ""}" href="#/lista/${x}">${esc(LISTS[x].t)}</a>`).join("")}</div>` : "";
  app.innerHTML = `<div class="page"><h1>${esc(L.t)}</h1>${tabs}<div class="grid" id="grid"></div></div>`;
  infiniteGrid($("#grid"), L.path, L.p ? L.p() : {}, L.type, x => x.poster_path && (!kidsModeEnabled || isChildCatalogItem(x,L.type)));
}

function search(q){
  const query = (q.get("q") || "").trim(), tipo = q.get("tipo") || "multi";
  const quickLinks = kidsModeEnabled ? [["Películas infantiles","#/lista/infantiles"],["Series infantiles","#/lista/infantiles-series"],["Animación familiar","#/lista/infantiles-animacion"],["Dibujos animados","#/lista/infantiles-dibujos"]] : [["Tendencias","#/lista/top-peliculas"],["Acción","#/lista/genero-28"],["Anime","#/lista/anime"],["Ciencia ficción","#/lista/genero-878"],["Comedia","#/lista/genero-35"],["Terror","#/lista/genero-27"],["Doramas","#/lista/doramas"]];
  document.title = `Buscar: ${query} — CINENOVA`;
  setSeo(query ? `Buscar: ${query} — CINENOVA` : "Buscar — CINENOVA", query ? `Resultados de búsqueda para ${query} en CINENOVA.` : "Busca películas, series y personas.", "/buscar", null, "noindex, follow");
  const form = `<form class="search-page-form" id="searchForm"><input id="searchQuery" type="search" value="${esc(query)}" ${isTvMode ? "readonly" : ""} placeholder="Buscar películas, series o actores" aria-label="Buscar películas, series o actores"><button class="btn primary" type="submit">Buscar</button></form>`;
  if (!query){
    app.innerHTML = `<div class="page search-page"><h1>Buscar</h1>${form}<p class="muted">Escribí un título${kidsModeEnabled ? " infantil o familiar" : ", una serie o el nombre de un actor"}.</p><nav class="search-quick-links" aria-label="Búsquedas rápidas">${quickLinks.map(([label,href])=>`<a class="chip" href="${href}">${label}</a>`).join("")}</nav></div>`;
    bindSearchForm();
    return;
  }
  const l = t => `#/buscar?q=${encodeURIComponent(query)}&tipo=${t}`;
  app.innerHTML = `<div class="page search-page"><h1>Resultados para “${esc(query)}”</h1>${form}
    <div class="tabs">${[["multi","Todo"],["movie","Películas"],["tv","Series"],...(kidsModeEnabled?[]:[["person","Personas"]])].map(([v, n]) => `<a class="chip ${v === tipo ? "on" : ""}" href="${l(v)}">${n}</a>`).join("")}</div>
    <div class="grid" id="grid"></div></div>`;
  bindSearchForm();
  infiniteGrid($("#grid"), "/search/" + tipo, {query, include_adult:false}, tipo === "multi" ? undefined : tipo, x => (x.poster_path || x.profile_path) && (!kidsModeEnabled || isChildCatalogItem(x, tipo === "multi" ? x.media_type : tipo)));
}
function bindSearchForm(){
  const input = $("#searchQuery");
  if (input && isTvMode) input.addEventListener("click", () => {
    if (!input.readOnly) return;
    input.readOnly = false; input.blur(); input.focus();
  });
  $("#searchForm")?.addEventListener("submit", e => {
    e.preventDefault();
    const value = $("#searchQuery")?.value.trim();
    if (value) location.hash = `#/buscar?q=${encodeURIComponent(value)}`;
  });
  if (input) requestAnimationFrame(() => { if (input.isConnected) input.focus({preventScroll:true}); });
}

function pickVideo(list = []){
  const yt = list.filter(v => v.site === "YouTube");
  const rank = v => (v.type === "Trailer" ? 0 : v.type === "Teaser" ? 1 : 2) + (v.iso_639_1 === "es" ? 0 : 3) + (v.official ? 0 : .5);
  return yt.sort((a, b) => rank(a) - rank(b))[0];
}
async function playTrailer(type, id){
  try{
    const d = await api(`/${type}/${id}/videos`, {include_video_language:"es,en,null"});
    const v = pickVideo(d.results);
    if (!v) return toast("No hay tráiler disponible.");
    playVideo(v.key);
  }catch(e){ toast("No se pudo cargar el tráiler."); }
}
function playVideo(key){ openModal(`<div class="vid"><iframe src="https://www.youtube-nocookie.com/embed/${encodeURIComponent(key)}?autoplay=1&rel=0" allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowfullscreen></iframe></div>`, "wide"); }

function getCert(d, type){
  if (type === "movie"){
    const r = d.release_dates?.results || [];
    for (const c of [REGION, "US"]){ const x = r.find(a => a.iso_3166_1 === c); const cert = x?.release_dates?.find(z => z.certification)?.certification; if (cert) return cert; }
  } else {
    const r = d.content_ratings?.results || [];
    for (const c of [REGION, "US"]){ const x = r.find(a => a.iso_3166_1 === c); if (x?.rating) return x.rating; }
  }
  return "";
}
function isChildApprovedDetail(data,type){
  if (data.adult) return false;
  const genres = (data.genres || []).map(g => g.id);
  const allowed = type === "tv" ? [16, 10762] : [16, 10751];
  if (!genres.some(id => allowed.includes(id)) || genres.some(id => [27, 80, 53, 10752].includes(id))) return false;
  const cert = getCert(data, type);
  return !cert || /^(ATP|G|U|AL|0|TV-Y|TV-Y7|TV-G)$/i.test(cert);
}
function providersHTML(p){
  if (!p) return `<p class="muted">No hay información de plataformas para ${esc(REGIONS[REGION] || REGION)}.</p>`;
  const grp = (arr, label) => arr?.length ? `<div class="pgroup"><h4>${label}</h4><div class="plist">${arr.map(x => `<a href="${esc(p.link)}" target="_blank" rel="noopener" class="prov" title="${esc(x.provider_name)}"><img loading="lazy" src="${img(x.logo_path, "w92")}" alt=""><span>${esc(x.provider_name)}</span></a>`).join("")}</div></div>` : "";
  const h = grp(p.flatrate, "Suscripción") + grp(p.free, "Gratis") + grp(p.ads, "Gratis con anuncios") + grp(p.rent, "Alquiler") + grp(p.buy, "Compra");
  return h || `<p class="muted">Sin plataformas disponibles en esta región.</p>`;
}

async function detail(type, id){
  const numericId = String(id).match(/^\d+/)?.[0] || "";
  if (!numericId) return notFound();
  id = numericId;
  const t = routeToken;
  app.innerHTML = `<div class="dsk"></div>`;
  const append = ["videos","credits","recommendations","similar","watch/providers","external_ids","keywords", type === "movie" ? "release_dates" : "content_ratings"].join(",");
  let d;
  try{ d = await api(`/${type}/${id}`, {append_to_response:append, include_video_language:"es,en,null"}); }
  catch(e){ if (t === routeToken) notFound(); return; }
  if (t !== routeToken) return;
  if (kidsModeEnabled && !isChildApprovedDetail(d,type)){
    app.innerHTML = `<div class="page"><h1>No disponible en modo infantil</h1><p class="muted">Este título no tiene una clasificación infantil confirmada.</p><a class="btn primary" href="#/">Volver al inicio</a></div>`; return;
  }
  currentDetailContext = {id,type,title:titleOf(d),runTime:Number(d.episode_run_time?.[0]) || 45,posterPath:d.poster_path || ""};
  if (!d.overview){ try{ const en = await api(`/${type}/${id}`, {language:"en-US"}); d.overview = en.overview; }catch(e){} }
  if (t !== routeToken) return;
  remember(d, type);
  const title = titleOf(d);
  const currentParts=parseHash().parts;
  if (!/-/.test(currentParts[1]||"")) history.replaceState(null,"",`/#/${type}/${id}-${encodeURIComponent(slugifyTitle(title))}`);
  const overlayPlayback = isNativeApp() || isTvMode;
  const tvApp = isNativeApp() && isTvMode;
  document.title = title + " — CINENOVA";
  const canonicalPath = `/${type === "tv" ? "serie" : "pelicula"}/${id}`;
  setSeo(`${title} — CINENOVA`, d.overview || `${title}: ficha, reparto, tráiler y más información.`, canonicalPath, {"@context":"https://schema.org","@type":type === "tv" ? "TVSeries" : "Movie",name:title,description:d.overview || "",image:img(d.poster_path,"w500"),datePublished:d.release_date || d.first_air_date,aggregateRating:d.vote_average ? {"@type":"AggregateRating",ratingValue:d.vote_average,ratingCount:d.vote_count} : undefined});
  const otitle = d.original_title || d.original_name;
  const cert = getCert(d, type);
  const trailer = pickVideo(d.videos?.results);
  const fav = isFav(type, d.id);
  const facts = [
    `<span class="rating">★ ${score(d.vote_average)}</span><span class="muted">(${(d.vote_count || 0).toLocaleString("es-AR")} votos)</span>`,
    cert ? `<span class="cert">${esc(cert)}</span>` : "",
    type === "movie" ? (d.runtime ? `<span>${fmtRuntime(d.runtime)}</span>` : "") : `<span>${d.number_of_seasons || 0} temporada${d.number_of_seasons === 1 ? "" : "s"} · ${d.number_of_episodes || 0} episodios</span>`,
    `<span>${fmtDate(d.release_date || d.first_air_date)}</span>`
  ].join("");
  const crew = d.credits?.crew || [];
  const crewBits = [];
  if (type === "movie"){
    const dir = crew.filter(c => c.job === "Director"), wr = crew.filter(c => ["Screenplay","Writer","Novel"].includes(c.job)).slice(0, 3);
    dir.forEach(c => crewBits.push(`<a href="#/person/${c.id}"><b>${esc(c.name)}</b><span>Dirección</span></a>`));
    wr.forEach(c => crewBits.push(`<a href="#/person/${c.id}"><b>${esc(c.name)}</b><span>${c.job === "Novel" ? "Novela" : "Guion"}</span></a>`));
  } else {
    (d.created_by || []).forEach(c => crewBits.push(`<a href="#/person/${c.id}"><b>${esc(c.name)}</b><span>Creación</span></a>`));
  }
  const cast = (d.credits?.cast || []).slice(0, 24).map(p => personCard(p)).join("");
  const defaultOverlayTab = cast ? "reparto" : "similares";
  const vids = (d.videos?.results || []).filter(v => v.site === "YouTube").slice(0, 12)
    .map(v => `<div class="vcard" role="button" tabindex="0" data-act="video" data-key="${esc(v.key)}"><div class="vthumb"><img loading="lazy" src="https://i.ytimg.com/vi/${esc(v.key)}/hqdefault.jpg" alt=""></div><div class="ctitle">${esc(v.name)}</div><div class="cmeta">${esc(v.type)}</div></div>`).join("");
  const kidFilter = x => x.poster_path && (!kidsModeEnabled || isChildCatalogItem(x, type));
  const recs = (d.recommendations?.results || []).filter(kidFilter).map(x => card(x, type)).join("");
  const sim = (d.similar?.results || []).filter(kidFilter).map(x => card(x, type)).join("");
  const kws = (d.keywords?.keywords || d.keywords?.results || []).slice(0, 20);
  const langName = (() => { try{ return new Intl.DisplayNames(["es"], {type:"language"}).of(d.original_language); }catch(e){ return d.original_language; } })();
  const info = [
    ["Título original", esc(otitle)],
    ["Estado", esc(d.status || "—")],
    ["Idioma original", esc(langName || "—")],
    type === "movie" ? ["Presupuesto", money(d.budget)] : ["Cadena", esc((d.networks || []).map(n => n.name).join(", ") || "—")],
    type === "movie" ? ["Recaudación", money(d.revenue)] : ["Último episodio", d.last_episode_to_air ? `T${d.last_episode_to_air.season_number}E${d.last_episode_to_air.episode_number} · ${fmtDate(d.last_episode_to_air.air_date)}` : "—"],
    ["País", esc((d.production_countries || []).map(c => c.name).join(", ") || (d.origin_country || []).join(", ") || "—")],
    ["Productoras", esc((d.production_companies || []).slice(0, 4).map(c => c.name).join(", ") || "—")],
    d.external_ids?.imdb_id ? ["IMDb", `<a href="https://www.imdb.com/title/${esc(d.external_ids.imdb_id)}/" target="_blank" rel="noopener" style="color:var(--gold)">${esc(d.external_ids.imdb_id)} ↗</a>`] : null
  ].filter(Boolean).map(([k, v]) => `<div><b>${k}</b>${v}</div>`).join("");
  const seasons = type === "tv" ? (d.seasons || []).filter(s => s.season_number > 0) : [];
  const seasonList = seasons.length ? seasons : (d.seasons || []);
  const initialSeason = seasonList.find(s => s.season_number === 1) || seasonList[0];
  const initialSeasonNumber = initialSeason?.season_number || 1;
  const initialEpisodeCount = initialSeason?.episode_count || 1;
  const episodeBrowserHTML = type === "tv" ? `<section class="episode-browser ${overlayPlayback ? "episode-browser-app" : ""}" aria-label="Capítulos de la serie">
      <div class="episode-browser-head"><label class="season-picker">Temporada<select id="playSeason">${seasonList.map(s => `<option value="${s.season_number}" data-episodes="${s.episode_count}" ${s.season_number === initialSeasonNumber ? "selected" : ""}>${esc(s.name)}</option>`).join("") || '<option value="1" data-episodes="1">Temporada 1</option>'}</select></label>
        <div><h3>Episodios</h3><p id="episodeSeasonLabel">Temporada ${initialSeasonNumber} · Elegí un capítulo para reproducir.</p></div>
      </div><div class="episode-list" id="episodeList" aria-live="polite"></div></section>` : "";

  app.innerHTML = `
  <section class="dhero" style="background-image:url('${img(d.backdrop_path, "original")}')">
    <div class="dinner">
      <div class="dposter">${d.poster_path ? `<img src="${img(d.poster_path, "w500")}" alt="">` : `<div class="noimg" style="aspect-ratio:2/3">${esc(title)}</div>`}</div>
      <div class="dinfo">
        <span class="tag">${typeName(type)} ${year(d)}</span>
        <h1>${esc(title)}</h1>
        ${otitle && otitle !== title ? `<div class="otitle">${esc(otitle)}</div>` : ""}
        <div class="facts">${facts}</div>
        <div class="chips">${(d.genres || []).map(g => `<a class="chip" href="#/${type === "movie" ? "peliculas" : "series"}?genero=${g.id}">${esc(g.name)}</a>`).join("")}</div>
        ${d.tagline ? `<p class="tagline">“${esc(d.tagline)}”</p>` : ""}
        <p class="overview">${esc(d.overview || "Sin sinopsis disponible.")}</p>
        <div class="actions">
          <button class="btn primary" data-act="play-detail" data-tab="ver" data-target="player-${d.id}" data-type="${type}" data-id="${d.id}">▶ Reproducir</button>
          ${canUseOfflineDownloads() ? offlineDownloadButton({tmdbId:d.id, mediaType:type, title, posterPath:d.poster_path || ""}) : ""}
          <button class="btn ghost ${fav ? "fav-on" : ""}" data-act="fav" data-type="${type}" data-id="${d.id}">${fav ? "✓ En Mi lista" : "+ Mi lista"}</button>
          ${tvApp ? "" : '<button class="btn ghost" data-act="share">↗ Compartir</button>'}
        </div>
        ${crewBits.length && !tvApp ? `<div class="crew">${crewBits.join("")}</div>` : ""}
      </div>
    </div>
  </section>
  ${overlayPlayback && type === "tv" ? episodeBrowserHTML : ""}
  <nav class="detail-tabs" role="tablist" aria-label="Secciones del título">
    ${(overlayPlayback ? [["reparto","Reparto"],["similares","Similares"],["trailer","Tráiler"]] : [["ver","Ver"],["reparto","Reparto"],["detalles","Detalles"],["similares","Similares"],["trailer","Tráiler"]]).map(([key,label], i) => { const active = overlayPlayback ? key === defaultOverlayTab : i === 0; return `<button class="detail-tab ${active ? "active" : ""}" role="tab" aria-selected="${active}" data-detail-tab="${key}">${label}</button>`; }).join("")}
  </nav>
  ${overlayPlayback ? "" : `<section class="detail-panel" id="panel-ver" role="tabpanel">
    <h2 class="player-title">Ver ahora: ${esc(title)}</h2>
    ${type === "tv" ? episodeBrowserHTML : ""}
    <div class="player-frame" id="player-${d.id}"><iframe src="about:blank" title="Reproductor de video" tabindex="0" width="100%" height="100%" frameBorder="0" allowFullScreen allow="autoplay; fullscreen; picture-in-picture; encrypted-media; remote-playback" referrerPolicy="origin"></iframe></div>
  </section>`}
  <section class="detail-panel" id="panel-reparto" role="tabpanel" ${overlayPlayback && defaultOverlayTab === "reparto" ? "" : "hidden"}>${staticRow("Reparto", cast)}${tvApp && crewBits.length ? `<section class="block"><h2>${type === "movie" ? "Dirección y guion" : "Creación"}</h2><div class="crew">${crewBits.join("")}</div></section>` : ""}</section>
  ${overlayPlayback ? "" : `<section class="detail-panel" id="panel-detalles" role="tabpanel" hidden>
    <section class="block"><h2>Información</h2><div class="info">${info}</div>${kws.length ? `<div style="margin-top:18px"><b class="muted" style="font-size:12px;text-transform:uppercase;letter-spacing:1px">Palabras clave</b><div class="kw">${kws.map(k => `<span>${esc(k.name)}</span>`).join("")}</div></div>` : ""}</section>
  </section>`}
  <section class="detail-panel" id="panel-similares" role="tabpanel" ${overlayPlayback && defaultOverlayTab === "similares" ? "" : "hidden"}>${staticRow("Recomendadas", recs)}${staticRow("Títulos similares", sim)}${overlayPlayback && defaultOverlayTab === "similares" && !recs && !sim ? '<section class="block"><p class="muted">No hay títulos similares disponibles.</p></section>' : ""}</section>
  <section class="detail-panel" id="panel-trailer" role="tabpanel" hidden>${staticRow("Tráileres y videos", vids)}</section>`;
  $$("[data-detail-tab]").forEach(tab => tab.onclick = () => activateDetailTab(tab.dataset.detailTab));
  const playerFrame = $(`#player-${d.id} iframe`);
  requestAnimationFrame(() => { if (isTvMode) $("[data-act='play-detail']")?.focus(); });
  if (type === "tv"){
    const seasonSel = $("#playSeason");
    const updateEpisodes = () => {
      const label = $("#episodeSeasonLabel"); if (label) label.textContent = `Temporada ${seasonSel.value} · Elegí un capítulo para reproducir.`;
      loadSeason(d.id, seasonSel.value);
    };
    seasonSel.onchange = updateEpisodes;
    loadSeason(d.id, initialSeasonNumber);
  }
}
function activateDetailTab(key){
  if (!document.getElementById(`panel-${key}`)) return;
  $$("[data-detail-tab]").forEach(tab => { const active = tab.dataset.detailTab === key; tab.classList.toggle("active", active); tab.setAttribute("aria-selected", String(active)); });
  $$(".detail-panel").forEach(panel => { panel.hidden = panel.id !== `panel-${key}`; });
}
async function loadSeason(id, n){
  const numericId = String(id).match(/^\d+/)?.[0] || "";
  const t = routeToken, request = ++episodeRequestToken, box = $("#episodeList");
  if (!box || !numericId) return;
  id = numericId;
  box.innerHTML = '<p class="episode-empty">Cargando capítulos…</p>';
  try{
    const s = await api(`/tv/${id}/season/${n}`);
    if (t !== routeToken || request !== episodeRequestToken) return;
    currentEpisodeCount=(s.episodes||[]).length||currentEpisodeCount;
    const seriesTitle = currentDetailContext?.title || "";
    const seriesPoster = currentDetailContext?.posterPath || "";
    const offlineEpisodes = canUseOfflineDownloads();
    const cardTag = offlineEpisodes ? "div" : "button";
    const cardAttrs = offlineEpisodes ? ' role="button" tabindex="0"' : "";
    box.innerHTML = (s.episodes || []).map(e => `<${cardTag} class="episode-card"${cardAttrs} data-act="play-episode" data-type="tv" data-id="${id}" data-season="${n}" data-episode="${e.episode_number}" data-runtime="${Number(e.runtime) || 0}" data-search="${esc(e.name || "").toLowerCase()}" aria-label="Reproducir temporada ${n}, episodio ${e.episode_number}: ${esc(e.name || "")}">
      <span class="episode-thumb">${e.still_path ? `<img loading="lazy" src="${img(e.still_path, "w300")}" alt="">` : '<span class="episode-thumb-fallback"></span>'}</span>
      <span class="episode-meta"><span class="episode-number">E${String(e.episode_number).padStart(2, "0")}</span><strong>${esc(e.name || "Episodio " + e.episode_number)}</strong></span>
      ${offlineEpisodes ? offlineDownloadButton({tmdbId:id, mediaType:"tv", season:n, episode:e.episode_number, title:`${seriesTitle} · T${n} E${e.episode_number} ${e.name || ""}`.trim(), posterPath:seriesPoster}) : ""}
    </${cardTag}>`).join("") || '<p class="episode-empty">No hay capítulos disponibles para esta temporada.</p>';
  }catch(e){ if (t === routeToken && request === episodeRequestToken) box.innerHTML = '<p class="episode-empty">No se pudieron cargar los capítulos. Vuelve a elegir la temporada para reintentar.</p>'; }
}
function filterEpisodeCards(query){
  const q = String(query || "").trim().toLocaleLowerCase("es");
  const cards = $$(".episode-card", $("#episodeList") || document);
  let visible = 0;
  cards.forEach(card => { const match = !q || card.dataset.search.includes(q); card.hidden = !match; if (match) visible++; });
  let empty = $("#episodeList .episode-empty");
  if (cards.length && !visible){
    if (!empty){ empty = document.createElement("p"); empty.className = "episode-empty"; $("#episodeList").append(empty); }
    empty.textContent = "No hay capítulos que coincidan con la búsqueda.";
    empty.hidden = false;
  } else if (empty && cards.length) empty.hidden = true;
}
function makePlayerContext(type,season,episode,metadata={}){
  const base=currentDetailContext || {id:"",type,title:"CINENOVA",runTime:45};
  if(type!=="tv") return {id:base.id,type,title:base.title,subtitle:"",runTime:0,next:null};
  const options=$$("#playSeason option"), current=options.findIndex(option=>Number(option.value)===Number(season));
  const seasonCount=Number(options[current]?.dataset.episodes)||currentEpisodeCount;
  let next=null;
  if(Number(episode)<seasonCount) next={season:Number(season),episode:Number(episode)+1};
  else if(options[current+1]) next={season:Number(options[current+1].value),episode:1};
  const trigger=lastPlaybackTrigger?.closest?.(".episode-card") || $$(".episode-card").find(card=>Number(card.dataset.season)===Number(season)&&Number(card.dataset.episode)===Number(episode)), name=metadata.name || trigger?.querySelector(".episode-meta strong")?.textContent?.trim() || `Episodio ${episode}`;
  const runtime=Number(metadata.runtime)||Number(trigger?.dataset.runtime)||base.runTime||45;
  return {id:base.id,type,title:base.title,subtitle:`${season}x${episode} · ${name}`,runTime:runtime,next};
}
function sendPlayerContext(frame){ if(currentPlayerContext) frame?.contentWindow?.postMessage({type:"cinenova-player-context",...currentPlayerContext},"*"); }
function startDetailPlayback(id, type, season = 1, episode = 1, metadata = {}){
  const numericId = String(id).match(/^\d+/)?.[0] || "";
  if (!numericId) return toast("No se pudo identificar este título.");
  id = numericId;
  lastPlaybackTrigger = document.activeElement;
  if(currentDetailContext) currentDetailContext.id=id;
  currentPlayerContext=makePlayerContext(type,season,episode,metadata);
  $(".player-next-ep-btn")?.setAttribute("hidden","");
  const overlayPlayback = isNativeApp() || isTvMode;
  const path = type === "tv" ? `f/embed/tv/${id}/${season}/${episode}` : `f/embed/movie/${id}`;
  const gatewaySrc = gatewayEmbedSrc(type, id, season, episode);
  const playerURL = new URL(gatewaySrc || unlimplayUrl(path), location.href);
  if (!gatewaySrc && (isTvMode || isNativeApp())) playerURL.searchParams.set("cn_tv", "1");
  const src = playerURL.href;
  if (overlayPlayback){
    $(".app-player-overlay")?.remove();
    const player = document.createElement("div"); player.className = "player-frame player-fullscreen app-player-overlay"; player.id = `player-${id}`;
    const frame = document.createElement("iframe");
    frame.title = "Reproductor de video"; frame.tabIndex = 0; frame.width = "100%"; frame.height = "100%"; frame.setAttribute("frameborder", "0"); frame.allowFullscreen = true;
    frame.allow = "autoplay; fullscreen; picture-in-picture; encrypted-media; remote-playback"; frame.referrerPolicy = "origin";
    const loader = createPlayerLoader(src, player);
    frame.addEventListener("load", () => { schedulePlayerLoaderRemoval(loader); sendPlayerContext(frame); focusPlayerFrame(frame, true); showPlayerHud(); }, {once:true});
    frame.addEventListener("error", () => { playerDebugErrors.push("Error al cargar el iframe: " + src); schedulePlayerLoaderRemoval(loader); showPlayerDebugInfo(player, src); }, {once:true});
    frame.src = src; player.append(loader, frame); createPlayerHud(player, frame); document.body.append(player);
    window.CinenovaTvRemote?.setPlayerFullscreen(true); requestAnimationFrame(() => frame.focus({preventScroll:true})); return;
  }
  const player = document.getElementById(`player-${id}`), frame = player?.querySelector("iframe");
  if (!player || !frame) return;
  if (frame.dataset.loadedSrc !== src){
    frame.dataset.loadedSrc = src;
    if (overlayPlayback){
      const loader = createPlayerLoader(); player.append(loader);
      frame.addEventListener("load", () => { sendPlayerContext(frame); schedulePlayerLoaderRemoval(loader); focusPlayerFrame(frame, true); }, {once:true});
    }
    frame.src = src;
  }
  createPlayerHud(player, frame);
  player.scrollIntoView({behavior:"smooth", block:"start"});
  if (isTvMode){
    player.classList.add("player-fullscreen");
    createPlayerHud(player, frame);
    showPlayerHud();
    window.CinenovaTvRemote?.setPlayerFullscreen(true);
    requestAnimationFrame(() => frame.focus({preventScroll:true}));
  }
}
function createPlayerHud(player, frame){
  const label=currentPlayerContext?.title ? `${currentPlayerContext.title}${currentPlayerContext.subtitle ? ` · ${currentPlayerContext.subtitle}` : ""}` : player.dataset.title || "";
  let title=$(".player-now-playing",player);
  if(!title){ title=document.createElement("div"); title.className="player-now-playing"; title.setAttribute("aria-live","polite"); player.append(title); }
  title.textContent=label; player.dataset.title=label;
  let next=$(".player-next-ep-btn",player);
  if(!next){ next=document.createElement("button"); next.type="button"; next.className="player-next-ep-btn"; next.tabIndex=0; next.hidden=true; next.addEventListener("click",()=>playFollowingEpisode()); player.append(next); }
  const info=currentPlayerContext?.next;
  next.textContent=info ? `▶ Siguiente capítulo · ${info.season}x${info.episode}` : "";
  if(!info) next.hidden=true;
  if (!isTvMode || $(".player-hud", player)) return;
  subtitlesEnabled = false;
  const hud = document.createElement("div"); hud.className = "player-hud";
  hud.append(title);
  const cc = document.createElement("button"); cc.type="button"; cc.className="player-cc-btn"; cc.textContent="CC"; cc.dataset.enabled="false"; cc.tabIndex=0;
  cc.setAttribute("aria-label","Subtítulos desactivados. Pulsa Enter para activarlos.");
  cc.addEventListener("click", () => {
    subtitlesEnabled = !subtitlesEnabled;
    cc.dataset.enabled = String(subtitlesEnabled);
    cc.textContent = subtitlesEnabled ? "CC ON" : "CC";
    cc.setAttribute("aria-label", subtitlesEnabled ? "Subtítulos activados. Pulsa Enter para desactivarlos." : "Subtítulos desactivados. Pulsa Enter para activarlos.");
    frame.contentWindow?.postMessage({type:"cinenova-toggle-subtitles",enabled:subtitlesEnabled,language:"es"}, "*");
    showPlayerHud();
  });
  const exit = document.createElement("button"); exit.type="button"; exit.className="player-exit-btn"; exit.textContent="← Salir"; exit.tabIndex=0;
  exit.setAttribute("aria-label","Salir del reproductor");
  exit.addEventListener("click", () => {
    try { frame?.contentWindow?.postMessage({type:"cinenova-player-exit-focus"}, "*"); } catch(e){}
    exitPlayerFullscreen();
  });
  hud.append(cc, exit); player.append(hud);
}
function showPlayerDebugInfo(player, src){
  if (!player?.isConnected) return;
  let info = $("#playerDebugInfo", player);
  if (!info){ info = document.createElement("small"); info.id = "playerDebugInfo"; info.className = "player-debug-info"; player.append(info); }
  info.hidden = false;
  const detail = playerDebugErrors.slice(-2).join(" · ");
  info.textContent = `URL: ${src || "sin URL"}${detail ? " · " + detail : ""}`;
}
function createPlayerLoader(src = "", player = null){
  const loader = document.createElement("div");
  loader.className = "player-loader"; loader.setAttribute("aria-live", "polite");
  loader.innerHTML = '<div class="spinner"></div><span>Cargando reproductor…</span>';
  loader._fallbackTimer = setTimeout(() => removePlayerLoader(loader), 4000);
  loader._debugTimer = setTimeout(() => showPlayerDebugInfo(player, src), 5000);
  return loader;
}
function schedulePlayerLoaderRemoval(loader){
  clearTimeout(loader._fallbackTimer); clearTimeout(loader._hideTimer); clearTimeout(loader._debugTimer);
  loader._hideTimer = setTimeout(() => removePlayerLoader(loader), 600);
}
function removePlayerLoader(loader){
  clearTimeout(loader._fallbackTimer); clearTimeout(loader._hideTimer); loader.remove();
}
function showPlayerHud(key){
  const player = $(".player-frame.player-fullscreen");
  player?.querySelector(".player-hud")?.classList.add("visible");
  if (player){
    clearTimeout(playerHudTimer);
    playerHudTimer = setTimeout(() => {
      const hud = $(".player-frame.player-fullscreen .player-hud");
      if (!hud) return;
      if (hud.contains(document.activeElement)) $(".player-frame.player-fullscreen iframe")?.focus({preventScroll:true});
      hud.classList.remove("visible");
    }, 3500);
  }
  player?.querySelector("iframe")?.contentWindow?.postMessage({type:"cinenova-show-controls",key}, "*");
}
["pointermove","mousemove"].forEach(type => document.addEventListener(type, () => {
  if ($(".player-frame.player-fullscreen")) showPlayerHud();
}, {passive:true}));
window.cinenovaExitPlayerFullscreen = () => {
  const frame = $(".player-frame.player-fullscreen iframe");
  $$(".player-frame.player-fullscreen").forEach(player => player.classList.remove("player-fullscreen"));
  $$(".app-player-overlay").forEach(player => { $$("video", player).forEach(video => { try{ video.pause(); }catch(e){} }); const loader=$(".player-loader",player); if(loader){ clearTimeout(loader._debugTimer); removePlayerLoader(loader); } $("#playerDebugInfo",player)?.remove(); player.remove(); });
  frame?.blur();
  window.CinenovaTvRemote?.setPlayerFullscreen(false);
  if (isTvMode) requestAnimationFrame(() => {
    const target = lastPlaybackTrigger?.isConnected ? lastPlaybackTrigger : $("[data-act='play-detail']") || $(".episode-card");
    target?.focus({preventScroll:true}); target?.scrollIntoView?.({block:"nearest",inline:"nearest"});
    lastPlaybackTrigger = null;
  });
};
window.addEventListener("message", event => {
  const type = event.data?.type;
  if (type === "cinenova-exit-player") exitPlayerFullscreen();
  else if (type === "cinenova-player-exit-focus") {
    const frame = $(".player-frame.player-fullscreen iframe, .app-player-overlay iframe");
    try { frame?.focus?.({preventScroll:true}); frame?.contentWindow?.postMessage({type:"cinenova-player-focus"}, "*"); } catch(e){}
    showPlayerHud();
  }
  else if (type === "cinenova-player-time") updateNextEpisodeButton(event.data?.currentTime, event.data?.duration);
  else if (type === "cinenova-player-subtitle-focus") { showPlayerHud(); $(".player-frame.player-fullscreen .player-cc-btn")?.focus({preventScroll:true}); }
  else if (type === "cinenova-player-activity") showPlayerHud();
  else if (type === "cinenova-player-back-confirmation") toast("Presiona Atrás otra vez para salir");
});
function updateNextEpisodeButton(currentTime, duration){
  const button = $(".player-next-ep-btn");
  if (!button) return;
  const time = Number(currentTime), total = Number(duration);
  const show = Boolean(currentPlayerContext?.next) && Number.isFinite(time) && Number.isFinite(total) && total > 300 && time > 0 && total - time <= 90;
  button.hidden = !show;
}
async function playFollowingEpisode(){
  const next=currentPlayerContext?.next, series=currentDetailContext;
  const numericId = String(series?.id || "").match(/^\d+/)?.[0] || "";
  if(!next || !series || series.type!=="tv" || !numericId) return toast("No hay otro capítulo disponible.");
  let metadata={name:`Episodio ${next.episode}`,runtime:series.runTime};
  try{ const season=await api(`/tv/${numericId}/season/${next.season}`), match=season.episodes?.find(item=>Number(item.episode_number)===Number(next.episode)); if(match) metadata={name:match.name||metadata.name,runtime:Number(match.runtime)||metadata.runtime}; }catch(e){}
  if($("#playSeason")){ $("#playSeason").value=String(next.season); loadSeason(numericId,next.season); }
  startDetailPlayback(numericId,"tv",next.season,next.episode,metadata);
}

function focusPlayerFrame(frame, autoplay = false){
  try{
    frame.focus({preventScroll:true}); const win = frame.contentWindow;
    let doc; try { doc = frame.contentDocument; } catch(e) { doc = null; }
    win?.postMessage({type:autoplay ? "cinenova-player-autoplay" : "cinenova-player-focus"}, "*");
    if (!doc) return;
    installSameOriginPlayerBridge(doc, win);
    win?.focus();
    if (doc){ const active = doc.activeElement; if (!active || active === doc.body || active === doc.documentElement){
      const play = doc.querySelector("#pbtn, .pbtn, video, button, [tabindex='0']");
      if (play && play !== doc.querySelector("video")) play.focus?.({preventScroll:true});
      else { doc.body.tabIndex = -1; doc.body.focus({preventScroll:true}); }
    }}
  }catch(e){}
}
function installSameOriginPlayerBridge(doc, win){
  if (!doc?.documentElement || doc.documentElement.dataset.cinenovaPlayerBridge) return;
  doc.documentElement.dataset.cinenovaPlayerBridge = "1";
  const send = type => { try { win.parent.postMessage({type}, "*"); } catch(e){} };
  const view = doc.defaultView || win;
  const arrows = ["ArrowLeft","ArrowRight","ArrowUp","ArrowDown"];
  let lastBackPressAt = 0;
  view.addEventListener("keyup", e => { if (arrows.includes(e.key)) { e.preventDefault(); e.stopImmediatePropagation(); } }, true);
  view.addEventListener("keypress", e => { if (arrows.includes(e.key)) { e.preventDefault(); e.stopImmediatePropagation(); } }, true);
  view.addEventListener("keydown", e => {
    if (["Escape","Backspace","BrowserBack"].includes(e.key)){
      e.preventDefault(); e.stopImmediatePropagation();
      const now = Date.now();
      if (now - lastBackPressAt <= 1400) { lastBackPressAt = 0; send("cinenova-exit-player"); }
      else { lastBackPressAt = now; send("cinenova-player-back-confirmation"); }
      return;
    }
    lastBackPressAt = 0;
    send("cinenova-player-activity");
    const video = doc.querySelector("video");
    if (["Enter"," ","MediaPlayPause"].includes(e.key)){
      e.preventDefault(); e.stopImmediatePropagation();
      if (video){ if (video.paused) video.play?.().catch?.(() => {}); else video.pause(); }
      else { const target=doc.activeElement; if (target && target!==doc.body) target.click?.(); }
    } else if (arrows.includes(e.key)) {
      e.preventDefault(); e.stopImmediatePropagation();
      const active=doc.activeElement||doc.body;
      {
        const controls=[...doc.querySelectorAll('button:not(:disabled),a[href],select:not(:disabled),input:not(:disabled):not([type="hidden"]),[role="button"],[role="menuitem"],[role="option"],[tabindex],[onclick],li,.item')].filter(el=>el.getClientRects().length&&getComputedStyle(el).visibility!=="hidden"&&getComputedStyle(el).display!=="none");
        const focused=active.closest?.('button,a[href],select,input,[role="button"],[role="menuitem"],[role="option"],[tabindex],[onclick],li,.item');
        const rect=focused?.getBoundingClientRect();
        if (!controls.includes(focused)) controls[0]?.focus({preventScroll:true});
        else {
          const top = Math.min(...controls.map(el=>el.getBoundingClientRect().top));
          const topRow = rect.top <= top + Math.max(40, rect.height*.8);
          const row = controls.filter(el=>Math.abs(el.getBoundingClientRect().top-rect.top)<Math.max(30,rect.height*.7));
          { const dx=e.key==="ArrowLeft"?-1:e.key==="ArrowRight"?1:0,dy=e.key==="ArrowUp"?-1:e.key==="ArrowDown"?1:0,cx=rect.left+rect.width/2,cy=rect.top+rect.height/2; const next=controls.filter(el=>el!==focused).map(el=>{const r=el.getBoundingClientRect(),x=r.left+r.width/2,y=r.top+r.height/2,p=dx?(x-cx)*dx:(y-cy)*dy,c=dx?Math.abs(y-cy):Math.abs(x-cx);return{el,score:p+c*1.5,p};}).filter(x=>x.p>4).sort((a,b)=>a.score-b.score)[0]; next?.el.focus({preventScroll:true}); next?.el.scrollIntoView?.({block:"nearest",inline:"nearest"}); }
        }
      }
    }
  }, true);
  win.addEventListener("message", e => {
    if (e.source !== win.parent || !["cinenova-player-focus","cinenova-player-autoplay"].includes(e.data?.type)) return;
    const play=doc.querySelector('#pbtn,.pbtn,.play-overlay,[class*="play-overlay" i],[aria-label*="play" i],[title*="play" i],video');
    if (play && play.tagName !== "VIDEO"){ play.focus?.({preventScroll:true}); if(e.data.type === "cinenova-player-autoplay") play.click?.(); }
    else if (play?.tagName === "VIDEO"){ if(e.data.type === "cinenova-player-autoplay") play.play?.().catch?.(() => {}); doc.body.tabIndex=-1; doc.body.focus({preventScroll:true}); }
  });
  const installFrame = child => {
    const attach=()=>{ try{ installSameOriginPlayerBridge(child.contentDocument,child.contentWindow); }catch(e){} };
    child.addEventListener("load",attach); attach();
  };
  doc.querySelectorAll("iframe").forEach(installFrame);
  new MutationObserver(()=>doc.querySelectorAll("iframe").forEach(child=>{
    if(child.dataset.cinenovaObserved)return; child.dataset.cinenovaObserved="1"; installFrame(child);
  })).observe(doc.documentElement,{childList:true,subtree:true});
}
function handleFullscreenPlayerKey(key, player, event){
  if (!player || player.classList.contains("offline-player-overlay")) return false;
  if (!["ArrowUp","ArrowDown","ArrowLeft","ArrowRight","Enter"," ","MediaPlayPause"].includes(key)) return false;
  const frame = $("iframe", player);
  event?.preventDefault(); event?.stopImmediatePropagation();
  if (key === " "){ frame?.contentWindow?.postMessage({type:"cinenova-player-key",key:" "}, "*"); return true; }
  frame?.contentWindow?.postMessage({type:"cinenova-player-key", key}, "*");
  return true;
}
function handlePlayerHudKey(key, player, event){
  const hud = $(".player-hud", player), focused = document.activeElement;
  const nextBtn = $(".player-next-ep-btn:not([hidden])", player);
  if (nextBtn?.contains(focused)){
    event?.preventDefault(); event?.stopImmediatePropagation(); showPlayerHud();
    if (key === "Enter") { nextBtn.click(); return true; }
    if (key === "ArrowLeft" || key === "ArrowRight") { $(".player-cc-btn", hud)?.focus({preventScroll:true}); return true; }
    return true;
  }
  if (!hud?.contains(focused)) return false;
  const frame = $("iframe", player);
  event?.preventDefault(); event?.stopImmediatePropagation(); showPlayerHud();
  if (key === "Enter") { focused.click(); return true; }
  if (["ArrowLeft","ArrowRight","ArrowUp","ArrowDown"].includes(key)) {
    frame?.focus({preventScroll:true}); frame?.contentWindow?.postMessage({type:"cinenova-player-key",key}, "*"); return true;
  }
  return true;
}
window.cinenovaForwardPlayerKey = key => {
  if (!["Escape","Backspace","BrowserBack"].includes(key)) lastPlayerBackTime = 0;
  if (["Escape","Backspace","BrowserBack"].includes(key) && $(".player-frame.player-fullscreen")) return handlePlayerBack();
  const keyForEmbed = ["ArrowUp","ArrowDown","ArrowLeft","ArrowRight","Enter"," ","MediaPlayPause"].includes(key) ? key : undefined;
  showPlayerHud(keyForEmbed);
  activateNativeTvMode();
  const player = $(".player-frame.player-fullscreen");
  if (player && handlePlayerHudKey(key, player)) return true;
  if (player && handleFullscreenPlayerKey(key, player)) return true;
  const frame = $(".app-player-overlay iframe, .player-frame.player-fullscreen iframe");
  const win = frame?.contentWindow;
  if (!win) return false;
  try { win.postMessage({type:"cinenova-player-key", key}, "*"); } catch(e) { return false; }
  return true;
};

async function person(id){
  const t = routeToken;
  app.innerHTML = `<div class="dsk"></div>`;
  let p;
  try{ p = await api(`/person/${id}`, {append_to_response:"combined_credits,external_ids"}); }
  catch(e){ if (t === routeToken) notFound(); return; }
  if (!p.biography){ try{ p.biography = (await api(`/person/${id}`, {language:"en-US"})).biography; }catch(e){} }
  if (t !== routeToken) return;
  document.title = p.name + " — CINENOVA";
  setSeo(`${p.name} — CINENOVA`, p.biography || `Biografía y películas de ${p.name}.`, `/persona/${encodeURIComponent(id)}`);
  const seen = new Set();
  const credits = [...(p.combined_credits?.cast || []), ...(p.combined_credits?.crew || [])]
    .filter(c => c.poster_path && (!kidsModeEnabled || isChildCatalogItem(c, c.media_type)) && !seen.has(c.media_type + c.id) && seen.add(c.media_type + c.id))
    .sort((a, b) => (b.vote_count || 0) - (a.vote_count || 0)).slice(0, 60);
  const age = p.birthday ? Math.floor(((p.deathday ? new Date(p.deathday) : new Date()) - new Date(p.birthday)) / 31557600000) : null;
  app.innerHTML = `<div class="page"><div class="phead">
    <div class="dposter">${p.profile_path ? `<img src="${img(p.profile_path, "h632")}" alt="">` : `<div class="noimg" style="aspect-ratio:2/3">👤</div>`}</div>
    <div style="flex:1;min-width:260px">
      <h1 style="font-size:38px;font-weight:900;margin-bottom:8px">${esc(p.name)}</h1>
      <div class="facts">
        <span>${esc(p.known_for_department || "")}</span>
        ${p.birthday ? `<span>Nacimiento: ${fmtDate(p.birthday)}${!p.deathday && age ? ` (${age} años)` : ""}</span>` : ""}
        ${p.deathday ? `<span>Fallecimiento: ${fmtDate(p.deathday)}${age ? ` (${age} años)` : ""}</span>` : ""}
        ${p.place_of_birth ? `<span>${esc(p.place_of_birth)}</span>` : ""}
      </div>
      <div class="bio clamp" id="bio">${esc(p.biography || "Sin biografía disponible.")}</div>
      ${(p.biography || "").length > 600 ? `<button class="linkbtn" id="bioMore">Leer más</button>` : ""}
    </div></div>
    <section class="block"><h2>Conocido/a por</h2><div class="grid">${credits.map(c => card(c)).join("") || '<p class="muted">Sin créditos.</p>'}</div></section></div>`;
  const more = $("#bioMore");
  if (more) more.onclick = () => { $("#bio").classList.remove("clamp"); more.remove(); };
}

const favs = () => store.get("mi_lista", []);
const isFav = (type, id) => favs().some(f => f.type === type && f.id == id);
function toggleFav(type, id){
  const l = favs(), i = l.findIndex(f => f.type === type && f.id == id);
  if (i >= 0){ l.splice(i, 1); toast("Quitado de Mi lista"); }
  else { const it = ITEMS.get(type + ":" + id); if (!it) return false; l.unshift(it); toast("Agregado a Mi lista"); }
  store.set("mi_lista", l);
  return i < 0;
}
function myList(){
  document.title = "Mi lista — CINENOVA";
  setSeo("Mi lista — CINENOVA", "Tu colección personal de películas y series guardadas.", "/mi-lista", null, "noindex, follow");
  const l = kidsModeEnabled ? favs().filter(x => isChildCatalogItem(x, x.type)) : favs();
  app.innerHTML = `<div class="page"><h1>Mi lista</h1>${l.length ? `<div class="grid">${l.map(x => card(x, x.type)).join("")}</div>` : `<p class="muted">Todavía no agregaste nada. Usá el botón “+ Mi lista” en cualquier película o serie.</p>`}</div>`;
}
function notFound(){ app.innerHTML = `<div class="page"><h1>No encontrado</h1><p class="muted">Esta página no existe. <a href="#/" style="color:var(--accent)">Volver al inicio</a></p></div>`; }

const LEGAL_PAGES = {
  terminos:["Términos de uso", "CINENOVA facilita la consulta de fichas y metadatos de obras audiovisuales. El uso del sitio debe respetar la legislación aplicable y los derechos de terceros. Los enlaces a servicios externos se ofrecen tal como están y cada proveedor establece sus propias condiciones."],
  privacidad:["Privacidad", "CINENOVA utiliza almacenamiento local del navegador para preferencias como la lista personal. Las solicitudes de metadatos se realizan a TMDB y los enlaces externos pueden aplicar sus propias políticas. No ingreses información sensible en el sitio."],
  dmca:["DMCA / Aviso legal", "CINENOVA funciona como indexador de metadatos y enlaces externos; no aloja archivos audiovisuales. Los derechos sobre obras y marcas pertenecen a sus titulares. Si representas a un titular y deseas informar sobre una referencia, incluye la obra, URL afectada, acreditación de titularidad y un medio de contacto verificable."],
  contacto:["Contacto", "Para consultas sobre fichas o avisos de derechos, incluye la URL afectada, una descripción clara de tu solicitud y un medio de contacto verificable. Esta versión no publica una dirección de correo ni almacena mensajes; evita incluir información sensible en el sitio."]
};
function legalPage(key){
  const [title, copy] = LEGAL_PAGES[key];
  setSeo(`${title} — CINENOVA`, copy, `/${key}`);
  app.innerHTML = `<article class="page legal-page"><h1>${esc(title)}</h1><p>${esc(copy)}</p><p>Este sitio no almacena ningún archivo en su servidor. Todo el contenido es proporcionado por terceros no afiliados.</p><a class="btn ghost" href="#/">Volver al inicio</a></article>`;
}

/* ===== ROUTER ===== */
function parseHash(){ const h = location.hash.slice(1) || "/"; const [p, qs] = h.split("?"); return {parts:p.split("/").filter(Boolean), q:new URLSearchParams(qs || "")}; }
function hashFromPath(){
  if (location.hash) return;
  const p = location.pathname.replace(/^\/+|\/+$/g, "");
  if (!p) return;
  const map = {pelicula:"movie", serie:"tv"};
  const parts = p.split("/");
  if (map[parts[0]] && parts[1]) history.replaceState(null, "", `/#/${map[parts[0]]}/${encodeURIComponent(parts[1])}`);
  else if (["peliculas","series","tendencias","buscar","anime","doramas","mi-lista","terminos","privacidad","dmca","contacto"].includes(parts[0]) || parts[0] === "lista") history.replaceState(null, "", `/#/${p}`);
}
let currentRouteHash = null;
const routeTrail = [];
let skipRouteTrailPush = false;
function router(){
  if (location.hash === "#donde") return;
  const nextRouteHash = location.hash || "#/";
  if (currentRouteHash !== nextRouteHash){
    if (currentRouteHash && !skipRouteTrailPush){ routeTrail.push(currentRouteHash); if (routeTrail.length > 40) routeTrail.shift(); }
    skipRouteTrailPush = false;
    currentRouteHash = nextRouteHash;
  }
  cleanup.splice(0).forEach(f => { try{ f(); }catch(e){} });
  routeToken++;
  const {parts, q} = parseHash();
  document.documentElement.style.scrollBehavior = "auto";
  window.scrollTo(0, 0); document.documentElement.scrollTop = 0; document.body.scrollTop = 0;
  requestAnimationFrame(() => { window.scrollTo(0, 0); document.documentElement.style.removeProperty("scroll-behavior"); });
  const activeRoute = parts[0] === "lista"
    ? ((parts[1] || "").startsWith("infantiles") ? "infantiles" : (parts[1] || "lista"))
    : (parts[0] || "");
  document.body.classList.toggle("home-route", !activeRoute);
  $$(`[data-r]`).forEach(a => a.classList.toggle("active", a.dataset.r === activeRoute));
  const [a, b] = parts;
  if (kidsModeEnabled && a && !(a === "lista" && (b || "").startsWith("infantiles")) && a !== "buscar" && a !== "movie" && a !== "tv") { location.hash = "#/"; return; }
  if (!a) return home();
  if (a === "peliculas") return explore("movie", q);
  if (a === "series") return explore("tv", q);
  if (a === "tendencias") return trending(q);
  if (a === "anime") return listPage("anime");
  if (a === "doramas") return listPage("doramas");
  if (a === "lista") return listPage(b);
  if (a === "buscar") return search(q);
  if (a === "descargas") return canUseOfflineDownloads() ? downloadsView() : notFound();
  if (a === "mi-lista") return myList();
  if (LEGAL_PAGES[a]) return legalPage(a);
  if ((a === "movie" || a === "tv") && b){
    const numericId = String(parseInt(b, 10) || "").match(/^\d+/)?.[0] || "";
    if (numericId) return detail(a, numericId);
    return notFound();
  }
  if (a === "person" && b) return person(b);
  notFound();
}

/* ===== MODAL / TOAST ===== */
let modalLocked = false;
let lastModalTrigger = null;
let lastBackTime = 0;
function openModal(html, cls = "", locked = false){
  lastModalTrigger = document.activeElement;
  modalLocked = locked;
  $("#mbox").className = "mbox " + cls;
  $("#mclose").style.display = locked ? "none" : "";
  $("#mbody").innerHTML = html;
  $("#modal").classList.remove("hidden");
  if (!locked) requestAnimationFrame(() => $("#mclose")?.focus({preventScroll:true}));
}
async function codeDigest(value){
  const data = new TextEncoder().encode(`CINENOVA:${value}`);
  if (window.crypto?.subtle){ const hash = await crypto.subtle.digest("SHA-256",data); return [...new Uint8Array(hash)].map(b=>b.toString(16).padStart(2,"0")).join(""); }
  return btoa(String.fromCharCode(...data));
}
let pinPress = null;
function setKidsMode(enabled){
  kidsModeEnabled = enabled;
  store.set(KIDS_MODE_KEY, enabled);
  document.body.classList.toggle("kids-mode", enabled);
  const badge = $("#kidsBadge"); if (badge) badge.hidden = !enabled;
  cache.clear();
  closeModal();
  if (enabled && location.hash !== "#/") location.hash = "#/"; else router();
}
function renderSettings(status = ""){
  pinPress = null;
  const hasPin = Boolean(store.get(KIDS_PIN_KEY, ""));
  openModal(`<section class="settings-modal">
    <h2>Configuración</h2><p class="muted">Preferencias guardadas en este dispositivo.</p>
    <div class="settings-card"><h3>Modo Infantil</h3>
      <p class="muted">Muestra solo películas y series aptas para niños. Para volver al catálogo completo se requiere el PIN de 4 dígitos.</p>
      <button id="kidsToggleBtn" class="btn primary" type="button">${kidsModeEnabled ? "Desactivar modo infantil" : hasPin ? "Activar modo infantil" : "Crear PIN y activar"}</button>
      <p class="muted" role="status">${kidsModeEnabled ? "Modo infantil activado" : hasPin ? "Modo infantil desactivado · PIN configurado" : "Todavía no hay un PIN configurado"}</p>
      ${status ? `<p class="muted">${esc(status)}</p>` : ""}
    </div>
  </section>`,"settings-modal-shell");
  $("#kidsToggleBtn")?.addEventListener("click", () => {
    if (!kidsModeEnabled){ if (!hasPin) renderPinScreen("create"); else setKidsMode(true); }
    else renderPinScreen("disable");
  });
}
function openSettings(){ renderSettings(); }
function renderPinScreen(mode){
  const creating = mode === "create";
  let value = "", busy = false;
  openModal(`<section class="settings-modal pin-modal">
    <h2>${creating ? "Crear PIN de 4 dígitos" : "Ingresá tu PIN"}</h2>
    <p class="muted">${creating ? "Elegí un código para activar y salir del modo infantil." : "Necesitás el código de adulto para desactivar el modo infantil."}</p>
    <div id="pinDisplay" class="pin-dots" aria-label="PIN ingresado" aria-live="polite"></div>
    <div id="pinPad" class="pin-pad">${[1,2,3,4,5,6,7,8,9].map(n => `<button type="button" data-pin="${n}" aria-label="${n}">${n}</button>`).join("")}<button type="button" data-pin="del" aria-label="Borrar">⌫</button><button type="button" data-pin="0" aria-label="0">0</button></div>
    <p id="pinStatus" class="muted" role="status"></p>
    <button id="pinCancel" class="btn ghost" type="button">Cancelar</button>
  </section>`,"settings-modal-shell");
  const display = $("#pinDisplay"), status = $("#pinStatus");
  const paint = () => { display.textContent = "●".repeat(value.length) + "○".repeat(4 - value.length); };
  const press = async digit => {
    if (busy) return;
    if (digit === "del"){ value = value.slice(0, -1); paint(); return; }
    if (!/^\d$/.test(digit) || value.length >= 4) return;
    value += digit; paint();
    if (value.length < 4) return;
    busy = true; status.textContent = "Verificando…";
    if (creating){ store.set(KIDS_PIN_KEY, await codeDigest(value)); toast("PIN guardado. Modo infantil activado."); setKidsMode(true); }
    else if ((await codeDigest(value)) === store.get(KIDS_PIN_KEY, "")){ setKidsMode(false); toast("Modo infantil desactivado."); }
    else { status.textContent = "PIN incorrecto. Intentá de nuevo."; value = ""; paint(); busy = false; }
  };
  pinPress = press;
  $$("#pinPad button").forEach(button => button.addEventListener("click", () => press(button.dataset.pin)));
  $("#pinCancel").addEventListener("click", () => renderSettings());
  paint();
  requestAnimationFrame(() => $("#pinPad button")?.focus({preventScroll:true}));
}
document.addEventListener("keydown", e => {
  if (!pinPress || $("#modal").classList.contains("hidden")) return;
  if (/^[0-9]$/.test(e.key) || e.key === "Backspace"){
    e.preventDefault(); e.stopImmediatePropagation();
    pinPress(/^\d$/.test(e.key) ? e.key : "del");
  }
}, true);
function closeModal(){ if (modalLocked) return; pinPress = null; $("#modal").classList.add("hidden"); $("#mbody").innerHTML = ""; if (lastModalTrigger?.isConnected) lastModalTrigger.focus({preventScroll:true}); }
function exitPlayerFullscreen(){
  window.cinenovaExitPlayerFullscreen?.();
  if (document.fullscreenElement && document.exitFullscreen) document.exitFullscreen().catch(() => {});
}
function handlePlayerBack(){
  const now = Date.now();
  if (now - lastPlayerBackTime > 1400){
    lastPlayerBackTime = now;
    showPlayerHud();
    toast("Presiona Atrás otra vez para salir");
    return true;
  }
  lastPlayerBackTime = 0;
  exitPlayerFullscreen();
  return true;
}
function handleAppBack(){
  const now = Date.now();
  if (!$("#modal").classList.contains("hidden")){ closeModal(); return true; }
  if (document.fullscreenElement || $(".player-frame.player-fullscreen")) return handlePlayerBack();
  if (now - lastBackTime < 350) return true;
  lastBackTime = now;
  if (routeTrail.length){ skipRouteTrailPush = true; location.hash = routeTrail.pop(); return true; }
  if (location.hash && location.hash !== "#/" && location.hash !== "#"){ skipRouteTrailPush = true; routeTrail.length = 0; location.hash = "#/"; return true; }
  return false;
}
window.onAndroidBackPressed = handleAppBack;
document.addEventListener("fullscreenchange", () => {
  const frame = $(".player-frame.player-fullscreen iframe");
  if (isTvMode && document.fullscreenElement && frame?.contains(document.fullscreenElement)){
    suppressPlayerNativeFullscreenExit = true;
    if (document.exitFullscreen) document.exitFullscreen().catch(() => { suppressPlayerNativeFullscreenExit = false; });
    else suppressPlayerNativeFullscreenExit = false;
    return;
  }
  if (!document.fullscreenElement){
    if (suppressPlayerNativeFullscreenExit){ suppressPlayerNativeFullscreenExit = false; return; }
    window.cinenovaExitPlayerFullscreen?.();
  }
});
$("#mclose").onclick = closeModal;
$("#modal").onclick = e => { if (e.target.id === "modal") closeModal(); };
function focusTvSidebar(){
  const sidebar = $("#tvSidebar");
  if (!sidebar) return false;
  const isVisible = el => el.getClientRects().length && getComputedStyle(el).visibility !== "hidden" && getComputedStyle(el).display !== "none";
  const active = $("[data-r].active", sidebar);
  const target = active && isVisible(active) ? active : $$('a[href],button:not(:disabled),[tabindex="0"]', sidebar).find(isVisible);
  target?.focus({preventScroll:true});
  return Boolean(target);
}
const suppressFullscreenSpace = e => {
  const player = $(".player-frame.player-fullscreen");
  if (!player || !(e.key === " " || e.code === "Space")) return;
  if (e.type === "keydown") showPlayerHud();
  e.preventDefault();
  e.stopImmediatePropagation();
  if (e.type === "keydown") $("iframe", player)?.contentWindow?.postMessage({type:"cinenova-player-key",key:" "}, "*");
};
window.addEventListener("keydown", suppressFullscreenSpace, true);
window.addEventListener("keyup", suppressFullscreenSpace, true);
window.addEventListener("keydown", e => {
  if (!["Escape","Backspace","BrowserBack"].includes(e.key)) lastPlayerBackTime = 0;
  if ($(".player-frame.player-fullscreen")) {
    const keyForEmbed = ["ArrowUp","ArrowDown","ArrowLeft","ArrowRight","Enter"," ","MediaPlayPause"].includes(e.key) ? e.key : undefined;
    showPlayerHud(keyForEmbed);
  }
  if (["ArrowUp","ArrowDown","ArrowLeft","ArrowRight"].includes(e.key) && isNativeApp()) activateNativeTvMode();
  const editing = e.target.matches("input,textarea,select,[contenteditable='true']");
  if (["Escape","Backspace"].includes(e.key) && !editing){ if (handleAppBack()){ e.preventDefault(); e.stopImmediatePropagation(); } }
  const modal = $("#modal");
  if (!modal.classList.contains("hidden") && e.key.startsWith("Arrow")){
    e.preventDefault(); e.stopPropagation();
    const items = $$("#modal button:not(:disabled),#modal a[href],#modal [tabindex='0'],#modal input:not(:disabled),#modal select:not(:disabled)")
      .filter(el => el.getClientRects().length && getComputedStyle(el).visibility !== "hidden");
    const current = document.activeElement, rect = current.getBoundingClientRect();
    const [dx,dy] = ({ArrowLeft:[-1,0],ArrowRight:[1,0],ArrowUp:[0,-1],ArrowDown:[0,1]})[e.key];
    const cx = rect.left + rect.width/2, cy = rect.top + rect.height/2;
    const candidate = items.filter(el => el !== current).map(el => {
      const r = el.getBoundingClientRect(), x = r.left+r.width/2, y = r.top+r.height/2;
      const primary = dx ? (x-cx)*dx : (y-cy)*dy, cross = dx ? Math.abs(y-cy) : Math.abs(x-cx);
      return {el,score:primary+cross*1.5};
    }).filter(v => v.score > 4).sort((a,b)=>a.score-b.score)[0];
    (candidate?.el || items[0] || $("#mclose"))?.focus({preventScroll:true}); return;
  }
  if (isTvMode && e.target.matches("#searchQuery") && e.key === "Enter" && e.target.readOnly){
    e.preventDefault();
    if(e.target.value.trim()){ e.target.form?.requestSubmit(); return; }
    e.target.readOnly = false; e.target.blur(); e.target.focus(); e.target.select(); return;
  }
  if (isTvMode && e.target.matches("#searchQuery") && e.target.readOnly && e.key === "ArrowLeft"){
    e.preventDefault(); $("#tvSidebar [data-r='buscar']")?.focus({preventScroll:true}); return;
  }
  if (isTvMode && e.target.matches("#searchQuery") && e.key === "ArrowDown"){
    const first = $("#grid .card"); if (first){ e.preventDefault(); first.focus({preventScroll:true}); first.scrollIntoView({block:"center",inline:"nearest",behavior:"smooth"}); return; }
  }
  if (isTvMode && e.target.matches("#playSeason")){
    if (e.key === "ArrowLeft"){ e.preventDefault(); focusTvSidebar(); return; }
    if (e.key === "ArrowUp"){ e.preventDefault(); $("[data-act='play-detail']")?.focus({preventScroll:true}); return; }
    if (e.key === "ArrowRight" || e.key === "ArrowDown"){
      e.preventDefault();
      const episode = $(".episode-card"), tab = $(".detail-tabs .detail-tab");
      if (episode){ episode.focus({preventScroll:true}); episode.scrollIntoView({block:"nearest",inline:"nearest"}); }
      else tab?.focus({preventScroll:true});
      return;
    }
  }
  if (e.key === "Enter" && e.target.matches('[role="button"][tabindex="0"]') && !e.target.matches("button,a")){ e.preventDefault(); e.target.click(); return; }
  const playerOverlay = $(".player-frame.player-fullscreen");
  if (playerOverlay && handlePlayerHudKey(e.key, playerOverlay, e)) return;
  if (playerOverlay && handleFullscreenPlayerKey(e.key, playerOverlay, e)) return;
  if (!isTvMode || editing || !e.key.startsWith("Arrow")) return;
  const current = document.activeElement;
  const playerOverlayFallback = $(".player-frame.player-fullscreen");
  if (playerOverlayFallback) { if (e.key.startsWith("Arrow")) showPlayerHud(); return; }
  const sideMenu = current.closest("#tvSidebar");
  if (sideMenu){
    if (e.key === "ArrowUp" || e.key === "ArrowDown"){
      const menuItems = $$("a[href],button:not(:disabled)", sideMenu).filter(el => el.getClientRects().length && getComputedStyle(el).display !== "none");
      const at = menuItems.indexOf(current), next = menuItems[at + (e.key === "ArrowUp" ? -1 : 1)];
      if (next){ e.preventDefault(); next.focus({preventScroll:true}); next.scrollIntoView({block:"nearest"}); }
      return;
    }
    if (e.key === "ArrowRight"){
      const mainItems = $$("#app a[href],#app button:not(:disabled),#app select:not(:disabled),#app input:not(:disabled)")
        .filter(el => el.getClientRects().length && !el.closest("[hidden]"));
      if (mainItems[0]){ e.preventDefault(); mainItems[0].focus({preventScroll:true}); mainItems[0].scrollIntoView({block:"nearest",inline:"nearest"}); }
      return;
    }
    return;
  }
  if (isTvMode && !editing && e.key === "ArrowLeft" && !e.target.closest("#modal,.player-frame.player-fullscreen")){
    const currentRect = current.getBoundingClientRect();
    const currentCenterX = currentRect.left + currentRect.width / 2;
    const appControls = $$('#app a[href],#app button:not(:disabled):not(.arr),#app select:not(:disabled),#app input:not(:disabled),#app [tabindex="0"]')
      .filter(el => el !== current && el.getClientRects().length && getComputedStyle(el).visibility !== "hidden" && getComputedStyle(el).display !== "none" && !el.closest("[hidden]"));
    const hasLeftNeighbor = appControls.some(el => {
      const rect = el.getBoundingClientRect(), centerX = rect.left + rect.width / 2;
      const verticalOverlap = Math.min(currentRect.bottom, rect.bottom) - Math.max(currentRect.top, rect.top);
      const sameRow = verticalOverlap > Math.min(currentRect.height, rect.height) * .35
        || Math.abs(rect.top + rect.height / 2 - (currentRect.top + currentRect.height / 2)) <= Math.max(24, Math.min(currentRect.height, rect.height) * .65);
      return centerX < currentCenterX - 4 && sameRow;
    });
    if (!hasLeftNeighbor){ e.preventDefault(); focusTvSidebar(); return; }
  }
  const tabs = $(".detail-tabs");
  if (tabs && current.closest(".detail-tabs")){
    const items = $$(".detail-tab", tabs), index = items.indexOf(current);
    if (e.key === "ArrowLeft" || e.key === "ArrowRight"){
      e.preventDefault(); const next = items[index + (e.key === "ArrowLeft" ? -1 : 1)];
      if (next){ next.focus({preventScroll:true}); activateDetailTab(next.dataset.detailTab); next.scrollIntoView({block:"nearest",inline:"nearest",behavior:"smooth"}); }
      else if (e.key === "ArrowLeft") focusTvSidebar();
      return;
    }
    if (e.key === "ArrowDown"){
      const activePanel = $(".detail-panel:not([hidden])");
      const first = activePanel && $$('a[href],button:not(.arr):not(:disabled),select:not(:disabled),[tabindex="0"]', activePanel)
        .find(el => el.getClientRects().length && getComputedStyle(el).visibility !== "hidden" && getComputedStyle(el).display !== "none" && !el.closest("[hidden]"));
      if (first){ e.preventDefault(); first.focus({preventScroll:true}); first.scrollIntoView({block:"nearest",inline:"nearest"}); }
      return;
    }
  }
  if (current.matches(".detail-tab") && e.key === "ArrowUp"){
    e.preventDefault(); $("[data-act='play-detail']")?.focus({preventScroll:true}); return;
  }
  const actionGroup = current.closest(".dinfo .actions");
  if (actionGroup && (e.key === "ArrowLeft" || e.key === "ArrowRight")){
    const items = $$('button:not(:disabled)', actionGroup), index = items.indexOf(current);
    const next = items[index + (e.key === "ArrowLeft" ? -1 : 1)];
    if (index >= 0){ e.preventDefault(); if (next) next.focus({preventScroll:true}); else if (e.key === "ArrowLeft") $("#tvSidebar [data-r].active")?.focus({preventScroll:true}); return; }
  }
  if (current.closest(".detail-panel") && e.key === "ArrowLeft"){
    const rect = current.getBoundingClientRect();
    if (rect.left <= 20){ e.preventDefault(); $("#tvSidebar [data-r].active")?.focus({preventScroll:true}); return; }
  }
  const heroControl = current.closest(".hero-carousel-controls") && current.closest(".hero-arrow, .hero-thumb");
  if (heroControl){
    if (e.key === "ArrowLeft" || e.key === "ArrowRight"){
      const controls = $$(".hero-carousel-controls .hero-arrow, .hero-carousel-controls .hero-thumb").filter(el => el.getClientRects().length);
      const index = controls.indexOf(current), next = controls[index + (e.key === "ArrowLeft" ? -1 : 1)];
      if (index >= 0){ e.preventDefault(); if (next){ next.focus({preventScroll:true}); next.scrollIntoView({block:"nearest",inline:"center",behavior:"smooth"}); } else if (e.key === "ArrowLeft" && index === 0) $("#tvSidebar [data-r].active")?.focus({preventScroll:true}); return; }
    }
    if (e.key === "ArrowUp"){ const watch = $(".hero [data-hero-action='watch']"); if (watch){ e.preventDefault(); watch.focus({preventScroll:true}); } return; }
    if (e.key === "ArrowDown"){ const card = $(".row .scroller .card"); if (card){ e.preventDefault(); card.focus({preventScroll:true}); card.scrollIntoView({block:"nearest",inline:"nearest"}); } return; }
  }
  const heroActions = current.closest(".hero .actions");
  if (heroActions && (e.key === "ArrowLeft" || e.key === "ArrowRight")){
    const actions = $$("[data-hero-action]", heroActions), index = actions.indexOf(current);
    const next = actions[index + (e.key === "ArrowLeft" ? -1 : 1)];
    if (index >= 0){ e.preventDefault(); if (next) next.focus({preventScroll:true}); return; }
  }
  if (heroActions && e.key === "ArrowDown"){
    const thumb = $(".hero-thumb");
    if (thumb){ e.preventDefault(); thumb.focus({preventScroll:true}); thumb.scrollIntoView({block:"nearest",inline:"center"}); return; }
  }
  if (heroActions && e.key === "ArrowUp"){
    e.preventDefault(); window.scrollTo({top:0,behavior:"smooth"}); return;
  }
  const episodeRail = current.closest(".episode-list");
  if (episodeRail && current.matches(".episode-card")){
    const cards = $$(".episode-card", episodeRail).filter(el => !el.hidden && el.getClientRects().length);
    const index = cards.indexOf(current), columns = Math.max(1, getComputedStyle(episodeRail).gridTemplateColumns.split(" ").filter(Boolean).length);
    const delta = e.key === "ArrowLeft" ? -1 : e.key === "ArrowRight" ? 1 : e.key === "ArrowUp" ? -columns : e.key === "ArrowDown" ? columns : 0;
    if (index >= 0 && delta){
      e.preventDefault();
      if (e.key === "ArrowUp" && index < columns) { $("#playSeason")?.focus({preventScroll:true}); return; }
      if (e.key === "ArrowDown" && index + columns >= cards.length) { $(".detail-tabs .detail-tab")?.focus({preventScroll:true}); return; }
      if (e.key === "ArrowLeft" && index % columns === 0) { focusTvSidebar(); return; }
      const next = cards[index + delta];
      if (next){ next.focus({preventScroll:true}); next.scrollIntoView({block:"nearest",inline:"nearest",behavior:"smooth"}); }
      return;
    }
  }
  const grid = current.closest(".grid");
  if (current.matches(".card") && grid){
    const cards = $$(".card", grid).filter(el => !el.hidden && el.getClientRects().length);
    const index = cards.indexOf(current);
    if (index >= 0){
      const columns = Math.max(1, getComputedStyle(grid).gridTemplateColumns.split(" ").filter(Boolean).length);
      const delta = e.key === "ArrowUp" ? -columns : e.key === "ArrowDown" ? columns : e.key === "ArrowLeft" ? -1 : e.key === "ArrowRight" ? 1 : 0;
      if (delta){ e.preventDefault(); const next = cards[index + delta];
        if (next){ next.focus({preventScroll:true}); next.scrollIntoView({block:"nearest",inline:"nearest",behavior:"smooth"}); }
        else if (e.key === "ArrowLeft" && index % columns === 0) $("#tvSidebar [data-r].active")?.focus({preventScroll:true});
        else if (e.key === "ArrowUp" && index < columns){
          const top = $("#searchQuery") || $(".tabs .chip.on") || $(".page h1");
          if (top){ if (top.tagName === "H1") top.setAttribute("tabindex","-1"); top.focus({preventScroll:true}); }
          window.scrollTo({top:0,behavior:"smooth"});
        }
        return;
      }
    }
  }
  if (e.key === "ArrowUp" && current.matches(".scroller .card")){
    const rows = $$("section.row"), row = current.closest("section.row");
    if (row && rows[0] === row){
      const firstAction = $(".hero [data-hero-action='watch']");
      if (firstAction){ e.preventDefault(); firstAction.focus({preventScroll:true}); window.scrollTo({top:0,behavior:"smooth"}); return; }
    }
  }
  if (e.key === "ArrowDown" && current.closest(".dinfo .actions")){
    const episode = $(".episode-card"); if (episode){ e.preventDefault(); episode.focus({preventScroll:true}); episode.scrollIntoView({block:"center",inline:"nearest"}); return; }
  }
  const scroller = current.closest(".scroller");
  if (current.matches(".card") && scroller && (e.key === "ArrowLeft" || e.key === "ArrowRight")){
    const cards = $$(".card", scroller).filter(el => !el.hidden && el.getClientRects().length);
    const at = cards.indexOf(current), next = cards[at + (e.key === "ArrowLeft" ? -1 : 1)];
    e.preventDefault();
    if (next){ next.focus({preventScroll:true}); next.scrollIntoView({block:"nearest",inline:"nearest",behavior:"smooth"}); }
    else if (e.key === "ArrowLeft" && at === 0) $("#tvSidebar [data-r].active")?.focus({preventScroll:true});
    return;
  }
  const rowLink = current.closest(".rhead")?.querySelector("a");
  if (e.key === "ArrowDown" && rowLink === current){
    const firstCard = current.closest(".row")?.querySelector(".scroller .card");
    if (firstCard){ e.preventDefault(); firstCard.focus({preventScroll:true}); firstCard.scrollIntoView({block:"nearest",inline:"nearest"}); }
    return;
  }
  if (e.key === "ArrowDown" && current.closest(".hero .actions")){
    const firstCard = $(".row .scroller .card");
    if (firstCard){ e.preventDefault(); firstCard.focus({preventScroll:true}); firstCard.scrollIntoView({block:"nearest",inline:"nearest"}); }
    return;
  }
  const directions = {ArrowUp:[0,-1],ArrowDown:[0,1],ArrowLeft:[-1,0],ArrowRight:[1,0]};
  const [dx,dy] = directions[e.key];
  const focusables = $$('a[href],button:not(:disabled):not(.arr),select:not(:disabled),input:not(:disabled),[tabindex="0"]:not(.arr)')
    .filter(el => el.getClientRects().length && getComputedStyle(el).visibility !== "hidden");
  if (!focusables.includes(current)){ focusables[0]?.focus(); return; }
  const from = current.getBoundingClientRect(), fx = from.left + from.width/2, fy = from.top + from.height/2;
  const candidates = focusables.filter(el => el !== current).map(el => {
    const r = el.getBoundingClientRect(), x = r.left + r.width/2, y = r.top + r.height/2;
    const px = (x-fx)*dx, py = (y-fy)*dy, primary = dx ? px : py, cross = dx ? Math.abs(y-fy) : Math.abs(x-fx);
    return {el, primary, cross, score:primary + cross*1.6};
  }).filter(v => v.primary > 4).sort((a,b) => a.score-b.score);
  if (candidates.length){
    e.preventDefault(); candidates[0].el.focus({preventScroll:true});
    const atTopHero = candidates[0].el.closest(".hero, .dhero");
    candidates[0].el.scrollIntoView({block:atTopHero && e.key === "ArrowUp" ? "start" : "nearest",inline:"nearest",behavior:"smooth"});
    if (atTopHero && e.key === "ArrowUp") window.scrollTo({top:0,behavior:"smooth"});
    return;
  }
  if (e.key === "ArrowUp"){ e.preventDefault(); window.scrollTo({top:0,behavior:"smooth"}); }
  if (scroller && dx){ e.preventDefault(); scroller.scrollBy({left:dx*scroller.clientWidth*.75,behavior:"smooth"}); }
});
let toastT;
function toast(msg){ const t = $("#toast"); t.textContent = msg; t.classList.add("show"); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove("show"), 2200); }

document.addEventListener("click", e => {
  if (e.target.closest("[data-open-settings],#tvSettings")){ e.preventDefault(); openSettings(); return; }
  const arr = e.target.closest(".arr");
  if (arr){ const sc = arr.parentElement.querySelector(".scroller"); sc.scrollBy({left:(arr.classList.contains("r") ? 1 : -1) * sc.clientWidth * .85}); return; }
  const vaultAction = e.target.closest("[data-vault]");
  if (vaultAction){ e.preventDefault(); e.stopPropagation(); handleVaultAction(vaultAction); return; }
  const act = e.target.closest("[data-act]");
  if (act){
    const a = act.dataset.act;
    if (a === "offline-download"){ e.preventDefault(); e.stopPropagation(); startOfflineDownload(offlineMetaFromElement(act)); return; }
    if (a === "open-downloads"){ e.preventDefault(); e.stopPropagation(); location.hash = "#/descargas"; return; }
    if (a === "play-detail"){
      activateDetailTab(act.dataset.tab);
      const season = Number($("#playSeason")?.value || 1), episode = Number($("#playEpisode")?.value || 1);
      startDetailPlayback(act.dataset.id, act.dataset.type, season, episode, {name:act.closest(".episode-card")?.querySelector(".episode-meta strong")?.textContent?.trim()});
    }
    if (a === "play-current-episode" || a === "play-episode"){
      const season = Number(act.dataset.season || $("#playSeason")?.value || 1);
      const episode = Number(act.dataset.episode || $("#playEpisode")?.value || 1);
      if ($("#playSeason")) $("#playSeason").value = String(season);
      if ($("#playEpisode")) $("#playEpisode").value = String(episode);
      activateDetailTab("ver");
      startDetailPlayback(act.dataset.id, "tv", season, episode, {name:act.querySelector(".episode-meta strong")?.textContent?.trim(),runtime:Number(act.dataset.runtime)||0});
    }
    if (a === "trailer") playTrailer(act.dataset.type, act.dataset.id);
    if (a === "video") playVideo(act.dataset.key);
    if (a === "fav"){ const on = toggleFav(act.dataset.type, act.dataset.id); act.classList.toggle("fav-on", on); act.textContent = on ? "✓ En Mi lista" : "+ Mi lista"; }
    if (a === "share"){ const url = location.href; if (navigator.share) navigator.share({title:document.title, url}).catch(() => {}); else navigator.clipboard?.writeText(url).then(() => toast("Link copiado")); }
    return;
  }
  const sc = e.target.closest("[data-scroll]");
  if (sc){ e.preventDefault(); document.getElementById(sc.dataset.scroll)?.scrollIntoView({behavior:"smooth"}); return; }
});

/* ===== INICIO ===== */
$("#yr").textContent = new Date().getFullYear();
window.addEventListener("hashchange", router);
(async () => {
  hashFromPath();
  const localBrowser = (location.hostname === "127.0.0.1" || location.hostname === "localhost") && !isNativeApp();
  let configData = {};
  try{
    const cfg = await fetch("./app-config.json", {headers:{accept:"application/json"}});
    if (cfg.ok) configData = await cfg.json();
  }catch(e){}
  if (!localBrowser && typeof configData.apiBaseUrl === "string" && configData.apiBaseUrl.trim()) API_BASE_URL = configData.apiBaseUrl.trim().replace(/\/$/, "");
  await applyGatewayConfig(configData);
  try{ await loadGenres(); }catch(e){}
  if (canUseOfflineDownloads()) refreshDownloads();
  router();
})();
