// ④ 映画ロケ地ワールドマップ。Leaflet をタイル無しで使い、同梱の Natural Earth データだけを描く（外部通信なし）。
// ズームで描くものを切り替える: 〜4.5 国境 50m / 4〜 県・州の境界線 / 5〜 国境・海岸線 10m / 6〜 主要都市名
// ロケ地の周辺（街路データをダウンロード済みの範囲）だけは、ズーム 10 以上で OpenStreetMap の街路を重ね、18 まで拡大できる（データはズーム 15 まで。それ以上は拡大表示）
import { h, toast, sheet, confirmSheet, select } from '../ui/dom.js';
import { paramSummary } from '../ui/recipe-ui.js';
import { themeColors } from '../ui/theme.js';
import { haversine, formatKm, formatLatLng, unwrapAntimeridian, pickLabels } from '../geo.js';
import { loadLocations } from '../locations.js';
import { inDecade, decadeCounts } from '../film.js';
import { decadeChips } from './search.js';
import * as X from '../xt3.js';
import * as store from '../store.js';
import * as streets from '../streets.js';
import * as photos from '../photos.js';
import { photoFigure } from '../ui/photo.js';
import { clusterPoints, maxSpread, spiderOffsets, sizeTier, facetCounts, filterLocations, typeCounts, CLUSTER_RADIUS, CLUSTER_SIZES } from '../cluster.js';

const CONF_LABEL = { high: '確度 高', medium: '確度 中' };
const MIN_ZOOM = 1, MAX_ZOOM = 8; // 通常の最大ズーム（県・都市が分かる程度まで）
export const LAYER_ZOOM = { admin1: 4, detail: 5, places: 6 }; // このズーム以上で表示

/* ---- ライブラリとデータの読み込み（一度だけ） ---- */
const loadScript = (src) => new Promise((resolve, reject) => {
  const s = document.createElement('script');
  s.src = src; s.onload = resolve; s.onerror = () => reject(new Error(`${src} を読み込めません`));
  document.head.append(s);
});
const loadCss = (href) => {
  if (document.querySelector(`link[href="${href}"]`)) return;
  document.head.append(h('link', { rel: 'stylesheet', href }));
};
let libs = null;
function loadLibs() {
  libs ??= (async () => {
    loadCss('vendor/leaflet/leaflet.css');
    await Promise.all([window.L ? null : loadScript('vendor/leaflet/leaflet.js'), window.topojson ? null : loadScript('vendor/topojson-client.min.js')]);
    const [world, locs] = await Promise.all([fetch('data/countries-50m.json').then((r) => r.json()), loadLocations()]);
    return { L: window.L, countries: unwrapAntimeridian(window.topojson.feature(world, world.objects.countries)), locations: locs };
  })();
  libs.catch(() => { libs = null; });
  return libs;
}
// ズームしたときに初めて読み込む詳細データ（一度だけ）
const detail = {};
function loadDetail(key) {
  const load = {
    countries10m: () => fetch('data/countries-10m.json').then((r) => r.json()).then((t) => unwrapAntimeridian(window.topojson.feature(t, t.objects.countries))),
    admin1: () => fetch('data/admin1-10m.json').then((r) => r.json()).then((t) => unwrapAntimeridian(window.topojson.feature(t, t.objects.admin1))),
    places: () => fetch('data/places-10m.json').then((r) => r.json()).then((d) => d.places),
  }[key];
  detail[key] ??= load();
  detail[key].catch(() => { delete detail[key]; });
  return detail[key];
}
// 街路レイヤー用のライブラリ（街路を初めて表示するときだけ読み込む）
let streetLibs = null;
function loadStreetLibs() {
  streetLibs ??= Promise.all([window.pmtiles ? null : loadScript('vendor/pmtiles/pmtiles.js'), window.protomapsL ? null : loadScript('vendor/protomaps-leaflet/protomaps-leaflet.js')])
    .then(() => ({ PMTiles: window.pmtiles.PMTiles, leafletLayer: window.protomapsL.leafletLayer }));
  streetLibs.catch(() => { streetLibs = null; });
  return streetLibs;
}
const WORLD_BOUNDS = [[-85, -400], [85, 400]];


// 現在地はメモリだけに持つ（保存しない）
let here = null;
const mapGeo = { type: 'all', region: 'all', country: 'all', decade: 'all' };
const visibleLocs = (locations, geo) => filterLocations(locations, geo).filter((l) => inDecade(l.year, geo.decade));

export function render(root, { id: focusId } = {}) {
  const mapEl = h('div', { class: 'map', role: 'application', 'aria-label': '世界地図' });
  const status = h('div', { class: 'small muted', 'aria-live': 'polite' });
  const listEl = h('div', { class: 'stack', style: 'gap:6px' });
  const locBtn = h('button', { type: 'button', class: 'btn', onclick: locate }, '現在地');
  const filter = { kind: 'all' };
  // ダウンロード中は地図の右上に小さく進捗（n/N）を出す
  const dlBadge = h('div', { class: 'map-progress num', 'aria-live': 'polite', hidden: true });
  const drawBadge = () => {
    const parts = [['写真', photos.getStatus()], ['街路', streets.getStatus()]]
      .filter(([, st]) => st.state === 'running' && st.total > 0).map(([k, st]) => `${k} ${st.done}/${st.total}`);
    dlBadge.hidden = !parts.length;
    dlBadge.textContent = parts.join('　');
  };
  streets.events.addEventListener('status', drawBadge);
  photos.events.addEventListener('status', drawBadge);
  drawBadge();
  const geo = mapGeo; // ロケ地の種類（実写／モデル地）・地域・国・年代の絞り込み（メモリのみ。画面を移っても保つ）
  const facetEl = h('div', { class: 'stack facets', style: 'gap:8px;margin:12px 0 4px' });

  root.append(
    h('div', { class: 'map-wrap' }, mapEl, h('div', { class: 'map-loading muted small' }, '地図を読み込み中…'), dlBadge),
    h('div', { class: 'row', style: 'margin:8px 0' }, locBtn, h('div', { class: 'grow small muted' }, '長押し（PC は右クリック）でピンを追加')),
    status,
    h('a', { class: 'btn block', href: '#/search', style: 'margin-top:6px' }, '作品・監督・俳優で探す'),
    facetEl,
    h('div', { class: 'row', style: 'margin:14px 0 8px' },
      h('div', { class: 'section-title grow', style: 'margin:0' }, '近い順'),
      h('div', { style: 'width:150px' }, select([{ id: 'all', label: 'すべて' }, { id: 'loc', label: 'ロケ地' }, { id: 'pin', label: 'マイピン' }], filter.kind, (v) => { filter.kind = v; drawList(); }, { 'aria-label': '一覧の絞り込み' }))),
    listEl);

  let map = null, L = null, locations = [], landLayer = null, pinLayer = null, hereLayer = null;
  let land10Layer = null, adminLayer = null, labelLayer = null, places = null;
  let streetAreas = [], street = null; // street: { id, theme, layer }
  const markers = new Map();
  let alive = true;

  /* ---- 一覧 ---- */
  function entries() {
    const items = [
      ...visibleLocs(locations, geo).map((l) => ({ kind: 'loc', id: l.id, lat: l.lat, lng: l.lng, title: l.title, sub: `${l.place}・${l.city} / ${l.year}${store.getVisited(l.id) ? ' · ✓ 行った' : ''}`, open: () => openLocation(l) })),
      ...store.pins().map((p) => ({ kind: 'pin', id: p.id, lat: p.lat, lng: p.lng, title: p.name, sub: p.memo ? p.memo.split('\n')[0].slice(0, 40) : 'マイピン', open: () => openPin(p) })),
    ].filter((e) => filter.kind === 'all' || e.kind === filter.kind);
    for (const e of items) e.km = here ? haversine(here.lat, here.lng, e.lat, e.lng) : null;
    return items.sort((a, b) => (here ? a.km - b.km : a.title.localeCompare(b.title, 'ja')));
  }
  function drawList() {
    const items = entries();
    listEl.replaceChildren(...(items.length ? items.map((e) => h('button', { type: 'button', class: 'list-btn near', onclick: () => { focus(e); e.open(); } },
      h('span', { class: `dot ${e.kind}` }),
      h('div', { class: 'grow' }, h('div', { class: 'near-title' }, e.title), h('div', { class: 'small muted' }, e.sub)),
      h('div', { class: 'num small' }, formatKm(e.km)))) : [h('p', { class: 'muted small' }, 'まだありません。')]));
    status.replaceChildren(here
      ? h('span', null, '現在地 ', h('span', { class: 'num' }, formatLatLng(here.lat, here.lng)), ' ', h('span', { class: 'num' }, `±${Math.round(here.acc)}m`))
      : h('span', null, '「現在地」を押すと近い順に並びます（位置情報は保存しません）'));
  }
  const focus = (e) => {
    if (!map) return;
    map.setView([e.lat, e.lng], Math.max(map.getZoom(), 5));
    if (mapEl.getBoundingClientRect().top < 0) window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  /* ---- 地図 ---- */
  function style() {
    const c = themeColors();
    mapEl.style.background = c.bg;
    const landStyle = { fillColor: c.card, fillOpacity: 1, color: c.line, weight: 1 };
    landLayer?.setStyle(landStyle);
    land10Layer?.setStyle(landStyle);
    // 県・州の境界線は国境より目立たない細い破線
    adminLayer?.setStyle({ color: c.muted, opacity: 0.35, weight: 0.6, dashArray: '3 3' });
    for (const [, m] of markers) m.setStyle(m.options.kind === 'loc'
      ? { color: c.bg, fillColor: c.accent, fillOpacity: 1, weight: 2 }
      : { color: c.accent, fillColor: c.bg, fillOpacity: 1, weight: 3 });
    hereLayer?.setStyle({ color: c.text, fillColor: c.text });
    if (street) updateStreets(); // テーマが変わったら街路の配色も作り直す
  }

  /* ---- ピン（ロケ地とマイピンを別々にクラスタ表示） ---- */
  let spider = null; // 放射状に展開中のクラスタ { layer, marker }
  function addSingle(kind, p, layer = pinLayer, key = `${kind}:${p.id}`) {
    const m = L.circleMarker([p.lat, p.lng], { radius: kind === 'loc' ? 7 : 6, kind, bubblingMouseEvents: false })
      .bindTooltip(p.label, { direction: 'top', offset: [0, -6] }).on('click', p.open);
    m.addTo(layer); markers.set(key, m);
    return m;
  }
  function addCluster(kind, c) {
    const d = CLUSTER_SIZES[sizeTier(c.count)];
    const el = h('div', { class: `cluster ${kind} s${sizeTier(c.count)}` }, h('span', { class: 'num' }, c.count));
    const marker = L.marker([c.lat, c.lng], {
      icon: L.divIcon({ html: el, className: 'cluster-icon', iconSize: [d, d], iconAnchor: [d / 2, d / 2] }),
      title: `${kind === 'loc' ? 'ロケ地' : 'マイピン'} ${c.count} 件`, alt: `${c.count} 件`, riseOnHover: true,
      zIndexOffset: kind === 'loc' ? 100 : 0,
    });
    marker.on('click', () => onCluster(kind, c, marker)).addTo(pinLayer);
  }
  // タップ: ズームで分けられるならその範囲にズーム。最大ズームでも重なる（同じ建物など）なら放射状に展開
  function onCluster(kind, c, marker) {
    const maxZ = map.getMaxZoom();
    const spread = maxSpread(c.members, (lat, lng) => map.project([lat, lng], maxZ));
    if (map.getZoom() < maxZ && spread > CLUSTER_RADIUS) {
      const b = L.latLngBounds([c.bounds[0], c.bounds[1]], [c.bounds[2], c.bounds[3]]);
      map.fitBounds(b.pad(0.35), { maxZoom: maxZ });
    } else if (spider?.marker === marker) unspider();
    else spiderfy(kind, c, marker);
  }
  function spiderfy(kind, c, marker) {
    unspider();
    const center = map.latLngToLayerPoint([c.lat, c.lng]);
    const layer = L.layerGroup().addTo(map);
    const legColor = themeColors().muted;
    spiderOffsets(c.count).forEach((o, i) => {
      const p = c.members[i];
      const ll = map.layerPointToLatLng(center.add(L.point(o.x, o.y)));
      L.polyline([[c.lat, c.lng], ll], { color: legColor, weight: 1.5, opacity: 0.8, interactive: false }).addTo(layer);
      addSingle(kind, { ...p, lat: ll.lat, lng: ll.lng }, layer, `spider:${kind}:${p.id}`);
    });
    marker.setOpacity(0.3);
    spider = { layer, marker };
    style();
  }
  function unspider() {
    if (!spider) return;
    spider.layer.remove();
    spider.marker.setOpacity(1);
    for (const k of [...markers.keys()]) if (k.startsWith('spider:')) markers.delete(k);
    spider = null;
  }

  function drawPins() {
    if (!map) return;
    unspider();
    pinLayer.clearLayers();
    markers.clear();
    const z = map.getZoom();
    const project = (lat, lng) => map.project([lat, lng], z); // ワールドピクセル座標（パンしても変わらない）
    const groups = [
      ['loc', visibleLocs(locations, geo).map((l) => ({ id: l.id, lat: l.lat, lng: l.lng, label: l.title, open: () => openLocation(l) }))],
      ['pin', store.pins().map((p) => ({ id: p.id, lat: p.lat, lng: p.lng, label: p.name, open: () => openPin(p) }))],
    ];
    for (const [kind, pts] of groups) {
      for (const c of clusterPoints(pts, project)) {
        if (c.count === 1) addSingle(kind, c.members[0]);
        else addCluster(kind, c);
      }
    }
    style();
  }

  /* ---- 地域・国の絞り込み ---- */
  function drawFacets() {
    if (!locations.length) { facetEl.replaceChildren(); return; }
    const typed = filterLocations(locations, { type: geo.type });
    const f = facetCounts(typed, geo.region);
    const shown = visibleLocs(locations, geo).length;
    const inRegion = filterLocations(locations, geo);
    const dc = Object.fromEntries([['all', inRegion.length], ...decadeCounts(inRegion).map((d) => [d.id, d.count])]);
    const chip = (id, label, count) => h('button', {
      type: 'button', class: `chip ${geo.region === id ? 'on' : ''}`, 'aria-pressed': String(geo.region === id),
      onclick: () => { geo.region = id; geo.country = 'all'; applyGeo(); },
    }, label, h('span', { class: 'num chip-count' }, count));
    const countryTotal = f.countries.reduce((s, c) => s + c.count, 0);
    const typeChip = (id, label, count) => h('button', {
      type: 'button', class: `chip ${geo.type === id ? 'on' : ''}`, 'aria-pressed': String(geo.type === id),
      onclick: () => { geo.type = id; geo.region = 'all'; geo.country = 'all'; applyGeo(); },
    }, label, h('span', { class: 'num chip-count' }, count));
    facetEl.replaceChildren(
      h('div', { class: 'row wrap', style: 'gap:6px', role: 'group', 'aria-label': '実写の撮影地とモデル地で絞り込み' },
        typeChip('all', 'すべての種類', locations.length), ...typeCounts(locations).map((t) => typeChip(t.id, t.label, t.count))),
      h('div', { class: 'row wrap', style: 'gap:6px', role: 'group', 'aria-label': '地域で絞り込み' },
        chip('all', 'すべて', f.total), ...f.regions.map((r) => chip(r.id, r.label, r.count))),
      h('div', { class: 'row', style: 'gap:10px' },
        h('div', { class: 'grow' }, select([{ id: 'all', label: `すべての国（${countryTotal}）` }, ...f.countries.map((c) => ({ id: c.id, label: `${c.id}（${c.count}）` }))],
          geo.country, (v) => { geo.country = v; applyGeo(); }, { 'aria-label': '国で絞り込み' })),
        h('div', { class: 'small muted', style: 'white-space:nowrap' }, '表示 ', h('span', { class: 'num' }, shown), ' / ', h('span', { class: 'num' }, locations.length), ' 件')),
      decadeChips(geo.decade, dc, (id) => { geo.decade = id; applyGeo(); }));
  }
  function applyGeo() {
    drawFacets(); drawPins(); drawList();
    const vis = visibleLocs(locations, geo);
    if (map && vis.length && (geo.type !== 'all' || geo.region !== 'all' || geo.country !== 'all' || geo.decade !== 'all')) {
      map.fitBounds(L.latLngBounds(vis.map((l) => [l.lat, l.lng])).pad(0.25), { maxZoom: Math.min(map.getMaxZoom(), MAX_ZOOM) });
    }
  }

  async function init() {
    let res;
    try { res = await loadLibs(); }
    catch { root.querySelector('.map-loading').textContent = '地図データを読み込めませんでした。'; return; }
    if (!alive) return;
    ({ L, locations } = res);
    root.querySelector('.map-loading')?.remove();
    streetAreas = await streets.cachedAreas();
    if (!alive) return;
    const saved = store.getSetting('mapView');
    const savedMax = saved && streetAreas.some((a) => streets.bboxContains(a.bbox, saved.lat, saved.lng)) ? streets.STREET_MAX_ZOOM : MAX_ZOOM;
    map = L.map(mapEl, {
      preferCanvas: true, zoomSnap: 0.5, minZoom: MIN_ZOOM, maxZoom: savedMax, worldCopyJump: true,
      maxBounds: WORLD_BOUNDS, maxBoundsViscosity: 0.8,
      attributionControl: true, tapHold: true,
    }).setView(saved ? [saved.lat, saved.lng] : [30, 60], saved ? Math.min(saved.zoom, savedMax) : 1.5);
    map.attributionControl.setPrefix(false).addAttribution('Natural Earth');
    // 重なり順: 陸地（国境）→ 県・州の境界 →（街路）→ 都市名 → ピン
    for (const [name, z] of [['ne-land', 200], ['ne-admin', 210], ['streets', 220], ['ne-labels', 390]]) map.createPane(name).style.zIndex = z;
    map.getPane('ne-labels').style.pointerEvents = 'none';
    renderers = { land: L.canvas({ pane: 'ne-land' }), admin: L.canvas({ pane: 'ne-admin' }) };
    landLayer = L.geoJSON(res.countries, { interactive: false, renderer: renderers.land, pane: 'ne-land' }).addTo(map);
    labelLayer = L.layerGroup([], { pane: 'ne-labels' });
    pinLayer = L.layerGroup().addTo(map);
    drawPins();
    drawFacets();
    if (here) showHere();
    map.on('contextmenu', (e) => addPin(e.latlng));
    map.on('zoomend', () => { updateLayers(); drawPins(); });
    map.on('zoomstart click', unspider);
    map.on('moveend', () => { drawLabels(); updateStreets(); });
    updateLayers();
    updateStreets();
    map.on('moveend', () => { const c = map.getCenter(); store.setSetting('mapView', { lat: +c.lat.toFixed(4), lng: +c.lng.toFixed(4), zoom: map.getZoom() }); });
    drawList();
    // #/map/<ロケ地 ID>: そのロケ地を中心に（街路データがあれば街路が見えるズームで）表示してシートを開く
    const target = focusId && locations.find((x) => x.id === focusId);
    if (target) {
      const hasStreet = streetAreas.some((a) => a.id === target.id);
      if (hasStreet) map.setMaxZoom(streets.STREET_MAX_ZOOM);
      map.setView([target.lat, target.lng], hasStreet ? 15 : Math.max(map.getZoom(), 7));
      openLocation(target);
    }
  }

  /* ---- ズームに応じた詳細レイヤー ---- */
  let renderers = null;
  function updateLayers() {
    if (!map) return;
    const z = map.getZoom();
    // 国境・海岸線: ズーム 5 以上は 10m 版（読み込みが終わるまでは 50m 版のまま）
    if (z >= LAYER_ZOOM.detail) {
      loadDetail('countries10m').then((gj) => {
        if (!alive || !map || map.getZoom() < LAYER_ZOOM.detail) return;
        land10Layer ??= L.geoJSON(gj, { interactive: false, renderer: renderers.land, pane: 'ne-land' });
        if (!map.hasLayer(land10Layer)) { land10Layer.addTo(map); landLayer.remove(); style(); }
      }).catch(() => {});
    } else if (land10Layer && map.hasLayer(land10Layer)) { landLayer.addTo(map); land10Layer.remove(); style(); }
    // 県・州の境界線: ズーム 4 以上
    if (z >= LAYER_ZOOM.admin1) {
      loadDetail('admin1').then((gj) => {
        if (!alive || !map || map.getZoom() < LAYER_ZOOM.admin1) return;
        adminLayer ??= L.geoJSON(gj, { interactive: false, renderer: renderers.admin, pane: 'ne-admin' });
        if (!map.hasLayer(adminLayer)) { adminLayer.addTo(map); style(); }
      }).catch(() => {});
    } else adminLayer?.remove();
    // 都市名: ズーム 6 以上
    if (z >= LAYER_ZOOM.places) {
      loadDetail('places').then((p) => { places = p; if (alive) drawLabels(); }).catch(() => {});
    } else drawLabels();
  }

  function drawLabels() {
    if (!map || !labelLayer) return;
    const z = map.getZoom();
    labelLayer.clearLayers();
    // 街路レイヤーを表示しているときは、そちらの地名を使う
    if (z < LAYER_ZOOM.places || !places || street?.shown) { labelLayer.remove(); return; }
    const size = map.getSize();
    const picked = pickLabels(places, (lat, lng) => map.latLngToContainerPoint([lat, lng]), {
      zoom: z, width: size.x, height: size.y, centerLng: map.getCenter().lng, fontSize: 11,
    });
    for (const p of picked) {
      const el = document.createElement('div');
      el.className = `city-label${p.rank <= 2 ? ' major' : ''}`;
      el.append(document.createElement('i'), Object.assign(document.createElement('span'), { textContent: p.name }));
      el.title = p.nameEn;
      L.marker([p.lat, p.lng], { icon: L.divIcon({ html: el, className: 'city-label-icon', iconSize: null, iconAnchor: [3, 7] }), interactive: false, keyboard: false, pane: 'ne-labels' }).addTo(labelLayer);
    }
    if (!map.hasLayer(labelLayer)) labelLayer.addTo(map);
  }

  /* ---- 街路（OpenStreetMap / PMTiles） ---- */
  let boundsKey = 'world';
  function updateStreets() {
    if (!map) return;
    const z = map.getZoom(), b = map.getBounds(), c = map.getCenter();
    const off = c.lng - c.wrap().lng; // worldCopyJump で横にずれた分
    const area = streets.areasInView(streetAreas, [b.getWest() - off, b.getSouth(), b.getEast() - off, b.getNorth()])[0];
    // 街路データのある範囲だけ最大ズームを 18 に。範囲から外れたら通常の 8 に戻す
    map.setMaxZoom(area ? streets.STREET_MAX_ZOOM : MAX_ZOOM);
    // ズーム 9 以上では、その範囲の外へ動かせないようにする（外へ行くにはズームアウト）
    const key = area && z > MAX_ZOOM ? area.id : 'world';
    if (key !== boundsKey) {
      boundsKey = key;
      if (key === 'world') map.setMaxBounds(WORLD_BOUNDS);
      else {
        const [w, s, e, n] = area.bbox, pad = 0.01;
        map.setMaxBounds([[s - pad + 0, w - pad + off], [n + pad, e + pad + off]]);
      }
    }
    if (area && z >= streets.STREET_MIN_ZOOM) showStreet(area, off);
    else hideStreet();
  }

  async function showStreet(area, off) {
    const theme = document.documentElement.dataset.theme === 'light' ? 'light' : 'dark';
    if (street && street.id === area.id && street.theme === theme) return;
    hideStreet();
    const mine = street = { id: area.id, theme, layer: null, shown: false };
    try {
      const [lib, blob] = await Promise.all([loadStreetLibs(), streets.cachedBlob(area.url)]);
      if (!alive || street !== mine) return;
      if (!blob) { streetAreas = await streets.cachedAreas(); street = null; return; } // 全削除された
      const [w, s, e, n] = area.bbox;
      mine.layer = lib.leafletLayer({
        url: new lib.PMTiles(new streets.BlobSource(area.url, blob)), // Range 読み込みはキャッシュ済みファイルから切り出す
        flavor: theme, lang: 'ja', maxDataZoom: streets.STREET_DATA_ZOOM,
        bounds: [[s, w + off], [n, e + off]], pane: 'streets', minZoom: streets.STREET_MIN_ZOOM,
        attribution: '© OpenStreetMap contributors',
      });
      mine.layer.addTo(map);
      mine.shown = true;
      drawLabels();
    } catch (err) {
      console.warn('街路地図を表示できません', err);
      if (street === mine) street = null;
    }
  }

  function hideStreet() {
    if (!street) return;
    street.layer?.remove();
    street = null;
    drawLabels();
  }

  const onStreetFile = async () => {
    streetAreas = await streets.cachedAreas();
    if (!alive) return;
    if (street && !streetAreas.some((a) => a.id === street.id)) hideStreet();
    updateStreets();
  };
  streets.events.addEventListener('file', onStreetFile);

  function showHere() {
    if (!map) return;
    hereLayer?.remove();
    hereLayer = L.featureGroup([
      L.circle([here.lat, here.lng], { radius: Math.max(here.acc, 50), weight: 1, fillOpacity: 0.12, interactive: false }),
      L.circleMarker([here.lat, here.lng], { radius: 5, weight: 2, fillOpacity: 1, interactive: false }),
    ]).addTo(map);
    style();
  }

  function locate() {
    if (!('geolocation' in navigator)) return toast('この端末は位置情報に対応していません');
    locBtn.disabled = true; locBtn.textContent = '取得中…';
    navigator.geolocation.getCurrentPosition((pos) => {
      if (!alive) return;
      here = { lat: pos.coords.latitude, lng: pos.coords.longitude, acc: pos.coords.accuracy };
      locBtn.disabled = false; locBtn.textContent = '現在地';
      showHere(); map?.setView([here.lat, here.lng], Math.max(map.getZoom(), 5)); drawList();
    }, (err) => {
      if (!alive) return;
      locBtn.disabled = false; locBtn.textContent = '現在地';
      toast(err.code === 1 ? '位置情報の利用が許可されていません' : '現在地を取得できませんでした', 3500);
    }, { enableHighAccuracy: false, timeout: 15000, maximumAge: 60000 });
  }

  /* ---- シート ---- */
  function openLocation(l) {
    sheet(l.title, (close) => [
      h('div', { class: 'small muted', style: 'margin-top:-6px' }, `${l.titleEn} · `, h('span', { class: 'num' }, l.year), ` · ${l.director}`),
      h('div', { class: 'loc-place' }, h('div', null, l.place), h('div', { class: 'small muted' }, `${l.city}・${l.country} `, h('span', { class: 'num' }, formatLatLng(l.lat, l.lng))),
        h('div', { class: 'row wrap', style: 'gap:6px;margin-top:4px' }, h('span', { class: `chip conf-${l.confidence}` }, CONF_LABEL[l.confidence]),
          store.getVisited(l.id) ? h('span', { class: 'chip visited' }, '✓ 行った') : null,
          here ? h('span', { class: 'chip num' }, formatKm(haversine(here.lat, here.lng, l.lat, l.lng))) : null)),
      photoFigure(l),
      h('p', { style: 'margin:10px 0' }, l.scene),
      h('a', { class: 'btn primary block', href: `#/locations/${encodeURIComponent(l.id)}`, onclick: close }, '詳細（作品情報・撮影ガイド・レシピ）'),
      streetAreas.some((a) => a.id === l.id) && map ? h('button', { type: 'button', class: 'btn block', style: 'margin-top:8px', onclick: () => {
        close(); map.setMaxZoom(streets.STREET_MAX_ZOOM); map.setView([l.lat, l.lng], 15);
        if (mapEl.getBoundingClientRect().top < 0) window.scrollTo({ top: 0, behavior: 'smooth' });
      } }, '周辺の街路地図を見る') : null,
    ]);
  }

  function pinForm(title, init, onSave) {
    const d = { name: init.name || '', memo: init.memo || '', recipeId: init.recipeId || null };
    const recipes = [...store.recipes()].sort((a, b) => a.name.localeCompare(b.name, 'ja'));
    sheet(title, (close) => [
      h('div', { class: 'small muted num', style: 'margin-top:-6px' }, formatLatLng(init.lat, init.lng)),
      h('div', { class: 'field' }, h('label', null, '名前'), h('input', { class: 'input', type: 'text', maxLength: store.PIN_LIMITS.name, value: d.name, placeholder: '例: 夕方の歩道橋', 'aria-label': '名前', oninput: (e) => { d.name = e.target.value; } })),
      h('div', { class: 'field' }, h('label', null, 'メモ'), h('textarea', { class: 'input', maxLength: store.PIN_LIMITS.memo, value: d.memo, 'aria-label': 'メモ', oninput: (e) => { d.memo = e.target.value; } })),
      h('div', { class: 'field' }, h('label', null, '紐づけるレシピ'),
        select([{ id: '', label: 'なし' }, ...recipes.map((r) => ({ id: r.id, label: r.name }))], d.recipeId || '', (v) => { d.recipeId = v || null; }, { 'aria-label': '紐づけるレシピ' })),
      h('div', { class: 'row', style: 'margin-top:10px' },
        h('button', { type: 'button', class: 'btn grow', onclick: close }, 'キャンセル'),
        h('button', { type: 'button', class: 'btn primary grow', onclick: () => {
          const res = onSave({ ...d, lat: init.lat, lng: init.lng });
          if (res.errors) return toast(res.errors[0], 4000);
          close(); drawPins(); drawList();
        } }, '保存')),
    ]);
  }

  function addPin(latlng) {
    const ll = latlng.wrap();
    pinForm('ピンを追加', { lat: ll.lat, lng: ll.lng }, (p) => {
      const res = store.savePin(p);
      if (!res.errors) toast('ピンを追加しました');
      return res;
    });
  }

  function openPin(p) {
    const r = store.getRecipe(p.recipeId);
    sheet(p.name, (close) => [
      h('div', { class: 'small muted num', style: 'margin-top:-6px' }, formatLatLng(p.lat, p.lng),
        here ? ` · ${formatKm(haversine(here.lat, here.lng, p.lat, p.lng))}` : ''),
      p.memo ? h('p', { style: 'margin:10px 0;white-space:pre-wrap;overflow-wrap:anywhere' }, p.memo) : null,
      r ? h('a', { class: 'card stack', style: 'gap:4px;margin-top:10px;text-decoration:none;display:flex', href: `#/recipes/${encodeURIComponent(r.id)}`, onclick: close },
        h('div', { style: 'font-weight:600' }, r.name), h('div', { class: 'small muted' }, X.filmLabel(r)), paramSummary(r)) : h('p', { class: 'small muted' }, 'レシピは紐づいていません。'),
      h('div', { class: 'actions', style: 'margin-top:10px' },
        r ? h('a', { class: 'btn', href: `#/qmenu/${encodeURIComponent(r.id)}`, onclick: close }, 'Qメニュー') : h('span'),
        h('button', { type: 'button', class: 'btn', onclick: () => { close(); pinForm('ピンを編集', p, (d) => store.savePin(d, p.id)); } }, '編集'),
        h('button', { type: 'button', class: 'btn danger', onclick: async () => {
          close();
          if (await confirmSheet('ピンを削除', `「${p.name}」を削除します。`, '削除', true)) { store.deletePin(p.id); drawPins(); drawList(); toast('削除しました'); }
        } }, '削除')),
    ]);
  }

  drawList();
  init();
  const mo = new MutationObserver(style);
  mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  return () => { alive = false; mo.disconnect(); streets.events.removeEventListener('file', onStreetFile); streets.events.removeEventListener('status', drawBadge); photos.events.removeEventListener('status', drawBadge); map?.remove(); };
}
