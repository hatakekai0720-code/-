// 「この写真に近い映画」のテスト。実行: node tests/similar.test.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { analyze } from '../js/analyzer.js';
import { similarWorks, locationFeatures, imageFeatures, score, RULES } from '../js/similar.js';
import { workKey } from '../js/film.js';
import { nightImage, NIGHT, makeImage, sceneImage } from './fixtures.mjs';

const locs = JSON.parse(readFileSync(new URL('../data/locations.json', import.meta.url), 'utf8')).locations;
let count = 0;
const test = (name, fn) => { fn(); count++; console.log('ok  ', name); };
const night = analyze(nightImage(), NIGHT.w, NIGHT.h);

test('上位 5 件・同じ作品は 1 件にまとめる・理由の一言が付く', () => {
  const list = similarWorks(night, locs);
  assert.equal(list.length, 5);
  assert.equal(new Set(list.map((w) => w.key)).size, 5, '作品が重複しない');
  for (const w of list) {
    assert.equal(workKey(w.location), w.key);
    assert.ok(w.reason && w.reason.length <= 40, w.reason);
    assert.ok(w.score > 0 && w.score <= 1);
  }
  for (let i = 1; i < list.length; i++) assert.ok(list[i - 1].score >= list[i].score, '近い順');
  const multi = similarWorks(night, locs, { top: 300 }).find((w) => w.count > 1);
  assert.ok(multi, '複数のロケ地がある作品は count に件数');
});

test('暗い夜景 + 青い光源 → 夜の作品が上位に来て、理由に「暗い夜景」「青い光源」', () => {
  const list = similarWorks(night, locs);
  assert.ok(list.filter((w) => w.location.sceneTime === '夜').length >= 4, list.map((w) => `${w.title}:${w.location.sceneTime}`).join(', '));
  assert.ok(list.some((w) => /暗い夜景/.test(w.reason)));
  assert.ok(list.some((w) => /青い光源/.test(w.reason)));
});

test('モノクロ画像 → モノクロの作品が上位', () => {
  const mono = analyze(makeImage(300, 200, (x, y) => { const v = 20 + 220 * ((x * y) % 97) / 97; return [v, v, v]; }), 300, 200);
  const list = similarWorks(mono, locs);
  assert.ok(list.every((w) => locationFeatures(w.location).mono), list.map((w) => w.title).join(', '));
});

test('明るい昼の画像では夜の作品は上位に来ない', () => {
  const day = analyze(sceneImage(300, 200), 300, 200);
  assert.ok(similarWorks(day, locs).every((w) => w.location.sceneTime !== '夜'));
});

test('重みは RULES で調整できる（光源の重みを 0 にすると理由に光源が出ない）', () => {
  const save = RULES.weights.light;
  try {
    RULES.weights.light = 0;
    assert.ok(similarWorks(night, locs).every((w) => !/光源/.test(w.reason)));
  } finally { RULES.weights.light = save; }
});

test('locationFeatures: 時間帯「夜」は暗い・代表色が無いロケ地は比べない', () => {
  const l = locs.find((x) => x.sceneTime === '夜' && x.palette?.length);
  assert.ok(locationFeatures(l).ev <= RULES.sceneTimeEV.夜);
  assert.equal(locationFeatures({ ...l, palette: [] }), null);
  const s = score(imageFeatures(night), locationFeatures(l));
  for (const v of Object.values(s.parts)) assert.ok(v >= 0 && v <= 1);
});

console.log(`\n${count} 件のテストに合格`);
