// ロケ地データと距離計算のテスト。実行: node tests/map.test.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { haversine, formatKm, formatLatLng, unwrapAntimeridian, wrapLngNear, labelWidth, pickLabels } from '../js/geo.js';
import { statSync } from 'node:fs';
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
test('ロケ地: 15〜20 件、複数地域に分散', () => {
  assert.ok(locs.length >= 15 && locs.length <= 20, `${locs.length} 件`);
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
    assert.ok(!/\.(jpe?g|png|webp|gif)|https?:/i.test(JSON.stringify(l)), `${l.id} に画像や URL が含まれる`);
  }
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
console.log(`\n${count} 件のテストに合格`);
