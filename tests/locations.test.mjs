// data/locations.json のスキーマ（作品情報・撮影ガイド・links・photo）と外部リンクの形式のテスト。実行: node tests/locations.test.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { groupWorks } from '../js/film.js';
import { ALLOWED_LICENSE } from '../js/photos.js';

let count = 0;
const test = (name, fn) => { fn(); count++; console.log('ok  ', name); };
const locs = JSON.parse(readFileSync(new URL('../data/locations.json', import.meta.url))).locations;
const strOrNull = (v) => v === null || (typeof v === 'string' && v.trim().length > 0);
const KEYS = ['cinematographer', 'cast', 'production', 'distributor', 'genre', 'synopsis', 'format', 'sceneTime', 'weather', 'guide', 'visitNotes', 'lessons', 'palette', 'links', 'photo'];

test('すべてのロケ地に追加項目がある（確認できないものは null。推測で埋めない）', () => {
  for (const l of locs) for (const k of KEYS) assert.ok(k in l, `${l.id}.${k} がない`);
});
test('type: 実写の撮影地は "filming"、アニメなどのモデル地は "model"（すべてのロケ地に必須）', () => {
  for (const l of locs) assert.ok(l.type === 'filming' || l.type === 'model', `${l.id}.type = ${l.type}`);
});
test('作品情報: 撮影監督・キャスト（2〜3 人、役名）・製作（最大 3 社）・配給（原題国／日本）・ジャンル', () => {
  for (const l of locs) {
    assert.ok(strOrNull(l.cinematographer), `${l.id}.cinematographer`);
    assert.ok(strOrNull(l.genre), `${l.id}.genre`);
    if (l.cast !== null) {
      assert.ok(Array.isArray(l.cast) && l.cast.length >= 1 && l.cast.length <= 3, `${l.id}.cast は 1〜3 人`);
      for (const c of l.cast) assert.ok(typeof c.name === 'string' && c.name && strOrNull(c.role) && Object.keys(c).sort().join() === 'name,role', `${l.id}.cast`);
    }
    if (l.production !== null) assert.ok(Array.isArray(l.production) && l.production.length >= 1 && l.production.length <= 3 && l.production.every((x) => typeof x === 'string' && x), `${l.id}.production`);
    if ('committee' in l) assert.equal(l.committee, true, `${l.id}.committee は true のときだけ書く`);
    assert.ok(l.distributor && typeof l.distributor === 'object' && Object.keys(l.distributor).sort().join() === 'japan,original', `${l.id}.distributor`);
    assert.ok(strOrNull(l.distributor.original) && strOrNull(l.distributor.japan), `${l.id}.distributor の値`);
  }
});
test('あらすじ: 100 字以内（null 可）', () => {
  for (const l of locs) assert.ok(l.synopsis === null || (typeof l.synopsis === 'string' && [...l.synopsis].length <= 100 && l.synopsis.trim()), `${l.id}.synopsis`);
});
test('形式: capture と aspect（画面比は「n.nn:1」で始まる）', () => {
  for (const l of locs) {
    assert.ok(l.format && Object.keys(l.format).sort().join() === 'aspect,capture', `${l.id}.format`);
    assert.ok(strOrNull(l.format.capture), `${l.id}.format.capture`);
    assert.ok(l.format.aspect === null || /^\d(\.\d{1,2})?:1/.test(l.format.aspect), `${l.id}.format.aspect`);
  }
});
test('撮影ガイド: 時間帯・天気は決まった値、焦点距離は 35mm 換算、アングルとおすすめの時間', () => {
  for (const l of locs) {
    assert.ok([null, '朝', '昼', '夕方', 'マジックアワー', '夜'].includes(l.sceneTime), `${l.id}.sceneTime = ${l.sceneTime}`);
    assert.ok([null, '晴れ', '曇り', '雨', '雪', '霧'].includes(l.weather), `${l.id}.weather = ${l.weather}`);
    const g = l.guide;
    assert.ok(g && Object.keys(g).sort().join() === 'angle,bestTime,focal', `${l.id}.guide`);
    assert.ok(/^\d{2,3}mm/.test(g.focal), `${l.id}.guide.focal`);
    assert.ok(typeof g.angle === 'string' && g.angle && typeof g.bestTime === 'string' && g.bestTime, `${l.id}.guide`);
  }
});
test('訪問メモ: 料金・営業時間は書かない', () => {
  for (const l of locs) {
    assert.ok(strOrNull(l.visitNotes), `${l.id}.visitNotes`);
    if (l.visitNotes) assert.ok(!/料金|入場料|拝観料|\d+\s*円|\$\s*\d|€\s*\d|営業時間|開館時間|閉館時間|\d{1,2}:\d{2}/.test(l.visitNotes), `${l.id}.visitNotes に料金・営業時間`);
  }
});
test('講座: 1〜3 件・重複なし・1〜50 回、パレット: 5 色の #rrggbb', () => {
  for (const l of locs) {
    assert.ok(Array.isArray(l.lessons) && l.lessons.length >= 1 && l.lessons.length <= 3 && new Set(l.lessons).size === l.lessons.length
      && l.lessons.every((n) => Number.isInteger(n) && n >= 1 && n <= 50), `${l.id}.lessons`);
    assert.ok(Array.isArray(l.palette) && l.palette.length === 5 && l.palette.every((c) => /^#[0-9a-f]{6}$/.test(c)), `${l.id}.palette`);
  }
});
test('links: 映画.com は https://eiga.com/movie/<数字>/、Wikipedia は日本語版か英語版、予告編は https。キーは 3 つ', () => {
  for (const l of locs) {
    const k = l.links;
    assert.ok(k && Object.keys(k).sort().join() === 'eigacom,trailer,wikipedia', `${l.id}.links`);
    assert.ok(k.eigacom === null || /^https:\/\/eiga\.com\/movie\/\d+\/$/.test(k.eigacom), `${l.id}.links.eigacom = ${k.eigacom}`);
    assert.ok(k.wikipedia === null || /^https:\/\/(ja|en)\.wikipedia\.org\/wiki\/\S+$/.test(k.wikipedia), `${l.id}.links.wikipedia`);
    assert.ok(k.trailer === null || /^https:\/\/[^\s/]+\.[^\s/]+\/\S*$/.test(k.trailer), `${l.id}.links.trailer`);
  }
});
test('links: 同じ作品のロケ地は同じリンク、違う作品が同じ映画.com のページを指さない', () => {
  const owner = new Map();
  for (const w of groupWorks(locs)) {
    for (const key of ['eigacom', 'trailer', 'wikipedia']) assert.equal(new Set(w.locations.map((l) => l.links[key])).size, 1, `${w.key}.${key}`);
    const e = w.info.links.eigacom;
    if (!e) continue;
    assert.ok(!owner.has(e), `${e} が ${owner.get(e)} と ${w.key} の両方に`);
    owner.set(e, w.key);
  }
});
test('photo: null か、Commons のファイルページ・撮影者・許可されたライセンス', () => {
  for (const l of locs) {
    if (l.photo === null) continue;
    const p = l.photo;
    assert.ok(Object.keys(p).sort().join() === 'author,license,licenseUrl,sourceUrl', `${l.id}.photo`);
    assert.ok(/^https:\/\/commons\.wikimedia\.org\/wiki\/File:\S+$/.test(p.sourceUrl), `${l.id}.photo.sourceUrl`);
    assert.ok(typeof p.author === 'string' && p.author.trim(), `${l.id}.photo.author`);
    assert.ok(ALLOWED_LICENSE.test(p.license), `${l.id}.photo.license = ${p.license}`);
    assert.ok(p.licenseUrl === null || /^https:\/\/creativecommons\.org\//.test(p.licenseUrl), `${l.id}.photo.licenseUrl`);
  }
});

console.log(`\n${count} 件のテストに合格`);
