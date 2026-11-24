// JPEG の EXIF / 富士フイルム MakerNote の読み取りテスト。実行: node tests/exif.test.mjs
// 合成した EXIF だけの JPEG（tests/jpeg-builder.mjs）と、tests/fixtures/jpeg/ にある実機の JPEG（EXIF だけに削ったもの）で検証する。
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { readExif, findExif, decodeFuji, recipeFromJpeg, notesFromJpeg, shotInfo, formatShutter, isXT3, toneOf, drOf, WB_SHIFT } from '../js/exif.js';
import { validateRecipe } from '../js/xt3.js';
import { makeExifJpeg, xt3Sample } from './jpeg-builder.mjs';
import { stripJpeg } from '../scripts/strip-jpeg-exif.mjs';

let count = 0;
const test = (name, fn) => { fn(); count++; console.log('ok  ', name); };
const byKey = (items) => Object.fromEntries(items.map((x) => [x.key, x]));

test('APP1 Exif を探す（APP0 の後ろでも、無ければ null）', () => {
  assert.ok(findExif(xt3Sample()));
  assert.ok(findExif(makeExifJpeg({ app0: false, ifd0: [[0x0110, 2, 'X']] })));
  assert.equal(findExif(Uint8Array.from([0xff, 0xd8, 0xff, 0xd9])), null);
  assert.equal(findExif(Uint8Array.from([0x89, 0x50, 0x4e, 0x47])), null, 'PNG');
  assert.equal(readExif(new Uint8Array(0)), null);
});

test('撮影情報: 機種・レンズ・焦点距離・SS・F 値・ISO・露出補正・撮影日時', () => {
  const e = readExif(xt3Sample());
  assert.equal(e.make, 'FUJIFILM'); assert.equal(e.model, 'X-T3'); assert.ok(isXT3(e));
  assert.equal(e.lens, 'XF23mmF2 R WR'); assert.equal(e.focalLength, 23); assert.equal(e.focal35, 35);
  assert.equal(formatShutter(e.exposureTime), '1/250'); assert.equal(e.fNumber, 2.8); assert.equal(e.iso, 640);
  assert.ok(Math.abs(e.exposureBias + 2 / 3) < 1e-9); assert.equal(e.dateTime, '2026:10:03 18:42:05');
  const info = Object.fromEntries(shotInfo(e).map((x) => [x.label, x.text]));
  assert.equal(info['機種'], 'FUJIFILM X-T3');
  assert.equal(info['焦点距離'], '23mm（35mm 換算 35mm）');
  assert.equal(info['F 値'], 'F2.8'); assert.equal(info['露出補正'], '−0.7EV');
  assert.equal(info['撮影日時'], '2026-10-03 18:42:05 +09:00');
});

test('ビッグエンディアン（MM）の TIFF でも読める（MakerNote は常にリトルエンディアン）', () => {
  const e = readExif(xt3Sample({ little: false }));
  assert.equal(e.model, 'X-T3'); assert.equal(e.iso, 640);
  assert.equal(byKey(decodeFuji(e.fuji)).filmSim.value, 'classic-chrome');
});

test('GPS は読まない（結果にもメモにも位置情報が無い）', () => {
  const e = readExif(xt3Sample({ gps: true }));
  const json = JSON.stringify(e) + notesFromJpeg(e);
  assert.ok(!/gps|lat|lng|139|35\.6/i.test(json.replace(/"focal35":35/, '')), json);
  assert.ok(!('gps' in e));
});

test('MakerNote: フィルム・DR・グレイン・カラークローム・WB・トーン・カラー・シャープネス・NR', () => {
  const k = byKey(decodeFuji(readExif(xt3Sample()).fuji));
  assert.equal(k.filmSim.value, 'classic-chrome');
  assert.equal(k.dr.value, 'dr400');
  assert.equal(k.grain.value, 'weak'); assert.equal(k.colorChrome.value, 'strong');
  assert.deepEqual(k.wb.value, { mode: 'kelvin', kelvin: 4300 });
  assert.equal(k.highlight.value, 2); assert.equal(k.shadow.value, -1);
  assert.equal(k.color.value, -1); assert.equal(k.sharpness.value, -1); assert.equal(k.nr.value, -4);
  assert.deepEqual(k.wbShift.value, { r: 2, b: -3 }, `記録値 ÷ ${WB_SHIFT.divisor}`);
  assert.match(k.wbShift.note, /要確認/, 'WB シフトの換算は実機で確かめるまで要確認');
  for (const it of Object.values(k)) assert.equal(it.ok, true, it.key);
});

test('対応表（ExifTool）: シャープネス・NR・カラー・トーンの記録値', () => {
  const dec = (fuji) => byKey(decodeFuji(fuji));
  const sh = { 0x00: -4, 0x01: -3, 0x02: -2, 0x82: -1, 0x03: 0, 0x84: 1, 0x04: 2, 0x05: 3, 0x06: 4 };
  for (const [raw, want] of Object.entries(sh)) assert.equal(dec({ sharpness: +raw }).sharpness.value, want);
  const nr = { 0x2e0: -4, 0x2c0: -3, 0x200: -2, 0x280: -1, 0: 0, 0x180: 1, 0x100: 2, 0x1c0: 3, 0x1e0: 4 };
  for (const [raw, want] of Object.entries(nr)) assert.equal(dec({ noiseReduction: +raw }).nr.value, want);
  const col = { 0x4e0: -4, 0x4c0: -3, 0x400: -2, 0x180: -1, 0: 0, 0x80: 1, 0x100: 2, 0xc0: 3, 0xe0: 4 };
  for (const [raw, want] of Object.entries(col)) assert.equal(dec({ saturation: +raw }).color.value, want);
  assert.equal(toneOf(-64), 4); assert.equal(toneOf(32), -2); assert.equal(toneOf(0), 0);
});

test('モノクロ / ACROS / セピアとフィルター（Saturation に入る）', () => {
  const dec = (s) => byKey(decodeFuji({ saturation: s, filmMode: 0 }));
  assert.equal(dec(0x300).filmSim.value, 'monochrome'); assert.equal(dec(0x300).monoFilter.value, 'none');
  assert.equal(dec(0x301).monoFilter.value, 'r'); assert.equal(dec(0x302).monoFilter.value, 'ye'); assert.equal(dec(0x303).monoFilter.value, 'g');
  assert.equal(dec(0x500).filmSim.value, 'acros'); assert.equal(dec(0x503).monoFilter.value, 'g');
  assert.equal(dec(0x310).filmSim.value, 'sepia');
  assert.equal(dec(0x500).color, undefined, 'モノクロではカラーを出さない');
  const r = recipeFromJpeg({ fuji: { saturation: 0x502, filmMode: 0 } }).recipe;
  assert.equal(r.filmSim, 'acros'); assert.equal(r.monoFilter, 'ye'); assert.equal(r.monoWC, 0);
  assert.deepEqual(validateRecipe({ ...r, name: 'x' }), []);
});

test('DR: AUTO（適用された %）・手動 100/200/400', () => {
  assert.deepEqual(drOf({ drSetting: 0, autoDR: 200 }), { id: 'auto', applied: 200 });
  for (const v of [100, 200, 400]) assert.equal(drOf({ drSetting: 1, devDR: v }).id, `dr${v}`);
  assert.equal(drOf({ drSetting: 1, devDR: 800 }).id, null);
  assert.match(byKey(decodeFuji({ drSetting: 0, autoDR: 400 })).dr.text, /400%/);
});

test('X-T3 以外の設定は「X-T3では設定できない」（クラシックネガ・グレイン小・カラークロームブルー・0.5 刻みのトーン・明瞭度）', () => {
  const k = byKey(decodeFuji({ filmMode: 0x800, grainRoughness: 16, grainSize: 32, colorChromeBlue: 64, highlightTone: -24, shadowTone: 8, clarity: -2000, whiteBalance: 0x1 }));
  for (const key of ['filmSim', 'grain', 'grainSize', 'colorChromeBlue', 'highlight', 'shadow', 'clarity', 'wb']) {
    assert.equal(k[key].ok, false, key); assert.match(k[key].note, /X-T3では設定できない/, key);
  }
  assert.equal(k.filmSim.text, 'クラシックネガ（Classic Negative）');
  assert.equal(k.highlight.text, '+1.5');
  const { recipe, skipped } = recipeFromJpeg({ model: 'X-T4', fuji: { filmMode: 0x800, highlightTone: -24, sharpness: 0x84 } });
  assert.equal(recipe.filmSim, 'provia', '設定できない値は既定値で保存'); assert.equal(recipe.highlight, 0); assert.equal(recipe.sharpness, 1);
  assert.equal(skipped.length, 2);
  assert.deepEqual(validateRecipe({ ...recipe, name: 'x' }), []);
});

test('MakerNote が無い画像: 撮影情報だけ、設定は空', () => {
  const e = readExif(makeExifJpeg({ ifd0: [[0x010f, 2, 'Apple'], [0x0110, 2, 'iPhone 15']], exif: [[0x8827, 3, 100]] }));
  assert.equal(e.fuji, null); assert.equal(e.iso, 100); assert.ok(!isXT3(e));
  assert.deepEqual(decodeFuji(e.fuji), []);
  // 他社の MakerNote（FUJIFILM ヘッダが無い）は読まない
  const other = makeExifJpeg({ exif: [[0x927c, 7, Uint8Array.from('Nikon\0\x02\x10\0\0MM\0*', (c) => c.charCodeAt(0))]] });
  assert.equal(readExif(other).fuji, null);
});

test('レシピとして保存: source jpeg・撮影情報をメモに・検証を通る', () => {
  const e = readExif(xt3Sample());
  const { recipe, skipped, unconfirmed } = recipeFromJpeg(e);
  assert.equal(recipe.source, 'jpeg'); assert.equal(recipe.filmSim, 'classic-chrome'); assert.equal(recipe.dr, 'dr400');
  assert.deepEqual(recipe.wb, { mode: 'kelvin', kelvin: 4300 }); assert.deepEqual(recipe.wbShift, { r: 2, b: -3 });
  assert.equal(recipe.isoNote, 'ISO 640'); assert.equal(recipe.exposureNote, '-2/3EV');
  assert.deepEqual(skipped, []); assert.ok(unconfirmed.some((s) => /WBシフト/.test(s)));
  const notes = notesFromJpeg(e, { skipped, unconfirmed });
  assert.match(notes, /XF23mmF2 R WR/); assert.match(notes, /1\/250/); assert.match(notes, /2026-10-03/);
  assert.deepEqual(validateRecipe({ ...recipe, name: 'JPEG', notes }), []);
});

test('壊れた EXIF（IFD の位置が範囲外）でも例外を出さない', () => {
  const b = xt3Sample();
  const t = findExif(b).start;
  new DataView(b.buffer).setUint32(t + 4, 0xffffff, true);
  const e = readExif(b);
  assert.equal(e.model, null);
});

test('strip-jpeg-exif: EXIF だけを残し、GPS を 0 にする（読み取り結果は同じ）', () => {
  const src = xt3Sample({ gps: true });
  // 画像データの代わりに SOS 以降を付ける
  const full = new Uint8Array(src.length - 2 + 8);
  full.set(src.subarray(0, src.length - 2)); full.set([0xff, 0xda, 0, 4, 1, 2, 0xff, 0xd9], src.length - 2);
  const out = stripJpeg(full);
  assert.ok(!out.includes(0xda) || ![...out].some((v, i) => v === 0xff && out[i + 1] === 0xda), 'SOS を含まない');
  const e = readExif(out);
  assert.deepEqual(decodeFuji(e.fuji), decodeFuji(readExif(src).fuji));
  const lat = Buffer.from([35, 0, 0, 0, 1, 0, 0, 0, 41, 0, 0, 0, 1, 0, 0, 0]); // 緯度 35°41′ の RATIONAL
  assert.ok(Buffer.from(src).includes(lat), '元には GPS がある');
  assert.ok(!Buffer.from(out).includes(lat), 'GPS の緯度が消えている');
});

// 実機のフィクスチャ（tests/fixtures/jpeg/*.jpg と同名の .expected.json）
const dir = fileURLToPath(new URL('./fixtures/jpeg/', import.meta.url));
const samples = existsSync(dir) ? readdirSync(dir).filter((f) => /\.jpe?g$/i.test(f)) : [];
for (const f of samples) {
  const expFile = join(dir, f.replace(/\.jpe?g$/i, '.expected.json'));
  if (!existsSync(expFile)) { console.log(`skip  ${f}（${f.replace(/\.jpe?g$/i, '.expected.json')} がありません）`); continue; }
  test(`実機: ${f}`, () => {
    const want = JSON.parse(readFileSync(expFile, 'utf8'));
    const e = readExif(readFileSync(join(dir, f)));
    assert.ok(e, 'EXIF を読めない');
    if (want.model) assert.equal(e.model, want.model);
    const k = byKey(decodeFuji(e.fuji));
    for (const [key, v] of Object.entries(want.settings || {})) assert.deepEqual(k[key]?.value, v, key);
    if (want.wbShiftRaw) assert.deepEqual(k.wbShift?.raw, want.wbShiftRaw, 'WB シフトの記録値');
  });
}
if (!samples.length) console.log('info  実機のフィクスチャはまだありません（tests/fixtures/README.md）');

console.log(`\n${count} 件のテストに合格`);
