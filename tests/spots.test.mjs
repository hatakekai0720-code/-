// 撮影スポット: カテゴリ定義・データの検証・重複のまとめ・表示モードとカテゴリ切り替え・近い順・制覇率。実行: node tests/spots.test.mjs
import assert from 'node:assert/strict';
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import {
  validateCategories, categoryRecipe, validateSpot, validateAll, dedupeSpots, coreName, filterSpots, prefCounts, nearest, inBounds,
  completion, percent, MODES, normalizeMode, modeShows, normalizeSelection, toggleCategory, inJapan, PREFS, parseIndex, PRECACHE_LIMIT,
} from '../js/spots.js';
import { validateRecipe } from '../js/xt3.js';
import { classify, excluded, scoreCandidate } from '../scripts/spots-osm.mjs';
import { withRetry, overpassOnce, overpass, failedPrefsMarkdown, OverpassError, ENDPOINTS } from '../scripts/overpass.mjs';

let count = 0;
const test = (name, fn) => { fn(); count++; console.log('ok  ', name); };
const root = new URL('..', import.meta.url);
const read = (p) => JSON.parse(readFileSync(new URL(p, root), 'utf8'));

const cats = read('data/spot-categories.json').categories;
const catIds = cats.map((c) => c.id);
const lessonNos = new Set(read('data/lessons.json').lessons.map((l) => l.no));

/* ---- カテゴリ定義 ---- */
test('spot-categories.json: 名前・アイコン・色・レシピ（X-T3 の範囲内）・コツ 3〜5 行・講座の回が正しい', () => {
  assert.deepEqual(validateCategories({ categories: cats }, lessonNos), []);
  for (const c of cats) assert.deepEqual(validateRecipe(categoryRecipe(c)), [], c.id);
});
test('spot-categories.json: 要求されたカテゴリがそろい、色が重ならない', () => {
  for (const id of ['zoo', 'aquarium', 'botanical', 'observatory', 'viewpoint', 'lighthouse', 'castle', 'waterfall', 'beach', 'onsen', 'townscape', 'tanada', 'shrine']) assert.ok(catIds.includes(id), id);
  assert.equal(new Set(cats.map((c) => c.color.toLowerCase())).size, cats.length);
  assert.ok(!cats.some((c) => c.color.toLowerCase() === '#f59e0b'), '映画ロケ地のアクセント色と区別する');
});
test('spot-categories.json: 例に挙げた講座（滝 = 第5回・第37回）とコツ', () => {
  const w = cats.find((c) => c.id === 'waterfall');
  assert.ok(w.lessons.includes(5) && w.lessons.includes(37));
  const a = cats.find((c) => c.id === 'aquarium');
  assert.ok(a.tips.some((t) => t.includes('フラッシュ')) && a.tips.some((t) => t.includes('ガラス')));
  assert.equal(a.recipe.wb.mode, 'kelvin');
  assert.ok(cats.find((c) => c.id === 'zoo').tips.some((t) => t.includes('瞳')));
});
test('validateCategories: 不正なものを見つける', () => {
  const bad = structuredClone(cats.slice(0, 2));
  bad[0].recipe.highlight = 9; bad[1].tips = ['1 行だけ']; bad[1].lessons = [51];
  const e = validateCategories({ categories: bad }, lessonNos);
  assert.ok(e.some((x) => x.includes('レシピ')));
  assert.ok(e.some((x) => x.includes('tips')));
  assert.ok(e.some((x) => x.includes('lessons')));
  assert.ok(validateCategories({}).length);
});
test('categoryRecipe: source = spot・sourceRef = カテゴリ・メモにコツ', () => {
  const r = categoryRecipe(cats.find((c) => c.id === 'waterfall'));
  assert.equal(r.source, 'spot'); assert.equal(r.sourceRef, 'waterfall');
  assert.ok(r.notes.includes('低速シャッター'));
});

/* ---- スポットの検証 ---- */
const spot = (o = {}) => ({ id: 'osm-n1', category: 'waterfall', name: '華厳滝', lat: 36.7381, lng: 139.5023, pref: '栃木県', city: '日光市', source: 'osm', osmId: 'node/1', sources: ['https://www.openstreetmap.org/node/1'], website: null, note: null, ...o });
test('validateSpot: 正しいものは通る', () => { assert.deepEqual(validateSpot(spot(), catIds), []); });
test('validateSpot: 日本の範囲外・名前なし・都道府県名でない・出典なし', () => {
  assert.ok(validateSpot(spot({ lat: 48.85, lng: 2.35 }), catIds).some((e) => e.includes('範囲外')));
  assert.ok(validateSpot(spot({ name: ' ' }), catIds).some((e) => e.includes('name')));
  assert.ok(validateSpot(spot({ pref: '栃木' }), catIds).some((e) => e.includes('pref')));
  assert.ok(validateSpot(spot({ sources: [] }), catIds).some((e) => e.includes('sources')));
  assert.ok(validateSpot(spot({ osmId: null }), catIds).some((e) => e.includes('osmId')));
  assert.ok(validateSpot(spot({ source: 'curated', osmId: null, note: '' }), catIds).some((e) => e.includes('note')));
  assert.ok(validateSpot(spot({ category: 'ruins' }), catIds).some((e) => e.includes('category')));
});
test('inJapan: 端の島も含む', () => {
  assert.ok(inJapan(24.4667, 122.9333)); // 与那国島
  assert.ok(inJapan(45.5228, 141.9367)); // 宗谷岬
  assert.ok(inJapan(20.4253, 136.0806)); // 沖ノ鳥島
  assert.ok(inJapan(34.2, 129.3)); // 対馬
  assert.ok(inJapan(32.7, 128.8)); // 五島列島
  assert.ok(inJapan(26.2124, 127.6809)); // 那覇
  assert.ok(inJapan(27.0942, 142.1918)); // 父島
  assert.ok(inJapan(24.2867, 153.9806)); // 南鳥島
  assert.ok(inJapan(45.3, 148.5)); // 択捉島
  assert.ok(!inJapan(37.5665, 126.978)); // ソウル
  assert.ok(!inJapan(35.1796, 129.0756)); // 釜山
  assert.ok(!inJapan(33.4996, 126.5312)); // 済州島
  assert.ok(!inJapan(25.033, 121.5654)); // 台北
  assert.ok(!inJapan(46.9591, 142.738)); // ユジノサハリンスク
  assert.ok(!inJapan(43.1155, 131.8855)); // ウラジオストク
  assert.ok(!inJapan(NaN, 135));
});
test('validateAll: ID の重複とカテゴリごとの件数', () => {
  const r = validateAll([spot(), spot(), spot({ id: 'osm-n2', category: 'castle', name: '姫路城' })], catIds);
  assert.ok(r.errors.some((e) => e.includes('重複')));
  assert.equal(r.counts.waterfall, 2); assert.equal(r.counts.castle, 1); assert.equal(r.total, 3);
});

/* ---- 重複のまとめ ---- */
test('dedupeSpots: 同じ osmId はより具体的なカテゴリ（order の前）に 1 件', () => {
  const r = dedupeSpots([
    spot({ id: 'osm-w5-v', category: 'viewpoint', name: '姫路城', osmId: 'way/5' }),
    spot({ id: 'osm-w5-c', category: 'castle', name: '姫路城', osmId: 'way/5' }),
  ], catIds);
  assert.equal(r.spots.length, 1);
  assert.equal(r.spots[0].category, 'castle');
  assert.deepEqual(r.spots[0].alsoIn, ['viewpoint']);
});
test('dedupeSpots: 重伝建の地区内の温泉街は町並みに、城跡の展望所は城に', () => {
  const r = dedupeSpots([
    spot({ id: 'osm-n10', category: 'onsen', name: '温泉津温泉', lat: 35.0898, lng: 132.3433, osmId: 'node/10' }),
    spot({ id: 'jyudenken-yunotsu', category: 'townscape', name: '大田市温泉津', lat: 35.0905, lng: 132.3440, source: 'jyudenken', osmId: null, note: '港町・温泉町' }),
    spot({ id: 'osm-n11', category: 'castle', name: '竹田城跡', lat: 35.3005, lng: 134.8288, osmId: 'node/11' }),
    spot({ id: 'osm-n12', category: 'viewpoint', name: '天守台からの眺め', lat: 35.3008, lng: 134.8290, osmId: 'node/12' }),
    spot({ id: 'osm-n13', category: 'viewpoint', name: '立雲峡', lat: 35.2962, lng: 134.8391, osmId: 'node/13' }),
  ], catIds);
  assert.deepEqual(r.spots.map((s) => s.id).sort(), ['jyudenken-yunotsu', 'osm-n11', 'osm-n13']);
  assert.equal(r.merged.length, 2);
});
test('dedupeSpots: 名前が同じでも遠ければ別の場所・同じカテゴリの別の滝は残す', () => {
  const r = dedupeSpots([
    spot({ id: 'osm-n20', name: '不動滝', lat: 36.0, lng: 138.0, osmId: 'node/20' }),
    spot({ id: 'osm-n21', name: '不動滝', lat: 35.0, lng: 135.0, osmId: 'node/21' }),
    spot({ id: 'osm-n22', name: '白糸の滝', lat: 36.0003, lng: 138.0003, osmId: 'node/22' }),
  ], catIds);
  assert.equal(r.spots.length, 3);
});
test('coreName: 空白・中黒・括弧・「跡」を無視', () => {
  assert.equal(coreName('竹田城跡'), coreName('竹田城'));
  assert.equal(coreName('伊勢神宮（内宮）'), '伊勢神宮');
});

/* ---- 表示モードとカテゴリ切り替え ---- */
test('表示モード: 映画ロケ地／撮影スポット／すべて', () => {
  assert.deepEqual(MODES.map((m) => m.id), ['films', 'spots', 'all']);
  assert.deepEqual(modeShows('films'), { films: true, spots: false });
  assert.deepEqual(modeShows('spots'), { films: false, spots: true });
  assert.deepEqual(modeShows('all'), { films: true, spots: true });
  assert.equal(normalizeMode('xxx'), 'films');
  assert.equal(normalizeMode('spots'), 'spots');
});
test('カテゴリの選択: 未保存は全選択・無くなったカテゴリは捨てる・切り替え・全解除', () => {
  assert.deepEqual(normalizeSelection(undefined, catIds), catIds);
  assert.deepEqual(normalizeSelection(['zoo', 'ruins'], catIds), ['zoo']);
  assert.deepEqual(normalizeSelection([], catIds), []);
  let sel = toggleCategory(['zoo'], 'castle');
  assert.deepEqual(sel, ['zoo', 'castle']);
  sel = toggleCategory(sel, 'zoo');
  assert.deepEqual(sel, ['castle']);
});
const many = [
  spot({ id: 'a', category: 'zoo', name: '旭山動物園', lat: 43.7686, lng: 142.4800, pref: '北海道' }),
  spot({ id: 'b', category: 'castle', name: '姫路城', lat: 34.8394, lng: 134.6939, pref: '兵庫県' }),
  spot({ id: 'c', category: 'waterfall', name: '華厳滝', lat: 36.7381, lng: 139.5023, pref: '栃木県' }),
  spot({ id: 'd', category: 'castle', name: '松本城', lat: 36.2386, lng: 137.9689, pref: '長野県' }),
];
test('filterSpots: カテゴリ・都道府県・名前', () => {
  assert.deepEqual(filterSpots(many, { cats: ['castle'] }).map((s) => s.id), ['b', 'd']);
  assert.deepEqual(filterSpots(many, { cats: [] }), []);
  assert.deepEqual(filterSpots(many, { pref: '長野県' }).map((s) => s.id), ['d']);
  assert.deepEqual(filterSpots(many, { q: '姫路' }).map((s) => s.id), ['b']);
  assert.deepEqual(filterSpots([spot({ id: 'x', city: '日光市' }), spot({ id: 'y', city: '松本市' })], { q: '松本' }).map((s) => s.id), ['y'], '市区町村でも探せる');
  assert.deepEqual(filterSpots(many, { q: '長野' }).map((s) => s.id), ['d'], '都道府県名でも探せる');
  assert.deepEqual(filterSpots(many, { q: '華厳 滝' }).map((s) => s.id), ['c'], '空白は無視');
  assert.deepEqual(prefCounts(many).map((p) => p.id), ['北海道', '栃木県', '長野県', '兵庫県']);
});
test('nearest: 現在地から近い順（東京駅から）・件数の上限・現在地が無ければ名前順', () => {
  const tokyo = { lat: 35.6812, lng: 139.7671 };
  const r = nearest(many, tokyo, 3);
  assert.deepEqual(r.map((s) => s.id), ['c', 'd', 'b']);
  assert.ok(r[0].km > 100 && r[0].km < 120, `東京駅〜華厳滝 ${r[0].km}`);
  assert.ok(r.every((x, i) => i === 0 || r[i - 1].km <= x.km));
  assert.deepEqual(nearest(many, null).map((s) => s.km), [null, null, null, null]);
});
test('inBounds: 表示範囲（余白つき）の外は描かない', () => {
  const view = [135, 34, 140, 37]; // 近畿〜関東
  assert.deepEqual(inBounds(many, view).map((s) => s.id), ['c', 'd']);
  assert.deepEqual(inBounds(many, view, 0.2).map((s) => s.id), ['b', 'c', 'd']);
});
test('inBounds: 数千件でも速い', () => {
  const pts = Array.from({ length: 20000 }, (_, i) => ({ lat: 30 + (i % 150) / 10, lng: 130 + Math.floor(i / 150) / 10 }));
  const t = performance.now();
  for (let k = 0; k < 20; k++) inBounds(pts, [135, 34, 140, 37], 0.25);
  assert.ok(performance.now() - t < 500);
});
test('completion: カテゴリ別・都道府県別の制覇率', () => {
  const r = completion(many, { b: { date: '2026-01-01' }, c: { date: '2026-02-01' } }, cats);
  assert.equal(r.all.visited, 2); assert.equal(r.all.total, 4); assert.equal(percent(r.all.ratio), '50%');
  const castle = r.byCategory.find((x) => x.id === 'castle');
  assert.deepEqual([castle.visited, castle.total], [1, 2]);
  assert.ok(!r.byCategory.some((x) => x.id === 'beach'), '0 件のカテゴリは出さない');
  assert.deepEqual(r.byPref.map((x) => x.id), ['北海道', '栃木県', '長野県', '兵庫県']);
  assert.equal(r.byPref.find((x) => x.id === '栃木県').ratio, 1);
  assert.equal(percent(1 / 3), '33.3%');
});

/* ---- OpenStreetMap のタグの判定（scripts/spots-osm.mjs） ---- */
test('classify: タグ → カテゴリ', () => {
  assert.deepEqual(classify({ tourism: 'zoo', name: '上野動物園' }), ['zoo']);
  assert.deepEqual(classify({ tourism: 'aquarium', name: '海遊館' }), ['aquarium']);
  assert.deepEqual(classify({ leisure: 'garden', 'garden:type': 'botanical', name: '小石川植物園' }), ['botanical']);
  assert.deepEqual(classify({ leisure: 'park', name: '京都府立植物園' }), ['botanical']);
  assert.deepEqual(classify({ leisure: 'park', name: '代々木公園' }), []);
  assert.deepEqual(classify({ man_made: 'tower', 'tower:type': 'observation', name: '東京スカイツリー' }), ['observatory']);
  assert.deepEqual(classify({ man_made: 'tower', 'tower:type': 'communication', name: '電波塔' }), []);
  assert.deepEqual(classify({ tourism: 'viewpoint', name: '城山展望台' }), ['observatory']);
  assert.deepEqual(classify({ tourism: 'viewpoint', name: '天橋立ビューランド' }), ['viewpoint']);
  assert.deepEqual(classify({ man_made: 'lighthouse', name: '犬吠埼灯台' }), ['lighthouse']);
  assert.deepEqual(classify({ historic: 'castle', name: '姫路城' }), ['castle']);
  assert.deepEqual(classify({ historic: 'castle', tourism: 'viewpoint', name: '竹田城跡' }), ['castle', 'viewpoint']);
  assert.deepEqual(classify({ waterway: 'waterfall', name: '那智滝' }), ['waterfall']);
  assert.deepEqual(classify({ natural: 'beach', name: '白良浜' }), ['beach']);
  assert.deepEqual(classify({ place: 'village', name: '銀山温泉' }), ['onsen']);
  assert.deepEqual(classify({ place: 'suburb', name: '湯布院温泉郷' }), ['onsen']);
  assert.deepEqual(classify({ amenity: 'public_bath', name: '道後温泉' }), [], '温泉施設は温泉街に数えない');
  assert.deepEqual(classify({ place: 'village', name: '温泉寺前' }), []);
});
test('excluded: 名前なし・立入禁止・廃墟・個人宅は入れない', () => {
  assert.equal(excluded({ tourism: 'viewpoint' }), '名前なし');
  assert.equal(excluded({ name: '某展望所', access: 'private' }), '立入禁止・私有地');
  assert.equal(excluded({ name: '旧〇〇灯台', disused: 'yes' }), '廃止');
  assert.equal(excluded({ name: '〇〇ホテル廃墟' }), '廃墟・立入禁止');
  assert.equal(excluded({ name: '〇〇邸', building: 'house' }), '個人宅');
  assert.equal(excluded({ name: '竹田城跡', historic: 'castle', ruins: 'yes' }), null, '城跡は入れる');
});
test('scoreCandidate: 名前の一致と、カテゴリに合うタグ・近さで選ぶ', () => {
  const e = { name: '東大寺', match: ['東大寺'] };
  const temple = scoreCandidate(e, 'shrine', { type: 'way', tags: { name: '東大寺', amenity: 'place_of_worship' } }, 0.3);
  const bus = scoreCandidate(e, 'shrine', { type: 'node', tags: { name: '東大寺大仏殿春日大社前', highway: 'bus_stop' } }, 0.1);
  const other = scoreCandidate(e, 'shrine', { type: 'node', tags: { name: '興福寺' } }, 0.1);
  assert.ok(temple > bus, `${temple} > ${bus}`);
  assert.equal(other, -1);
});

/* ---- 同梱データ（data/spots/） ---- */
const dir = new URL('data/spots/', root);
test('data/spots/index.json: ファイルの sha256・サイズ・件数が実物と一致・precache は合計 5MB 以下のとき', () => {
  const idx = read('data/spots/index.json');
  const parsed = parseIndex(idx);
  assert.equal(parsed.files.length, idx.files.length, 'index の項目がすべて有効');
  let total = 0;
  for (const f of idx.files) {
    const buf = readFileSync(new URL(f.file, dir));
    assert.equal(buf.length, f.bytes, f.file);
    assert.equal(createHash('sha256').update(buf).digest('hex'), f.sha256, f.file);
    assert.equal(JSON.parse(buf).spots.length, f.count, f.file);
    total += f.bytes;
  }
  assert.equal(idx.totalBytes, total);
  assert.equal(idx.precache, total <= PRECACHE_LIMIT);
  const listed = new Set(idx.files.map((f) => f.file));
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.json') && x !== 'index.json')) assert.ok(listed.has(f), `${f} が index にありません`);
});
test('data/spots/*.json: 全件が検証を通り（日本の範囲・名前・都道府県・出典）、ID が全体で重複しない', () => {
  const idx = read('data/spots/index.json');
  const all = idx.files.flatMap((f) => {
    const d = read(`data/spots/${f.file}`);
    assert.equal(d.category, f.id);
    for (const s of d.spots) assert.equal(s.category, d.category, s.id);
    return d.spots;
  });
  const r = validateAll(all, catIds);
  assert.deepEqual(r.errors.slice(0, 5), []);
  assert.ok(r.total > 0);
});
test('data/spots/*.json: 外部 URL は sources（出典）と website（OSM の公式サイト）だけ', () => {
  for (const f of read('data/spots/index.json').files) {
    for (const s of read(`data/spots/${f.file}`).spots) {
      const { sources, website, ...rest } = s;
      assert.ok(!/https?:\/\//.test(JSON.stringify(rest)), `${s.id} に外部 URL`);
    }
  }
});
test('公的リスト・厳選の元データ（scripts/spot-lists/）: 出典と選定理由がある', () => {
  const lists = new URL('scripts/spot-lists/', root);
  for (const f of readdirSync(lists).filter((x) => x.endsWith('.json'))) {
    const d = JSON.parse(readFileSync(new URL(f, lists), 'utf8'));
    assert.ok(typeof d.listName === 'string' && d.listName, f);
    assert.ok(/^https:\/\//.test(d.listUrl), `${f}: listUrl`);
    const seen = new Set();
    for (const e of d.entries) {
      assert.ok(!seen.has(e.id), `${f}: ${e.id} が重複`); seen.add(e.id);
      assert.ok(PREFS.includes(e.pref), `${f}: ${e.id} の pref`);
      assert.ok(e.name && e.note, `${f}: ${e.id}`);
      assert.ok(Array.isArray(e.match) && e.match.length, `${f}: ${e.id} の match（OSM と照合する名前）`);
      assert.ok(inJapan(e.approx[0], e.approx[1]), `${f}: ${e.id} の概略座標`);
      if (d.category === 'shrine') assert.ok(e.sources?.length && e.sources.every((u) => /^https:\/\//.test(u)), `${f}: ${e.id} の出典`);
    }
  }
});
test('神社仏閣: 約 100 件・都道府県の偏りが大きすぎない', () => {
  const d = JSON.parse(readFileSync(new URL('scripts/spot-lists/shrines.json', root), 'utf8'));
  assert.ok(d.entries.length >= 90 && d.entries.length <= 120, `${d.entries.length} 件`);
  const per = new Map();
  for (const e of d.entries) per.set(e.pref, (per.get(e.pref) || 0) + 1);
  assert.ok(per.size >= 40, `${per.size} 都道府県`);
  const max = Math.max(...per.values());
  assert.ok(max <= 20, `最多の都道府県が ${max} 件`);
});

/* ---- Overpass の問い合わせとやり直し（scripts/overpass.mjs） ---- */
{
  const res = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
  const results = [];
  const check = async (name, fn) => { try { await fn(); results.push([name, null]); } catch (e) { results.push([name, e]); } };
  await check('やり直し: 失敗したら待って最大 3 回やり直し、待ち時間は倍々', async () => {
    const waits = [];
    let calls = 0;
    const r = await withRetry(async (attempt) => { calls++; if (attempt < 3) throw new OverpassError('混雑', true); return 'ok'; }, { retries: 3, wait: 30000, sleep: async (ms) => waits.push(ms) });
    assert.equal(r, 'ok'); assert.equal(calls, 4); assert.deepEqual(waits, [30000, 60000, 120000]);
  });
  await check('やり直し: 3 回やり直しても失敗したら投げる（試した回数つき）・やり直せない失敗はすぐ投げる', async () => {
    let calls = 0;
    await assert.rejects(withRetry(async () => { calls++; throw new OverpassError('HTTP 504', true); }, { retries: 3, wait: 1, sleep: async () => {} }), (e) => e.attempts === 4);
    assert.equal(calls, 4);
    calls = 0;
    await assert.rejects(withRetry(async () => { calls++; throw new OverpassError('HTTP 400', false); }, { retries: 3, wait: 1, sleep: async () => {} }), (e) => e.attempts === 1);
    assert.equal(calls, 1);
  });
  await check('問い合わせ: 混雑・通信エラー・時間切れ・サーバー側の時間切れはやり直せる、400 はやり直さない', async () => {
    const once = (fetchImpl) => overpassOnce('q', { fetchImpl, timeoutMs: 1000 });
    assert.deepEqual(await once(async () => res(200, { elements: [{ id: 1 }] })), [{ id: 1 }]);
    for (const st of [429, 502, 503, 504]) await assert.rejects(once(async () => res(st, {})), (e) => e.retryable === true && e.message.includes(String(st)));
    await assert.rejects(once(async () => res(400, {})), (e) => e.retryable === false);
    await assert.rejects(once(async () => { throw new TypeError('fetch failed'); }), (e) => e.retryable === true);
    await assert.rejects(once(async () => { throw Object.assign(new Error('t'), { name: 'TimeoutError' }); }), (e) => e.retryable === true && e.message.includes('時間切れ'));
    await assert.rejects(once(async () => res(200, { elements: [], remark: 'runtime error: Query timed out in "query" at line 3 after 601 seconds.' })), (e) => e.retryable === true);
  });
  await check('問い合わせ: やり直すたびに問い合わせ先を変える', async () => {
    const used = [];
    const fetchImpl = async (url) => { used.push(url); return used.length < 3 ? res(503, {}) : res(200, { elements: [] }); };
    await overpass('q', { fetchImpl, wait: 1, sleep: async () => {} });
    assert.deepEqual(used, [ENDPOINTS[0], ENDPOINTS[1], ENDPOINTS[0]]);
  });
  await check('Summary: 取得できなかった都道府県の一覧（無ければ「なし」）', async () => {
    assert.match(failedPrefsMarkdown([]), /なし/);
    const md = failedPrefsMarkdown([{ iso: 'JP-01', pref: '北海道', attempts: 4, kept: 120, error: 'overpass-api.de: HTTP 504 | x' }, { iso: 'JP-13', pref: '東京都', attempts: 4, kept: 0, error: '時間切れ' }]);
    assert.match(md, /取得できなかった都道府県（2 件）/);
    assert.match(md, /\| 北海道 \| JP-01 \| 4 \| 120 \| overpass-api\.de: HTTP 504 \\\| x \|/);
    assert.match(md, /\| 東京都 \| JP-13 \| 4 \| 0 \| 時間切れ \|/);
  });
  for (const [name, err] of results) { if (err) throw err; test(name, () => {}); }
}

/* ---- 保存（表示モード・カテゴリの選択・撮影スポットの「行った」） ---- */
{
  const mem = new Map();
  globalThis.localStorage = { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k),
    get length() { return mem.size; }, key: (i) => [...mem.keys()][i] };
  const store = await import('../js/store.js');
  store.init();
  test('設定: 表示モードと選択中のカテゴリを保存し、エクスポート/インポートで保つ・不正な値は捨てる', () => {
    store.setSetting('mapMode', 'spots');
    store.setSetting('spotCats', ['zoo', 'castle']);
    assert.ok(store.setVisited('shrine-001', { date: '2026-11-01', memo: '' }).visit);
    const back = store.validateDb(JSON.parse(store.exportData()));
    assert.ok(back.ok);
    assert.equal(back.db.settings.mapMode, 'spots');
    assert.deepEqual(back.db.settings.spotCats, ['zoo', 'castle']);
    assert.equal(back.db.visited['shrine-001'].date, '2026-11-01');
    const bad = store.validateDb({ version: 4, recipes: [], settings: { mapMode: 'xxx', spotCats: ['<script>', 1] } });
    assert.ok(bad.ok);
    assert.equal(bad.db.settings.mapMode, undefined);
    assert.equal(bad.db.settings.spotCats, undefined);
  });
  test('撮影スポットの「行った」は制覇率に反映される', () => {
    const spotsData = read('data/spots/shrine.json').spots;
    const r = completion(spotsData, store.visited(), cats);
    assert.equal(r.byCategory.find((x) => x.id === 'shrine').visited, 1);
  });
}
console.log(`\n${count} 件のテストに合格`);
