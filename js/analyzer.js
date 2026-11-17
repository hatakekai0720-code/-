// ① 画像解析。入力は RGBA のピクセル配列（Canvas の ImageData.data）。
// DOM に依存しないので Node でも数値テストできる（tests/analyzer.test.mjs）。
// 解析結果は数値だけを返し、画像そのものはどこにも保存しない。

export const ANALYZE_MAX_EDGE = 800;
export const CLIP = { black: 2, white: 253 }; // 輝度がこの値以下 / 以上を黒つぶれ / 白飛びとみなす

// sRGB (0-255) → リニア
const LIN = new Float32Array(256);
for (let i = 0; i < 256; i++) { const c = i / 255; LIN[i] = c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; }
const toSrgb = (l) => Math.round(255 * (l <= 0.0031308 ? 12.92 * l : 1.055 * l ** (1 / 2.4) - 0.055));

const f = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
/** リニア RGB → CIE Lab (D65) */
export function linToLab(r, g, b) {
  const x = (0.4124564 * r + 0.3575761 * g + 0.1804375 * b) / 0.95047;
  const y = 0.2126729 * r + 0.7151522 * g + 0.072175 * b;
  const z = (0.0193339 * r + 0.119192 * g + 0.9503041 * b) / 1.08883;
  const fx = f(x), fy = f(y), fz = f(z);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}
export const rgbToLab = (r, g, b) => linToLab(LIN[r], LIN[g], LIN[b]);

// 色相角（Lab の atan2(b*, a*)、度）→ 色名
const HUE_NAMES = [
  [20, 'マゼンタ'], [45, 'レッド'], [75, 'オレンジ'], [92, 'アンバー'], [115, 'イエロー'],
  [160, 'グリーン'], [215, null /* 明るさでティール / シアン */], [250, 'シアン'], [312, 'ブルー'], [325, 'パープル'], [360, 'マゼンタ'],
];
export const CAST_STRENGTH = [[3, 'なし'], [8, '弱'], [18, '中'], [Infinity, '強']]; // 彩度 C* の上限 → 強さ

export function describeCast(L, a, b) {
  const chroma = Math.hypot(a, b);
  const hue = (Math.atan2(b, a) * 180 / Math.PI + 360) % 360;
  const strength = CAST_STRENGTH.find(([max]) => chroma < max)[1];
  let name = HUE_NAMES.find(([max]) => hue < max)[1];
  if (name === null) name = L < 60 ? 'ティール' : 'シアン';
  if (strength === 'なし') name = 'ニュートラル';
  return { name, strength, hue, chroma };
}

function percentile(hist, total, p) {
  const target = total * p;
  let acc = 0;
  for (let i = 0; i < 256; i++) { acc += hist[i]; if (acc >= target && acc > 0) return i; }
  return 255;
}

/**
 * @param {Uint8ClampedArray|Uint8Array} data RGBA
 * @returns 解析結果（数値のみ）
 */
export function analyze(data, width, height) {
  const n = width * height;
  if (!n || data.length < n * 4) throw new Error('画像データが空です');
  const histR = new Uint32Array(256), histG = new Uint32Array(256), histB = new Uint32Array(256), histL = new Uint32Array(256);
  const lum = new Uint8Array(n);
  let sumChroma = 0, sumSatHsv = 0, skin = 0, sumLum = 0, sumLum2 = 0;
  const all = [0, 0, 0];

  for (let i = 0, p = 0; i < n; i++, p += 4) {
    const r = data[p], g = data[p + 1], b = data[p + 2];
    histR[r]++; histG[g]++; histB[b]++;
    const y = Math.round(0.2126 * r + 0.7152 * g + 0.0722 * b);
    lum[i] = y; histL[y]++; sumLum += y; sumLum2 += y * y;
    const rl = LIN[r], gl = LIN[g], bl = LIN[b];
    all[0] += rl; all[1] += gl; all[2] += bl;
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
    sumSatHsv += mx ? (mx - mn) / mx : 0;
    if (mx === mn) continue; // 無彩色は彩度 0
    const [L, a, bb] = linToLab(rl, gl, bl);
    const c = Math.hypot(a, bb);
    sumChroma += c;
    // 肌色域のおおまかな判定（Lab の色相 35〜75°、中程度の彩度と明るさ）
    if (c >= 12 && c <= 45 && L >= 30 && L <= 88) {
      const hue = Math.atan2(bb, a) * 180 / Math.PI;
      if (hue >= 35 && hue <= 75) skin++;
    }
  }

  const pct = (p) => percentile(histL, n, p);
  const p5 = pct(0.05), p25 = pct(0.25), p50 = pct(0.5), p75 = pct(0.75), p95 = pct(0.95);

  // シャドウ = 輝度下位 25%、ハイライト = 上位 25%
  const sh = [0, 0, 0, 0], hi = [0, 0, 0, 0];
  for (let i = 0, p = 0; i < n; i++, p += 4) {
    const y = lum[i];
    if (y <= p25) { sh[0] += LIN[data[p]]; sh[1] += LIN[data[p + 1]]; sh[2] += LIN[data[p + 2]]; sh[3]++; }
    if (y >= p75) { hi[0] += LIN[data[p]]; hi[1] += LIN[data[p + 1]]; hi[2] += LIN[data[p + 2]]; hi[3]++; }
  }
  const zone = (s, count) => {
    const lin = [s[0] / count, s[1] / count, s[2] / count];
    const [L, a, b] = linToLab(...lin);
    return { L, a, b, rgb: lin.map(toSrgb), ...describeCast(L, a, b) };
  };

  let clipB = 0, clipW = 0;
  for (let i = 0; i <= CLIP.black; i++) clipB += histL[i];
  for (let i = CLIP.white; i < 256; i++) clipW += histL[i];
  const mean = sumLum / n;

  return {
    width, height, pixels: n,
    hist: { r: histR, g: histG, b: histB, l: histL },
    clipBlack: clipB / n * 100, clipWhite: clipW / n * 100,
    p5, p50, p95,
    contrast: p95 - p5,                                  // コントラスト指標（0〜255）
    lumaStd: Math.sqrt(Math.max(0, sumLum2 / n - mean * mean)),
    meanLuma: mean,
    chroma: sumChroma / n,                               // 平均彩度（Lab C*）
    saturation: sumSatHsv / n * 100,                     // 平均彩度（HSV S, %）
    skinRatio: skin / n,
    shadows: zone(sh, sh[3]),
    highlights: zone(hi, hi[3]),
    overall: zone(all, n),
  };
}

/** 長辺を ANALYZE_MAX_EDGE に収めたサイズ */
export function fitSize(w, h, max = ANALYZE_MAX_EDGE) {
  const s = Math.min(1, max / Math.max(w, h));
  return { width: Math.max(1, Math.round(w * s)), height: Math.max(1, Math.round(h * s)) };
}
