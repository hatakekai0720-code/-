// 判定ルールの較正（較正データの保存・移行・分布・更新案）のテスト。実行: node tests/calibration.test.mjs
import assert from 'node:assert/strict';
import { analyze } from '../js/analyzer.js';
import { readExif } from '../js/exif.js';
import { calibrationEntry, calibrationStats, validateCalibration, summarizeCalibration, proposeRules, MIN_SAMPLES, STAT_KEYS } from '../js/calibration.js';
import { RULES as TR } from '../js/translator.js';
import { xt3Sample } from './jpeg-builder.mjs';
import { sceneImage, edgesImage, addNoise } from './fixtures.mjs';

const mem = new Map();
globalThis.localStorage = { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k),
  key: (i) => [...mem.keys()][i] ?? null, get length() { return mem.size; } };
const store = await import('../js/store.js');

let count = 0;
const test = (name, fn) => { fn(); count++; console.log('ok  ', name); };
const a = analyze(sceneImage(300, 200), 300, 200);
const exif = readExif(xt3Sample());

test('較正データ 1 件: 実際の設定と統計値（数値）だけ。画像・ヒストグラム・GPS を持たない', () => {
  const e = calibrationEntry(exif, a);
  assert.equal(e.settings.filmSim, 'classic-chrome'); assert.equal(e.settings.color, -1); assert.equal(e.settings.kelvin, 4300);
  assert.deepEqual(Object.keys(e.stats), STAT_KEYS);
  for (const v of Object.values(e.stats)) assert.ok(v === null || Number.isFinite(v));
  assert.ok(!/hist|palette|data|gps|lat/i.test(JSON.stringify(e)), JSON.stringify(e));
  assert.ok(JSON.stringify(e).length < 1500, '1 件は小さい');
  assert.deepEqual(validateCalibration(e), []);
  assert.equal(calibrationEntry({ fuji: null }, a), null, '実際の設定が無ければ作らない');
  assert.equal(calibrationEntry({ fuji: { filmMode: 0x800 } }, a), null, 'X-T3 に無いフィルムでは作らない');
});

test('検証: 範囲外の設定・数値でない統計値は不可', () => {
  const e = calibrationEntry(exif, a);
  assert.ok(validateCalibration({ ...e, settings: { ...e.settings, filmSim: 'classic-neg' } }).length);
  assert.ok(validateCalibration({ ...e, settings: { ...e.settings, sharpness: 5 } }).length);
  assert.ok(validateCalibration({ ...e, stats: { ...e.stats, chroma: 'x' } }).length);
});

test('保存データ v3 → v4: calibration が空で追加される・追加 / 同じ写真は置き換え / エクスポートとインポート', () => {
  assert.equal(store.VERSION, 4);
  mem.set('xt3cine:db', JSON.stringify({ version: 3, recipes: [], slots: {}, pins: [], academy: { completed: [] }, visited: {}, palettes: {}, settings: { seeded: true } }));
  store.init();
  const saved = JSON.parse(mem.get('xt3cine:db'));
  assert.equal(saved.version, 4); assert.deepEqual(saved.calibration, []);
  const r1 = store.addCalibration({ ...calibrationEntry(exif, a), image: 'data:image/jpeg;base64,xxx' });
  assert.ok(r1.entry && !r1.replaced);
  assert.ok(!('image' in r1.entry), '未知のフィールドは保存しない');
  assert.ok(store.addCalibration(calibrationEntry(exif, a)).replaced, '同じ機種・撮影日時・フィルムは置き換え');
  assert.equal(store.calibration().length, 1);
  assert.ok(store.addCalibration({ settings: { filmSim: 'x' }, stats: {} }).errors);
  const exp = JSON.parse(store.exportData());
  assert.equal(exp.calibration.length, 1);
  const round = store.validateDb(exp);
  assert.ok(round.ok, round.errors?.join()); assert.equal(round.db.calibration.length, 1);
  const bad = store.validateDb({ ...exp, calibration: [{ id: 'z', settings: { filmSim: 'velvia', sharpness: 9 }, stats: {} }] });
  assert.equal(bad.ok, false);
  const other = store.validateDb({ ...exp, calibration: [{ ...exp.calibration[0], id: 'other' }] });
  store.importData(other.db, 'merge');
  assert.equal(store.calibration().length, 2, 'マージで追加');
  store.clearCalibration(); assert.equal(store.calibration().length, 0);
});

// フィルムごとに彩度の違う較正データ（RULES からずれた分布）
function sample(filmSim, chroma, contrast, color = 0, grain = 'off', g = 0.5) {
  const stats = Object.fromEntries(STAT_KEYS.map((k) => [k, 0]));
  return { settings: { filmSim, color, grain, monoFilter: null, dr: null, colorChrome: null, wbMode: null, kelvin: null, highlight: null, shadow: null, sharpness: null, nr: null }, stats: { ...stats, chroma, contrast, grain: g } };
}

test('分布: フィルムごとの彩度・コントラストと、RULES との差（範囲外なら差が出る）', () => {
  const list = [sample('velvia', 30, 180), sample('velvia', 34, 190), sample('velvia', 32, 170, 2), sample('eterna', 10, 120)];
  const sum = summarizeCalibration(list);
  const v = sum.find((s) => s.id === 'velvia');
  assert.equal(v.n, 3); assert.equal(v.chroma.mean, 32); assert.equal(v.contrast.mean, 180);
  assert.deepEqual(v.rule.sat, TR.film.find((f) => f.id === 'velvia').sat);
  assert.equal(v.diff.sat, 32 - TR.film.find((f) => f.id === 'velvia').sat[0], '下限からのずれ');
  assert.equal(v.chromaAtColor0.mean, (30 + 34 + 32 - 2 * TR.colorStep) / 3, 'カラー設定の分を引く');
  assert.equal(sum.find((s) => s.id === 'eterna').diff.sat, 0, '範囲内なら 0');
});

test('更新案（JSON）: 件数が足りるフィルムだけ・現在の値も並べる・RULES は書き換えない', () => {
  const before = JSON.stringify(TR);
  const list = [...[28, 30, 32, 34].map((c) => sample('velvia', c, 180)), sample('eterna', 10, 120)];
  const p = proposeRules(list, '2026-11-24T00:00:00.000Z');
  assert.equal(p.kind, 'rules-proposal'); assert.equal(p.samples, 5);
  assert.deepEqual(p.film.map((f) => f.id), ['velvia'], `件数 ${MIN_SAMPLES} 以上のフィルムだけ`);
  assert.equal(p.film[0].sat[0] >= 28 && p.film[0].sat[1] <= 34, true);
  assert.deepEqual(p.film[0].current.sat, TR.film.find((f) => f.id === 'velvia').sat);
  assert.equal(p.colorCenter.velvia.proposed, 31); assert.equal(p.colorCenter.velvia.current, TR.colorCenter.velvia);
  assert.equal(JSON.stringify(TR), before, 'RULES はそのまま');
  JSON.parse(JSON.stringify(p));
});

test('更新案: グレインの設定ごとの粒状感から、しきい値の案を出す', () => {
  const list = [sample('provia', 30, 160, 0, 'off', 0.4), sample('provia', 30, 160, 0, 'off', 0.6), sample('provia', 30, 160, 0, 'weak', 2.6), sample('provia', 30, 160, 0, 'strong', 5)];
  const p = proposeRules(list);
  assert.equal(p.texture.grainMedianBySetting.off.median, 0.5);
  assert.equal(p.texture.grainThresholds.weak, 1.55); assert.equal(p.texture.grainThresholds.strong, 3.8);
});

test('実際の解析結果から統計値を作れる（質感も入る）', () => {
  const t = analyze(addNoise(edgesImage(1200, 800), 4), 1200, 800);
  const s = calibrationStats(t);
  assert.ok(s.grain > 3 && s.sharpness > 0.5);
});

console.log(`\n${count} 件のテストに合格`);
