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
