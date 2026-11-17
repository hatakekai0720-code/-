// 街路地図（PMTiles）のダウンロード計画・範囲判定・Range 読み込みのテスト。実行: node tests/streets.test.mjs
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { parseIndex, planDownloads, bboxContains, areasInView, readRange, BlobSource, sha256Hex,
  STREETS_DIR, INDEX_URL, STREET_MIN_ZOOM, STREET_MAX_ZOOM, STREET_DATA_ZOOM } from '../js/streets.js';

let count = 0;
const queue = [];
const test = (name, fn) => queue.push([name, fn]);
const sha = (c) => c.repeat(64);
const file = (id, over = {}) => ({ id, file: `${id}.pmtiles`, bytes: 1000, sha256: sha('a'), bbox: [139.66, 35.66, 139.72, 35.71], ...over });

test('定数: ズーム 10 以上で表示、16 まで拡大、データは 15 まで', () => {
  assert.deepEqual([STREET_MIN_ZOOM, STREET_MAX_ZOOM, STREET_DATA_ZOOM], [10, 16, 15]);
  assert.equal(INDEX_URL, 'data/streets/index.json'); assert.ok(!STREETS_DIR.startsWith('/'), '相対パス');
});
test('parseIndex: 不正な項目（パス・ハッシュ・範囲）は捨てる', () => {
  const idx = parseIndex({ version: 1, files: [
    file('ok'), file('../evil', { file: '../evil.pmtiles' }), file('badsha', { sha256: 'xyz' }), file('badbox', { bbox: [10, 0, 5, 1] }),
    file('zero', { bytes: 0 }), null, file('abs', { file: '/abs.pmtiles' })] });
  assert.deepEqual(idx.files.map((f) => f.id), ['ok']);
  assert.deepEqual(parseIndex(null).files, []); assert.deepEqual(parseIndex({ files: 'x' }).files, []);
});
test('planDownloads: 未保存・ハッシュ違い（更新）だけをダウンロードし、ロケ地から消えたものは削除', () => {
  const idx = parseIndex({ files: [file('a', { bytes: 100 }), file('b', { bytes: 200, sha256: sha('b') }), file('c', { bytes: 300 })] });
  const cached = new Map([['data/streets/a.pmtiles', sha('a')], ['data/streets/b.pmtiles', sha('0')], ['data/streets/old.pmtiles', sha('a')], [INDEX_URL, null]]);
  const p = planDownloads(idx, cached);
  assert.deepEqual(p.todo.map((f) => f.id), ['b', 'c'], 'b はハッシュ違いで差し替え、c は未保存');
  assert.deepEqual(p.done.map((f) => f.id), ['a']);
  assert.deepEqual(p.remove, ['data/streets/old.pmtiles']);
  assert.deepEqual([p.total, p.totalBytes, p.doneBytes], [3, 600, 100]);
  // 途中で中断 → 次回は残りだけ（続きから再開）
  cached.set('data/streets/b.pmtiles', sha('b'));
  assert.deepEqual(planDownloads(idx, cached).todo.map((f) => f.id), ['c']);
  cached.set('data/streets/c.pmtiles', sha('a'));
  assert.equal(planDownloads(idx, cached).todo.length, 0);
});
test('範囲判定: ロケ地付近だけ（表示範囲に重なるもの、中心に近い順）', () => {
  const tokyo = { id: 'tokyo', bbox: [139.66, 35.66, 139.72, 35.71] }, osaka = { id: 'osaka', bbox: [135.47, 34.68, 135.53, 34.72] };
  assert.ok(bboxContains(tokyo.bbox, 35.6856, 139.6906)); assert.ok(!bboxContains(tokyo.bbox, 35.6856, 139.8));
  assert.deepEqual(areasInView([tokyo, osaka], [139.68, 35.68, 139.70, 35.70]).map((a) => a.id), ['tokyo']);
  assert.deepEqual(areasInView([tokyo, osaka], [139.80, 35.68, 139.90, 35.70]), []);
  assert.deepEqual(areasInView([tokyo, osaka], [130, 30, 140, 40]).map((a) => a.id), ['osaka', 'tokyo'], '広い範囲では中心に近い順');
});
test('readRange: キャッシュ済み Blob から指定範囲を切り出す（末尾を超える分は切り詰め）', async () => {
  const blob = new Blob([new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7, 8, 9])]);
  assert.deepEqual([...new Uint8Array((await readRange(blob, 2, 3)).data)], [2, 3, 4]);
  assert.deepEqual([...new Uint8Array((await readRange(blob, 8, 100)).data)], [8, 9]);
  assert.equal((await readRange(blob, 20, 5)).data.byteLength, 0);
  await assert.rejects(readRange(blob, -1, 2));
});
test('sha256Hex', async () => {
  assert.equal(await sha256Hex(new TextEncoder().encode('abc')), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
});

/** 最小の PMTiles v3（非圧縮、z0 のタイル 1 枚）を作る */
function tinyPmtiles(tile) {
  const varint = (n, out) => { while (n >= 0x80) { out.push((n & 0x7f) | 0x80); n = Math.floor(n / 128); } out.push(n); };
  const dir = []; varint(1, dir); varint(0, dir); varint(1, dir); varint(tile.length, dir); varint(0 + 1, dir); // 1 エントリ: id 0, run 1, 長さ, offset 0
  const meta = new TextEncoder().encode('{}');
  const H = 127, rootOff = H, metaOff = rootOff + dir.length, dataOff = metaOff + meta.length;
  const buf = new Uint8Array(dataOff + tile.length);
  const dv = new DataView(buf.buffer);
  buf.set(new TextEncoder().encode('PMTiles'), 0); buf[7] = 3;
  const u64 = (pos, v) => dv.setBigUint64(pos, BigInt(v), true);
  [rootOff, dir.length, metaOff, meta.length, 0, 0, dataOff, tile.length, 1, 1, 1].forEach((v, i) => u64(8 + i * 8, v));
  buf[96] = 1; buf[97] = 1; buf[98] = 1; buf[99] = 1; buf[100] = 0; buf[101] = 0; // clustered, 内部圧縮なし, タイル圧縮なし, MVT, z0〜0
  dv.setInt32(102, -1800000000, true); dv.setInt32(106, -850000000, true); dv.setInt32(110, 1800000000, true); dv.setInt32(114, 850000000, true);
  buf.set(dir, rootOff); buf.set(meta, metaOff); buf.set(tile, dataOff);
  return buf;
}

test('同梱の pmtiles で、キャッシュ済み Blob からの Range 読み込みでタイルを取り出せる', async () => {
  const code = readFileSync(new URL('../vendor/pmtiles/pmtiles.js', import.meta.url), 'utf8');
  const { PMTiles } = new Function(`${code}; return pmtiles;`)();
  const tile = new TextEncoder().encode('tile-data-z0');
  const blob = new Blob([tinyPmtiles(tile)]);
  const reads = [];
  const src = new BlobSource('data/streets/test.pmtiles', blob);
  const orig = src.getBytes.bind(src);
  src.getBytes = (o, l, ...rest) => { reads.push([o, l]); return orig(o, l, ...rest); };
  const p = new PMTiles(src);
  const h = await p.getHeader();
  assert.equal(h.specVersion, 3); assert.equal(h.maxZoom, 0);
  const got = await p.getZxy(0, 0, 0);
  assert.equal(new TextDecoder().decode(got.data), 'tile-data-z0');
  assert.equal(await p.getZxy(1, 0, 0), undefined, '無いタイル');
  assert.ok(reads.length >= 2 && reads.every(([o, l]) => o >= 0 && l > 0), JSON.stringify(reads));
});

test('index.json があれば、すべての項目が正しく、実ファイルのサイズ・ハッシュと一致', () => {
  const p = new URL('../data/streets/index.json', import.meta.url);
  if (!existsSync(p)) { console.log('     （data/streets/index.json はまだありません。scripts/extract-streets.sh で作成）'); return; }
  const json = JSON.parse(readFileSync(p, 'utf8'));
  const idx = parseIndex(json);
  assert.equal(idx.files.length, json.files.length, '不正な項目がある');
  const locs = JSON.parse(readFileSync(new URL('../data/locations.json', import.meta.url))).locations;
  for (const f of idx.files) {
    assert.ok(locs.some((l) => l.id === f.id), `${f.id} は locations.json にない`);
    const loc = locs.find((l) => l.id === f.id);
    assert.ok(bboxContains(f.bbox, loc.lat, loc.lng), `${f.id} の範囲にロケ地が入っていない`);
    const buf = readFileSync(new URL(`../data/streets/${f.file}`, import.meta.url));
    assert.equal(buf.length, f.bytes, `${f.file} のサイズ`);
    assert.equal(createHash('sha256').update(buf).digest('hex'), f.sha256, `${f.file} のハッシュ`);
  }
});

for (const [name, fn] of queue) { await fn(); count++; console.log('ok  ', name); }
console.log(`\n${count} 件のテストに合格`);
