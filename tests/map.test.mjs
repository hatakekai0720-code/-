// ロケ地データと距離計算のテスト。実行: node tests/map.test.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { haversine, formatKm, formatLatLng, unwrapAntimeridian, wrapLngNear, labelWidth, pickLabels } from '../js/geo.js';
import { statSync } from 'node:fs';
import { clusterPoints, maxSpread, spiderOffsets, sizeTier, facetCounts, filterLocations, CLUSTER_RADIUS, REGION_LABELS } from '../js/cluster.js';
import { locationRecipe } from '../js/locations.js';
import { validateRecipe, drWarning } from '../js/xt3.js';

const near = (v, want, tol, msg) => assert.ok(Math.abs(v - want) <= tol, `${msg}: ${v} (期待 ${want}±${tol})`);
let count = 0;
const test = (name, fn) => { fn(); count++; console.log('ok  ', name); };

test('Haversine: 既知の距離', () => {
  near(haversine(0, 0, 0, 1), 111.2, 0.1, '赤道上の経度 1°');
  near(haversine(0, 0, 1, 0), 111.2, 0.1, '緯度 1°');
  near(haversine(35.6812, 139.7671, 34.7025, 135.4959), 403, 3, '東京駅〜大阪駅');
  near(haversine(51.5074, -0.1278, 40.7128, -74.006), 5570, 10, 'ロンドン〜ニューヨーク');
  near(haversine(0, 179.5, 0, -179.5), 111.2, 0.1, '日付変更線をまたぐ');
  assert.equal(haversine(10, 20, 10, 20), 0);
  near(haversine(90, 0, -90, 0), Math.PI * 6371.0088, 0.01, '対蹠点');
});
test('表示形式', () => {
  assert.equal(formatKm(3.456), '3.5 km'); assert.equal(formatKm(12345.6), '12,346 km'); assert.equal(formatKm(null), '— km');
  assert.equal(formatLatLng(35.6856, -0.5), '35.6856°N 0.5000°W'); assert.equal(formatLatLng(-13.4, 103.8), '13.4000°S 103.8000°E');
});

const data = JSON.parse(readFileSync(new URL('../data/locations.json', import.meta.url)));
const locs = data.locations;
export const REGIONS = ['asia', 'middle-east', 'europe', 'north-america', 'latin-america', 'africa', 'oceania'];
test('ロケ地: 15 件以上、複数地域に分散、地域は定義済みのもの', () => {
  assert.ok(locs.length >= 15, `${locs.length} 件`);
  for (const l of locs) assert.ok(REGIONS.includes(l.region), `${l.id}.region = ${l.region}`);
  const regions = new Set(locs.map((l) => l.region));
  for (const r of ['asia', 'europe', 'north-america']) assert.ok(regions.has(r), r);
});
test('ロケ地: 必須項目・座標・confidence・ID 重複なし', () => {
  const ids = new Set();
  for (const l of locs) {
    for (const k of ['id', 'title', 'titleEn', 'director', 'place', 'city', 'country', 'scene', 'look']) assert.ok(typeof l[k] === 'string' && l[k], `${l.id}.${k}`);
    assert.ok(Number.isInteger(l.year) && l.year > 1890 && l.year <= 2026, `${l.id}.year`);
    assert.ok(Math.abs(l.lat) <= 90 && Math.abs(l.lng) <= 180, `${l.id} 座標`);
    assert.ok(['high', 'medium'].includes(l.confidence), `${l.id}.confidence`);
    assert.ok(!ids.has(l.id), `重複 ${l.id}`); ids.add(l.id);
    const { sources, links, photo, ...rest } = l; // 外部 URL を書いてよいのは出典・リンク・写真のクレジットだけ
    assert.ok(!/\.(jpe?g|png|webp|gif)|https?:/i.test(JSON.stringify(rest)), `${l.id} に画像や URL が含まれる（sources / links / photo 以外）`);
    assert.equal(typeof l.streets, 'boolean', `${l.id}.streets`);
    assert.ok(/^-?\d+(\.\d{1,4})?$/.test(String(l.lat)) && /^-?\d+(\.\d{1,4})?$/.test(String(l.lng)), `${l.id} 座標は小数 4 桁まで`);
  }
});
test('ロケ地: 出典 sources は 1 件以上の https URL（重複なし）、confidence は撮影地点の出典の件数と一致', () => {
  for (const l of locs) {
    assert.ok(Array.isArray(l.sources) && l.sources.length >= 1, `${l.id} に出典がない`);
    assert.equal(new Set(l.sources).size, l.sources.length, `${l.id} の出典が重複`);
    for (const u of l.sources) assert.ok(/^https:\/\/[^\s/]+\.[^\s/]+\/\S*$/.test(u) && !/\.(jpe?g|png|webp|gif)(\?|$)/i.test(u), `${l.id}: ${u}`);
    // 先頭 spotSources 件が撮影地点を確認できる出典（残りは作品情報の出典）。未設定なら全件
    const spot = l.spotSources ?? l.sources.length;
    assert.ok(Number.isInteger(spot) && spot >= 1 && spot <= l.sources.length, `${l.id}.spotSources`);
    assert.equal(l.confidence, spot >= 2 ? 'high' : 'medium', `${l.id}.confidence`);
  }
});
test('ロケ地: 同じ作品・同じ場所の重複がない', () => {
  const keys = locs.map((l) => `${l.titleEn}|${l.lat}|${l.lng}`);
  assert.equal(new Set(keys).size, keys.length);
});
test('ロケ地: 推定レシピはすべて xt3.js の範囲内', () => {
  for (const l of locs) assert.deepEqual(validateRecipe(locationRecipe(l)), [], l.id);
  for (const l of locs) assert.notEqual(drWarning(locationRecipe(l))?.level, 'warn', l.id);
});
test('日付変更線をまたぐリングを連続化', () => {
  const g = { type: 'Feature', geometry: { type: 'Polygon', coordinates: [[[178, 0], [-178, 0], [-178, 2], [178, 2], [178, 0]]] } };
  unwrapAntimeridian(g);
  assert.deepEqual(g.geometry.coordinates[0].map((p) => p[0]), [178, 182, 182, 178, 178]);
  const plain = { type: 'Feature', geometry: { type: 'MultiPolygon', coordinates: [[[[10, 0], [20, 0], [20, 5], [10, 0]]]] } };
  unwrapAntimeridian(plain);
  assert.deepEqual(plain.geometry.coordinates[0][0].map((p) => p[0]), [10, 20, 20, 10]);
});
test('日付変更線: 線（LineString / MultiLineString）も連続化', () => {
  const l = { type: 'Feature', geometry: { type: 'LineString', coordinates: [[179, 60], [-179, 61], [-178, 62]] } };
  unwrapAntimeridian(l);
  assert.deepEqual(l.geometry.coordinates.map((p) => p[0]), [179, 181, 182]);
  const m = { type: 'Feature', geometry: { type: 'MultiLineString', coordinates: [[[-179, 0], [179, 1]]] } };
  unwrapAntimeridian(m);
  assert.deepEqual(m.geometry.coordinates[0].map((p) => p[0]), [-179, -181]);
});
test('wrapLngNear: 地図の中心に近い経度へずらす', () => {
  assert.equal(wrapLngNear(139.7, 139), 139.7); assert.equal(wrapLngNear(139.7, -200), -220.3); assert.equal(wrapLngNear(-170, 175), 190);
});
test('pickLabels: ズーム・画面外・重なりで間引き、重要な順に残す', () => {
  const project = (lat, lng) => ({ x: lng * 10, y: -lat * 10 + 100 }); // 1° = 10px の簡易投影
  const places = [
    [10, 5, '大都市', 'Big', 2, 0],
    [10.2, 5, '重なる町', 'Overlap', 3, 5],   // 大都市のすぐ右 → 重なるので除外
    [10, 0, '下の町', 'Below', 4, 6],
    [30, 5, '小さな町', 'Small', 9, 9],       // ズーム 6 では出ない
    [200, 5, '画面外', 'Out', 1, 0],
  ];
  const got = pickLabels(places, project, { zoom: 6, width: 400, height: 200, centerLng: 10 });
  assert.deepEqual(got.map((p) => p.name), ['大都市', '下の町']);
  assert.equal(pickLabels(places, project, { zoom: 9, width: 400, height: 200, centerLng: 10 }).length, 3);
  assert.equal(pickLabels(places, project, { zoom: 9, width: 400, height: 200, centerLng: 10, max: 1 }).length, 1);
  assert.equal(labelWidth('Tokyo', 10), 30); assert.equal(labelWidth('東京', 10), 20);
});

const read = (f) => JSON.parse(readFileSync(new URL(`../data/${f}`, import.meta.url)));
const size = (f) => statSync(new URL(`../data/${f}`, import.meta.url)).size;
test('地図データ: 10m 国境・県州境界・都市名がそろい、合計 6MB 以内', () => {
  const c = read('countries-10m.json'), a = read('admin1-10m.json'), p = read('places-10m.json');
  assert.equal(c.type, 'Topology'); assert.ok(c.objects.countries.geometries.length > 200);
  assert.equal(a.type, 'Topology'); assert.ok(a.objects.admin1, 'admin1 オブジェクト'); assert.ok(a.arcs.length > 1000);
  assert.deepEqual(p.fields, ['lng', 'lat', 'name', 'nameEn', 'minZoom', 'rank']);
  assert.ok(p.places.length > 5000);
  for (const r of p.places) {
    assert.ok(Math.abs(r[0]) <= 180 && Math.abs(r[1]) <= 90 && typeof r[2] === 'string' && r[2] && typeof r[4] === 'number', JSON.stringify(r));
  }
  for (let i = 1; i < p.places.length; i++) assert.ok(p.places[i - 1][4] <= p.places[i][4], 'minZoom の昇順（重要な順）');
  const tokyo = p.places.find((r) => r[3] === 'Tokyo');
  assert.ok(tokyo && tokyo[4] <= 6, '東京はズーム 6 で表示される');
  const total = ['countries-10m.json', 'admin1-10m.json', 'places-10m.json'].reduce((s, f) => s + size(f), 0);
  assert.ok(total < 6e6, `${(total / 1e6).toFixed(1)} MB`);
});
/* ---- ピンのクラスタ ---- */
const flat = (lat, lng) => ({ x: lng * 10, y: -lat * 10 }); // 1° = 10px の簡易投影
test('クラスタ: 半径内はまとめ、離れた点は別。すべての点がちょうど 1 回ずつ含まれる', () => {
  const pts = [
    { id: 'a', lat: 0, lng: 0 }, { id: 'b', lat: 0, lng: 1 }, { id: 'c', lat: 1, lng: 0 },   // 互いに 10〜14px
    { id: 'd', lat: 0, lng: 20 },                                                         // 200px 先
    { id: 'e', lat: 30, lng: 30 }, { id: 'f', lat: 30, lng: 30 },                          // 同じ地点
  ];
  const cs = clusterPoints(pts, flat, 44);
  assert.deepEqual(cs.map((c) => c.members.map((m) => m.id).sort().join('')).sort(), ['abc', 'd', 'ef']);
  assert.equal(cs.reduce((s, c) => s + c.count, 0), pts.length);
  const abc = cs.find((c) => c.count === 3);
  assert.deepEqual(abc.bounds, [0, 0, 1, 1], '[南, 西, 北, 東]');
  near(abc.lat, 1 / 3, 1e-9, '中心の緯度'); near(abc.lng, 1 / 3, 1e-9, '中心の経度');
  assert.deepEqual(clusterPoints([], flat), []);
});
test('クラスタ: 実データ（ロケ地全件）でも、すべてのズームで重複・漏れなし', () => {
  const merc = (z) => (lat, lng) => { const s = 256 * 2 ** z; const r = lat * Math.PI / 180; return { x: (lng + 180) / 360 * s, y: (1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * s }; };
  for (const z of [1, 3, 5, 8, 12, 16]) {
    const cs = clusterPoints(locs, merc(z));
    const ids = cs.flatMap((c) => c.members.map((m) => m.id));
    assert.equal(ids.length, locs.length, `z${z}`); assert.equal(new Set(ids).size, locs.length, `z${z} 重複`);
    for (const c of cs) for (const m of c.members) {
      const a = merc(z)(m.lat, m.lng), o = merc(z)(c.members[0].lat, c.members[0].lng);
      assert.ok(Math.hypot(a.x - o.x, a.y - o.y) <= CLUSTER_RADIUS + 1e-6, `z${z} 半径外の点が混ざっている`);
    }
  }
  assert.ok(clusterPoints(locs, merc(1)).length < locs.length / 4, 'ズームアウトでは十分にまとまる');
});
test('クラスタ: 2000 点でも速い（スマホでカクつかない目安 50ms 未満）', () => {
  let seed = 3; const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  const pts = Array.from({ length: 2000 }, (_, i) => ({ id: i, lat: rnd() * 140 - 70, lng: rnd() * 360 - 180 }));
  const t = performance.now(); const cs = clusterPoints(pts, flat); const ms = performance.now() - t;
  assert.equal(cs.reduce((s, c) => s + c.count, 0), 2000);
  assert.ok(ms < 50, `${ms.toFixed(1)}ms`);
});
test('クラスタの大きさは件数で 3 段階', () => {
  assert.deepEqual([1, 2, 9, 10, 49, 50, 500].map(sizeTier), [0, 0, 0, 1, 1, 2, 2]);
});
test('最大ズームでも重なるか（maxSpread）と放射状の展開位置', () => {
  assert.equal(maxSpread([{ lat: 1, lng: 1 }, { lat: 1, lng: 1 }], flat), 0);
  near(maxSpread([{ lat: 0, lng: 0 }, { lat: 0, lng: 3 }, { lat: 4, lng: 0 }], flat), 50, 1e-9, '最大距離');
  for (const n of [1, 2, 3, 8, 9, 20, 60]) {
    const o = spiderOffsets(n, 26);
    assert.equal(o.length, n);
    let min = Infinity;
    for (let i = 0; i < n; i++) {
      assert.ok(Math.hypot(o[i].x, o[i].y) >= 26, `n=${n}: 中心に近すぎる`);
      for (let j = i + 1; j < n; j++) min = Math.min(min, Math.hypot(o[i].x - o[j].x, o[i].y - o[j].y));
    }
    if (n > 1) assert.ok(min >= 26 * 0.9, `n=${n}: ピン同士が重なる（最小 ${min.toFixed(1)}px）`);
  }
  assert.deepEqual(spiderOffsets(0), []);
});
test('地域・国の絞り込みと件数', () => {
  const f = facetCounts(locs);
  assert.equal(f.total, locs.length);
  assert.equal(f.regions.reduce((s, r) => s + r.count, 0), locs.length);
  assert.equal(f.countries.reduce((s, c) => s + c.count, 0), locs.length);
  for (const r of f.regions) assert.equal(r.label, REGION_LABELS[r.id]);
  for (let i = 1; i < f.countries.length; i++) assert.ok(f.countries[i - 1].count >= f.countries[i].count, '国は件数の多い順');
  const eu = facetCounts(locs, 'europe');
  assert.equal(eu.countries.reduce((s, c) => s + c.count, 0), filterLocations(locs, { region: 'europe' }).length);
  const jp = filterLocations(locs, { country: '日本' });
  assert.ok(jp.length > 0 && jp.every((l) => l.country === '日本'));
  assert.equal(filterLocations(locs, { region: 'europe', country: '日本' }).length, 0);
  assert.equal(filterLocations(locs).length, locs.length);
});
console.log(`\n${count} 件のテストに合格`);
