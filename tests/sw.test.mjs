// Service Worker のプリキャッシュ一覧が実ファイルと一致しているかのテスト。実行: node tests/sw.test.mjs
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const sw = readFileSync(join(root, 'sw.js'), 'utf8');
const assets = new Function(`return ${sw.match(/const ASSETS = (\[[\s\S]*?\]);/)[1]}`)();
let count = 0;
const test = (name, fn) => { fn(); count++; console.log('ok  ', name); };

const walk = (dir) => readdirSync(dir).flatMap((f) => { const p = join(dir, f); return statSync(p).isDirectory() ? walk(p) : [p]; });
// アプリの実行に必要なファイル（ライセンス文書・テスト・仕様書・README は除く）
const required = ['index.html', 'manifest.webmanifest',
  ...['css', 'js', 'data', 'vendor', 'icons'].flatMap((d) => walk(join(root, d)).map((p) => relative(root, p).split('\\').join('/')))]
  .filter((p) => !/LICENSE/i.test(p) && !p.startsWith('data/streets/')); // 街路データは別途ダウンロードする

test('ASSETS に重複がない・すべて相対パス', () => {
  assert.equal(new Set(assets).size, assets.length);
  for (const a of assets) assert.ok(a.startsWith('./'), a);
});
test('ASSETS のファイルが実在する', () => {
  for (const a of assets.filter((a) => a !== './')) assert.ok(existsSync(join(root, a)), `${a} がありません`);
});
test('アプリに必要なファイルがすべて ASSETS に入っている', () => {
  const set = new Set(assets.map((a) => a.slice(2)));
  const missing = required.filter((p) => !set.has(p));
  assert.deepEqual(missing, [], `ASSETS に未登録: ${missing.join(', ')}`);
});
test('キャッシュ名は xt3cine- で始まり、自分のキャッシュだけを削除する（街路地図のキャッシュは残す）', () => {
  assert.match(sw, /const PREFIX = 'xt3cine-'/);
  assert.match(sw, /k\.startsWith\(PREFIX\) && k !== CACHE && k !== STREETS_CACHE/);
  assert.match(sw, /const STREETS_CACHE = `\$\{PREFIX\}streets`/);
  assert.match(readFileSync(join(root, 'js/streets.js'), 'utf8'), /export const STREETS_CACHE = 'xt3cine-streets'/);
});
test('街路データ（data/streets/）は ASSETS に入れない', () => {
  assert.deepEqual(assets.filter((a) => a.includes('data/streets')), []);
});
test('外部ドメインの URL を含まない（コード・HTML・CSS・データ）', () => {
  const files = required.filter((p) => /\.(js|css|html|json|webmanifest)$/.test(p) && !p.startsWith('vendor/'));
  for (const f of files) {
    let text = readFileSync(join(root, f), 'utf8');
    // ロケ地の出典（sources）・外部リンク（links）・写真のクレジット（photo）は表示するだけで、アプリは通信しない
    if (f === 'data/locations.json') text = JSON.stringify(JSON.parse(text).locations.map(({ sources, links, photo, ...l }) => l));
    assert.ok(!/https?:\/\//.test(text.replace(/http:\/\/www\.w3\.org\/2000\/svg/g, '')), `${f} に外部 URL があります`);
  }
});
test('manifest のパスは相対', () => {
  const m = JSON.parse(readFileSync(join(root, 'manifest.webmanifest'), 'utf8'));
  for (const k of ['start_url', 'scope']) assert.ok(m[k].startsWith('./'), k);
  for (const i of m.icons) { assert.ok(!i.src.startsWith('/'), i.src); assert.ok(existsSync(join(root, i.src)), i.src); }
});
console.log(`\n${count} 件のテストに合格`);
