// 作品のまとめ・検索・年代・講座との対応・画面比、保存データ v3（行った・パレット）のテスト。実行: node tests/film.test.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { workKey, groupWorks, DECADES, decadeOf, inDecade, decadeCounts, namesOf, fold, search, worksByName, locationsForLesson, aspectValue, needs169 } from '../js/film.js';
import { dominantColors, Accumulator } from '../js/analyzer.js';

let count = 0;
const test = (name, fn) => { fn(); count++; console.log('ok  ', name); };
const locs = JSON.parse(readFileSync(new URL('../data/locations.json', import.meta.url))).locations;

test('作品のキー: 英題と年から（記号・アクセントを落とす）', () => {
  assert.equal(workKey({ titleEn: 'Amélie', year: 2001 }), 'amelie-2001');
  assert.equal(workKey({ titleEn: '(500) Days of Summer', year: 2009 }), '500-days-of-summer-2009');
  assert.equal(workKey({ titleEn: 'Thelma & Louise', year: 1991 }), 'thelma-and-louise-1991');
  assert.equal(workKey({ titleEn: 'Mission: Impossible – Fallout', year: 2018 }), 'mission-impossible-fallout-2018');
});
test('作品ごとのまとめ: 全ロケ地がどれか 1 作品に入り、同じ作品は同じキー', () => {
  const works = groupWorks(locs);
  assert.equal(works.reduce((s, w) => s + w.locations.length, 0), locs.length);
  assert.equal(new Set(works.map((w) => w.key)).size, works.length);
  for (const w of works) for (const l of w.locations) assert.equal(`${l.titleEn}|${l.year}`, `${w.titleEn}|${w.year}`);
  // 同じ作品のロケ地は映画.com のリンクも同じ
  for (const w of works) assert.equal(new Set(w.locations.map((l) => l.links?.eigacom ?? null)).size, 1, w.key);
});
test('年代: 〜1960年代 / 70 / 80 / 90 / 2000 / 2010年代〜', () => {
  assert.deepEqual(DECADES.map((d) => d.label), ['〜1960年代', '70年代', '80年代', '90年代', '2000年代', '2010年代〜']);
  assert.equal(decadeOf(1949), '1960s-'); assert.equal(decadeOf(1969), '1960s-'); assert.equal(decadeOf(1970), '1970s');
  assert.equal(decadeOf(1999), '1990s'); assert.equal(decadeOf(2009), '2000s'); assert.equal(decadeOf(2010), '2010s+'); assert.equal(decadeOf(2023), '2010s+');
  assert.ok(inDecade(1985, 'all') && inDecade(1985, '1980s') && !inDecade(1985, '1990s'));
  assert.equal(decadeCounts(locs).reduce((s, d) => s + d.count, 0), locs.length);
});
test('名前: 監督・撮影・出演（役名）・製作・配給（原題国／日本）、「、」区切りを分ける', () => {
  const n = namesOf({ director: 'A、B', cinematographer: 'C', cast: [{ name: 'D', role: 'x' }], production: ['E'], distributor: { original: 'F', japan: 'G、H' } });
  assert.deepEqual(n.map((x) => `${x.role}:${x.name}`), ['director:A', 'director:B', 'cinematographer:C', 'cast:D', 'production:E', 'distributor:F', 'distributor:G', 'distributor:H']);
  assert.equal(n.find((x) => x.name === 'D').detail, 'x');
  assert.equal(n.find((x) => x.name === 'G').detail, '日本');
});
test('検索: 作品名・人物・会社。中黒や空白・全角半角の違いを無視、年代で絞り込み', () => {
  assert.equal(fold('ビル・マーレイ'), fold('ビル マーレイ'));
  assert.equal(fold('ＬＡ　ＬＡ'), fold('la la'));
  const r = search(locs, 'ヴェンダース');
  const wenders = r.names.find((x) => x.name === 'ヴィム・ヴェンダース');
  assert.ok(wenders && wenders.roles.includes('director') && wenders.count >= 3);
  assert.ok(search(locs, 'ローマ').works.some((w) => w.title === 'ローマの休日'));
  assert.ok(search(locs, 'lost in').works.some((w) => w.titleEn === 'Lost in Translation'));
  assert.ok(search(locs, '東宝').names.some((x) => x.name === '東宝' && x.kind === 'company'));
  assert.ok(search(locs, 'ビル マーレイ').names.some((x) => x.name === 'ビル・マーレイ'));
  // 年代で絞ると 2000 年代の作品は出ない
  assert.ok(search(locs, 'ロスト・イン').works.length > 0);
  assert.equal(search(locs, 'ロスト・イン', { decade: '1980s' }).works.length, 0);
  assert.deepEqual(search(locs, '  '), { works: [], names: [] });
});
test('名前 → 作品（役割つき・年の古い順）', () => {
  const list = worksByName(locs, 'ビル・マーレイ');
  assert.ok(list.length >= 2);
  assert.ok(list.every((x, i) => i === 0 || list[i - 1].work.year <= x.work.year));
  assert.ok(list.every((x) => x.roles.some((r) => r.role === 'cast')));
});
test('講座 ↔ ロケ地: lessons の番号は 1〜50、講座から逆引きできる', () => {
  for (const l of locs) for (const n of l.lessons || []) assert.ok(Number.isInteger(n) && n >= 1 && n <= 50, `${l.id}.lessons`);
  const night = locationsForLesson(locs, 42);
  assert.ok(night.length > 0 && night.every((l) => l.lessons.includes(42)));
});
test('画面比: 1.85:1 以上なら 16:9（X-T3 は 3:2 / 16:9 / 1:1）', () => {
  assert.equal(aspectValue('2.39:1'), 2.39); assert.equal(aspectValue('1.33:1（スタンダード）'), 1.33); assert.equal(aspectValue(null), null);
  assert.ok(needs169('2.39:1') && needs169('1.85:1') && needs169('2.20:1（70mm）'));
  assert.ok(!needs169('1.66:1') && !needs169('1.37:1') && !needs169(null));
  for (const l of locs) assert.equal(!!l.recipe.sizeNote, needs169(l.format?.aspect), `${l.id}: 16:9 の注記`);
});
test('解析の代表色: 多い色から、似た色を避けて最大 5 色（#rrggbb）', () => {
  const w = 100, hgt = 100, d = new Uint8ClampedArray(w * hgt * 4);
  for (let i = 0; i < w * hgt; i++) {
    const c = i < 5000 ? [200, 40, 40] : i < 8000 ? [30, 60, 160] : i < 9500 ? [240, 230, 210] : [201, 41, 42];
    d.set([...c, 255], i * 4);
  }
  const pal = new Accumulator().add(d).result(w, hgt).palette;
  assert.deepEqual(pal, ['#c82828', '#1e3ca0', '#f0e6d2']); // [201,41,42] は赤と同じビン
  assert.ok(pal.every((c) => /^#[0-9a-f]{6}$/.test(c)));
  assert.deepEqual(dominantColors(new Uint32Array(4096), new Float64Array(4096 * 3)), []);
});

/* ---- 保存データ v3（localStorage はテスト用の簡易版） ---- */
const mem = new Map();
globalThis.localStorage = { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k),
  key: (i) => [...mem.keys()][i] ?? null, get length() { return mem.size; } };
const store = await import('../js/store.js');

test('保存データ: v2 → v3 の移行で visited・palettes が空で追加される', () => {
  assert.equal(store.VERSION, 3);
  mem.set('xt3cine:db', JSON.stringify({ version: 2, recipes: [], slots: {}, pins: [], academy: { completed: [2] }, settings: { seeded: true } }));
  store.init();
  const saved = JSON.parse(mem.get('xt3cine:db'));
  assert.equal(saved.version, 3);
  assert.deepEqual(saved.visited, {}); assert.deepEqual(saved.palettes, {});
  assert.deepEqual(saved.academy.completed, [2]);
});
test('行った: 日付とメモだけ。日付・メモの長さ・ID を検証、エクスポートに入る', () => {
  assert.ok(store.setVisited('lost-in-translation-park-hyatt', { date: '2026-02-30', memo: '' }).errors);
  assert.ok(store.setVisited('Bad ID', { date: '2026-01-01' }).errors);
  assert.ok(store.setVisited('a', { date: '2026-01-01', memo: 'x'.repeat(501) }).errors);
  assert.deepEqual(store.setVisited('lost-in-translation-park-hyatt', { date: '2026-03-01', memo: 'バー' }).visit, { date: '2026-03-01', memo: 'バー' });
  const exp = JSON.parse(store.exportData());
  assert.deepEqual(exp.visited, { 'lost-in-translation-park-hyatt': { date: '2026-03-01', memo: 'バー' } });
  assert.ok(!/photo|image|blob/i.test(JSON.stringify(exp.visited)));
  store.clearVisited('lost-in-translation-park-hyatt');
  assert.equal(store.getVisited('lost-in-translation-park-hyatt'), null);
});
test('パレット: 色の数値だけ（#rrggbb、1〜8 色）。インポートで検証・マージ', () => {
  assert.ok(store.savePalette('blade-runner-1982', ['red']).errors);
  assert.ok(store.savePalette('blade-runner-1982', []).errors);
  assert.deepEqual(store.savePalette('blade-runner-1982', ['#AABBCC', '#000000']).palette.colors, ['#aabbcc', '#000000']);
  const bad = store.validateDb({ version: 3, recipes: [], palettes: { 'x-1': { colors: ['#zzzzzz'] } } });
  assert.equal(bad.ok, false);
  const inc = store.validateDb({ version: 3, recipes: [], visited: { 'paterson-great-falls': { date: '2025-05-05', memo: '' } }, palettes: { 'paterson-2016': { colors: ['#112233'], savedAt: '2026-01-01T00:00:00.000Z' } } });
  assert.ok(inc.ok);
  store.importData(inc.db, 'merge');
  assert.ok(store.getVisited('paterson-great-falls'));
  assert.deepEqual(store.getPalette('paterson-2016').colors, ['#112233']);
  assert.ok(store.getPalette('blade-runner-1982')); // マージでは既存を残す
  const round = store.validateDb(JSON.parse(store.exportData()));
  assert.ok(round.ok, round.errors?.join());
  assert.deepEqual(Object.keys(round.db.palettes).sort(), ['blade-runner-1982', 'paterson-2016']);
});

console.log(`\n${count} 件のテストに合格`);
