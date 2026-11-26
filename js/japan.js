// 日本の詳細地図（撮影スポットモード）
// ・表示範囲: 撮影スポットモードは日本全体（沖縄・小笠原・北方領土を含む）に合わせ、地図を動かせる範囲も日本周辺に限る。
//   映画ロケ地／すべてのモードは従来の世界地図。モードごとに最後の表示位置を覚える（settings.mapViews）
// ・前半は DOM 非依存の純粋関数（tests/japan.test.mjs でテスト）

/* ---- 表示範囲 ---- */

/** 世界地図の動かせる範囲（従来と同じ） */
export const WORLD_BOUNDS = [[-85, -400], [85, 400]];
/** 日本全体が収まる範囲（与那国島〜択捉島・宗谷岬〜波照間島。小笠原も入る）。最初に表示するときに合わせる */
export const JAPAN_FIT = [[24.0, 122.9], [45.6, 149.0]];
/** 撮影スポットモードで地図を動かせる範囲（日本周辺。沖ノ鳥島・南鳥島・北方領土を含めて余白をとる） */
export const JAPAN_MAX_BOUNDS = [[19.0, 118.0], [50.5, 158.0]];
export const WORLD_ZOOM = { min: 1, max: 8 };     // 世界地図（通常の最大ズーム 8）
export const JAPAN_ZOOM = { min: 3.5, max: 12 };  // 日本の詳細地図（最大ズーム 12。最小は画面幅に合わせて JAPAN_FIT が入るまで）
export const WORLD_DEFAULT = { lat: 30, lng: 60, zoom: 1.5 };
/** ズームに応じて表示するもの（このズーム以上 / 以下） */
export const JAPAN_LAYER_ZOOM = { prefLabelMin: 5, prefLabelMax: 8, cities: 8 };

/** モード → 地図の種類（撮影スポットだけ日本の詳細地図） */
export const regionOf = (mode) => (mode === 'spots' ? 'japan' : 'world');

/** モードの表示範囲の設定 */
export function viewConfig(mode) {
  return regionOf(mode) === 'japan'
    ? { region: 'japan', maxBounds: JAPAN_MAX_BOUNDS, fit: JAPAN_FIT, minZoom: JAPAN_ZOOM.min, maxZoom: JAPAN_ZOOM.max }
    : { region: 'world', maxBounds: WORLD_BOUNDS, fit: null, minZoom: WORLD_ZOOM.min, maxZoom: WORLD_ZOOM.max };
}

const inBox = ([[s, w], [n, e]], lat, lng) => lat >= s && lat <= n && lng >= w && lng <= e;

/** 保存された表示位置の検証（形式・範囲。範囲外や壊れた値は null） */
export function validView(v, mode, maxZoom = 18) {
  if (!v || typeof v !== 'object' || ![v.lat, v.lng, v.zoom].every(Number.isFinite)) return null;
  const cfg = viewConfig(mode);
  if (!inBox(cfg.maxBounds, v.lat, v.lng)) return null;
  const zoom = Math.min(Math.max(v.zoom, cfg.minZoom), maxZoom);
  return { lat: v.lat, lng: v.lng, zoom };
}

/**
 * モードの最後の表示位置。無ければ null（日本は JAPAN_FIT に合わせ、世界は WORLD_DEFAULT）。
 * legacy: 以前の 1 つだけの保存（settings.mapView）。世界地図のモードだけ引き継ぐ
 */
export function restoreView(views, mode, legacy = null, maxZoom = 18) {
  const saved = views && typeof views === 'object' ? views[mode] : null;
  return validView(saved, mode, maxZoom) ?? (regionOf(mode) === 'world' ? validView(legacy, mode, maxZoom) : null);
}

/** モードの表示位置を記録した新しいオブジェクト（他のモードの値は残す） */
export function rememberView(views, mode, v) {
  const out = {};
  for (const m of VIEW_MODES) if (views?.[m] && validView(views[m], m)) out[m] = views[m];
  out[mode] = { lat: +v.lat.toFixed(4), lng: +v.lng.toFixed(4), zoom: v.zoom };
  return out;
}
export const VIEW_MODES = ['films', 'spots', 'all'];

/** settings.mapViews の検証（インポート用。正しいモードの正しい値だけ通す） */
export function sanitizeViews(s) {
  if (!s || typeof s !== 'object' || Array.isArray(s)) return null;
  const out = {};
  for (const m of VIEW_MODES) {
    const v = validView(s[m], m);
    if (v && v.zoom === s[m].zoom) out[m] = { lat: v.lat, lng: v.lng, zoom: v.zoom };
  }
  return Object.keys(out).length ? out : null;
}

/**
 * モードを切り替えるときの手順（地図の外で計算してテストする）
 * @returns {{ views, config, view: {lat,lng,zoom}|null, fit: bounds|null }}
 *   view が null なら fit（日本全体）に合わせる
 */
export function switchPlan({ views, from, to, current, legacy = null }) {
  const next = from && current ? rememberView(views, from, current) : { ...(views || {}) };
  const config = viewConfig(to);
  const view = restoreView(next, to, legacy);
  return { views: next, config, view: view ?? (config.region === 'world' ? { ...WORLD_DEFAULT } : null), fit: view ? null : config.fit };
}

/* ---- 行政区域データ（国土数値情報 N03）の属性 ---- */

export const JAPAN_DIR = 'data/japan/';
export const JAPAN_FILES = { low: 'japan-low.json', high: 'japan-high.json' }; // 都道府県（ズーム 8 未満）/ 市区町村（8 以上・判定）
export const JAPAN_ATTRIBUTION = '国土数値情報（行政区域データ）（国土交通省）を加工して作成';
export const JAPAN_SIZE_LIMIT = 5 * 1024 * 1024; // data/japan/ の合計の上限

/**
 * N03 の属性 → 市区町村名。政令指定都市の区は「市名 + 区名」（札幌市中央区）、郡・支庁・振興局は付けない。
 * 年度で列の使い方が違っても動くように、N03_003〜N03_005 の値から組み立てる。所属未定地は ''。
 */
export function municipalityName(p) {
  const vals = ['N03_003', 'N03_004', 'N03_005'].map((k) => p?.[k]).filter((v) => typeof v === 'string' && v.trim()).map((v) => v.trim());
  if (!vals.length || vals.includes('所属未定地')) return '';
  const ward = [...vals].reverse().find((v) => /区$/.test(v));
  const city = vals.find((v) => /市$/.test(v) && v !== ward);
  if (ward && city) return ward.startsWith(city) ? ward : city + ward;
  const rest = vals.filter((v) => !/(郡|支庁|振興局)$/.test(v));
  return rest[rest.length - 1] || '';
}

/** N03 の 1 地物 → アプリで使う属性 { key, pref, city, code } */
export function n03Props(p) {
  const pref = String(p?.N03_001 || '').trim();
  const code = /^\d{5}$/.test(p?.N03_007 || '') ? p.N03_007 : '';
  const city = municipalityName(p);
  return { key: code || `${pref}:${city || '所属未定地'}`, pref, city, code };
}

/* ---- 市区町村の判定（地図データの市区町村ポリゴンに点が入るか） ---- */

/** 海岸線を簡略化したため、陸の外に少し出た地点（灯台・海岸・島）はこの距離までの最寄りの市区町村とみなす */
export const NEAR_KM = 3;

/** TopoJSON の 1 つのオブジェクト → [{ properties, polygons: [[[lng, lat], …], …][] }]（topojson-client を使わない最小の実装） */
export function decodeTopo(topo, name) {
  const t = topo.transform;
  const arcs = topo.arcs.map((arc) => {
    if (!t) return arc;
    let x = 0, y = 0;
    return arc.map(([dx, dy]) => { x += dx; y += dy; return [x * t.scale[0] + t.translate[0], y * t.scale[1] + t.translate[1]]; });
  });
  const ring = (ids) => {
    const out = [];
    for (const i of ids) {
      const a = i < 0 ? arcs[~i].slice().reverse() : arcs[i];
      for (let k = out.length ? 1 : 0; k < a.length; k++) out.push(a[k]);
    }
    return out;
  };
  return topo.objects[name].geometries.map((g) => ({
    properties: g.properties || {},
    polygons: g.type === 'Polygon' ? [g.arcs.map(ring)] : g.type === 'MultiPolygon' ? g.arcs.map((p) => p.map(ring)) : [],
  }));
}

const KM_LAT = 111.32;
/** 点と線分の距離（km。狭い範囲なので正距円筒で近似） */
function segKm(lng, lat, a, b) {
  const kx = KM_LAT * Math.cos(lat * Math.PI / 180);
  const ax = (a[0] - lng) * kx, ay = (a[1] - lat) * KM_LAT, bx = (b[0] - lng) * kx, by = (b[1] - lat) * KM_LAT;
  const dx = bx - ax, dy = by - ay, len = dx * dx + dy * dy;
  const k = len ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len)) : 0;
  return Math.hypot(ax + k * dx, ay + k * dy);
}
function inRings(lng, lat, rings) {
  let inside = false; // 偶奇規則（穴も正しく扱える）
  for (const r of rings) {
    for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
      const [xi, yi] = r[i], [xj, yj] = r[j];
      if ((yi > lat) !== (yj > lat) && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
    }
  }
  return inside;
}

/**
 * 市区町村の判定器。locate(lat, lng) → { pref, city, code, exact, km } | null
 *   exact: ポリゴンの中 / false: ポリゴンの外だが NEAR_KM 以内の最寄り（km はその距離）
 */
export function createLocator(features) {
  const items = features.map((f) => {
    let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity;
    for (const poly of f.polygons) for (const [x, y] of poly[0] || []) { if (x < w) w = x; if (x > e) e = x; if (y < s) s = y; if (y > n) n = y; }
    return { f, bbox: [w, s, e, n] };
  });
  const result = (f, exact, km) => ({ pref: f.properties.pref, city: f.properties.city || '', code: f.properties.code || '', exact, km });
  return function locate(lat, lng) {
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    let hit = null;
    for (const { f, bbox: [w, s, e, n] } of items) {
      if (lng < w || lng > e || lat < s || lat > n) continue;
      if (f.polygons.some((poly) => inRings(lng, lat, poly))) {
        if (f.properties.city) return result(f, true, 0);
        hit ??= f; // 所属未定地（湖など）は、他に入るものが無いときだけ
      }
    }
    if (hit) return result(hit, true, 0);
    const dLat = NEAR_KM / KM_LAT, dLng = NEAR_KM / (KM_LAT * Math.cos(lat * Math.PI / 180));
    let best = null, bestKm = Infinity;
    for (const { f, bbox: [w, s, e, n] } of items) {
      if (lng < w - dLng || lng > e + dLng || lat < s - dLat || lat > n + dLat) continue;
      for (const poly of f.polygons) for (const r of poly) for (let i = 1; i < r.length; i++) {
        const km = segKm(lng, lat, r[i - 1], r[i]);
        if (km < bestKm || (km === bestKm && best && !best.properties.city)) { bestKm = km; best = f; }
      }
    }
    return best && bestKm <= NEAR_KM ? result(best, false, Math.round(bestKm * 100) / 100) : null;
  };
}

const normName = (s) => String(s || '').normalize('NFKC').replace(/[\s　]/g, '');
/**
 * 撮影スポットのデータの市区町村名と、地図データから判定した市区町村名が同じか。
 * データ側は「京都市」（区なし）・「西村山郡朝日町」（郡つき）・「東山区」（市なし）でも一致とみなす
 */
export function sameCity(dataCity, mapCity) {
  const a = normName(dataCity), b = normName(mapCity);
  if (!a || !b) return false;
  if (a === b) return true;
  if (/市$/.test(a) && b.startsWith(a) && /区$/.test(b)) return true;           // 政令指定都市（区まで書いていない）
  if (/郡/.test(a) && a.endsWith(b) && /郡$/.test(a.slice(0, -b.length))) return true; // 郡名つき
  if (/区$/.test(a) && a.length >= 2 && b.endsWith(a) && /市$/.test(b.slice(0, -a.length))) return true; // 政令指定都市の区名だけ
  return false;
}

/** 撮影スポット 1 件をデータと地図で照合する → { found, pref: 一致か, city: 一致か（データに市区町村が無ければ null） } */
export function checkSpot(spot, locate) {
  const found = locate(spot.lat, spot.lng);
  if (!found) return { found: null, pref: false, city: spot.city ? false : null };
  return { found, pref: found.pref === spot.pref, city: spot.city ? sameCity(spot.city, found.city) : null };
}

/* ---- ブラウザ: 地図データの読み込み（一度だけ。Service Worker のプリキャッシュから読む） ---- */

const topoCache = {};
/** level: 'low'（都道府県）| 'high'（市区町村）の TopoJSON */
export function loadJapanTopo(level) {
  topoCache[level] ??= fetch(JAPAN_DIR + JAPAN_FILES[level]).then((r) => {
    if (!r.ok) throw new Error(`${JAPAN_FILES[level]} を読み込めません`);
    return r.json();
  });
  topoCache[level].catch(() => { delete topoCache[level]; });
  return topoCache[level];
}
let locatorP = null;
/** 市区町村の判定器（japan-high.json から作る） */
export function loadLocator() {
  locatorP ??= loadJapanTopo('high').then((t) => createLocator(decodeTopo(t, 'cities')));
  locatorP.catch(() => { locatorP = null; });
  return locatorP;
}
/** 名前のラベル（js/geo.js の pickLabels の形 [経度, 緯度, 名前, 補足, 表示し始めるズーム, 順位]） */
export const prefLabels = (topo) => topo.objects.prefs.geometries.map((g) => [g.properties.lx, g.properties.ly, g.properties.pref, '', 0, 0]);
export const cityLabels = (topo) => topo.objects.cities.geometries.filter((g) => g.properties.city)
  .map((g) => [g.properties.lx, g.properties.ly, g.properties.city, g.properties.pref, 0, 1]);
/** 地図で表示するもの（ズーム z のとき） */
export function japanLayersAt(z) {
  const L = JAPAN_LAYER_ZOOM;
  return { detail: z >= L.cities ? 'high' : 'low', prefLabels: z >= L.prefLabelMin && z <= L.prefLabelMax, cityLabels: z >= L.cities };
}
