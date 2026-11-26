// 日本の詳細地図（撮影スポットモード）のテスト: 表示範囲の切り替え・表示位置の記憶。実行: node tests/japan.test.mjs
import assert from 'node:assert/strict';
import {
  viewConfig, regionOf, validView, restoreView, rememberView, sanitizeViews, switchPlan,
  WORLD_BOUNDS, JAPAN_MAX_BOUNDS, JAPAN_FIT, JAPAN_ZOOM, WORLD_ZOOM, WORLD_DEFAULT,
} from '../js/japan.js';

let count = 0;
const test = async (name, fn) => { await fn(); count++; console.log('ok  ', name); };
const inBox = ([[s, w], [n, e]], lat, lng) => lat >= s && lat <= n && lng >= w && lng <= e;

/* ---- 表示範囲の切り替え ---- */
await test('範囲: 撮影スポットだけ日本の詳細地図（最大ズーム 12）、映画ロケ地・すべては世界地図（最大 8）', () => {
  assert.equal(regionOf('spots'), 'japan');
  assert.equal(regionOf('films'), 'world');
  assert.equal(regionOf('all'), 'world');
  const jp = viewConfig('spots');
  assert.deepEqual(jp.maxBounds, JAPAN_MAX_BOUNDS);
  assert.equal(jp.maxZoom, 12);
  assert.deepEqual(jp.fit, JAPAN_FIT);
  for (const m of ['films', 'all']) {
    const w = viewConfig(m);
    assert.deepEqual(w.maxBounds, WORLD_BOUNDS);
    assert.equal(w.maxZoom, WORLD_ZOOM.max);
    assert.equal(w.fit, null);
  }
});
await test('範囲: 日本の動かせる範囲に沖縄・小笠原・北方領土・沖ノ鳥島・南鳥島が入り、朝鮮半島の奥・北京・台北・マニラは入らない', () => {
  const places = {
    与那国島: [24.4500, 122.9900], 波照間島: [24.0500, 123.7800], 那覇: [26.2124, 127.6809], 父島: [27.0940, 142.1910],
    南鳥島: [24.2867, 153.9806], 沖ノ鳥島: [20.4253, 136.0814], 択捉島: [45.0000, 147.7000], 色丹島: [43.8000, 146.7500],
    宗谷岬: [45.5228, 141.9364], 東京: [35.6812, 139.7671],
  };
  for (const [name, [lat, lng]] of Object.entries(places)) {
    assert.ok(inBox(JAPAN_MAX_BOUNDS, lat, lng), `${name} が動かせる範囲の外`);
  }
  // 日本全体を表示する範囲（最初に合わせる範囲）にも、本土・沖縄・北方領土・小笠原が入る
  for (const name of ['与那国島', '波照間島', '那覇', '父島', '択捉島', '色丹島', '宗谷岬', '東京']) assert.ok(inBox(JAPAN_FIT, ...places[name]), `${name} が JAPAN_FIT の外`);
  for (const [name, lat, lng] of [['北京', 39.9, 116.4], ['ウランバートル', 47.9, 106.9], ['マニラ', 14.6, 121.0], ['ハワイ', 21.3, -157.8]]) {
    assert.ok(!inBox(JAPAN_MAX_BOUNDS, lat, lng), `${name} が範囲内`);
  }
  // 日本全体を表示する範囲は、動かせる範囲の内側
  const [[s, w], [n, e]] = JAPAN_FIT, [[S, W], [N, E]] = JAPAN_MAX_BOUNDS;
  assert.ok(s >= S && w >= W && n <= N && e <= E);
});
await test('範囲: 世界地図の範囲外の座標は日本モードの保存値として使わない', () => {
  assert.equal(validView({ lat: 48.85, lng: 2.35, zoom: 6 }, 'spots'), null); // パリ
  assert.deepEqual(validView({ lat: 48.85, lng: 2.35, zoom: 6 }, 'films'), { lat: 48.85, lng: 2.35, zoom: 6 });
  assert.equal(validView({ lat: 'x', lng: 0, zoom: 1 }, 'films'), null);
  assert.equal(validView(null, 'films'), null);
  // ズームはモードの最小ズームより引かない
  assert.equal(validView({ lat: 35, lng: 139, zoom: 1 }, 'spots').zoom, JAPAN_ZOOM.min);
});

/* ---- 表示位置の記憶 ---- */
await test('記憶: モードごとに最後の表示位置を覚え、他のモードの値は残す', () => {
  let v = rememberView(null, 'films', { lat: 48.856613, lng: 2.352222, zoom: 6 });
  assert.deepEqual(v, { films: { lat: 48.8566, lng: 2.3522, zoom: 6 } });
  v = rememberView(v, 'spots', { lat: 35.0116, lng: 135.7681, zoom: 10.5 });
  v = rememberView(v, 'all', { lat: 40.7128, lng: -74.006, zoom: 4 });
  assert.deepEqual(Object.keys(v).sort(), ['all', 'films', 'spots']);
  assert.deepEqual(restoreView(v, 'films'), { lat: 48.8566, lng: 2.3522, zoom: 6 });
  assert.deepEqual(restoreView(v, 'spots'), { lat: 35.0116, lng: 135.7681, zoom: 10.5 });
  assert.deepEqual(restoreView(v, 'all'), { lat: 40.7128, lng: -74.006, zoom: 4 });
});
await test('記憶: 保存が無い・壊れているときは、日本は全体表示（null）、世界は以前の 1 件だけの保存（mapView）を引き継ぐ', () => {
  assert.equal(restoreView(null, 'spots'), null);
  assert.equal(restoreView({ spots: { lat: 1, lng: 2 } }, 'spots'), null);
  const legacy = { lat: 51.5, lng: -0.12, zoom: 5 };
  assert.deepEqual(restoreView(null, 'films', legacy), legacy);
  assert.deepEqual(restoreView({}, 'all', legacy), legacy);
  assert.equal(restoreView(null, 'spots', legacy), null, '日本のモードには世界地図の保存を使わない');
});
await test('切り替え: 世界 → 撮影スポット → 世界で、元の世界地図の位置とズームに戻る', () => {
  const paris = { lat: 48.8566, lng: 2.3522, zoom: 6 };
  // 初回の撮影スポット: 日本全体に合わせる
  let p = switchPlan({ views: null, from: 'films', to: 'spots', current: paris });
  assert.equal(p.config.region, 'japan');
  assert.equal(p.view, null);
  assert.deepEqual(p.fit, JAPAN_FIT);
  assert.deepEqual(p.views.films, paris);
  // 日本で京都を見てから映画ロケ地に戻る → パリ・ズーム 6
  const kyoto = { lat: 35.0116, lng: 135.7681, zoom: 11 };
  p = switchPlan({ views: p.views, from: 'spots', to: 'films', current: kyoto });
  assert.equal(p.config.region, 'world');
  assert.deepEqual(p.view, paris);
  assert.equal(p.fit, null);
  assert.deepEqual(p.config.maxBounds, WORLD_BOUNDS);
  // もう一度撮影スポットにすると京都に戻る
  p = switchPlan({ views: p.views, from: 'films', to: 'spots', current: paris });
  assert.deepEqual(p.view, kyoto);
  // 「すべて」はまだ保存が無いので世界の初期表示
  p = switchPlan({ views: p.views, from: 'spots', to: 'all', current: kyoto });
  assert.deepEqual(p.view, WORLD_DEFAULT);
  assert.deepEqual(p.views.spots, kyoto);
});
await test('切り替え: 地図を開いた直後（from なし）は保存を変えずに復元だけする', () => {
  const views = { spots: { lat: 43.06, lng: 141.35, zoom: 8 } };
  const p = switchPlan({ views, from: null, to: 'spots', current: null });
  assert.deepEqual(p.views, views);
  assert.deepEqual(p.view, views.spots);
});
await test('インポート: mapViews は正しいモード・範囲内の値だけ通す', () => {
  assert.deepEqual(sanitizeViews({ films: { lat: 1, lng: 2, zoom: 3 }, spots: { lat: 48.8, lng: 2.3, zoom: 6 }, xxx: { lat: 0, lng: 0, zoom: 1 }, all: 'x' }),
    { films: { lat: 1, lng: 2, zoom: 3 } });
  assert.equal(sanitizeViews('x'), null);
  assert.equal(sanitizeViews([]), null);
  assert.equal(sanitizeViews({}), null);
});
{
  const mem = new Map();
  globalThis.localStorage = { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k),
    get length() { return mem.size; }, key: (i) => [...mem.keys()][i] };
  const store = await import('../js/store.js');
  store.init();
  await test('保存: モードごとの表示位置はエクスポート/インポートで保ち、不正な値は捨てる', () => {
    store.setSetting('mapViews', rememberView(rememberView(null, 'films', { lat: 10, lng: 20, zoom: 3 }), 'spots', { lat: 35, lng: 139, zoom: 9 }));
    const back = store.validateDb(JSON.parse(store.exportData()));
    assert.ok(back.ok);
    assert.deepEqual(back.db.settings.mapViews, { films: { lat: 10, lng: 20, zoom: 3 }, spots: { lat: 35, lng: 139, zoom: 9 } });
    const bad = store.validateDb({ version: 4, recipes: [], settings: { mapViews: { spots: { lat: 0, lng: 0, zoom: 5 } } } });
    assert.ok(bad.ok);
    assert.equal(bad.db.settings.mapViews, undefined);
  });
}

console.log(`\n${count} 件のテストに合格`);
