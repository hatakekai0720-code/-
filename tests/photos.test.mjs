// ロケ地写真（Wikimedia Commons）のクレジット・ライセンス判定・index.json のテスト。実行: node tests/photos.test.mjs
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { parseIndex, planDownloads, creditOf, ALLOWED_LICENSE, PHOTOS_DIR } from '../js/photos.js';
import { normalizeLicense, licenseFromCategories, licenseUrlOf, fileTitle, plain, thumbWidthFor } from '../scripts/fetch-photos.mjs';

let count = 0;
const test = (name, fn) => { fn(); count++; console.log('ok  ', name); };
const locs = JSON.parse(readFileSync(new URL('../data/locations.json', import.meta.url))).locations;

test('ライセンスの判定: CC0 / パブリックドメイン / CC BY / CC BY-SA だけを許可', () => {
  assert.equal(normalizeLicense('CC BY-SA 4.0', 'cc-by-sa-4.0'), 'CC BY-SA 4.0');
  assert.equal(normalizeLicense('CC BY 2.0', 'cc-by-2.0'), 'CC BY 2.0');
  assert.equal(normalizeLicense('CC BY-SA 2.1 jp', ''), 'CC BY-SA 2.1');
  assert.equal(normalizeLicense('CC0', 'cc0'), 'CC0');
  assert.equal(normalizeLicense('Public domain', 'pd'), 'Public domain');
  assert.equal(normalizeLicense('GFDL', 'gfdl'), null);
  assert.equal(normalizeLicense('CC BY-NC-SA 2.0', 'cc-by-nc-sa-2.0'), null);
  assert.equal(normalizeLicense('', ''), null);
  // GFDL と CC BY-SA の併記はカテゴリーから CC BY-SA を選ぶ
  assert.equal(licenseFromCategories([{ title: 'Category:GFDL' }, { title: 'Category:CC-BY-SA-3.0' }]), 'CC BY-SA 3.0');
  assert.equal(licenseFromCategories([{ title: 'Category:CC-Zero' }]), 'CC0');
  assert.equal(licenseFromCategories([{ title: 'Category:GFDL' }]), null);
  assert.equal(licenseUrlOf('CC BY-SA 3.0'), 'https://creativecommons.org/licenses/by-sa/3.0/');
  assert.equal(licenseUrlOf('Public domain'), null);
});
test('サムネイルの幅: 元画像より小さい標準幅（元画像の直接取得は断られやすいため）', () => {
  assert.equal(thumbWidthFor(4000), 1280);
  assert.equal(thumbWidthFor(1280), 960);
  assert.equal(thumbWidthFor(640), 500);
  assert.equal(thumbWidthFor(200), null);
});
test('Commons のファイルページ URL → タイトル、HTML のクレジット → 文字列', () => {
  assert.equal(fileTitle('https://commons.wikimedia.org/wiki/File:Caf%C3%A9_des_2_Moulins_June_2010.jpg'), 'File:Café des 2 Moulins June 2010.jpg');
  assert.equal(fileTitle('https://example.com/wiki/File:x.jpg'), null);
  assert.equal(plain('<a href="//commons.wikimedia.org/wiki/User:X">X &amp; Y</a>\n'), 'X & Y');
});
test('locations.json の photo: Commons のファイルページ・許可されたライセンス・撮影者あり', () => {
  let n = 0;
  for (const l of locs) {
    if (l.photo === undefined) continue;
    if (l.photo === null) continue;
    n++;
    const p = l.photo;
    assert.ok(fileTitle(p.sourceUrl), `${l.id}.photo.sourceUrl`);
    assert.ok(ALLOWED_LICENSE.test(p.license), `${l.id}.photo.license = ${p.license}`);
    assert.ok(typeof p.author === 'string' && p.author.trim(), `${l.id}.photo.author`);
    if (p.license === 'Public domain') assert.equal(p.licenseUrl, null, `${l.id}.photo.licenseUrl`);
    else assert.ok(/^https:\/\/creativecommons\.org\/(licenses|publicdomain)\//.test(p.licenseUrl), `${l.id}.photo.licenseUrl`);
  }
  assert.ok(n > 0);
});
test('クレジット: index.json（Commons API で確認した値）を優先、写真の URL が違えば locations.json の値', () => {
  const loc = { photo: { sourceUrl: 'https://commons.wikimedia.org/wiki/File:A.jpg', author: 'a', license: 'CC BY 2.0', licenseUrl: 'https://creativecommons.org/licenses/by/2.0/' } };
  assert.deepEqual(creditOf(loc, null), { author: 'a', license: 'CC BY 2.0', licenseUrl: 'https://creativecommons.org/licenses/by/2.0/', sourceUrl: loc.photo.sourceUrl });
  const entry = { sourceUrl: loc.photo.sourceUrl, author: 'A (API)', license: 'CC BY-SA 3.0', licenseUrl: 'https://creativecommons.org/licenses/by-sa/3.0' };
  assert.equal(creditOf(loc, entry).author, 'A (API)');
  assert.equal(creditOf(loc, { ...entry, sourceUrl: 'https://commons.wikimedia.org/wiki/File:B.jpg' }).author, 'a');
  assert.equal(creditOf({ photo: null }, entry), null);
});
test('parseIndex / planDownloads: webp だけ・許可されたライセンスだけ、更新分だけダウンロード', () => {
  const ok = { id: 'a', file: 'a.webp', bytes: 10, sha256: 'a'.repeat(64), license: 'CC BY 2.0', author: 'x' };
  const idx = parseIndex({ version: 1, files: [ok, { ...ok, id: 'b', file: 'b.jpg' }, { ...ok, id: 'c', file: 'c.webp', license: 'GFDL' }, { ...ok, id: 'd', file: 'd.webp', author: '' }] });
  assert.deepEqual(idx.files.map((f) => f.id), ['a']);
  const plan = planDownloads(idx, new Map([[`${PHOTOS_DIR}a.webp`, 'b'.repeat(64)], [`${PHOTOS_DIR}old.webp`, null], [`${PHOTOS_DIR}index.json`, null]]));
  assert.deepEqual(plan.todo.map((f) => f.id), ['a']);
  assert.deepEqual(plan.remove, [`${PHOTOS_DIR}old.webp`]);
});
test('data/photos/index.json があれば、項目が正しく、実ファイルのサイズ・ハッシュ・ロケ地と一致', () => {
  const p = new URL('../data/photos/index.json', import.meta.url);
  if (!existsSync(p)) { console.log('     （data/photos/index.json はまだありません。GitHub Actions の「ロケ地写真を取得」で作成）'); return; }
  const json = JSON.parse(readFileSync(p));
  const idx = parseIndex(json);
  assert.equal(idx.files.length, json.files.length, '不正な項目がある');
  for (const f of idx.files) {
    const loc = locs.find((l) => l.id === f.id);
    assert.ok(loc?.photo, `${f.id} は locations.json に写真がない`);
    assert.equal(f.sourceUrl, loc.photo.sourceUrl, `${f.id} の写真が locations.json と違う`);
    const buf = readFileSync(new URL(`../data/photos/${f.file}`, import.meta.url));
    assert.equal(buf.length, f.bytes, `${f.file} のサイズ`);
    assert.equal(createHash('sha256').update(buf).digest('hex'), f.sha256, `${f.file} のハッシュ`);
    assert.ok(Math.max(f.width, f.height) <= 1000, `${f.file} は長辺 1000px 以下`);
  }
});

console.log(`\n${count} 件のテストに合格`);
