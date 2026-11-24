#!/usr/bin/env node
// 実機の JPEG から「EXIF（APP1）だけ」を抜き出し、テストのフィクスチャにする。
//   画像データ（SOS 以降）・サムネイル（IFD1）・APP2 の MPF プレビューは捨てる。
//   GPS IFD の中身と、シリアル番号（BodySerialNumber 0xA431 / 富士の InternalSerialNumber 0x0010）は 0 で塗りつぶす。
//   出力は SOI → APP1 → EOI の小さな JPEG（画像としては表示できない）。
// 使い方:
//   node scripts/strip-jpeg-exif.mjs DSCF1234.JPG tests/fixtures/jpeg/classic-chrome-dr400.jpg
// 書き出したら tests/fixtures/README.md の表に「どの設定で撮ったか」を書き、
// 同じ名前の .expected.json（tests/fixtures/README.md の例）を置く。
import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [src, dst] = process.argv.slice(2);
  if (!src || !dst) { console.error('使い方: node scripts/strip-jpeg-exif.mjs 入力.jpg 出力.jpg'); process.exit(1); }
  const out = stripJpeg(readFileSync(src));
  writeFileSync(dst, out);
  console.log(`${dst}: ${out.length} バイト（EXIF のみ。GPS・サムネイル・シリアル番号を消去）`);
}

export function stripJpeg(buf) {
  const b = new Uint8Array(buf);
  if (b[0] !== 0xff || b[1] !== 0xd8) throw new Error('JPEG ではありません');
  let p = 2, app1 = null;
  while (p + 4 <= b.length) {
    if (b[p] !== 0xff) throw new Error('マーカーが壊れています');
    const m = b[p + 1];
    if (m === 0xda || m === 0xd9) break;
    const len = (b[p + 2] << 8) | b[p + 3];
    if (m === 0xe1 && String.fromCharCode(...b.subarray(p + 4, p + 8)) === 'Exif') { app1 = b.slice(p, p + 2 + len); break; }
    p += 2 + len;
  }
  if (!app1) throw new Error('EXIF（APP1）がありません');
  scrub(app1.subarray(10));
  const out = new Uint8Array(2 + app1.length + 2);
  out.set([0xff, 0xd8]); out.set(app1, 2); out.set([0xff, 0xd9], 2 + app1.length);
  return out;
}

// TIFF 内の GPS・サムネイル・シリアル番号を 0 にする
function scrub(t) {
  const v = new DataView(t.buffer, t.byteOffset, t.byteLength);
  const le = v.getUint16(0) === 0x4949;
  const u16 = (o) => v.getUint16(o, le), u32 = (o) => v.getUint32(o, le);
  const SIZE = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 6: 1, 7: 1, 8: 2, 9: 4, 10: 8, 11: 4, 12: 8 };
  const entries = (off, view = v, little = le) => {
    const n = view.getUint16(off, little), list = [];
    for (let i = 0; i < n; i++) {
      const e = off + 2 + i * 12, type = view.getUint16(e + 2, little), count = view.getUint32(e + 4, little), bytes = (SIZE[type] || 1) * count;
      list.push({ e, tag: view.getUint16(e, little), bytes, at: bytes <= 4 ? e + 8 : view.getUint32(e + 8, little) });
    }
    return { list, next: off + 2 + n * 12 };
  };
  const zero = (view, at, n) => new Uint8Array(view.buffer, view.byteOffset + at, n).fill(0);
  const ifd0 = entries(u32(4));
  for (const x of ifd0.list) {
    if (x.tag === 0x8825) { // GPS IFD: 中身をすべて 0 に
      const g = entries(u32(x.e + 8));
      for (const y of g.list) if (y.bytes > 4) zero(v, y.at, y.bytes);
      zero(v, u32(x.e + 8), g.next + 4 - u32(x.e + 8));
    }
    if (x.tag === 0x8769) { // Exif IFD
      for (const y of entries(u32(x.e + 8)).list) {
        if (y.tag === 0xa431) zero(v, y.at, y.bytes);
        if (y.tag === 0x927c) { // 富士の MakerNote
          const mv = new DataView(t.buffer, t.byteOffset + y.at, y.bytes);
          if (String.fromCharCode(...new Uint8Array(mv.buffer, mv.byteOffset, 8)) === 'FUJIFILM') {
            for (const z of entries(mv.getUint32(8, true), mv, true).list) if (z.tag === 0x0010) zero(mv, z.at, z.bytes);
          }
        }
      }
    }
  }
  // IFD1（サムネイル）: JPEGInterchangeFormat（0x0201）と長さ（0x0202）の範囲を 0 に
  const ifd1 = u32(ifd0.next);
  if (ifd1) {
    const l = entries(ifd1).list;
    const off = l.find((x) => x.tag === 0x0201), len = l.find((x) => x.tag === 0x0202);
    if (off && len) { const o = u32(off.e + 8), n = u32(len.e + 8); if (o + n <= t.length) zero(v, o, n); }
  }
}
