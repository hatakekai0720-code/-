// 日本の撮影スポットのデータを作る（GitHub Actions 用。アプリの実行には不要）
// 使い方: node scripts/fetch-spots.mjs [--offline]
//   A. OpenStreetMap（Overpass API）から都道府県ごとに一括取得: 動物園・水族館・植物園・展望台・絶景・灯台・城・滝・砂浜・温泉街
//   B. 公的リスト（scripts/spot-lists/jyudenken.json・tanada.json）を名前と概略座標で OpenStreetMap と照合して座標を決める
//   C. 手作業で選んだ神社仏閣（scripts/spot-lists/shrines.json）の座標を OpenStreetMap で確認する
//   → 重複をまとめ（より具体的なカテゴリを優先）、data/spots/<category>.json・index.json・report.md に書く
// --offline: ネットワークを使わない。A は既存の data/spots/<category>.json をそのまま使い、
//            B・C は概略座標のまま（verified: false）にする（外部に接続できない環境で形式だけ作るため）
// 環境変数: OVERPASS_URL（既定 https://overpass-api.de/api/interpreter）、CONTACT（任意。User-Agent に付ける）
import { readFileSync, writeFileSync, readdirSync, mkdirSync, existsSync, appendFileSync, rmSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { haversine } from '../js/geo.js';
import { PREFS, dedupeSpots, validateAll, inJapan, PRECACHE_LIMIT, SOURCE_LABELS } from '../js/spots.js';
import { classify, excluded, scoreCandidate, NAMED } from './spots-osm.mjs';

const ROOT = new URL('..', import.meta.url);
const OUT = new URL('data/spots/', ROOT);
const LISTS = new URL('scripts/spot-lists/', ROOT);
const OFFLINE = process.argv.includes('--offline');
const ENDPOINTS = [process.env.OVERPASS_URL || 'https://overpass-api.de/api/interpreter', 'https://overpass.private.coffee/api/interpreter'];
const UA = `xt3cine-spots/1.0 (GitHub Actions${process.env.CONTACT ? `; ${process.env.CONTACT}` : ''})`;
const OSM_CATS = ['zoo', 'aquarium', 'botanical', 'observatory', 'viewpoint', 'lighthouse', 'castle', 'waterfall', 'beach', 'onsen'];

const categories = JSON.parse(readFileSync(new URL('data/spot-categories.json', ROOT), 'utf8')).categories;
const ORDER = categories.map((c) => c.id); // 優先度の高い順
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const round = (v) => Math.round(v * 1e5) / 1e5;
const log = (...a) => console.log(...a);

/* ---- Overpass ---- */
async function overpass(query) {
  let last = null;
  for (let attempt = 0; attempt < 6; attempt++) {
    const url = ENDPOINTS[attempt % ENDPOINTS.length];
    try {
      const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', 'user-agent': UA }, body: `data=${encodeURIComponent(query)}` });
      if (res.ok) return (await res.json()).elements || [];
      last = new Error(`${url}: HTTP ${res.status}`);
      if (![429, 502, 503, 504].includes(res.status)) throw last;
    } catch (err) { last = err; }
    await sleep(5000 * 2 ** attempt); // 混んでいるときは待ってやり直す
  }
  throw last;
}

const osmRef = (el) => `${el.type}/${el.id}`;
const osmUrl = (el) => `https://www.openstreetmap.org/${osmRef(el)}`;
const siteOf = (t) => [t.website, t['contact:website'], t.url].find((u) => typeof u === 'string' && /^https?:\/\/\S+$/.test(u)) || null;
const ll = (el) => (el.type === 'node' ? [el.lat, el.lon] : el.center ? [el.center.lat, el.center.lon] : [NaN, NaN]);

async function fetchOsm() {
  const out = [];
  const skipped = {};
  for (let i = 0; i < PREFS.length; i++) {
    const iso = `JP-${String(i + 1).padStart(2, '0')}`;
    const q = `[out:json][timeout:600];
area["ISO3166-2"="${iso}"]["admin_level"="4"]->.a;
(
  nwr["tourism"~"^(zoo|aquarium)$"](area.a);
  nwr["leisure"="garden"]["garden:type"="botanical"](area.a);
  nwr["name"~"植物園"]["leisure"~"^(garden|park)$"](area.a);
  nwr["name"~"植物園"]["tourism"~"^(attraction|museum)$"](area.a);
  nwr["tourism"="viewpoint"]["name"](area.a);
  nwr["man_made"="tower"]["tower:type"="observation"]["name"](area.a);
  nwr["man_made"="lighthouse"]["name"](area.a);
  nwr["historic"="castle"]["name"](area.a);
  nwr["waterway"="waterfall"]["name"](area.a);
  nwr["natural"="beach"]["name"](area.a);
  nwr["place"~"^(village|town|hamlet|suburb|quarter|neighbourhood|locality)$"]["name"~"温泉(郷|街)?$"](area.a);
);
out center tags;`;
    const els = await overpass(q);
    let n = 0;
    for (const el of els) {
      const t = el.tags || {};
      const why = excluded(t);
      if (why) { skipped[why] = (skipped[why] || 0) + 1; continue; }
      const [lat, lng] = ll(el);
      if (!inJapan(lat, lng)) { skipped['範囲外'] = (skipped['範囲外'] || 0) + 1; continue; }
      for (const category of classify(t)) {
        out.push({
          id: `osm-${el.type[0]}${el.id}`, category, name: NAMED(t), lat: round(lat), lng: round(lng), pref: PREFS[i],
          city: t['addr:city'] || null, source: 'osm', osmId: osmRef(el), sources: [osmUrl(el)], website: siteOf(t), note: null,
        });
        n++;
      }
    }
    log(`${iso} ${PREFS[i]}: ${els.length} 件取得 → ${n} 件`);
    await sleep(2000);
  }
  return { spots: out, skipped };
}

/* ---- B・C. リストと OSM の照合 ---- */
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\"]/g, '\\$&');
const RADIUS = { townscape: 3000, tanada: 4000, shrine: 3000 };
async function matchList(file) {
  const list = JSON.parse(readFileSync(new URL(file, LISTS), 'utf8'));
  const spots = [], unmatched = [];
  for (const e of list.entries) {
    const base = {
      id: e.id, category: list.category, name: e.name, lat: e.approx[0], lng: e.approx[1], pref: e.pref, city: e.city ?? null,
      source: list.source, osmId: null, sources: [...(e.sources || [list.listUrl])], website: null,
      note: `${e.note}（出典: ${list.listName}）`, verified: false,
    };
    if (!OFFLINE) {
      try {
        const re = e.match.map(esc).join('|');
        const els = await overpass(`[out:json][timeout:60];nwr(around:${RADIUS[list.category]},${e.approx[0]},${e.approx[1]})["name"~"${re}"];out center tags;`);
        let best = null;
        for (const el of els) {
          const [lat, lng] = ll(el);
          if (!Number.isFinite(lat)) continue;
          const sc = scoreCandidate(e, list.category, el, haversine(e.approx[0], e.approx[1], lat, lng));
          if (sc >= 0 && (!best || sc > best.sc)) best = { el, sc, lat, lng };
        }
        if (best) {
          Object.assign(base, { lat: round(best.lat), lng: round(best.lng), osmId: osmRef(best.el), website: siteOf(best.el.tags || {}), verified: true });
          base.sources = [...base.sources, osmUrl(best.el)];
        }
      } catch (err) { log(`  ${e.id} ${e.name}: 照合できません（${err.message}）`); }
      await sleep(1100);
    }
    if (!base.verified) unmatched.push({ id: e.id, name: e.name, pref: e.pref, city: e.city });
    spots.push(base);
  }
  log(`${list.listName}: ${list.entries.length} 件（照合できなかった ${unmatched.length} 件）`);
  return { list, spots, unmatched };
}

/* ---- 実行 ---- */
mkdirSync(OUT, { recursive: true });
let osm;
if (OFFLINE) {
  // 既存の OSM 由来データをそのまま使う
  const spots = [];
  for (const c of OSM_CATS) {
    const f = new URL(`${c}.json`, OUT);
    if (existsSync(f)) spots.push(...JSON.parse(readFileSync(f, 'utf8')).spots.filter((s) => s.source === 'osm'));
  }
  osm = { spots, skipped: {}, offline: true };
  log(`オフライン: OpenStreetMap 由来の既存データ ${spots.length} 件を使います`);
} else {
  osm = await fetchOsm();
}
const lists = [];
for (const f of readdirSync(LISTS).filter((x) => x.endsWith('.json')).sort()) lists.push(await matchList(f));

const all = [...lists.flatMap((l) => l.spots), ...osm.spots];
const { spots, merged } = dedupeSpots(all, ORDER);
const check = validateAll(spots, ORDER);
if (check.errors.length) {
  console.error(check.errors.slice(0, 30).join('\n'));
  console.error(`検証エラー ${check.errors.length} 件`);
  process.exit(1);
}

// 書き出し（ファイルの中身は取得日時を含めない = 変化が無ければ sha256 も変わらない）
const files = [];
for (const c of categories) {
  const list = spots.filter((s) => s.category === c.id).sort((a, b) => a.id.localeCompare(b.id));
  const path = new URL(`${c.id}.json`, OUT);
  if (!list.length) continue;
  const src = [...new Set(list.map((s) => s.source))].map((k) => SOURCE_LABELS[k]);
  const body = JSON.stringify({ category: c.id, name: c.name, sources: src, spots: list }) + '\n';
  writeFileSync(path, body);
  files.push({ id: c.id, file: `${c.id}.json`, bytes: Buffer.byteLength(body), sha256: createHash('sha256').update(body).digest('hex'), count: list.length });
}
// 空になったカテゴリのファイルは消す
for (const f of readdirSync(OUT).filter((x) => x.endsWith('.json') && x !== 'index.json')) {
  if (!files.some((x) => x.file === f)) rmSync(new URL(f, OUT));
}
const totalBytes = files.reduce((s, f) => s + f.bytes, 0);
const index = {
  version: 1, generatedAt: new Date().toISOString(), precache: totalBytes <= PRECACHE_LIMIT, totalBytes,
  osmFetched: !osm.offline,
  attribution: ['© OpenStreetMap contributors（ODbL 1.0）', ...lists.map((l) => `${l.list.listName} ${l.list.listUrl}`)],
  files,
};
writeFileSync(new URL('index.json', OUT), JSON.stringify(index, null, 1) + '\n');

// 報告
const mb = (b) => (b / 1048576).toFixed(2);
const name = Object.fromEntries(categories.map((c) => [c.id, c.name]));
const unmatched = lists.flatMap((l) => l.unmatched.map((u) => ({ ...u, list: l.list.listName })));
const md = [
  '# 撮影スポットのデータ（自動生成の報告）', '',
  `生成: ${index.generatedAt}${osm.offline ? '（オフライン。OpenStreetMap からは取得していない・照合もしていない）' : ''}`, '',
  `合計 **${spots.length} 件・${mb(totalBytes)} MB**（${index.precache ? '5MB 以下なので Service Worker でプリキャッシュ' : '5MB を超えるので裏で自動ダウンロード'}）`, '',
  '| カテゴリ | 件数 | MB |', '|---|---:|---:|',
  ...categories.map((c) => { const f = files.find((x) => x.id === c.id); return `| ${c.name} | ${f?.count ?? 0} | ${f ? mb(f.bytes) : '—'} |`; }), '',
  `重複としてまとめた件数: ${merged.length}`,
  Object.keys(osm.skipped).length ? `除外した件数: ${Object.entries(osm.skipped).map(([k, v]) => `${k} ${v}`).join(' / ')}` : '', '',
  '## 温泉街の判定', '',
  'OpenStreetMap の `place=village|town|hamlet|suburb|quarter|neighbourhood|locality` のうち、名前が「〜温泉」「〜温泉郷」「〜温泉街」で終わるもの。',
  '温泉施設（`amenity=public_bath` など）は温泉街に数えない。重要伝統的建造物群保存地区から 600m 以内のものは町並みにまとめる。', '',
  `## OpenStreetMap と照合できなかったもの（${unmatched.length} 件。概略座標のまま verified: false）`, '',
  ...(unmatched.length ? ['| リスト | ID | 名前 | 都道府県 | 市区町村 |', '|---|---|---|---|---|', ...unmatched.map((u) => `| ${u.list} | ${u.id} | ${u.name} | ${u.pref} | ${u.city ?? ''} |`)] : ['なし']), '',
].join('\n');
writeFileSync(new URL('report.md', OUT), md);
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, md + '\n');
log(`\n${spots.length} 件（${Object.entries(check.counts).map(([k, v]) => `${name[k]} ${v}`).join('・')}）`);
log(`まとめた重複 ${merged.length} 件 / 照合できなかった ${unmatched.length} 件 / 合計 ${mb(totalBytes)} MB / precache: ${index.precache}`);
