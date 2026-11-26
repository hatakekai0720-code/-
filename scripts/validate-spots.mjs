// 撮影スポットのデータの検証（GitHub Actions とローカルで使う。アプリの実行には不要）
// 使い方: node scripts/validate-spots.mjs
// ・座標が日本の範囲内か・名前があるか・ID の重複がないか・都道府県名・出典 URL を調べ、カテゴリごとの件数と合計サイズを出す
// ・index.json の sha256・サイズ・件数が実物と一致するか、precache（合計 5MB 以下）が正しいか
// ・問題があれば終了コード 1
import { readFileSync, appendFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { validateAll, PRECACHE_LIMIT, validateCategories } from '../js/spots.js';

const ROOT = new URL('..', import.meta.url);
const cats = JSON.parse(readFileSync(new URL('data/spot-categories.json', ROOT), 'utf8')).categories;
const lessons = new Set(JSON.parse(readFileSync(new URL('data/lessons.json', ROOT), 'utf8')).lessons.map((l) => l.no));
const index = JSON.parse(readFileSync(new URL('data/spots/index.json', ROOT), 'utf8'));
const errors = [...validateCategories({ categories: cats }, lessons)];
const all = [];
let total = 0;
for (const f of index.files) {
  const buf = readFileSync(new URL(`data/spots/${f.file}`, ROOT));
  total += buf.length;
  if (buf.length !== f.bytes) errors.push(`${f.file}: サイズが index と違います`);
  if (createHash('sha256').update(buf).digest('hex') !== f.sha256) errors.push(`${f.file}: sha256 が index と違います`);
  const d = JSON.parse(buf);
  if (d.spots.length !== f.count) errors.push(`${f.file}: 件数が index と違います`);
  all.push(...d.spots);
}
if (total !== index.totalBytes) errors.push('totalBytes が合計と違います');
if (index.precache !== (total <= PRECACHE_LIMIT)) errors.push('precache の判定が合計サイズと合いません');
const r = validateAll(all, cats.map((c) => c.id));
errors.push(...r.errors);
const unverified = all.filter((s) => s.verified === false).length;
const md = ['### 撮影スポットの検証', '', `合計 **${r.total} 件・${(total / 1048576).toFixed(2)} MB**（${index.precache ? 'プリキャッシュ' : '裏で自動ダウンロード'}）／ OSM で座標を確認できていない ${unverified} 件`, '',
  '| カテゴリ | 件数 |', '|---|---:|', ...cats.map((c) => `| ${c.name} | ${r.counts[c.id]} |`), '',
  errors.length ? `**エラー ${errors.length} 件**\n\n${errors.slice(0, 50).map((e) => `- ${e}`).join('\n')}` : 'エラーなし', ''].join('\n');
console.log(md);
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, md + '\n');
process.exit(errors.length ? 1 : 0);
