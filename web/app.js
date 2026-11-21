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
let REGION = CONFIG.REGION;
const GENRES = { movie:{}, tv:{} };
const ITEMS = new Map();          // datos mínimos para "Mi lista"
const cleanup = [];
let routeToken = 0;
let episodeRequestToken = 0;
const app = $("#app");
let isTvMode = false;
function isNativeApp(){
  return Boolean((window.Capacitor && window.Capacitor.isNativePlatform?.())
    || (location.hostname === "localhost" && /Android/i.test(navigator.userAgent || "")));
}
function updateDeviceMode(){
  const ua = navigator.userAgent || "";
  const nativeApp = isNativeApp();
  const tvUa = /Android TV|SmartTV|BRAVIA|AFT|Chromecast|GoogleTV|HbbTV/i.test(ua);
  let nativeTv = false;
  try { nativeTv = window.CinenovaTvRemote?.isTelevisionDevice?.() === true; } catch(e) {}
  const forced = new URLSearchParams(location.search).get("tv") === "1";
  const coarseLarge = matchMedia("(min-width: 1024px) and (pointer: coarse)").matches;
  isTvMode = forced || tvUa || coarseLarge || nativeTv;
  document.body.classList.toggle("native-app", nativeApp);
  document.body.classList.toggle("tv-mode", isTvMode);
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
function api(path, params = {}){
  const u = new URL(API_BASE_URL.replace(/\/$/, "") + "/api/tmdb" + path);
  u.searchParams.set("language", CONFIG.LANG);
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== "") u.searchParams.set(k, v);
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
function remember(it, t){ const type = typeOf(it, t); ITEMS.set(type + ":" + it.id, {id:it.id, type, title:titleOf(it), poster_path:it.poster_path, vote_average:it.vote_average, release_date:it.release_date, first_air_date:it.first_air_date}); }
function genreNames(it, t){ const map = GENRES[typeOf(it, t)] || {}; return (it.genre_ids || []).map(id => map[id]).filter(Boolean).slice(0, 3).join(" · "); }

function posterImg(it){ const src = img(it.poster_path, "w342"); return src ? `<img loading="lazy" src="${src}" alt="${esc(titleOf(it))}">` : `<div class="noimg">${esc(titleOf(it))}</div>`; }
function card(it, t){
  const type = typeOf(it, t);
  if (type === "person") return personCard(it);
  return `<a class="card" href="#/${type}/${it.id}"><div class="poster">${posterImg(it)}<span class="badge">★ ${score(it.vote_average)}</span><span class="tbadge">${typeName(type)}</span></div><div class="ctitle">${esc(titleOf(it))}</div><div class="cmeta">${year(it) || "—"}</div></a>`;
}
function personCard(p, sub){
  return `<a class="card person" href="#/person/${p.id}"><div class="poster round">${p.profile_path ? `<img loading="lazy" src="${img(p.profile_path, "w185")}" alt="">` : `<div class="noimg">👤</div>`}</div><div class="ctitle">${esc(p.name)}</div><div class="cmeta">${esc(sub ?? p.character ?? p.known_for_department ?? "")}</div></a>`;
}
function topCard(it, i, t){ return `<a class="card" href="#/${typeOf(it, t)}/${it.id}"><span class="num">${i + 1}</span><div class="poster">${posterImg(it)}<span class="badge">★ ${score(it.vote_average)}</span></div></a>`; }
const skel = n => Array.from({length:n}, () => `<div class="card sk"><div class="poster"></div></div>`).join("");
function staticRow(title, inner, extra = ""){ return inner ? `<section class="block"><div class="rhead"><h2>${esc(title)}</h2>${extra}</div><div class="rwrap"><button class="arr l">‹</button><div class="scroller">${inner}</div><button class="arr r">›</button></div></section>` : ""; }

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
  "infantiles":        {t:"Películas infantiles", type:"movie", path:"/discover/movie", p:() => ({with_genres:10751, include_adult:false, sort_by:"popularity.desc"}), tabs:["infantiles","infantiles-series","infantiles-animacion","infantiles-dibujos"]},
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
    return `<section class="row ${L.top ? "top" : ""}" data-list="${k}"><div class="rhead"><h2>${esc(L.t)}</h2><a href="#/lista/${k}">Ver todo ›</a></div><div class="rwrap"><button class="arr l">‹</button><div class="scroller">${skel(L.top ? 6 : 8)}</div><button class="arr r">›</button></div></section>`;
  }).join("");
}
async function fillRow(sec){
  const L = LISTS[sec.dataset.list], sc = $(".scroller", sec);
  try{
    const d = await api(L.path, L.p ? L.p() : {});
    const items = (d.results || []).filter(x => x.poster_path);
    if (!items.length){ sec.remove(); return; }
    sc.innerHTML = L.top ? items.slice(0, 10).map((it, i) => topCard(it, i, L.type)).join("") : items.map(it => card(it, L.type)).join("");
  }catch(e){ sc.innerHTML = `<div class="err">No se pudo cargar esta sección.</div>`; }
}
function observeRows(root){
  const io = new IntersectionObserver(es => es.forEach(e => { if (e.isIntersecting){ io.unobserve(e.target); fillRow(e.target); } }), {rootMargin:"700px"});
  $$("section.row[data-list]", root).forEach(s => io.observe(s));
  cleanup.push(() => io.disconnect());
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
  app.innerHTML = `<section class="hero" id="hero"></section>` + rowsHTML([
    "top-peliculas","top-series","estrenos","netflix","mejor-series","populares-peliculas","anime","doramas",
    "disney","hbo","prime","peliculas-coreanas","argentinas","latinas","proximamente",
    ...GENRE_ROWS.map(g => "genero-" + g[0]),
    "infantiles","infantiles-series","telenovelas","guerra-politica","documentales-series","mejor-peliculas","en-emision"]);
  observeRows(app);
  try{
    const d = await api("/trending/all/day");
    if (t !== routeToken) return;
    renderHero(d.results.filter(x => x.backdrop_path && x.media_type !== "person").slice(0, 7));
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
    const it = items[cur], type = it.media_type, fav = isFav(type, it.id);
    const ov = (it.overview || "").length > 230 ? it.overview.slice(0, 230).trim() + "…" : (it.overview || "");
    $("#hc").innerHTML = `<div class="hcontent" key="${cur}">
      <span class="tag">${typeName(type)} ${year(it)}</span><span class="rating">★ ${score(it.vote_average)}</span>
      <h1>${esc(titleOf(it))}</h1>
      <div class="hgen">${esc(genreNames(it))}</div>
      <p>${esc(ov)}</p>
      <div class="actions">
        <a class="btn" data-hero-action="watch" href="#/${type}/${it.id}">▶ Ver ahora</a>
        <button class="btn ghost" data-hero-action="trailer" data-act="trailer" data-type="${type}" data-id="${it.id}">🎬 Tráiler</button>
        <button class="btn ghost ${fav ? "fav-on" : ""}" data-hero-action="favorite" data-act="fav" data-type="${type}" data-id="${it.id}">${fav ? "✓ En Mi lista" : "+ Mi lista"}</button>
      </div>
      <div class="hero-carousel-controls" aria-label="Controles del carrusel">
        <button class="hero-arrow" type="button" data-hero-step="-1" aria-label="Destacado anterior">‹</button>
        <div class="hero-indicators hero-thumbnails" role="group" aria-label="Elegir destacado">
          ${items.map((x, k) => `<button class="hero-thumb ${k === cur ? "active" : ""}" type="button" data-slide="${k}" aria-label="Mostrar ${esc(titleOf(x))}" aria-pressed="${k === cur}"><img loading="lazy" src="${img(x.poster_path, "w185")}" alt=""><span>${esc(titleOf(x))}</span></button>`).join("")}
        </div>
        <button class="hero-arrow" type="button" data-hero-step="1" aria-label="Siguiente destacado">›</button>
      </div>
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
  const tabs = L.tabs ? `<div class="tabs">${L.tabs.map(x => `<a class="chip ${x === k ? "on" : ""}" href="#/lista/${x}">${esc(LISTS[x].t)}</a>`).join("")}</div>` : "";
  app.innerHTML = `<div class="page"><h1>${esc(L.t)}</h1>${tabs}<div class="grid" id="grid"></div></div>`;
  infiniteGrid($("#grid"), L.path, L.p ? L.p() : {}, L.type, x => x.poster_path);
}

function search(q){
  const query = (q.get("q") || "").trim(), tipo = q.get("tipo") || "multi";
  document.title = `Buscar: ${query} — CINENOVA`;
  const form = `<form class="search-page-form" id="searchForm"><input id="searchQuery" type="search" value="${esc(query)}" ${isTvMode ? "readonly" : ""} placeholder="Buscar películas, series o actores" aria-label="Buscar películas, series o actores"><button class="btn primary" type="submit">Buscar</button></form>`;
  if (!query){
    app.innerHTML = `<div class="page search-page"><h1>Buscar</h1>${form}<p class="muted">Escribí un título, una serie o el nombre de un actor.</p></div>`;
    bindSearchForm();
    return;
  }
  const l = t => `#/buscar?q=${encodeURIComponent(query)}&tipo=${t}`;
  app.innerHTML = `<div class="page search-page"><h1>Resultados para “${esc(query)}”</h1>${form}
    <div class="tabs">${[["multi","Todo"],["movie","Películas"],["tv","Series"],["person","Personas"]].map(([v, n]) => `<a class="chip ${v === tipo ? "on" : ""}" href="${l(v)}">${n}</a>`).join("")}</div>
    <div class="grid" id="grid"></div></div>`;
  bindSearchForm();
  infiniteGrid($("#grid"), "/search/" + tipo, {query, include_adult:false}, tipo === "multi" ? undefined : tipo, x => x.poster_path || x.profile_path, (grid, items) => {
    if (isTvMode && items.length) requestAnimationFrame(() => {
      const first = $(".card", grid);
      first?.focus({preventScroll:true});
      first?.scrollIntoView({block:"center", inline:"nearest"});
    });
  });
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
function providersHTML(p){
  if (!p) return `<p class="muted">No hay información de plataformas para ${esc(REGIONS[REGION] || REGION)}.</p>`;
  const grp = (arr, label) => arr?.length ? `<div class="pgroup"><h4>${label}</h4><div class="plist">${arr.map(x => `<a href="${esc(p.link)}" target="_blank" rel="noopener" class="prov" title="${esc(x.provider_name)}"><img loading="lazy" src="${img(x.logo_path, "w92")}" alt=""><span>${esc(x.provider_name)}</span></a>`).join("")}</div></div>` : "";
  const h = grp(p.flatrate, "Suscripción") + grp(p.free, "Gratis") + grp(p.ads, "Gratis con anuncios") + grp(p.rent, "Alquiler") + grp(p.buy, "Compra");
  return h || `<p class="muted">Sin plataformas disponibles en esta región.</p>`;
}

async function detail(type, id){
  const t = routeToken;
  app.innerHTML = `<div class="dsk"></div>`;
  const append = ["videos","credits","recommendations","similar","watch/providers","external_ids","keywords", type === "movie" ? "release_dates" : "content_ratings"].join(",");
  let d;
  try{ d = await api(`/${type}/${id}`, {append_to_response:append, include_video_language:"es,en,null"}); }
  catch(e){ if (t === routeToken) notFound(); return; }
  if (t !== routeToken) return;
  if (!d.overview){ try{ const en = await api(`/${type}/${id}`, {language:"en-US"}); d.overview = en.overview; }catch(e){} }
  if (t !== routeToken) return;
  remember(d, type);
  const title = titleOf(d);
  const appPlayback = isNativeApp();
  const tvApp = appPlayback && isTvMode;
  const defaultTvTab = type === "movie" ? "similares" : "reparto";
  document.title = title + " — CINENOVA";
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
  const vids = (d.videos?.results || []).filter(v => v.site === "YouTube").slice(0, 12)
    .map(v => `<div class="vcard" role="button" tabindex="0" data-act="video" data-key="${esc(v.key)}"><div class="vthumb"><img loading="lazy" src="https://i.ytimg.com/vi/${esc(v.key)}/hqdefault.jpg" alt=""></div><div class="ctitle">${esc(v.name)}</div><div class="cmeta">${esc(v.type)}</div></div>`).join("");
  const recs = (d.recommendations?.results || []).filter(x => x.poster_path).map(x => card(x, type)).join("");
  const sim = (d.similar?.results || []).filter(x => x.poster_path).map(x => card(x, type)).join("");
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
  const episodeBrowserHTML = type === "tv" ? `<section class="episode-browser ${appPlayback ? "episode-browser-app" : ""}" aria-label="Capítulos de la serie">
      <div class="episode-browser-head"><div><h3>Episodios</h3><p id="episodeSeasonLabel">Temporada ${initialSeasonNumber} · Elegí un capítulo para reproducir.</p></div>
        <label class="season-picker">Temporada<select id="playSeason">${seasonList.map(s => `<option value="${s.season_number}" data-episodes="${s.episode_count}" ${s.season_number === initialSeasonNumber ? "selected" : ""}>${esc(s.name)}</option>`).join("") || '<option value="1" data-episodes="1">Temporada 1</option>'}</select></label>
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
          <button class="btn ghost ${fav ? "fav-on" : ""}" data-act="fav" data-type="${type}" data-id="${d.id}">${fav ? "✓ En Mi lista" : "+ Mi lista"}</button>
          ${tvApp ? "" : '<button class="btn ghost" data-act="share">↗ Compartir</button>'}
        </div>
        ${crewBits.length && !tvApp ? `<div class="crew">${crewBits.join("")}</div>` : ""}
      </div>
    </div>
  </section>
  ${appPlayback && type === "tv" ? episodeBrowserHTML : ""}
  <nav class="detail-tabs" role="tablist" aria-label="Secciones del título">
    ${(appPlayback ? [["reparto","Reparto"],["similares","Similares"],["trailer","Tráiler"]] : [["ver","Ver"],["reparto","Reparto"],["detalles","Detalles"],["similares","Similares"],["trailer","Tráiler"]]).map(([key,label], i) => `<button class="detail-tab ${(!appPlayback && i === 0) || (tvApp && key === defaultTvTab) ? "active" : ""}" role="tab" aria-selected="${(!appPlayback && i === 0) || (tvApp && key === defaultTvTab)}" data-detail-tab="${key}">${label}</button>`).join("")}
  </nav>
  ${appPlayback ? "" : `<section class="detail-panel" id="panel-ver" role="tabpanel">
    <h2 class="player-title">Ver ahora: ${esc(title)}</h2>
    <div class="player-frame" id="player-${d.id}"><iframe src="about:blank" title="Reproductor de video" tabindex="0" width="100%" height="100%" frameBorder="0" allowFullScreen allow="autoplay; fullscreen; picture-in-picture; encrypted-media; remote-playback" referrerPolicy="origin"></iframe></div>
    ${type === "tv" ? episodeBrowserHTML : ""}
  </section>`}
  <section class="detail-panel" id="panel-reparto" role="tabpanel" ${tvApp && defaultTvTab === "reparto" ? "" : "hidden"}>${staticRow("Reparto", cast)}${tvApp && crewBits.length ? `<section class="block"><h2>${type === "movie" ? "Dirección y guion" : "Creación"}</h2><div class="crew">${crewBits.join("")}</div></section>` : ""}</section>
  ${appPlayback ? "" : `<section class="detail-panel" id="panel-detalles" role="tabpanel" hidden>
    <section class="block"><h2>Información</h2><div class="info">${info}</div>${kws.length ? `<div style="margin-top:18px"><b class="muted" style="font-size:12px;text-transform:uppercase;letter-spacing:1px">Palabras clave</b><div class="kw">${kws.map(k => `<span>${esc(k.name)}</span>`).join("")}</div></div>` : ""}</section>
  </section>`}
  <section class="detail-panel" id="panel-similares" role="tabpanel" ${tvApp && defaultTvTab === "similares" ? "" : "hidden"}>${staticRow("Recomendadas", recs)}${staticRow("Títulos similares", sim)}${tvApp && defaultTvTab === "similares" && !recs && !sim ? '<section class="block"><p class="muted">No hay títulos similares disponibles.</p></section>' : ""}</section>
  <section class="detail-panel" id="panel-trailer" role="tabpanel" hidden>${staticRow("Tráileres y videos", vids)}</section>`;
  $$("[data-detail-tab]").forEach(tab => tab.onclick = () => activateDetailTab(tab.dataset.detailTab));
  const playerFrame = $(`#player-${d.id} iframe`);
  playerFrame?.addEventListener("load", () => { if (isTvMode) focusPlayerFrame(playerFrame); });
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
  const t = routeToken, request = ++episodeRequestToken, box = $("#episodeList");
  if (!box) return;
  box.innerHTML = '<p class="episode-empty">Cargando capítulos…</p>';
  try{
    const s = await api(`/tv/${id}/season/${n}`);
    if (t !== routeToken || request !== episodeRequestToken) return;
    box.innerHTML = (s.episodes || []).map(e => `<button class="episode-card" data-act="play-episode" data-type="tv" data-id="${id}" data-season="${n}" data-episode="${e.episode_number}" data-search="${esc(e.name || "").toLowerCase()}" aria-label="Reproducir temporada ${n}, episodio ${e.episode_number}: ${esc(e.name || "")}">
      ${e.still_path ? `<img loading="lazy" src="${img(e.still_path, "w300")}" alt="">` : '<span class="episode-thumb-fallback"></span>'}
      <span><strong>E${e.episode_number}. ${esc(e.name || "Episodio " + e.episode_number)}</strong><small>${fmtDate(e.air_date)}${e.runtime ? " · " + e.runtime + " min" : ""}</small></span>
      <span class="episode-play-icon" aria-hidden="true">▶</span>
    </button>`).join("") || '<p class="episode-empty">No hay capítulos disponibles para esta temporada.</p>';
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
function startDetailPlayback(id, type, season = 1, episode = 1){
  const path = type === "tv" ? `f/embed/tv/${id}/${season}/${episode}` : `f/embed/movie/${id}`;
  const playerURL = new URL(unlimplayUrl(path), location.href);
  if (isTvMode) playerURL.searchParams.set("cn_tv", "1");
  const src = playerURL.href;
  if (isNativeApp()){
    $(".app-player-overlay")?.remove();
    const player = document.createElement("div"); player.className = "player-frame player-fullscreen app-player-overlay"; player.id = `player-${id}`;
    const frame = document.createElement("iframe");
    frame.title = "Reproductor de video"; frame.tabIndex = 0; frame.width = "100%"; frame.height = "100%"; frame.setAttribute("frameborder", "0"); frame.allowFullscreen = true;
    frame.allow = "autoplay; fullscreen; picture-in-picture; encrypted-media; remote-playback"; frame.referrerPolicy = "origin";
    frame.addEventListener("load", () => focusPlayerFrame(frame), {once:true}); player.append(frame); document.body.append(player);
    window.CinenovaTvRemote?.setPlayerFullscreen(true); frame.src = src; requestAnimationFrame(() => focusPlayerFrame(frame)); return;
  }
  const player = document.getElementById(`player-${id}`), frame = player?.querySelector("iframe");
  if (!player || !frame) return;
  if (frame.dataset.loadedSrc !== src){
    frame.dataset.loadedSrc = src;
    if (isTvMode) frame.addEventListener("load", () => focusPlayerFrame(frame), {once:true});
    frame.src = src;
  }
  player.scrollIntoView({behavior:"smooth", block:"start"});
  if (isTvMode){
    player.classList.add("player-fullscreen");
    window.CinenovaTvRemote?.setPlayerFullscreen(true);
    if (isTvMode) requestAnimationFrame(() => frame.focus({preventScroll:true}));
  }
}
window.cinenovaExitPlayerFullscreen = () => {
  const frame = $(".player-frame.player-fullscreen iframe");
  $$(".player-frame.player-fullscreen").forEach(player => player.classList.remove("player-fullscreen"));
  $$(".app-player-overlay").forEach(player => player.remove());
  frame?.blur();
  window.CinenovaTvRemote?.setPlayerFullscreen(false);
  if (isTvMode) requestAnimationFrame(() => $("[data-act='play-detail']")?.focus({preventScroll:true}) || $(".episode-card")?.focus({preventScroll:true}));
};

function focusPlayerFrame(frame){
  try{
    frame.focus({preventScroll:true}); const win = frame.contentWindow;
    let doc; try { doc = frame.contentDocument; } catch(e) { doc = null; }
    if (!doc){ win?.postMessage({type:"cinenova-player-focus"}, "*"); return; }
    win?.focus();
    if (doc){ const active = doc.activeElement; if (!active || active === doc.body || active === doc.documentElement){
      const play = doc.querySelector("#pbtn, .pbtn, video, button, [tabindex='0']");
      if (play && play !== doc.querySelector("video")) play.focus?.({preventScroll:true});
      else { doc.body.tabIndex = -1; doc.body.focus({preventScroll:true}); }
    }}
  }catch(e){}
}
window.cinenovaForwardPlayerKey = key => {
  const frame = $(".app-player-overlay iframe, .player-frame.player-fullscreen iframe");
  try{
    const win = frame?.contentWindow; if (!win) return false;
    let doc; try { doc = frame.contentDocument; } catch(e) { doc = null; }
    if (!doc){ win.postMessage({type:"cinenova-player-key", key}, "*"); return true; }
    const target = doc.activeElement || doc.body;
    const legacyCode = ({ArrowLeft:37,ArrowUp:38,ArrowRight:39,ArrowDown:40,Enter:13," ":32})[key];
    const keyEvent = new win.KeyboardEvent("keydown", {key, code:key === " " ? "Space" : key, bubbles:true, cancelable:true});
    try { Object.defineProperty(keyEvent, "keyCode", {get:() => legacyCode}); Object.defineProperty(keyEvent, "which", {get:() => legacyCode}); } catch(e){}
    target.dispatchEvent(keyEvent);
    target.dispatchEvent(new win.KeyboardEvent("keyup", {key, code:key === " " ? "Space" : key, bubbles:true, cancelable:true}));
    if (key === "Enter" && target !== doc.body && target.matches?.("button,a,select,input,[role='button'],[tabindex='0']")) target.click();
    return true;
  }catch(e){ return false; }
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
  const seen = new Set();
  const credits = [...(p.combined_credits?.cast || []), ...(p.combined_credits?.crew || [])]
    .filter(c => c.poster_path && !seen.has(c.media_type + c.id) && seen.add(c.media_type + c.id))
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
  const l = favs();
  app.innerHTML = `<div class="page"><h1>Mi lista</h1>${l.length ? `<div class="grid">${l.map(x => card(x, x.type)).join("")}</div>` : `<p class="muted">Todavía no agregaste nada. Usá el botón “+ Mi lista” en cualquier película o serie.</p>`}</div>`;
}
function notFound(){ app.innerHTML = `<div class="page"><h1>No encontrado</h1><p class="muted">Esta página no existe. <a href="#/" style="color:var(--accent)">Volver al inicio</a></p></div>`; }

/* ===== ROUTER ===== */
function parseHash(){ const h = location.hash.slice(1) || "/"; const [p, qs] = h.split("?"); return {parts:p.split("/").filter(Boolean), q:new URLSearchParams(qs || "")}; }
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
  $$(`[data-r]`).forEach(a => a.classList.toggle("active", a.dataset.r === activeRoute));
  const [a, b] = parts;
  if (!a) return home();
  if (a === "peliculas") return explore("movie", q);
  if (a === "series") return explore("tv", q);
  if (a === "tendencias") return trending(q);
  if (a === "anime") return listPage("anime");
  if (a === "doramas") return listPage("doramas");
  if (a === "lista") return listPage(b);
  if (a === "buscar") return search(q);
  if (a === "mi-lista") return myList();
  if ((a === "movie" || a === "tv") && b) return detail(a, b);
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
function closeModal(){ if (modalLocked) return; $("#modal").classList.add("hidden"); $("#mbody").innerHTML = ""; if (lastModalTrigger?.isConnected) lastModalTrigger.focus({preventScroll:true}); }
function exitPlayerFullscreen(){
  window.cinenovaExitPlayerFullscreen?.();
  if (document.fullscreenElement && document.exitFullscreen) document.exitFullscreen().catch(() => {});
}
function handleAppBack(){
  const now = Date.now();
  if (now - lastBackTime < 350) return true;
  lastBackTime = now;
  if (!$("#modal").classList.contains("hidden")){ closeModal(); return true; }
  if (document.fullscreenElement || $(".player-frame.player-fullscreen")){ exitPlayerFullscreen(); return true; }
  if (routeTrail.length){ skipRouteTrailPush = true; location.hash = routeTrail.pop(); return true; }
  if (location.hash && location.hash !== "#/" && location.hash !== "#"){ skipRouteTrailPush = true; routeTrail.length = 0; location.hash = "#/"; return true; }
  return false;
}
window.onAndroidBackPressed = handleAppBack;
document.addEventListener("fullscreenchange", () => {
  if (!document.fullscreenElement) window.cinenovaExitPlayerFullscreen?.();
});
$("#mclose").onclick = closeModal;
$("#modal").onclick = e => { if (e.target.id === "modal") closeModal(); };
document.addEventListener("keydown", e => {
  const editing = e.target.matches("input,textarea,select,[contenteditable='true']");
  if (["Escape","Backspace"].includes(e.key) && !editing){ if (handleAppBack()){ e.preventDefault(); e.stopImmediatePropagation(); } }
  if ($(".player-frame.player-fullscreen") && isTvMode && !editing) return;
  if (isTvMode && e.target.matches("#searchQuery") && e.key === "Enter" && e.target.readOnly){
    e.preventDefault(); e.target.readOnly = false; e.target.blur(); e.target.focus(); e.target.select(); return;
  }
  if (isTvMode && e.target.matches("#searchQuery") && e.key === "ArrowDown"){
    const first = $("#grid .card"); if (first){ e.preventDefault(); first.focus({preventScroll:true}); first.scrollIntoView({block:"center",inline:"nearest",behavior:"smooth"}); return; }
  }
  if (e.key === "Enter" && e.target.matches('[role="button"][tabindex="0"]') && !e.target.matches("button,a")){ e.preventDefault(); e.target.click(); return; }
  if (!isTvMode || editing || !e.key.startsWith("Arrow")) return;
  const current = document.activeElement;
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
  const player = $(".player-frame.player-fullscreen");
  if (player) return;
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
  if (episodeRail && (e.key === "ArrowLeft" || e.key === "ArrowRight")){
    const cards = $$(".episode-card", episodeRail).filter(el => !el.hidden);
    const index = cards.indexOf(current), next = cards[index + (e.key === "ArrowLeft" ? -1 : 1)];
    if (index >= 0){ e.preventDefault(); if (next){ next.focus({preventScroll:true}); next.scrollIntoView({block:"nearest",inline:"center",behavior:"smooth"}); } return; }
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
  const focusables = $$('a[href],button:not(:disabled),select:not(:disabled),input:not(:disabled),[tabindex="0"]')
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
  const arr = e.target.closest(".arr");
  if (arr){ const sc = arr.parentElement.querySelector(".scroller"); sc.scrollBy({left:(arr.classList.contains("r") ? 1 : -1) * sc.clientWidth * .85}); return; }
  const act = e.target.closest("[data-act]");
  if (act){
    const a = act.dataset.act;
    if (a === "play-detail"){
      activateDetailTab(act.dataset.tab);
      const season = Number($("#playSeason")?.value || 1), episode = Number($("#playEpisode")?.value || 1);
      startDetailPlayback(act.dataset.id, act.dataset.type, season, episode);
    }
    if (a === "play-current-episode" || a === "play-episode"){
      const season = Number(act.dataset.season || $("#playSeason")?.value || 1);
      const episode = Number(act.dataset.episode || $("#playEpisode")?.value || 1);
      if ($("#playSeason")) $("#playSeason").value = String(season);
      if ($("#playEpisode")) $("#playEpisode").value = String(episode);
      activateDetailTab("ver");
      startDetailPlayback(act.dataset.id, "tv", season, episode);
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
  try{ const cfg = await fetch("./app-config.json", {headers:{accept:"application/json"}}); if (cfg.ok){ const data = await cfg.json(); if (typeof data.apiBaseUrl === "string" && data.apiBaseUrl.trim()) API_BASE_URL = data.apiBaseUrl.trim().replace(/\/$/, ""); } }catch(e){}
  try{ await loadGenres(); }catch(e){}
  router();
})();