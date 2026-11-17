// ④ 映画ロケ地ワールドマップ。Leaflet をタイル無しで使い、同梱の Natural Earth データだけを描く（外部通信なし）。
// ズームで描くものを切り替える: 〜4.5 国境 50m / 4〜 県・州の境界線 / 5〜 国境・海岸線 10m / 6〜 主要都市名
import { h, toast, sheet, confirmSheet, select } from '../ui/dom.js';
import { paramSummary } from '../ui/recipe-ui.js';
import { themeColors } from '../ui/theme.js';
import { haversine, formatKm, formatLatLng, unwrapAntimeridian, pickLabels } from '../geo.js';
import { locationRecipe } from '../locations.js';
import * as X from '../xt3.js';
import * as store from '../store.js';

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
    const [world, locs] = await Promise.all([fetch('data/countries-50m.json').then((r) => r.json()), fetch('data/locations.json').then((r) => r.json())]);
    return { L: window.L, countries: unwrapAntimeridian(window.topojson.feature(world, world.objects.countries)), locations: locs.locations };
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

// 現在地はメモリだけに持つ（保存しない）
let here = null;

export function render(root) {
  const mapEl = h('div', { class: 'map', role: 'application', 'aria-label': '世界地図' });
  const status = h('div', { class: 'small muted', 'aria-live': 'polite' });
  const listEl = h('div', { class: 'stack', style: 'gap:6px' });
  const locBtn = h('button', { type: 'button', class: 'btn', onclick: locate }, '現在地');
  const filter = { kind: 'all' };

  root.append(
    h('div', { class: 'map-wrap' }, mapEl, h('div', { class: 'map-loading muted small' }, '地図を読み込み中…')),
    h('div', { class: 'row', style: 'margin:8px 0' }, locBtn, h('div', { class: 'grow small muted' }, '長押し（PC は右クリック）でピンを追加')),
    status,
    h('div', { class: 'row', style: 'margin:14px 0 8px' },
      h('div', { class: 'section-title grow', style: 'margin:0' }, '近い順'),
      h('div', { style: 'width:150px' }, select([{ id: 'all', label: 'すべて' }, { id: 'loc', label: 'ロケ地' }, { id: 'pin', label: 'マイピン' }], filter.kind, (v) => { filter.kind = v; drawList(); }, { 'aria-label': '一覧の絞り込み' }))),
    listEl);

  let map = null, L = null, locations = [], landLayer = null, pinLayer = null, hereLayer = null;
  let land10Layer = null, adminLayer = null, labelLayer = null, places = null;
  const markers = new Map();
  let alive = true;

  /* ---- 一覧 ---- */
  function entries() {
    const items = [
      ...locations.map((l) => ({ kind: 'loc', id: l.id, lat: l.lat, lng: l.lng, title: l.title, sub: `${l.city}・${l.country} / ${l.year}`, open: () => openLocation(l) })),
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
  }

  function drawPins() {
    pinLayer.clearLayers();
    markers.clear();
    const add = (id, kind, lat, lng, label, onClick) => {
      const m = L.circleMarker([lat, lng], { radius: kind === 'loc' ? 7 : 6, kind, bubblingMouseEvents: false })
        .bindTooltip(label, { direction: 'top', offset: [0, -6] }).on('click', onClick);
      m.addTo(pinLayer); markers.set(`${kind}:${id}`, m);
    };
    for (const l of locations) add(l.id, 'loc', l.lat, l.lng, l.title, () => openLocation(l));
    for (const p of store.pins()) add(p.id, 'pin', p.lat, p.lng, p.name, () => openPin(p));
    style();
  }

  async function init() {
    let res;
    try { res = await loadLibs(); }
    catch { root.querySelector('.map-loading').textContent = '地図データを読み込めませんでした。'; return; }
    if (!alive) return;
    ({ L, locations } = res);
    root.querySelector('.map-loading')?.remove();
    const saved = store.getSetting('mapView');
    map = L.map(mapEl, {
      preferCanvas: true, zoomSnap: 0.5, minZoom: MIN_ZOOM, maxZoom: MAX_ZOOM, worldCopyJump: true,
      maxBounds: [[-85, -400], [85, 400]], maxBoundsViscosity: 0.8,
      attributionControl: true, tapHold: true,
    }).setView(saved ? [saved.lat, saved.lng] : [30, 60], saved ? Math.min(saved.zoom, MAX_ZOOM) : 1.5);
    map.attributionControl.setPrefix(false).addAttribution('Natural Earth');
    // 重なり順: 陸地（国境）→ 県・州の境界 →（街路）→ 都市名 → ピン
    for (const [name, z] of [['ne-land', 200], ['ne-admin', 210], ['ne-labels', 390]]) map.createPane(name).style.zIndex = z;
    map.getPane('ne-labels').style.pointerEvents = 'none';
    renderers = { land: L.canvas({ pane: 'ne-land' }), admin: L.canvas({ pane: 'ne-admin' }) };
    landLayer = L.geoJSON(res.countries, { interactive: false, renderer: renderers.land, pane: 'ne-land' }).addTo(map);
    labelLayer = L.layerGroup([], { pane: 'ne-labels' });
    pinLayer = L.layerGroup().addTo(map);
    drawPins();
    if (here) showHere();
    map.on('contextmenu', (e) => addPin(e.latlng));
    map.on('zoomend', updateLayers);
    map.on('moveend', drawLabels);
    updateLayers();
    map.on('moveend', () => { const c = map.getCenter(); store.setSetting('mapView', { lat: +c.lat.toFixed(4), lng: +c.lng.toFixed(4), zoom: map.getZoom() }); });
    drawList();
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
    if (z < LAYER_ZOOM.places || !places) { labelLayer.remove(); return; }
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
    const recipe = locationRecipe(l);
    sheet(l.title, (close) => {
      const existing = store.findBySource('location', l.id);
      return [
        h('div', { class: 'small muted', style: 'margin-top:-6px' }, `${l.titleEn} · `, h('span', { class: 'num' }, l.year), ` · ${l.director}`),
        h('div', { class: 'loc-place' }, h('div', null, l.place), h('div', { class: 'small muted' }, `${l.city}・${l.country} `, h('span', { class: 'num' }, formatLatLng(l.lat, l.lng))),
          h('div', { class: 'row', style: 'gap:6px;margin-top:4px' }, h('span', { class: `chip conf-${l.confidence}` }, CONF_LABEL[l.confidence]),
            here ? h('span', { class: 'chip num' }, formatKm(haversine(here.lat, here.lng, l.lat, l.lng))) : null)),
        h('p', { style: 'margin:10px 0' }, l.scene),
        h('div', { class: 'small muted' }, '色味: ', l.look),
        h('div', { class: 'card stack', style: 'gap:6px;margin-top:10px' },
          h('div', { class: 'row' }, h('span', { class: 'grow', style: 'font-weight:600' }, '推定レシピ'), h('span', { class: 'small muted' }, X.filmLabel(recipe))),
          paramSummary(recipe),
          recipe.isoNote ? h('div', { class: 'small muted num' }, recipe.isoNote, recipe.exposureNote ? ` / ${recipe.exposureNote}` : '') : null),
        existing
          ? h('a', { class: 'btn block', style: 'margin-top:10px', href: `#/recipes/${encodeURIComponent(existing.id)}`, onclick: close }, 'インポート済み — レシピを開く')
          : h('button', { type: 'button', class: 'btn primary block', style: 'margin-top:10px', onclick: () => {
            const res = store.saveRecipe(recipe);
            if (res.errors) return toast(res.errors[0], 4000);
            close(); toast('レシピ帳にインポートしました');
          } }, 'レシピ帳にインポート'),
        h('p', { class: 'small muted', style: 'margin-top:8px' }, 'レシピは作品の色味から考えた推定で、公式の設定ではありません。'),
      ];
    });
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
  return () => { alive = false; mo.disconnect(); map?.remove(); };
}
