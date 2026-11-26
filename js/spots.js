// 日本の撮影スポット（動物園・水族館・展望台・灯台・城・滝・海岸・温泉街・古い町並み・棚田・神社仏閣など）
// ・データ: data/spots/<category>.json（.github/workflows/fetch-spots.yml → scripts/fetch-spots.mjs が作る）
//   と data/spots/index.json（各ファイルの sha256・サイズ・件数、合計が 5MB 以下なら precache: true）
// ・カテゴリの名前・アイコン・色・おすすめレシピ・撮影のコツ: data/spot-categories.json
// ・保存: Cache Storage（xt3cine-spots）。precache: true なら Service Worker のインストール時にまとめて保存し、
//   そうでなければ街路地図と同じ仕組み（js/bgdownload.js）で裏で 1 ファイルずつ保存する
// ・前半は DOM 非依存の純粋関数（tests/spots.test.mjs・scripts/fetch-spots.mjs から使う）
import * as X from './xt3.js';
import { haversine } from './geo.js';
import { createDownloader } from './bgdownload.js';

export const SPOTS_CACHE = 'xt3cine-spots';
export const SPOTS_DIR = 'data/spots/';
export const PRECACHE_LIMIT = 5 * 1024 * 1024; // 合計がこれ以下なら SW でプリキャッシュ
export const JAPAN_BOUNDS = { south: 20, north: 46, west: 122, east: 154 }; // 沖ノ鳥島〜択捉島・与那国島〜南鳥島を含む
export const ID_RE = /^[a-z0-9-]{1,80}$/;
export const SOURCE_KINDS = ['osm', 'jyudenken', 'tanada100', 'curated'];
export const SOURCE_LABELS = {
  osm: 'OpenStreetMap（ODbL）',
  jyudenken: '文化庁「重要伝統的建造物群保存地区」一覧',
  tanada100: '農林水産省「日本の棚田百選」',
  curated: '手作業で選定（選定理由と出典つき）',
};

/** 47 都道府県（北から。ISO 3166-2:JP の番号順） */
export const PREFS = ['北海道', '青森県', '岩手県', '宮城県', '秋田県', '山形県', '福島県', '茨城県', '栃木県', '群馬県', '埼玉県', '千葉県',
  '東京都', '神奈川県', '新潟県', '富山県', '石川県', '福井県', '山梨県', '長野県', '岐阜県', '静岡県', '愛知県', '三重県', '滋賀県', '京都府',
  '大阪府', '兵庫県', '奈良県', '和歌山県', '鳥取県', '島根県', '岡山県', '広島県', '山口県', '徳島県', '香川県', '愛媛県', '高知県', '福岡県',
  '佐賀県', '長崎県', '熊本県', '大分県', '宮崎県', '鹿児島県', '沖縄県'];

/* ---- 表示モードとカテゴリの選択 ---- */

export const MODES = [{ id: 'films', label: '映画ロケ地' }, { id: 'spots', label: '撮影スポット' }, { id: 'all', label: 'すべて' }];
export const normalizeMode = (m) => (MODES.some((x) => x.id === m) ? m : 'films');
/** モードで何を表示するか */
export const modeShows = (mode) => ({ films: mode !== 'spots', spots: mode !== 'films' });

/** 保存されていた選択を、今あるカテゴリだけに整える。未保存（null）ならすべて選択 */
export function normalizeSelection(saved, ids) {
  if (!Array.isArray(saved)) return [...ids];
  const set = new Set(saved);
  return ids.filter((id) => set.has(id));
}
export function toggleCategory(sel, id) {
  return sel.includes(id) ? sel.filter((x) => x !== id) : [...sel, id];
}

/* ---- カテゴリ定義 ---- */

const HEX = /^#[0-9a-f]{6}$/i;
/** spot-categories.json の検証。エラーの配列（空なら有効） */
export function validateCategories(json, lessonNos = null) {
  const e = [];
  const list = json?.categories;
  if (!Array.isArray(list) || !list.length) return ['categories がありません'];
  const seen = new Set();
  for (const c of list) {
    const tag = `カテゴリ ${c?.id}`;
    if (!c || !ID_RE.test(c.id || '')) { e.push(`${tag}: id が不正です`); continue; }
    if (seen.has(c.id)) e.push(`${tag}: id が重複しています`);
    seen.add(c.id);
    if (typeof c.name !== 'string' || !c.name) e.push(`${tag}: name がありません`);
    if (typeof c.icon !== 'string' || [...c.icon].length !== 1) e.push(`${tag}: icon は 1 文字です`);
    if (!HEX.test(c.color || '')) e.push(`${tag}: color が不正です`);
    if (!Array.isArray(c.tips) || c.tips.length < 3 || c.tips.length > 5) e.push(`${tag}: tips は 3〜5 行です`);
    if (!Array.isArray(c.lessons) || !c.lessons.length || c.lessons.some((n) => !Number.isInteger(n) || n < 1 || n > 50 || (lessonNos && !lessonNos.has(n)))) e.push(`${tag}: lessons が不正です`);
    const errs = c.recipe ? X.validateRecipe(categoryRecipe(c)) : ['recipe がありません'];
    if (errs.length) e.push(`${tag}: レシピ ${errs[0]}`);
  }
  return e;
}

/** カテゴリのおすすめレシピ（保存前の形） */
export function categoryRecipe(cat) {
  const r = X.fromPartial(cat.recipe);
  r.name = (cat.recipe.name || `${cat.name}のおすすめ`).slice(0, X.LIMITS.name);
  r.source = 'spot';
  r.sourceRef = cat.id;
  r.notes = [`撮影スポット「${cat.name}」のおすすめレシピ。`, ...cat.tips.map((t) => `・${t}`)].join('\n').slice(0, X.LIMITS.notes);
  return r;
}

/* ---- スポットの検証 ---- */

// 日本の範囲の目安（[経度, 緯度] の多角形 + 離島の矩形）。朝鮮半島・台湾・サハリン・ウルップ島より手前を通る。
// 海側は広めにとってある（陸地かどうかではなく「日本の外の座標」を見つけるためのもの）
export const JAPAN_POLYGON = [[139.0, 45.7], [149.2, 45.7], [149.2, 43.0], [146.5, 40.0], [143.0, 35.0], [141.0, 33.0], [136.0, 32.5], [134.0, 31.5],
  [132.0, 29.5], [131.6, 25.5], [131.6, 24.5], [124.0, 23.8], [122.5, 23.8], [122.5, 25.0], [123.0, 26.0], [126.5, 27.5], [127.8, 32.0], [128.3, 33.6],
  [129.1, 34.3], [129.1, 34.75], [129.6, 34.85], [130.6, 35.5], [132.5, 36.6], [135.5, 38.0], [138.5, 39.5], [139.0, 40.5]];
export const JAPAN_ISLAND_BOXES = [[138.5, 24.0, 142.5, 35.0], [153.5, 24.0, 154.5, 24.6], [135.9, 20.3, 136.3, 20.6]]; // 伊豆・小笠原 / 南鳥島 / 沖ノ鳥島
export function pointInPolygon(lng, lat, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if ((yi > lat) !== (yj > lat) && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
export const inJapan = (lat, lng) => Number.isFinite(lat) && Number.isFinite(lng)
  && lat >= JAPAN_BOUNDS.south && lat <= JAPAN_BOUNDS.north && lng >= JAPAN_BOUNDS.west && lng <= JAPAN_BOUNDS.east
  && (pointInPolygon(lng, lat, JAPAN_POLYGON) || JAPAN_ISLAND_BOXES.some(([w, s, e, n]) => lng >= w && lng <= e && lat >= s && lat <= n));
const HTTPS = /^https?:\/\/[^\s]+$/;

/** 1 件の検証。エラーの配列（空なら有効） */
export function validateSpot(s, catIds) {
  const e = [];
  if (!s || typeof s !== 'object') return ['形式が不正です'];
  if (!ID_RE.test(s.id || '')) e.push('id が不正です');
  if (!catIds.includes(s.category)) e.push(`category ${s.category} がありません`);
  if (typeof s.name !== 'string' || !s.name.trim()) e.push('name がありません');
  if (!Number.isFinite(s.lat) || !Number.isFinite(s.lng) || !inJapan(s.lat, s.lng)) e.push('座標が日本の範囲外です');
  if (!PREFS.includes(s.pref)) e.push(`pref ${s.pref} が都道府県名ではありません`);
  if (s.city != null && typeof s.city !== 'string') e.push('city が不正です');
  if (!SOURCE_KINDS.includes(s.source)) e.push('source が不正です');
  if (s.osmId != null && !/^(node|way|relation)\/\d+$/.test(s.osmId)) e.push('osmId が不正です');
  if (s.source === 'osm' && !s.osmId) e.push('OSM 由来なのに osmId がありません');
  if (!Array.isArray(s.sources) || !s.sources.length || s.sources.some((u) => !HTTPS.test(u))) e.push('sources（出典 URL）がありません');
  if (s.website != null && !HTTPS.test(s.website)) e.push('website が不正です');
  if (s.note != null && typeof s.note !== 'string') e.push('note が不正です');
  if (s.source !== 'osm' && !s.note) e.push('選定理由・リスト名（note）がありません');
  if (s.verified != null && typeof s.verified !== 'boolean') e.push('verified が不正です');
  return e;
}

/** 全体の検証: 各件の検証 + ID の重複 + カテゴリごとの件数 */
export function validateAll(spots, catIds) {
  const errors = [];
  const ids = new Set();
  const counts = Object.fromEntries(catIds.map((id) => [id, 0]));
  for (const s of spots) {
    for (const err of validateSpot(s, catIds)) errors.push(`${s?.id ?? '?'}（${s?.name ?? ''}）: ${err}`);
    if (ids.has(s?.id)) errors.push(`${s.id}: id が重複しています`);
    ids.add(s?.id);
    if (s && s.category in counts) counts[s.category]++;
  }
  return { errors, counts, total: spots.length };
}

/* ---- 重複をまとめる（より具体的なカテゴリを優先して 1 件に） ---- */

/** 名前の比較用（空白・中黒・括弧の中身・「跡」を無視） */
export const coreName = (s) => String(s || '').normalize('NFKC').replace(/[（(][^）)]*[）)]/g, '').replace(/[\s・·.\-ー_]/g, '').replace(/跡$/, '');
const sameName = (a, b) => {
  const x = coreName(a), y = coreName(b);
  return !!x && !!y && (x === y || (Math.min(x.length, y.length) >= 2 && (x.includes(y) || y.includes(x))));
};
// 名前が違っても同じ場所として扱う組（優先する側, 吸収される側, 距離 m）。
// 例: 重伝建の地区内にある温泉街、城跡の上の展望所、灯台の展望所
export const MERGE_NEAR = [
  ['townscape', 'onsen', 600],
  ['castle', 'viewpoint', 150],
  ['castle', 'observatory', 150],
  ['lighthouse', 'viewpoint', 150],
  ['lighthouse', 'observatory', 150],
  ['waterfall', 'viewpoint', 100],
];
const NAME_NEAR_M = 400; // 名前が同じ（含む）ときに同じ場所とみなす距離

/**
 * order（カテゴリ ID を優先度の高い順に）に従って重複をまとめる。
 * 同じ osmId、または近くて名前が同じ、または MERGE_NEAR の組なら、優先度の高い方を残し、
 * 残した方の alsoIn に吸収したカテゴリを記録する。
 * @returns {{ spots: object[], merged: Array<{ kept: string, dropped: string, reason: string }> }}
 */
export function dedupeSpots(spots, order) {
  const rank = (s) => { const i = order.indexOf(s.category); return i < 0 ? order.length : i; };
  const sorted = [...spots].sort((a, b) => rank(a) - rank(b));
  const kept = [], merged = [];
  const byOsm = new Map();
  const cell = 0.01; // 約 1km の格子で近傍だけ調べる
  const grid = new Map();
  const key = (la, ln) => `${Math.floor(la / cell)},${Math.floor(ln / cell)}`;
  const near = (s) => {
    const out = [];
    const cy = Math.floor(s.lat / cell), cx = Math.floor(s.lng / cell);
    for (let y = cy - 1; y <= cy + 1; y++) for (let x = cx - 1; x <= cx + 1; x++) out.push(...(grid.get(`${y},${x}`) || []));
    return out;
  };
  for (const s of sorted) {
    let into = s.osmId ? byOsm.get(s.osmId) : null;
    let reason = into ? '同じ OpenStreetMap の地物' : '';
    if (!into) {
      for (const k of near(s)) {
        if (k.category === s.category && k.source === s.source && s.source === 'osm') {
          // 同じカテゴリの OSM 同士は、名前が同じで近い（同じ滝の node と way など）ときだけ
          if (sameName(k.name, s.name) && haversine(k.lat, k.lng, s.lat, s.lng) * 1000 <= 150) { into = k; reason = '同じ名前で近い'; break; }
          continue;
        }
        const d = haversine(k.lat, k.lng, s.lat, s.lng) * 1000;
        if (sameName(k.name, s.name) && d <= NAME_NEAR_M) { into = k; reason = '同じ名前で近い'; break; }
        const rule = MERGE_NEAR.find(([a, b]) => a === k.category && b === s.category);
        if (rule && d <= rule[2]) { into = k; reason = `${k.category} の範囲内`; break; }
      }
    }
    if (into) {
      if (into.category !== s.category && !(into.alsoIn ||= []).includes(s.category)) into.alsoIn.push(s.category);
      if (!into.website && s.website) into.website = s.website;
      if (!into.osmId && s.osmId) into.osmId = s.osmId;
      merged.push({ kept: into.id, dropped: s.id, reason });
      continue;
    }
    const k = { ...s };
    kept.push(k);
    if (k.osmId) byOsm.set(k.osmId, k);
    const g = key(k.lat, k.lng);
    if (!grid.has(g)) grid.set(g, []);
    grid.get(g).push(k);
  }
  return { spots: kept, merged };
}

/* ---- 絞り込み・近い順・表示範囲・制覇率 ---- */

/** cats: 選択中のカテゴリ ID の配列 / pref: 'all' か都道府県名 / q: 名前・市区町村・都道府県の部分一致（空白・中黒は無視） */
export function filterSpots(spots, { cats = null, pref = 'all', q = '' } = {}) {
  const set = cats ? new Set(cats) : null;
  const needle = q ? coreName(q).toLowerCase() : '';
  return spots.filter((s) => (!set || set.has(s.category)) && (pref === 'all' || s.pref === pref)
    && (!needle || [s.name, s.city, s.pref].some((x) => coreName(x).toLowerCase().includes(needle))));
}

/** 都道府県ごとの件数（北から順。0 件は除く） */
export function prefCounts(spots) {
  const c = new Map();
  for (const s of spots) c.set(s.pref, (c.get(s.pref) || 0) + 1);
  return PREFS.filter((p) => c.has(p)).map((p) => ({ id: p, count: c.get(p) }));
}

/** 現在地 here から近い順（here が無ければ名前順）。limit 件まで。各項目に km を付ける */
export function nearest(items, here, limit = Infinity) {
  const out = items.map((e) => ({ ...e, km: here ? haversine(here.lat, here.lng, e.lat, e.lng) : null }));
  out.sort((a, b) => (here ? a.km - b.km : String(a.title ?? a.name).localeCompare(String(b.title ?? b.name), 'ja')));
  return out.slice(0, limit);
}

/** 表示範囲 [西, 南, 東, 北]（pad は幅・高さに対する割合）に入る点だけ */
export function inBounds(points, [w, s, e, n], pad = 0) {
  const dx = (e - w) * pad, dy = (n - s) * pad;
  const W = w - dx, E = e + dx, S = s - dy, N = n + dy;
  return points.filter((p) => p.lat >= S && p.lat <= N && p.lng >= W && p.lng <= E);
}

/** 制覇率（行った / 全体）。カテゴリ別と都道府県別 */
export function completion(spots, visited, categories) {
  const isV = (s) => !!visited?.[s.id];
  const tally = (keyOf, keys) => {
    const m = new Map(keys.map((k) => [k, { total: 0, visited: 0 }]));
    for (const s of spots) {
      const k = keyOf(s);
      if (!m.has(k)) m.set(k, { total: 0, visited: 0 });
      const t = m.get(k);
      t.total++; if (isV(s)) t.visited++;
    }
    return [...m].filter(([, t]) => t.total > 0).map(([id, t]) => ({ id, ...t, ratio: t.visited / t.total }));
  };
  const all = { total: spots.length, visited: spots.filter(isV).length };
  return {
    all: { ...all, ratio: all.total ? all.visited / all.total : 0 },
    byCategory: tally((s) => s.category, categories.map((c) => c.id)),
    byPref: tally((s) => s.pref, PREFS),
  };
}
export const percent = (r) => `${Math.floor(r * 1000) / 10}%`;

/* ---- ブラウザ: 読み込み ---- */

const dl = createDownloader({
  cacheName: SPOTS_CACHE, dir: SPOTS_DIR, fileRe: /^[a-z0-9-]+\.json$/, contentType: 'application/json',
  extra: (f) => Number.isInteger(f.count) && f.count >= 0,
});
export const parseIndex = dl.parseIndex;
export const events = dl.events;
export const getStatus = dl.getStatus;
export const startDownload = dl.startDownload;
export const cachedBytes = dl.cachedBytes;
export const clearAll = dl.clearAll;
/** 自動ダウンロード。precache（SW が保存する）分も sha256 の更新判定のためにここで確かめる */
export const autoDownloadSpots = (enabled) => dl.autoDownload(enabled, 1500);

let catCache = null;
export function loadCategories() {
  catCache ??= fetch('data/spot-categories.json').then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); }).then((d) => d.categories);
  catCache.catch(() => { catCache = null; });
  return catCache;
}

let spotCache = null;
/** すべての撮影スポット。キャッシュ（xt3cine-spots）にあるファイル → 無ければ同じオリジンから。読めないファイルは飛ばす */
export function loadSpots() {
  spotCache ??= (async () => {
    let index = null;
    try { const r = await fetch(`${SPOTS_DIR}index.json`); if (r.ok) index = parseIndex(await r.json()); } catch { /* オフライン */ }
    const files = index?.files?.length ? index.files : (await dl.cachedFiles());
    const lists = await Promise.all(files.map(async (f) => {
      const url = SPOTS_DIR + f.file;
      try {
        const blob = await dl.cachedBlob(url);
        if (blob) return JSON.parse(await blob.text()).spots || [];
        const r = await fetch(url);
        return r.ok ? (await r.json()).spots || [] : [];
      } catch { return []; }
    }));
    return lists.flat();
  })();
  spotCache.then((s) => { if (!s.length) spotCache = null; }, () => { spotCache = null; });
  return spotCache;
}
dl.events.addEventListener('file', () => { spotCache = null; }); // 新しいファイルを保存したら読み直す
