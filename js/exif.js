// JPEG の EXIF と富士フイルムの MakerNote を読み、撮影時の設定（実際の設定）を取り出す。自前の最小パーサー（DOM 非依存）。
//   JPEG: SOI → APP1 "Exif\0\0" → TIFF ヘッダ（II/MM）→ IFD0 → Exif IFD → MakerNote（タグ 0x927C）
//   富士の MakerNote: 先頭 8 バイトが "FUJIFILM"、続く 4 バイト（リトルエンディアン）が IFD の位置。
//   MakerNote 内のオフセットは MakerNote の先頭が起点で、バイト順は常にリトルエンディアン。
// ・GPS IFD（タグ 0x8825）はたどらない。位置情報は読まないし、保存もしない
// ・サムネイル（IFD1）・シリアル番号も読まない
// ・画像そのもの（圧縮データ）は読まない。ファイルの先頭（EXIF のある部分）だけを渡せばよい
//
// タグ番号と値の対応の出典: ExifTool の FujiFilm タグ表
//   （exiftool.org/TagNames/FujiFilm.html、ソースは github.com/exiftool/exiftool の lib/Image/ExifTool/FujiFilm.pm。Version 2.03 で確認）
//   EXIF の標準タグは ExifTool の EXIF タグ表（exiftool.org/TagNames/EXIF.html）・CIPA DC-008（Exif 2.32）
// 対応が実機で確かめられていない項目には【要確認】と書く（README と CLAUDE.md にも一覧）。
import * as X from './xt3.js';
import { formatEV } from './translator.js';

/* ---- EXIF の標準タグ ---- */
const T = {
  make: 0x010f, model: 0x0110, exifIfd: 0x8769, gpsIfd: 0x8825 /* たどらない */,
  exposureTime: 0x829a, fNumber: 0x829d, iso: 0x8827, dateTimeOriginal: 0x9003, offsetTimeOriginal: 0x9011,
  exposureBias: 0x9204, focalLength: 0x920a, makerNote: 0x927c, focal35: 0xa405, lensMake: 0xa433, lensModel: 0xa434,
};

/* ---- 富士フイルム MakerNote のタグ（ExifTool FujiFilm::Main） ---- */
export const FUJI = {
  sharpness: 0x1001,        // Sharpness
  whiteBalance: 0x1002,     // WhiteBalance
  saturation: 0x1003,       // Saturation（カラー。モノクロ / ACROS / セピアとフィルターもここに入る）
  colorTemperature: 0x1005, // ColorTemperature
  wbFineTune: 0x100a,       // WhiteBalanceFineTune（int32s × 2: Red, Blue）
  noiseReduction: 0x100e,   // NoiseReduction（X100 以降の新しい形式）
  clarity: 0x100f,          // Clarity（X-T3 には無い）
  shadowTone: 0x1040,       // ShadowTone（int32s。表示値 = -値 / 16）
  highlightTone: 0x1041,    // HighlightTone（同上）
  grainRoughness: 0x1047,   // GrainEffectRoughness
  colorChrome: 0x1048,      // ColorChromeEffect
  bwAdjustment: 0x1049,     // BWAdjustment（int8s。+ が暖色）
  bwMagentaGreen: 0x104b,   // BWMagentaGreen（X-T3 には無い）
  grainSize: 0x104c,        // GrainEffectSize（X-T3 には無い）
  colorChromeBlue: 0x104e,  // ColorChromeFXBlue（X-T3 には無い）
  filmMode: 0x1401,         // FilmMode
  drSetting: 0x1402,        // DynamicRangeSetting
  devDR: 0x1403,            // DevelopmentDynamicRange（手動 DR のときの 100 / 200 / 400）
  autoDR: 0x140b,           // AutoDynamicRange（DR AUTO のとき実際に使われた %）
  drPriority: 0x1443,       // DRangePriority（X-T3）0 = Auto / 1 = Fixed
  drPriorityAuto: 0x1444,   // DRangePriorityAuto 1 = Weak / 2 = Strong / 3 = Plus
  drPriorityFixed: 0x1445,  // DRangePriorityFixed 1 = Weak / 2 = Strong
};

// 型ごとのバイト数（TIFF 6.0）
const SIZE = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 6: 1, 7: 1, 8: 2, 9: 4, 10: 8, 11: 4, 12: 8 };

class Reader {
  constructor(view, base, little) { this.v = view; this.base = base; this.le = little; }
  u8(o) { return this.v.getUint8(this.base + o); }
  u16(o) { return this.v.getUint16(this.base + o, this.le); }
  u32(o) { return this.v.getUint32(this.base + o, this.le); }
  ok(o, n) { return o >= 0 && this.base + o + n <= this.v.byteLength; }
}

/**
 * IFD を読み、{ [tag]: 値 } を返す。値は型に応じて数値・数値の配列・文字列・Uint8Array（UNDEFINED）
 * @param {Reader} r @param {number} off IFD の位置（r.base 起点）
 * @param {Set<number>} [want] 読むタグ（省略時はすべて）
 */
function readIfd(r, off, want) {
  const out = {};
  if (!r.ok(off, 2)) return out;
  const n = r.u16(off);
  if (n > 1000 || !r.ok(off + 2, n * 12)) return out;
  for (let i = 0; i < n; i++) {
    const e = off + 2 + i * 12;
    const tag = r.u16(e), type = r.u16(e + 2), count = r.u32(e + 4);
    if (want && !want.has(tag)) continue;
    const size = SIZE[type];
    if (!size || count > 1e6) continue;
    const bytes = size * count;
    const at = bytes <= 4 ? e + 8 : r.u32(e + 8);
    if (!r.ok(at, bytes)) continue;
    out[tag] = readValue(r, type, count, at);
  }
  return out;
}

function readValue(r, type, count, at) {
  if (type === 2) { // ASCII
    let s = '';
    for (let i = 0; i < count; i++) { const c = r.u8(at + i); if (!c) break; s += String.fromCharCode(c); }
    return s.trim();
  }
  if (type === 7 || type === 1 && count > 4) { // UNDEFINED / 長い BYTE
    return new Uint8Array(r.v.buffer, r.v.byteOffset + r.base + at, count);
  }
  const one = (k) => {
    const o = at + k * SIZE[type];
    switch (type) {
      case 1: return r.u8(o);
      case 6: return r.v.getInt8(r.base + o);
      case 3: return r.u16(o);
      case 8: return r.v.getInt16(r.base + o, r.le);
      case 4: return r.u32(o);
      case 9: return r.v.getInt32(r.base + o, r.le);
      case 5: { const d = r.u32(o + 4); return d ? r.u32(o) / d : null; }
      case 10: { const d = r.v.getInt32(r.base + o + 4, r.le); return d ? r.v.getInt32(r.base + o, r.le) / d : null; }
      case 11: return r.v.getFloat32(r.base + o, r.le);
      case 12: return r.v.getFloat64(r.base + o, r.le);
      default: return null;
    }
  };
  if (count === 1) return one(0);
  return Array.from({ length: count }, (_, k) => one(k));
}

/** JPEG のバイト列から APP1 Exif セグメントの TIFF 部分の位置を探す。無ければ null */
export function findExif(bytes) {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (v.byteLength < 4 || v.getUint16(0) !== 0xffd8) return null; // SOI
  let p = 2;
  while (p + 4 <= v.byteLength) {
    if (v.getUint8(p) !== 0xff) return null;
    const marker = v.getUint8(p + 1);
    if (marker === 0xff) { p++; continue; } // 詰め物
    if (marker === 0xda || marker === 0xd9) return null; // SOS（画像データ）/ EOI。ここから先は読まない
    const len = v.getUint16(p + 2);
    if (len < 2) return null;
    if (marker === 0xe1 && len >= 8 && p + 4 + 6 <= v.byteLength
      && v.getUint32(p + 4) === 0x45786966 /* Exif */ && v.getUint16(p + 8) === 0) {
      return { start: p + 10, length: Math.min(len - 8, v.byteLength - (p + 10)) };
    }
    p += 2 + len;
  }
  return null;
}

/**
 * JPEG（の先頭部分）から EXIF と富士の MakerNote を読む。読めなければ null。
 * @param {ArrayBuffer|Uint8Array} input
 * @returns {{ make, model, lens, focalLength, focal35, exposureTime, fNumber, iso, exposureBias, dateTime, offset, fuji: object|null } | null}
 */
export function readExif(input) {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  const seg = findExif(bytes);
  if (!seg) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset + seg.start, seg.length);
  if (view.byteLength < 8) return null;
  const bo = view.getUint16(0);
  if (bo !== 0x4949 && bo !== 0x4d4d) return null;
  const r = new Reader(view, 0, bo === 0x4949);
  if (r.u16(2) !== 42) return null;
  const ifd0 = readIfd(r, r.u32(4), new Set([T.make, T.model, T.exifIfd])); // GPS IFD のポインタは読まない
  const ex = typeof ifd0[T.exifIfd] === 'number' ? readIfd(r, ifd0[T.exifIfd], new Set([T.exposureTime, T.fNumber, T.iso, T.dateTimeOriginal,
    T.offsetTimeOriginal, T.exposureBias, T.focalLength, T.makerNote, T.focal35, T.lensMake, T.lensModel])) : {};
  const num = (x) => (Array.isArray(x) ? x[0] : x) ?? null;
  const out = {
    make: ifd0[T.make] || null, model: ifd0[T.model] || null,
    lensMake: ex[T.lensMake] || null, lens: ex[T.lensModel] || null,
    focalLength: num(ex[T.focalLength]), focal35: num(ex[T.focal35]),
    exposureTime: num(ex[T.exposureTime]), fNumber: num(ex[T.fNumber]), iso: num(ex[T.iso]),
    exposureBias: num(ex[T.exposureBias]),
    dateTime: ex[T.dateTimeOriginal] || null, offset: ex[T.offsetTimeOriginal] || null,
    fuji: null,
  };
  const mn = ex[T.makerNote];
  if (mn instanceof Uint8Array) out.fuji = readFujiMakerNote(mn);
  return out;
}

/** 富士の MakerNote（"FUJIFILM" ヘッダ付き）を読む。富士でなければ null */
export function readFujiMakerNote(mn) {
  if (mn.length < 12) return null;
  const head = String.fromCharCode(...mn.subarray(0, 8));
  if (head !== 'FUJIFILM') return null;
  const view = new DataView(mn.buffer, mn.byteOffset, mn.byteLength);
  const r = new Reader(view, 0, true); // 常にリトルエンディアン、オフセットは MakerNote の先頭が起点
  const tags = readIfd(r, r.u32(8), new Set(Object.values(FUJI)));
  // 値を数値（配列）だけにする（UNDEFINED のタグは使わない。BWAdjustment は int8s として読む）
  const out = {};
  for (const [k, id] of Object.entries(FUJI)) {
    let v = tags[id];
    if (v instanceof Uint8Array) v = v.length ? ((v[0] << 24) >> 24) : undefined; // 1 バイト目を int8s として
    if (v !== undefined && v !== null) out[k] = v;
  }
  return out;
}

/* ---- 記録値 → X-T3 の設定 ---- */

// フィルムシミュレーション（FilmMode 0x1401）。X-T3 に無いものは id: null
export const FILM_MODE = {
  0x000: { id: 'provia', name: 'PROVIA/スタンダード' },
  0x100: { id: null, name: 'F1/Studio Portrait' },
  0x110: { id: null, name: 'F1a/Studio Portrait Enhanced Saturation' },
  0x120: { id: 'astia', name: 'ASTIA/ソフト' },
  0x130: { id: null, name: 'F1c/Studio Portrait Increased Sharpness' },
  0x200: { id: 'velvia', name: 'Velvia/ビビッド' },
  0x300: { id: null, name: 'F3/Studio Portrait Ex' },
  0x400: { id: null, name: 'F4/Velvia' },
  0x500: { id: 'pro-neg-std', name: 'PRO Neg.Std' },
  0x501: { id: 'pro-neg-hi', name: 'PRO Neg.Hi' },
  0x600: { id: 'classic-chrome', name: 'クラシッククローム' },
  0x700: { id: 'eterna', name: 'ETERNA/シネマ' },
  0x800: { id: null, name: 'クラシックネガ（Classic Negative）' },
  0x900: { id: null, name: 'ETERNA ブリーチバイパス（Bleach Bypass）' },
  0xa00: { id: null, name: 'ノスタルジックネガ（Nostalgic Neg）' },
  0xb00: { id: null, name: 'REALA ACE' },
};

// Saturation（0x1003）: カラーの値、またはモノクロ系のフィルムとフィルター
export const SATURATION_COLOR = { 0x0: 0, 0x080: 1, 0x100: 2, 0x0c0: 3, 0x0e0: 4, 0x180: -1, 0x400: -2, 0x4c0: -3, 0x4e0: -4 };
export const SATURATION_MONO = {
  0x300: { film: 'monochrome', filter: 'none' }, 0x301: { film: 'monochrome', filter: 'r' },
  0x302: { film: 'monochrome', filter: 'ye' }, 0x303: { film: 'monochrome', filter: 'g' },
  0x310: { film: 'sepia', filter: null },
  0x500: { film: 'acros', filter: 'none' }, 0x501: { film: 'acros', filter: 'r' },
  0x502: { film: 'acros', filter: 'ye' }, 0x503: { film: 'acros', filter: 'g' },
};

// Sharpness（0x1001）
export const SHARPNESS = { 0x00: -4, 0x01: -3, 0x02: -2, 0x82: -1, 0x03: 0, 0x84: 1, 0x04: 2, 0x05: 3, 0x06: 4 };
// NoiseReduction（0x100E）
export const NOISE_REDUCTION = { 0x000: 0, 0x180: 1, 0x100: 2, 0x1c0: 3, 0x1e0: 4, 0x280: -1, 0x200: -2, 0x2c0: -3, 0x2e0: -4 };

// WhiteBalance（0x1002）→ xt3.js の WB_MODES の id。X-T3 で設定できない（このアプリの定義に無い）ものは id: null
//   【要確認】0x200 'Cloudy' を X-T3 の「日陰」、0x300〜0x302 を「蛍光灯1〜3」に対応させている（ExifTool の名前からの推測）
//   【要確認】0x1 / 0x2（オート ホワイト優先 / 雰囲気優先）は xt3.js に無い
export const WHITE_BALANCE = {
  0x0: { id: 'auto' }, 0x1: { id: null, name: 'AUTO（ホワイト優先）' }, 0x2: { id: null, name: 'AUTO（雰囲気優先）' },
  0x100: { id: 'daylight' }, 0x200: { id: 'shade' },
  0x300: { id: 'fluorescent1' }, 0x301: { id: 'fluorescent2' }, 0x302: { id: 'fluorescent3' },
  0x303: { id: null, name: 'Warm White Fluorescent' }, 0x304: { id: null, name: 'Living Room Warm White Fluorescent' },
  0x400: { id: 'incandescent' }, 0x500: { id: null, name: 'フラッシュ' }, 0x600: { id: 'underwater' },
  0xf00: { id: 'custom1' }, 0xf01: { id: 'custom2' }, 0xf02: { id: 'custom3' },
  0xf03: { id: null, name: 'カスタム4' }, 0xf04: { id: null, name: 'カスタム5' },
  0xff0: { id: 'kelvin' },
};

// グレイン（GrainEffectRoughness 0x1047）/ カラークローム（ColorChromeEffect 0x1048）
export const GRAIN = { 0: 'off', 32: 'weak', 64: 'strong' }; // 16 / 48 は X-HF1 の「小」（X-T3 には無い）
export const COLOR_CHROME = { 0: 'off', 32: 'weak', 64: 'strong' };

// WB シフト（WhiteBalanceFineTune 0x100A）の記録値 → カメラの表示値（-9〜+9）。
//   【要確認】ExifTool は「新しい機種は 20 で割る」としているが、X-T3 の実機の JPEG で確かめていない。
//   サンプル（WB シフトを R/B それぞれ既知の値にして撮った JPEG）で確認できたら confirmed を true にする
export const WB_SHIFT = { divisor: 20, confirmed: false };

/**
 * DynamicRangeSetting（0x1402）と DevelopmentDynamicRange（0x1403）→ DR の id
 *   0 = Auto / 1 = Manual（このとき 0x1403 が 100 / 200 / 400）/ 0x100 = Standard (100%)
 *   【要確認】X-T3 の DR100 / 200 / 400 が「Manual + 100 / 200 / 400」で記録されるか（ExifTool の注記「only valid for manual DR」からの推測）
 */
export function drOf(f) {
  if (f.drSetting === 0) return { id: 'auto', applied: f.autoDR ?? null };
  if (f.drSetting === 1 && [100, 200, 400].includes(f.devDR)) return { id: `dr${f.devDR}` };
  if (f.drSetting === 0x100) return { id: 'dr100' };
  if (f.drSetting === 1 && f.devDR) return { id: null, name: `DR${f.devDR}` };
  if (f.drSetting === 0x200) return { id: null, name: 'Wide1 (230%)' };
  if (f.drSetting === 0x201) return { id: null, name: 'Wide2 (400%)' };
  return null;
}

/** ShadowTone / HighlightTone の記録値（int32s）→ 表示値（-値 / 16） */
export const toneOf = (v) => (v == null ? null : (-v / 16) || 0);

const hex = (v) => `0x${Number(v).toString(16)}`;

/**
 * 富士の MakerNote の値を、項目ごとに { key, label, value（xt3.js の id / 数値）, text（表示）, ok（X-T3 で設定できる）, note } にする。
 * 記録が無い項目は入れない。
 */
export function decodeFuji(f) {
  if (!f) return [];
  const items = [];
  const add = (key, label, o) => items.push({ key, label, ok: true, note: null, ...o });
  const ng = (key, label, text, note = 'X-T3では設定できない') => add(key, label, { value: null, text, ok: false, note });

  // フィルムシミュレーション（モノクロ系は Saturation に入る）
  const mono = f.saturation != null ? SATURATION_MONO[f.saturation] : null;
  if (mono) {
    add('filmSim', 'フィルムシミュレーション', { value: mono.film, text: X.filmSim(mono.film).label });
    if (mono.filter) add('monoFilter', 'フィルター', { value: mono.filter, text: X.labelOf(X.MONO_FILTERS, mono.filter) });
  } else if (f.filmMode != null) {
    const m = FILM_MODE[f.filmMode];
    if (m?.id) add('filmSim', 'フィルムシミュレーション', { value: m.id, text: X.filmSim(m.id).label });
    else ng('filmSim', 'フィルムシミュレーション', m?.name ?? `不明（${hex(f.filmMode)}）`);
  }
  // モノクロ調整（BWAdjustment）【要確認】X-T3 にこの機能があるかどうか自体が未確認（CLAUDE.md の未確認事項）
  if (mono && mono.film !== 'sepia' && f.bwAdjustment != null) {
    const v = f.bwAdjustment;
    add('monoWC', 'モノクロ調整', { value: v, text: X.wcLabel(v), ok: Number.isInteger(v) && v >= X.RANGES.monoWC.min && v <= X.RANGES.monoWC.max, note: '【要確認】X-T3 にこの機能があるか未確認' });
  }
  if (f.bwMagentaGreen) ng('bwMG', 'モノクロ調整（マゼンタ〜グリーン）', String(f.bwMagentaGreen));

  // DR
  const dr = drOf(f);
  if (dr?.id) add('dr', 'ダイナミックレンジ', { value: dr.id, text: X.labelOf(X.DR_MODES, dr.id) + (dr.applied ? `（自動で ${dr.applied}% を適用）` : ''), note: dr.id === 'auto' ? null : '【要確認】記録値の対応' });
  else if (dr) ng('dr', 'ダイナミックレンジ', dr.name);
  // D レンジ優先（X-T3 の機能だが、xt3.js のレシピ項目には無い）
  if (f.drPriority != null) {
    const lv = f.drPriority === 0 ? { 1: '弱', 2: '強', 3: 'PLUS' }[f.drPriorityAuto] : { 1: '弱', 2: '強' }[f.drPriorityFixed];
    const text = f.drPriority === 0 ? `AUTO${lv ? `（${lv}）` : ''}` : (lv ?? '不明');
    add('drp', 'Dレンジ優先', { value: null, text, ok: true, note: 'レシピの項目には無い（トーンと DR は Dレンジ優先で自動になる）' });
  }

  // グレイン（ラフネス）・サイズ
  if (f.grainRoughness != null) {
    const g = GRAIN[f.grainRoughness];
    if (g) add('grain', 'グレイン・エフェクト', { value: g, text: X.labelOf(X.EFFECT_LEVELS, g) });
    else ng('grain', 'グレイン・エフェクト', { 16: '弱・小', 48: '強・小' }[f.grainRoughness] ?? String(f.grainRoughness));
  }
  if (f.grainSize) ng('grainSize', 'グレインサイズ', { 16: '小', 32: '大' }[f.grainSize] ?? String(f.grainSize));
  if (f.colorChrome != null) {
    const c = COLOR_CHROME[f.colorChrome];
    if (c) add('colorChrome', 'カラークローム・エフェクト', { value: c, text: X.labelOf(X.EFFECT_LEVELS, c) });
    else ng('colorChrome', 'カラークローム・エフェクト', String(f.colorChrome));
  }
  if (f.colorChromeBlue) ng('colorChromeBlue', 'カラークローム・ブルー', { 32: '弱', 64: '強' }[f.colorChromeBlue] ?? String(f.colorChromeBlue));

  // WB
  if (f.whiteBalance != null) {
    const w = WHITE_BALANCE[f.whiteBalance];
    if (w?.id === 'kelvin') {
      const k = f.colorTemperature, R = X.RANGES.kelvin;
      const ok = Number.isInteger(k) && k >= R.min && k <= R.max;
      add('wb', 'ホワイトバランス', { value: { mode: 'kelvin', kelvin: ok ? Math.round(k / R.step) * R.step : null }, text: k ? `${k}K` : '色温度（値なし）', ok, note: ok ? null : 'X-T3では設定できない色温度' });
    } else if (w?.id) {
      const note = ['shade', 'fluorescent1', 'fluorescent2', 'fluorescent3'].includes(w.id) ? '【要確認】記録値の対応' : null;
      add('wb', 'ホワイトバランス', { value: { mode: w.id, kelvin: null }, text: X.labelOf(X.WB_MODES, w.id) + (f.colorTemperature ? `（${f.colorTemperature}K）` : ''), note });
    } else ng('wb', 'ホワイトバランス', w?.name ?? `不明（${hex(f.whiteBalance)}）`);
  }
  if (Array.isArray(f.wbFineTune) && f.wbFineTune.length >= 2) {
    const [rr, bb] = f.wbFineTune;
    const d = WB_SHIFT.divisor, r = rr / d, b = bb / d, R = X.RANGES.wbShift;
    const ok = [r, b].every((v) => Number.isInteger(v) && v >= R.min && v <= R.max);
    add('wbShift', 'WBシフト', { value: ok ? { r, b } : null, text: ok ? `R${X.signed(r)} B${X.signed(b)}` : `記録値 R ${rr} / B ${bb}`, ok,
      note: `${WB_SHIFT.confirmed ? '' : '【要確認】換算（記録値 ÷ ' + d + '）を実機で未確認。'}記録値 R ${rr} / B ${bb}`, raw: [rr, bb] });
  }

  // トーン（表示値 = -記録値 / 16。X-T3 は整数のみ）
  for (const [key, label, tag] of [['highlight', 'ハイライトトーン', 'highlightTone'], ['shadow', 'シャドウトーン', 'shadowTone']]) {
    const v = toneOf(f[tag]);
    if (v == null) continue;
    const R = X.RANGES[key];
    const ok = Number.isInteger(v) && v >= R.min && v <= R.max;
    add(key, label, { value: ok ? v : null, text: X.signed(v), ok, note: ok ? null : Number.isInteger(v) ? 'X-T3では設定できない値' : 'X-T3では設定できない（0.5 刻み）' });
  }

  // カラー（モノクロ系では記録されない）
  if (!mono && f.saturation != null) {
    const c = SATURATION_COLOR[f.saturation];
    if (c != null) add('color', 'カラー', { value: c, text: X.signed(c) });
    else ng('color', 'カラー', `不明（${hex(f.saturation)}）`);
  }
  if (f.sharpness != null) {
    const s = SHARPNESS[f.sharpness];
    if (s != null) add('sharpness', 'シャープネス', { value: s, text: X.signed(s) });
    else ng('sharpness', 'シャープネス', `不明（${hex(f.sharpness)}）`);
  }
  if (f.noiseReduction != null) {
    const n = NOISE_REDUCTION[f.noiseReduction];
    if (n != null) add('nr', 'ノイズリダクション', { value: n, text: X.signed(n) });
    else ng('nr', 'ノイズリダクション', `不明（${hex(f.noiseReduction)}）`);
  }
  if (f.clarity) ng('clarity', '明瞭度（クラリティ）', X.signed(f.clarity / 1000));
  return items;
}

/* ---- 撮影情報 ---- */

/** 1/250 / 2s のような SS 表記 */
export function formatShutter(t) {
  if (!(t > 0)) return null;
  if (t >= 1) return `${Math.round(t * 10) / 10}s`;
  return `1/${Math.round(1 / t)}`;
}

/** 撮影情報（機種・レンズ・焦点距離・SS・F 値・ISO・露出補正・撮影日時）を { label, text } の配列で */
export function shotInfo(e) {
  const out = [];
  const push = (label, text) => { if (text != null && text !== '') out.push({ label, text }); };
  push('機種', [e.make && !String(e.model || '').toUpperCase().startsWith(String(e.make).toUpperCase()) ? e.make : null, e.model].filter(Boolean).join(' ') || null);
  push('レンズ', e.lens);
  if (e.focalLength) push('焦点距離', `${Math.round(e.focalLength * 10) / 10}mm${e.focal35 ? `（35mm 換算 ${e.focal35}mm）` : ''}`);
  push('シャッタースピード', formatShutter(e.exposureTime));
  if (e.fNumber) push('F 値', `F${Math.round(e.fNumber * 10) / 10}`);
  if (e.iso) push('ISO', String(e.iso));
  if (e.exposureBias != null) {
    const v = Math.round(e.exposureBias * 100) / 100;
    push('露出補正', `${v > 0 ? '+' : v < 0 ? '−' : '±'}${Math.abs(v).toFixed(1)}EV`);
  }
  if (e.dateTime) push('撮影日時', e.dateTime.replace(/^(\d{4}):(\d{2}):(\d{2})/, '$1-$2-$3') + (e.offset ? ` ${e.offset}` : ''));
  return out;
}

export const isXT3 = (e) => /^X-T3$/i.test(String(e?.model || '').trim());

/**
 * 読み取った設定 → 保存できるレシピ（xt3.js の範囲に収める）と、X-T3 では設定できなかった項目
 * @returns {{ recipe, skipped: string[], unconfirmed: string[] }}
 */
export function recipeFromJpeg(e) {
  const items = decodeFuji(e?.fuji);
  const r = X.defaultRecipe();
  const skipped = [], unconfirmed = [];
  const by = Object.fromEntries(items.map((it) => [it.key, it]));
  for (const it of items) {
    if (!it.ok) { skipped.push(`${it.label} ${it.text}`); continue; }
    if (it.note?.includes('【要確認】')) unconfirmed.push(`${it.label}: ${it.note.replace(/^【要確認】/, '')}`);
  }
  if (by.filmSim?.ok) r.filmSim = by.filmSim.value;
  const mono = X.isMono(r.filmSim);
  r.monoFilter = mono ? (by.monoFilter?.value ?? 'none') : null;
  r.monoWC = mono ? (by.monoWC?.ok ? by.monoWC.value : 0) : null;
  for (const k of ['dr', 'grain', 'colorChrome', 'highlight', 'shadow', 'color', 'sharpness', 'nr']) if (by[k]?.ok && by[k].value != null) r[k] = by[k].value;
  if (by.wb?.ok) r.wb = { ...by.wb.value };
  if (r.wb.mode !== 'kelvin') r.wb.kelvin = null;
  if (by.wbShift?.ok) r.wbShift = { ...by.wbShift.value };
  if (!X.hasColor(r.filmSim)) r.color = 0;
  r.source = 'jpeg';
  if (e?.iso) r.isoNote = `ISO ${e.iso}`;
  if (e?.exposureBias != null) r.exposureNote = formatEV(e.exposureBias);
  return { recipe: r, skipped, unconfirmed };
}

/** レシピのメモに入れる撮影情報（GPS は含まない） */
export function notesFromJpeg(e, { skipped = [], unconfirmed = [] } = {}) {
  const lines = ['JPEG に記録された実際の設定（EXIF / 富士フイルム MakerNote から読み取り）。', '', '撮影情報:'];
  for (const s of shotInfo(e)) lines.push(`・${s.label}: ${s.text}`);
  if (skipped.length) lines.push('', 'X-T3では設定できない項目（既定値で保存）:', ...skipped.map((s) => `・${s}`));
  if (unconfirmed.length) lines.push('', '【要確認】の項目:', ...unconfirmed.map((s) => `・${s}`));
  return lines.join('\n');
}

/** File / Blob の先頭（EXIF は最大 64KB の APP1 に入る）だけを読んで解析する。画像データは読まない */
export async function readExifFromFile(file, maxBytes = 262_144) {
  const head = await file.slice(0, maxBytes).arrayBuffer();
  return readExif(head);
}
