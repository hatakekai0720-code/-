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
import { loadSpots, loadCategories, MODES, normalizeMode, modeShows, normalizeSelection, toggleCategory, filterSpots, prefCounts, inBounds, nearest, events as spotEvents } from '../spots.js';

const OSM_ATTRIBUTION = '撮影スポット © OpenStreetMap contributors（ODbL）';
const LIST_LIMIT = 100; // 「近い順」に並べる件数の上限（数千件を DOM にしない）
const VIEW_PAD = 0.3;   // 表示範囲の外側この割合までのピンだけ描く

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
    defineSpotMarker(window.L);
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

// 撮影スポットのピン: Canvas に角丸の四角 + カテゴリの 1 文字（映画ロケ地の丸いピンと形で区別する）。
// DOM の要素を作らないので数千件でも軽い。当たり判定は CircleMarker と同じ円
function defineSpotMarker(L) {
  if (L.SpotMarker) return;
  L.Canvas.include({
    _updateSpot(layer) {
      if (!this._drawing || layer._empty()) return;
      const p = layer._point, ctx = this._ctx, r = Math.max(Math.round(layer._radius), 1), o = layer.options;
      const x = p.x - r, y = p.y - r, d = r * 2, k = Math.min(4, r / 2);
      ctx.beginPath();
      ctx.moveTo(x + k, y); ctx.arcTo(x + d, y, x + d, y + d, k); ctx.arcTo(x + d, y + d, x, y + d, k); ctx.arcTo(x, y + d, x, y, k); ctx.arcTo(x, y, x + d, y, k);
      ctx.closePath();
      this._fillStroke(ctx, layer);
      ctx.globalAlpha = 1;
      ctx.fillStyle = '#ffffff';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      if (o.count) { // クラスタ: 上に小さくカテゴリの 1 文字、下に件数（等幅）
        ctx.font = `700 ${Math.round(r * 0.55)}px system-ui, "Hiragino Sans", "Noto Sans JP", sans-serif`;
        ctx.fillText(o.glyph, p.x, p.y - r * 0.38);
        ctx.font = `700 ${Math.round(r * 0.7)}px ui-monospace, Menlo, Consolas, monospace`;
        ctx.fillText(String(o.count), p.x, p.y + r * 0.32);
      } else if (o.glyph) {
        ctx.font = `700 ${Math.round(r * 1.15)}px system-ui, "Hiragino Sans", "Noto Sans JP", sans-serif`;
        ctx.fillText(o.glyph, p.x, p.y + 0.5);
      }
    },
  });
  L.SpotMarker = L.CircleMarker.extend({ _updatePath() { this._renderer._updateSpot(this); } });
}


// 現在地はメモリだけに持つ（保存しない）
let here = null;
const mapGeo = { type: 'all', region: 'all', country: 'all', decade: 'all', pref: 'all' };
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
  const geo = mapGeo; // ロケ地の種類（実写／モデル地）・地域・国・年代・都道府県の絞り込み（メモリのみ。画面を移っても保つ）
  const facetEl = h('div', { class: 'stack facets', style: 'gap:8px;margin:12px 0 4px' });
  // 表示モード（映画ロケ地／撮影スポット／すべて）と撮影スポットのカテゴリの選択は localStorage（設定）に保存する
  let mode = normalizeMode(store.getSetting('mapMode'));
  let spots = [], cats = [], sel = [];
  const modeEl = h('div', { class: 'seg', role: 'group', 'aria-label': '地図の表示モード', style: 'margin-bottom:8px' });
  const spotFacetEl = h('div', { class: 'stack facets', style: 'gap:8px;margin:12px 0 4px' });
  const catOf = (id) => cats.find((c) => c.id === id);

  root.append(
    modeEl,
    h('div', { class: 'map-wrap' }, mapEl, h('div', { class: 'map-loading muted small' }, '地図を読み込み中…'), dlBadge),
    h('div', { class: 'row', style: 'margin:8px 0' }, locBtn, h('div', { class: 'grow small muted' }, '長押し（PC は右クリック）でピンを追加')),
    status,
    h('a', { class: 'btn block', href: '#/search', style: 'margin-top:6px' }, '作品・人物・撮影スポットを探す'),
    spotFacetEl,
    facetEl,
    h('div', { class: 'row', style: 'margin:14px 0 8px' },
      h('div', { class: 'section-title grow', style: 'margin:0' }, '近い順'),
      h('div', { style: 'width:150px' }, select([{ id: 'all', label: 'すべて' }, { id: 'loc', label: '映画ロケ地' }, { id: 'spot', label: '撮影スポット' }, { id: 'pin', label: 'マイピン' }], filter.kind, (v) => { filter.kind = v; drawList(); }, { 'aria-label': '一覧の絞り込み' }))),
    listEl);

  let map = null, L = null, locations = [], landLayer = null, pinLayer = null, hereLayer = null;
  let land10Layer = null, adminLayer = null, labelLayer = null, places = null;
  let streetAreas = [], street = null; // street: { id, theme, layer }
  const markers = new Map();
  let alive = true;

  /* ---- 一覧 ---- */
  const shownFilms = () => (modeShows(mode).films ? visibleLocs(locations, geo) : []);
  const shownSpots = () => (modeShows(mode).spots ? filterSpots(spots, { cats: sel, pref: geo.pref }) : []);
  function entries() {
    const items = [
      ...shownFilms().map((l) => ({ kind: 'loc', id: l.id, lat: l.lat, lng: l.lng, title: l.title, sub: `${l.place}・${l.city} / ${l.year}${store.getVisited(l.id) ? ' · ✓ 行った' : ''}`, open: () => openLocation(l) })),
      ...shownSpots().map((sp) => ({ kind: 'spot', id: sp.id, lat: sp.lat, lng: sp.lng, title: sp.name, color: catOf(sp.category)?.color, sub: `${catOf(sp.category)?.name ?? ''}・${sp.pref}${sp.city ? ` ${sp.city}` : ''}${store.getVisited(sp.id) ? ' · ✓ 行った' : ''}`, open: () => openSpot(sp) })),
      ...store.pins().map((p) => ({ kind: 'pin', id: p.id, lat: p.lat, lng: p.lng, title: p.name, sub: p.memo ? p.memo.split('\n')[0].slice(0, 40) : 'マイピン', open: () => openPin(p) })),
    ].filter((e) => filter.kind === 'all' || e.kind === filter.kind);
    return { total: items.length, list: nearest(items, here, LIST_LIMIT) };
  }
  function drawList() {
    const { total, list: items } = entries();
    listEl.replaceChildren(...(items.length ? items.map((e) => h('button', { type: 'button', class: 'list-btn near', onclick: () => { focus(e); e.open(); } },
      h('span', { class: `dot ${e.kind}`, style: e.color ? `--c:${e.color}` : null }),
      h('div', { class: 'grow' }, h('div', { class: 'near-title' }, e.title), h('div', { class: 'small muted' }, e.sub)),
      h('div', { class: 'num small' }, formatKm(e.km)))) : [h('p', { class: 'muted small' }, 'まだありません。')]),
      total > items.length ? h('p', { class: 'small muted' }, `${here ? '近い' : '名前の'}順に `, h('span', { class: 'num' }, items.length), ' 件まで表示（全 ', h('span', { class: 'num' }, total), ' 件）。地図や絞り込みで探してください。') : null);
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
      : m.options.kind === 'spot' ? { color: c.bg, fillColor: m.options.catColor, fillOpacity: spider?.marker === m ? 0.3 : 1, opacity: spider?.marker === m ? 0.3 : 1, weight: m.options.count ? 2 : 1.5 }
        : { color: c.accent, fillColor: c.bg, fillOpacity: 1, weight: 3 });
    hereLayer?.setStyle({ color: c.text, fillColor: c.text });
    if (street) updateStreets(); // テーマが変わったら街路の配色も作り直す
  }

  /* ---- ピン（映画ロケ地・マイピン・撮影スポットのカテゴリごとに別々にクラスタ表示） ---- */
  // kind: 'loc' | 'pin' | 'spot:<カテゴリ>'
  let spider = null; // 放射状に展開中のクラスタ { layer, marker }
  const spotCat = (kind) => (kind.startsWith('spot:') ? catOf(kind.slice(5)) : null);
  function addSingle(kind, p, layer = pinLayer, key = `${kind}:${p.id}`) {
    const cat = spotCat(kind);
    const m = cat
      ? new L.SpotMarker([p.lat, p.lng], { radius: 8, kind: 'spot', catColor: cat.color, glyph: cat.icon, bubblingMouseEvents: false })
      : L.circleMarker([p.lat, p.lng], { radius: kind === 'loc' ? 7 : 6, kind, bubblingMouseEvents: false });
    m.bindTooltip(p.label, { direction: 'top', offset: [0, -6] }).on('click', p.open);
    m.addTo(layer); markers.set(key, m);
    return m;
  }
  function addCluster(kind, c) {
    const d = CLUSTER_SIZES[sizeTier(c.count)];
    const cat = spotCat(kind);
    if (cat) {
      // 撮影スポットのクラスタも Canvas に描く（数百個になっても DOM を増やさない）
      const m = new L.SpotMarker([c.lat, c.lng], { radius: d / 2 - 2, kind: 'spot', catColor: cat.color, glyph: cat.icon, count: c.count, bubblingMouseEvents: false });
      m.bindTooltip(`${cat.name} ${c.count} 件`, { direction: 'top', offset: [0, -d / 2] }).on('click', () => onCluster(kind, c, m)).addTo(pinLayer);
      markers.set(`cluster:${kind}:${c.members[0].id}`, m);
      return;
    }
    const el = h('div', { class: `cluster ${kind} s${sizeTier(c.count)}` }, h('span', { class: 'num' }, c.count));
    const marker = L.marker([c.lat, c.lng], {
      icon: L.divIcon({ html: el, className: 'cluster-icon', iconSize: [d, d], iconAnchor: [d / 2, d / 2] }),
      title: `${cat ? cat.name : kind === 'loc' ? 'ロケ地' : 'マイピン'} ${c.count} 件`, alt: `${c.count} 件`, riseOnHover: true,
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
    setDim(marker, true);
    spider = { layer, marker };
    style();
  }
  const setDim = (m, on) => (m.setOpacity ? m.setOpacity(on ? 0.3 : 1) : m.setStyle({ fillOpacity: on ? 0.3 : 1, opacity: on ? 0.3 : 1 }));
  function unspider() {
    if (!spider) return;
    spider.layer.remove();
    setDim(spider.marker, false);
    for (const k of [...markers.keys()]) if (k.startsWith('spider:')) markers.delete(k);
    spider = null;
  }

  // クラスタはズームと絞り込みが変わったときだけ計算し直す（パンでは計算しない）。描くのは表示範囲（余白つき）に入るものだけ
  // ズームごとのクラスタを覚えておく（同じズームに戻ったときは計算しない）。絞り込みが変わったら捨てる
  const clusterCache = new Map();
  let filterKey = null;
  const invalidatePins = () => { clusterCache.clear(); filterKey = null; };
  // Web メルカトルのワールドピクセル座標（Leaflet の map.project と同じ式。LatLng を作らないので数万件でも速い）
  const mercator = (z) => {
    const scale = 256 * 2 ** z;
    return (lat, lng) => {
      const s = Math.sin(Math.max(-85.0511, Math.min(85.0511, lat)) * Math.PI / 180);
      return { x: ((lng + 180) / 360) * scale, y: (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * scale };
    };
  };
  function clusterGroups(z) {
    const fk = `${mode}|${sel.join(',')}|${JSON.stringify(geo)}|${store.pins().length}|${spots.length}|${locations.length}`;
    if (fk !== filterKey) { clusterCache.clear(); filterKey = fk; }
    if (clusterCache.has(z)) return clusterCache.get(z);
    const project = mercator(z);
    const raw = [
      ['loc', shownFilms().map((l) => ({ id: l.id, lat: l.lat, lng: l.lng, label: l.title, open: () => openLocation(l) }))],
      ['pin', store.pins().map((p) => ({ id: p.id, lat: p.lat, lng: p.lng, label: p.name, open: () => openPin(p) }))],
    ];
    const byCat = new Map();
    for (const sp of shownSpots()) {
      if (!byCat.has(sp.category)) byCat.set(sp.category, []);
      byCat.get(sp.category).push({ id: sp.id, lat: sp.lat, lng: sp.lng, label: sp.name, open: () => openSpot(sp) });
    }
    for (const cat of cats) if (byCat.has(cat.id)) raw.push([`spot:${cat.id}`, byCat.get(cat.id)]);
    const groups = raw.map(([kind, pts]) => [kind, clusterPoints(pts, project)]);
    clusterCache.set(z, groups);
    return groups;
  }
  function drawPins() {
    if (!map) return;
    unspider();
    pinLayer.clearLayers();
    markers.clear();
    const groups = clusterGroups(map.getZoom());
    const b = map.getBounds(), c = map.getCenter();
    const off = c.lng - c.wrap().lng; // worldCopyJump で横にずれた分
    const view = [b.getWest() - off, b.getSouth(), b.getEast() - off, b.getNorth()];
    // 撮影スポット → 映画ロケ地 → マイピン の順に重ねる（ロケ地を上に）
    const ordered = [...groups.filter(([k]) => k.startsWith('spot:')), ...groups.filter(([k]) => !k.startsWith('spot:'))];
    for (const [kind, clusters] of ordered) {
      for (const cl of inBounds(clusters, view, VIEW_PAD)) {
        if (cl.count === 1) addSingle(kind, { ...cl.members[0], lng: cl.members[0].lng + off });
        else addCluster(kind, { ...cl, lng: cl.lng + off });
      }
    }
    style();
  }

  /* ---- 地域・国の絞り込み ---- */
  function drawMode() {
    modeEl.replaceChildren(...MODES.map((m) => h('button', { type: 'button', 'aria-pressed': String(mode === m.id), onclick: () => {
      if (mode === m.id) return;
      mode = m.id; store.setSetting('mapMode', mode);
      if (!modeShows(mode).spots && filter.kind === 'spot') filter.kind = 'all';
      drawMode(); drawAttribution(); applyGeo(false);
    } }, m.label)));
  }
  function drawAttribution() {
    if (!map) return;
    if (modeShows(mode).spots && spots.some((x) => x.source === 'osm' || x.osmId)) map.attributionControl.addAttribution(OSM_ATTRIBUTION);
    else map.attributionControl.removeAttribution(OSM_ATTRIBUTION);
  }
  // 撮影スポットのカテゴリ（複数選択・全選択・全解除）と都道府県
  function drawSpotFacets() {
    if (!modeShows(mode).spots) { spotFacetEl.replaceChildren(); return; }
    if (!cats.length) { spotFacetEl.replaceChildren(h('p', { class: 'small muted' }, '撮影スポットのデータを読み込み中…')); return; }
    const inPref = filterSpots(spots, { pref: geo.pref });
    const n = Object.fromEntries(cats.map((c) => [c.id, 0]));
    for (const sp of inPref) n[sp.category]++;
    const setSel = (next) => { sel = next; store.setSetting('spotCats', sel); applyGeo(false); };
    const prefs = prefCounts(filterSpots(spots, { cats: sel }));
    const shown = shownSpots().length;
    const empty = cats.filter((c) => !spots.some((sp) => sp.category === c.id));
    spotFacetEl.replaceChildren(
      h('div', { class: 'row', style: 'gap:8px' },
        h('div', { class: 'section-title grow', style: 'margin:0' }, '撮影スポット'),
        h('button', { type: 'button', class: 'btn', onclick: () => setSel(cats.map((c) => c.id)) }, '全選択'),
        h('button', { type: 'button', class: 'btn', onclick: () => setSel([]) }, '全解除')),
      h('div', { class: 'row wrap', style: 'gap:6px', role: 'group', 'aria-label': '撮影スポットのカテゴリ（複数選択）' },
        cats.map((c) => h('button', { type: 'button', class: `chip spot-chip ${sel.includes(c.id) ? 'on' : ''}`, style: `--c:${c.color}`, 'aria-pressed': String(sel.includes(c.id)),
          onclick: () => setSel(toggleCategory(sel, c.id)) }, c.name, h('span', { class: 'num chip-count' }, n[c.id])))),
      h('div', { class: 'row', style: 'gap:10px' },
        h('div', { class: 'grow' }, select([{ id: 'all', label: `すべての都道府県（${filterSpots(spots, { cats: sel }).length}）` }, ...prefs.map((x) => ({ id: x.id, label: `${x.id}（${x.count}）` }))],
          geo.pref, (v) => { geo.pref = v; applyGeo(); }, { 'aria-label': '都道府県で絞り込み' })),
        h('div', { class: 'small muted', style: 'white-space:nowrap' }, '表示 ', h('span', { class: 'num' }, shown), ' / ', h('span', { class: 'num' }, spots.length), ' 件')),
      h('div', { class: 'row', style: 'gap:8px' },
        h('a', { class: 'btn grow', href: '#/spots' }, '制覇率（カテゴリ・都道府県別）')),
      empty.length ? h('p', { class: 'small muted', style: 'margin:0' }, `${empty.map((c) => c.name).join('・')} は、データの取得（GitHub Actions の「撮影スポットを取得」）がまだのため 0 件です。`) : null);
  }

  function drawFacets() {
    if (!locations.length || !modeShows(mode).films) { facetEl.replaceChildren(); return; }
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
  // fit: 絞り込んだ範囲に地図を合わせる（カテゴリのチップやモードの切り替えでは動かさない）
  function applyGeo(fit = true) {
    invalidatePins();
    drawFacets(); drawSpotFacets(); drawPins(); drawList();
    if (!fit || !map) return;
    const filmFiltered = geo.type !== 'all' || geo.region !== 'all' || geo.country !== 'all' || geo.decade !== 'all';
    const vis = [...(filmFiltered ? shownFilms() : []), ...(geo.pref !== 'all' ? shownSpots() : [])];
    if (vis.length) map.fitBounds(L.latLngBounds(vis.map((l) => [l.lat, l.lng])).pad(0.25), { maxZoom: Math.min(map.getMaxZoom(), MAX_ZOOM) });
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
    drawAttribution();
    if (here) showHere();
    map.on('contextmenu', (e) => addPin(e.latlng));
    map.on('zoomend', updateLayers);
    map.on('moveend', drawPins); // ズーム・パンのたびに表示範囲のピンだけ描き直す
    map.on('zoomstart click', unspider);
    map.on('moveend', () => { drawLabels(); updateStreets(); });
    updateLayers();
    updateStreets();
    map.on('moveend', () => { const c = map.getCenter(); store.setSetting('mapView', { lat: +c.lat.toFixed(4), lng: +c.lng.toFixed(4), zoom: map.getZoom() }); });
    drawList();
    // #/map/<ロケ地 ID>: そのロケ地を中心に（街路データがあれば街路が見えるズームで）表示してシートを開く
    const target = focusId && locations.find((x) => x.id === focusId);
    if (focusId && !target) focusSpot(focusId);
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

  /* ---- 撮影スポット ---- */
  async function loadSpotData() {
    try {
      const [sp, cs] = await Promise.all([loadSpots(), loadCategories()]);
      if (!alive) return;
      spots = sp; cats = cs;
      sel = normalizeSelection(store.getSetting('spotCats'), cats.map((c) => c.id));
      drawAttribution(); applyGeo(false);
    } catch { if (alive) spotFacetEl.replaceChildren(h('p', { class: 'small muted' }, '撮影スポットのデータを読み込めませんでした。')); }
  }
  const spotsReady = loadSpotData();
  const onSpotFile = () => loadSpotData();
  spotEvents.addEventListener('file', onSpotFile);
  // #/map/<撮影スポット ID>: 撮影スポットを表示するモードにして、その場所を開く
  async function focusSpot(id) {
    await spotsReady;
    const sp = alive && map && spots.find((x) => x.id === id);
    if (!sp) return;
    if (!modeShows(mode).spots) { mode = 'all'; store.setSetting('mapMode', mode); drawMode(); }
    if (!sel.includes(sp.category)) { sel = [...sel, sp.category]; store.setSetting('spotCats', sel); }
    if (geo.pref !== 'all' && geo.pref !== sp.pref) geo.pref = 'all';
    applyGeo(false);
    map.setView([sp.lat, sp.lng], MAX_ZOOM);
    openSpot(sp);
  }
  function openSpot(sp) {
    const cat = catOf(sp.category);
    sheet(sp.name, (close) => [
      h('div', { class: 'small muted', style: 'margin-top:-6px' }, `${cat?.name ?? ''} · ${sp.pref}${sp.city ? `・${sp.city}` : ''} `, h('span', { class: 'num' }, formatLatLng(sp.lat, sp.lng))),
      h('div', { class: 'row wrap', style: 'gap:6px;margin-top:6px' },
        cat ? h('span', { class: 'chip spot-chip', style: `--c:${cat.color}` }, cat.name) : null,
        store.getVisited(sp.id) ? h('span', { class: 'chip visited' }, '✓ 行った') : null,
        here ? h('span', { class: 'chip num' }, formatKm(haversine(here.lat, here.lng, sp.lat, sp.lng))) : null),
      sp.note ? h('p', { class: 'small', style: 'margin:10px 0 0' }, sp.note) : null,
      h('p', { class: 'small muted', style: 'margin:8px 0' }, '撮影可否は現地のルールを確認してください。'),
      h('a', { class: 'btn primary block', href: `#/spots/${encodeURIComponent(sp.id)}`, onclick: close }, '詳細（おすすめレシピ・撮影のコツ・行った）'),
    ]);
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
          close(); invalidatePins(); drawPins(); drawList();
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
          if (await confirmSheet('ピンを削除', `「${p.name}」を削除します。`, '削除', true)) { store.deletePin(p.id); invalidatePins(); drawPins(); drawList(); toast('削除しました'); }
        } }, '削除')),
    ]);
  }

  drawMode();
  drawList();
  init();
  const mo = new MutationObserver(style);
  mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  return () => { alive = false; mo.disconnect(); spotEvents.removeEventListener('file', onSpotFile); streets.events.removeEventListener('file', onStreetFile); streets.events.removeEventListener('status', drawBadge); photos.events.removeEventListener('status', drawBadge); map?.remove(); };
}
