// 日本の詳細地図（撮影スポットモード）のテスト: 表示範囲の切り替え・表示位置の記憶。実行: node tests/japan.test.mjs
import assert from 'node:assert/strict';
import {
  viewConfig, regionOf, validView, restoreView, rememberView, sanitizeViews, switchPlan,
  WORLD_BOUNDS, JAPAN_MAX_BOUNDS, JAPAN_FIT, JAPAN_ZOOM, WORLD_ZOOM, WORLD_DEFAULT,
  municipalityName, n03Props, decodeTopo, createLocator, sameCity, checkSpot, japanLayersAt, prefLabels, cityLabels, NEAR_KM, JAPAN_DIR, JAPAN_FILES, JAPAN_ATTRIBUTION, JAPAN_SIZE_LIMIT,
} from '../js/japan.js';
import { PREFS } from '../js/spots.js';
import { readFileSync, statSync } from 'node:fs';

const root = new URL('../', import.meta.url);
const readJson = (p) => JSON.parse(readFileSync(new URL(p, root), 'utf8'));

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

/* ---- 地図データ（国土数値情報 N03 を加工） ---- */
await test('N03 の属性 → 市区町村名: 政令指定都市は「市名 + 区名」、郡・支庁は付けない、所属未定地は空', () => {
  assert.equal(municipalityName({ N03_003: '札幌市', N03_004: '中央区' }), '札幌市中央区');
  assert.equal(municipalityName({ N03_004: '札幌市', N03_005: '中央区' }), '札幌市中央区'); // 年度によって区名が N03_005
  assert.equal(municipalityName({ N03_003: '石狩郡', N03_004: '当別町' }), '当別町');
  assert.equal(municipalityName({ N03_003: '大島支庁', N03_004: '新島村' }), '新島村');
  assert.equal(municipalityName({ N03_002: '石狩振興局', N03_003: '札幌市', N03_004: '北区' }), '札幌市北区');
  assert.equal(municipalityName({ N03_004: '千代田区' }), '千代田区');
  assert.equal(municipalityName({ N03_004: '所属未定地' }), '');
  assert.deepEqual(n03Props({ N03_001: '京都府', N03_003: '京都市', N03_004: '東山区', N03_007: '26105' }), { key: '26105', pref: '京都府', city: '京都市東山区', code: '26105' });
  assert.deepEqual(n03Props({ N03_001: '千葉県', N03_004: '所属未定地', N03_007: null }), { key: '千葉県:所属未定地', pref: '千葉県', city: '', code: '' });
});
const low = readJson(JAPAN_DIR + JAPAN_FILES.low), high = readJson(JAPAN_DIR + JAPAN_FILES.high);
await test('データ: 都道府県 47 件・市区町村 1,700 件以上、属性と名前の位置、出典', () => {
  const prefs = low.objects.prefs.geometries;
  assert.deepEqual(prefs.map((g) => g.properties.pref).sort(), [...PREFS].sort());
  const cities = high.objects.cities.geometries;
  assert.ok(cities.length >= 1700, `${cities.length} 件`);
  for (const g of [...prefs, ...cities]) {
    assert.ok(['Polygon', 'MultiPolygon'].includes(g.type), g.type);
    assert.ok(PREFS.includes(g.properties.pref), g.properties.pref);
    assert.ok(Number.isFinite(g.properties.lx) && Number.isFinite(g.properties.ly), `${g.properties.city} の名前の位置`);
  }
  for (const g of cities) {
    assert.ok(g.properties.city === '' || /[市区町村]$/.test(g.properties.city), g.properties.city);
    assert.ok(g.properties.city === '' ? g.properties.code === '' : /^\d{5}$/.test(g.properties.code), g.properties.city);
    if (g.properties.code) assert.equal(Number(g.properties.code.slice(0, 2)), PREFS.indexOf(g.properties.pref) + 1, `${g.properties.city} の都道府県コード`);
  }
  const codes = cities.map((g) => g.properties.code).filter(Boolean);
  assert.equal(new Set(codes).size, codes.length, '同じ市区町村が 1 件にまとまっている');
  for (const name of ['札幌市中央区', '京都市東山区', '千代田区', '那覇市', '小笠原村', '与那国町']) assert.ok(cities.some((g) => g.properties.city === name), name);
  for (const t of [low, high]) assert.equal(t.meta.attribution, JAPAN_ATTRIBUTION);
});
await test('データ: 合計 5MB 以下（Service Worker でプリキャッシュする）', () => {
  const total = Object.values(JAPAN_FILES).reduce((s, f) => s + statSync(new URL(JAPAN_DIR + f, root)).size, 0);
  assert.ok(total <= JAPAN_SIZE_LIMIT, `${total} バイト`);
  const sw = readFileSync(new URL('sw.js', root), 'utf8');
  for (const f of Object.values(JAPAN_FILES)) assert.ok(sw.includes(`'./${JAPAN_DIR}${f}'`), `${f} が ASSETS にない`);
  assert.match(readFileSync(new URL('data/japan/LICENSE', root), 'utf8'), /国土数値情報（行政区域データ）（国土交通省）を加工して作成/);
});

/* ---- 市区町村の判定 ---- */
await test('判定: 小さな TopoJSON（穴あき・飛び地）で、中・穴・飛び地・海岸線の近く・遠くを判定する', () => {
  // A: 0〜10 の正方形に 4〜6 の穴、飛び地 20〜22。B: 穴の中身（4〜6）
  const topo = { type: 'Topology', arcs: [
    [[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]], [[4, 4], [4, 6], [6, 6], [6, 4], [4, 4]], [[20, 0], [22, 0], [22, 2], [20, 2], [20, 0]],
  ], objects: { cities: { type: 'GeometryCollection', geometries: [
    { type: 'MultiPolygon', arcs: [[[0], [1]], [[2]]], properties: { pref: '甲県', city: 'A市', code: '01001' } },
    { type: 'Polygon', arcs: [[~1]], properties: { pref: '甲県', city: 'B町', code: '01002' } },
  ] } } };
  // 座標は度。赤道付近なので 1° ≒ 111km。近さの判定に使うため、緯度 0 付近で 0.01° ≒ 1.1km
  const scaled = { ...topo, arcs: topo.arcs.map((a) => a.map(([x, y]) => [140 + x * 0.01, y * 0.01])) };
  const locate = createLocator(decodeTopo(scaled, 'cities'));
  assert.equal(locate(0.02, 140.02).city, 'A市');
  assert.equal(locate(0.05, 140.05).city, 'B町', '穴の中は B町');
  assert.equal(locate(0.01, 140.21).city, 'A市', '飛び地');
  const near = locate(0.05, 140.12); // 東の辺から 0.02° ≒ 2.2km
  assert.equal(near.city, 'A市'); assert.equal(near.exact, false); assert.ok(near.km > 2 && near.km < NEAR_KM, String(near.km));
  assert.equal(locate(0.05, 140.5), null, '遠い海の上');
  assert.equal(locate(NaN, 140), null);
});
const locate = createLocator(decodeTopo(high, 'cities'));
await test('判定: 実データで代表的な地点の都道府県・市区町村', () => {
  const cases = [
    [35.6812, 139.7671, '東京都', '千代田区'], [34.9671, 135.7727, '京都府', '京都市伏見区'], [43.0621, 141.3544, '北海道', '札幌市中央区'],
    [26.2124, 127.6809, '沖縄県', '那覇市'], [27.0940, 142.1910, '東京都', '小笠原村'], [24.4686, 123.0047, '沖縄県', '与那国町'],
    [34.6937, 135.5023, '大阪府', '大阪市北区'], [33.5897, 130.4207, '福岡県', '福岡市博多区'], [36.5613, 136.6562, '石川県', '金沢市'],
  ];
  for (const [lat, lng, pref, city] of cases) {
    const r = locate(lat, lng);
    assert.ok(r, `${city} が判定できない`);
    assert.equal(r.pref, pref, `${city}: ${r.pref}`);
    assert.equal(r.city, city, `${lat},${lng}: ${r.city}`);
  }
  assert.equal(locate(37.5, 132.0), null, '日本海の真ん中');
  assert.equal(locate(37.5665, 126.978), null, 'ソウル');
});
await test('判定: データの市区町村名の書き方の違い（区なし・郡つき・区名だけ）は一致とみなす', () => {
  assert.ok(sameCity('京都市', '京都市東山区'));
  assert.ok(sameCity('京都市東山区', '京都市東山区'));
  assert.ok(sameCity('西村山郡朝日町', '朝日町'));
  assert.ok(sameCity('東山区', '京都市東山区'));
  assert.ok(sameCity('大和郡山市', '大和郡山市'));
  assert.ok(!sameCity('郡山市', '大和郡山市'));
  assert.ok(!sameCity('白山市', '能美市'));
  assert.ok(!sameCity('府中市', '府中町'));
  assert.ok(!sameCity('', '千代田区'));
  const spot = { lat: 35.0116, lng: 135.7681, pref: '京都府', city: '京都市' };
  assert.deepEqual(checkSpot(spot, () => ({ pref: '京都府', city: '京都市中京区', exact: true, km: 0 })).city, true);
  assert.equal(checkSpot({ ...spot, city: null }, () => ({ pref: '京都府', city: '京都市中京区' })).city, null);
  assert.equal(checkSpot(spot, () => null).pref, false);
});
await test('表示: 都道府県名はズーム 5〜8、市区町村境と市区町村名は 8 以上', () => {
  assert.deepEqual(japanLayersAt(4.5), { detail: 'low', prefLabels: false, cityLabels: false });
  assert.deepEqual(japanLayersAt(5), { detail: 'low', prefLabels: true, cityLabels: false });
  assert.deepEqual(japanLayersAt(7.5), { detail: 'low', prefLabels: true, cityLabels: false });
  assert.deepEqual(japanLayersAt(8), { detail: 'high', prefLabels: true, cityLabels: true });
  assert.deepEqual(japanLayersAt(8.5), { detail: 'high', prefLabels: false, cityLabels: true });
  assert.deepEqual(japanLayersAt(12), { detail: 'high', prefLabels: false, cityLabels: true });
  assert.equal(prefLabels(low).length, 47);
  assert.ok(cityLabels(high).every((l) => l[2] && Number.isFinite(l[0]) && Number.isFinite(l[1])));
  // 名前を置く地点は、その市区町村の中（判定器で同じ市区町村になる）
  const off = cityLabels(high).filter(([lng, lat, city]) => locate(lat, lng)?.city !== city);
  assert.ok(off.length <= 5, off.map((l) => l[2]).join('・'));
});

/* ---- 撮影スポットのデータとの食い違い ---- */
// 座標が概略（verified: false。OpenStreetMap とまだ照合していない）のために地図データの判定と食い違っているもの。
// ワークフロー「撮影スポットを取得」で座標を照合したら、ここから外す（外せるものはテストの出力に出る）
const KNOWN_APPROX = new Set(['shrine-026', 'shrine-030', 'shrine-045', 'jyudenken-091', 'jyudenken-099', 'tanada-009', 'tanada-012', 'tanada-016', 'tanada-032']);
await test('撮影スポット: データの都道府県・市区町村と、地図データから判定した値が食い違わない', () => {
  const index = readJson('data/spots/index.json');
  const spots = index.files.flatMap((f) => readJson(`data/spots/${f.file}`).spots);
  const bad = [], fixed = [];
  for (const s of spots) {
    const r = checkSpot(s, locate);
    const ok = r.found && r.pref && r.city !== false;
    if (!ok && !KNOWN_APPROX.has(s.id)) bad.push(`${s.id} ${s.name}: データ ${s.pref} ${s.city ?? ''} / 地図 ${r.found ? `${r.found.pref} ${r.found.city}${r.found.exact ? '' : `（${r.found.km}km）`}` : '範囲外'}`);
    if (ok && KNOWN_APPROX.has(s.id)) fixed.push(s.id);
  }
  for (const id of KNOWN_APPROX) {
    const s = spots.find((x) => x.id === id);
    if (s) assert.equal(s.verified, false, `${id} は座標を照合済みなのに食い違っている（データを直す）`);
  }
  if (fixed.length) console.log(`     （食い違いが直ったので KNOWN_APPROX から外せる: ${fixed.join(', ')}）`);
  assert.deepEqual(bad, [], `食い違い ${bad.length} 件:\n${bad.join('\n')}`);
  console.log(`     ${spots.length} 件を照合（概略座標のため既知の食い違い ${KNOWN_APPROX.size - fixed.length} 件）`);
});

console.log(`\n${count} 件のテストに合格`);
