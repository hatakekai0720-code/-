// テスト用: EXIF（と富士の MakerNote）だけを持つ JPEG を組み立てる。画像データは入れない（SOI → APP1 → EOI）。
// 実機の JPEG はリポジトリに入れる前に scripts/strip-jpeg-exif.mjs で EXIF だけにする（tests/fixtures/README.md）。

// 型: 1 BYTE / 2 ASCII / 3 SHORT / 4 LONG / 5 RATIONAL / 7 UNDEFINED / 9 SLONG / 10 SRATIONAL
const SIZE = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 7: 1, 9: 4, 10: 8 };

/**
 * IFD をバイト列にする。entries: [[tag, type, value]]。value は数値・配列・文字列・Uint8Array。
 * ポインタ（サブ IFD）は後から書き込めるよう { tag: 位置 } を返す。
 * @param {number} base この IFD を置く位置（TIFF / MakerNote の起点からのオフセット）
 */
function ifdBytes(entries, base, little, next = 0) {
  entries = [...entries].sort((a, b) => a[0] - b[0]);
  const head = 2 + entries.length * 12 + 4;
  const data = [];
  let dataLen = 0;
  const buf = new ArrayBuffer(head + 4096);
  const v = new DataView(buf);
  v.setUint16(0, entries.length, little);
  const pointerAt = {};
  entries.forEach(([tag, type, value], i) => {
    const e = 2 + i * 12;
    const raw = encode(type, value, little);
    const count = type === 5 || type === 10 ? raw.length / 8 : type === 2 ? raw.length : raw.length / SIZE[type];
    v.setUint16(e, tag, little); v.setUint16(e + 2, type, little); v.setUint32(e + 4, count, little);
    if (raw.length <= 4) { new Uint8Array(buf, e + 8, raw.length).set(raw); pointerAt[tag] = e + 8; }
    else { const off = base + head + dataLen; v.setUint32(e + 8, off, little); data.push(raw); dataLen += raw.length + (raw.length & 1); if (raw.length & 1) data.push(new Uint8Array(1)); }
  });
  v.setUint32(2 + entries.length * 12, next, little);
  const out = new Uint8Array(head + dataLen);
  out.set(new Uint8Array(buf, 0, head));
  let p = head;
  for (const d of data) { out.set(d, p); p += d.length; }
  return { bytes: out, pointerAt };
}

function encode(type, value, little) {
  if (value instanceof Uint8Array) return value;
  if (type === 2) { const s = `${value}\0`; return Uint8Array.from(s, (c) => c.charCodeAt(0)); }
  const vals = Array.isArray(value) ? value : [value];
  const size = SIZE[type];
  const out = new Uint8Array(vals.length * size);
  const v = new DataView(out.buffer);
  vals.forEach((x, i) => {
    const o = i * size;
    if (type === 1 || type === 7) v.setUint8(o, x & 0xff);
    else if (type === 3) v.setUint16(o, x, little);
    else if (type === 4) v.setUint32(o, x, little);
    else if (type === 9) v.setInt32(o, x, little);
    else if (type === 5 || type === 10) {
      const [n, d] = Array.isArray(x) ? x : [Math.round(x * 1000), 1000];
      if (type === 5) { v.setUint32(o, n, little); v.setUint32(o + 4, d, little); } else { v.setInt32(o, n, little); v.setInt32(o + 4, d, little); }
    }
  });
  return out;
}

/** 富士の MakerNote: "FUJIFILM" + IFD の位置（12）+ IFD（リトルエンディアン、オフセットは MakerNote の先頭から） */
export function fujiMakerNote(entries) {
  const { bytes } = ifdBytes(entries, 12, true);
  const out = new Uint8Array(12 + bytes.length);
  out.set(Uint8Array.from('FUJIFILM', (c) => c.charCodeAt(0)));
  new DataView(out.buffer).setUint32(8, 12, true);
  out.set(bytes, 12);
  return out;
}

/**
 * EXIF だけの JPEG。
 * @param {object} o
 * @param {Array} [o.ifd0] IFD0 のエントリ（Make・Model など）
 * @param {Array} [o.exif] Exif IFD のエントリ
 * @param {Array} [o.fuji] 富士の MakerNote のエントリ（省略で MakerNote なし）
 * @param {boolean} [o.gps] GPS IFD を付ける（パーサーが読まないことのテスト用）
 * @param {boolean} [o.little] TIFF のバイト順（既定 true = II。富士の実機は II）
 */
export function makeExifJpeg({ ifd0 = [], exif = [], fuji = null, gps = false, little = true, app0 = true } = {}) {
  const exifEntries = [...exif];
  if (fuji) exifEntries.push([0x927c, 7, fujiMakerNote(fuji)]);
  // 配置: TIFF ヘッダ(8) → IFD0 → Exif IFD → GPS IFD
  const ifd0Entries = [...ifd0, [0x8769, 4, 0]];
  if (gps) ifd0Entries.push([0x8825, 4, 0]);
  const first = ifdBytes(ifd0Entries, 8, little);
  const exifBase = 8 + first.bytes.length;
  const ex = ifdBytes(exifEntries, exifBase, little);
  const gpsBase = exifBase + ex.bytes.length;
  const gp = gps ? ifdBytes([[0x0001, 2, 'N'], [0x0002, 5, [[35, 1], [41, 1], [0, 1]]], [0x0003, 2, 'E'], [0x0004, 5, [[139, 1], [41, 1], [0, 1]]]], gpsBase, little) : null;
  const tiff = new Uint8Array(gpsBase + (gp ? gp.bytes.length : 0));
  const v = new DataView(tiff.buffer);
  v.setUint16(0, little ? 0x4949 : 0x4d4d); v.setUint16(2, 42, little); v.setUint32(4, 8, little);
  tiff.set(first.bytes, 8); tiff.set(ex.bytes, exifBase); if (gp) tiff.set(gp.bytes, gpsBase);
  v.setUint32(8 + first.pointerAt[0x8769], exifBase, little);
  if (gps) v.setUint32(8 + first.pointerAt[0x8825], gpsBase, little);
  const app1Len = 2 + 6 + tiff.length;
  const app0Bytes = app0 ? Uint8Array.from([0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00]) : new Uint8Array(0);
  const out = new Uint8Array(2 + app0Bytes.length + 2 + app1Len + 2);
  let p = 0;
  out.set([0xff, 0xd8], p); p += 2;
  out.set(app0Bytes, p); p += app0Bytes.length;
  out.set([0xff, 0xe1, app1Len >> 8, app1Len & 0xff], p); p += 4;
  out.set(Uint8Array.from('Exif\0\0', (c) => c.charCodeAt(0)), p); p += 6;
  out.set(tiff, p); p += tiff.length;
  out.set([0xff, 0xd9], p);
  return out;
}

/** X-T3 の JPEG を模した EXIF（値は ExifTool のタグ表に沿った記録値） */
export function xt3Sample({ fuji, model = 'X-T3', little = true, gps = true } = {}) {
  return makeExifJpeg({
    little, gps,
    ifd0: [[0x010f, 2, 'FUJIFILM'], [0x0110, 2, model]],
    exif: [
      [0x829a, 5, [[1, 250]]], [0x829d, 5, [[28, 10]]], [0x8827, 3, 640], [0x9003, 2, '2026:10:03 18:42:05'], [0x9011, 2, '+09:00'],
      [0x9204, 10, [[-2, 3]]], [0x920a, 5, [[23, 1]]], [0xa405, 3, 35], [0xa433, 2, 'FUJIFILM'], [0xa434, 2, 'XF23mmF2 R WR'],
    ],
    fuji: fuji ?? [
      [0x1001, 3, 0x82],          // シャープネス -1
      [0x1002, 3, 0xff0],         // WB 色温度
      [0x1003, 3, 0x180],         // カラー -1
      [0x1005, 3, 4300],          // 4300K
      [0x100a, 9, [40, -60]],     // WB シフト（記録値）
      [0x100e, 3, 0x2e0],         // NR -4
      [0x1040, 9, 16],            // シャドウ -1
      [0x1041, 9, -32],           // ハイライト +2
      [0x1047, 9, 32],            // グレイン 弱
      [0x1048, 9, 64],            // カラークローム 強
      [0x1401, 3, 0x600],         // クラシッククローム
      [0x1402, 3, 1], [0x1403, 3, 400], // DR400
    ],
  });
}
