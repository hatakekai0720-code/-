// ① 画像解析。入力は RGBA のピクセル配列（Canvas の ImageData.data）。
// DOM に依存しないので Node でも数値テストできる（tests/analyzer.test.mjs）。
// 解析結果は数値だけを返し、画像そのものはどこにも保存しない。

export const ANALYZE_MAX_EDGE = 800; // 表示用プレビューの長辺（解析そのものは全ピクセルで行う）
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
 * 統計の累積器。画像を帯（タイル）に分けて順に add() し、最後に result() で解析結果を得る。
 * ピクセルを保持しないので、26MP の画像でもメモリは一定（輝度ビンごとのリニア RGB 合計を持つことで、
 * シャドウ / ハイライト（輝度の下位・上位 25%）の平均色も 1 パスで正確に出せる）。
 */
export class Accumulator {
  constructor() {
    this.n = 0;
    this.histR = new Uint32Array(256); this.histG = new Uint32Array(256); this.histB = new Uint32Array(256); this.histL = new Uint32Array(256);
    this.binLin = new Float64Array(256 * 3); // 輝度ビンごとのリニア RGB 合計
    this.sumChroma = 0; this.sumSatHsv = 0; this.skin = 0; this.sumLum = 0; this.sumLum2 = 0; this.sumA = 0; this.sumB = 0;
    // 代表色用: RGB を各 4bit に量子化した 4096 ビンの件数と sRGB 合計
    this.cbin = new Uint32Array(4096); this.cbinSum = new Float64Array(4096 * 3);
  }

  /** @param {Uint8ClampedArray|Uint8Array} data RGBA。count を省略すると data 全体 */
  add(data, count = data.length >> 2) {
    const { histR, histG, histB, histL, binLin, cbin, cbinSum } = this;
    let sumChroma = 0, sumSatHsv = 0, skin = 0, sumLum = 0, sumLum2 = 0, sumA = 0, sumB = 0;
    for (let i = 0, p = 0; i < count; i++, p += 4) {
      const r = data[p], g = data[p + 1], b = data[p + 2];
      histR[r]++; histG[g]++; histB[b]++;
      const y = Math.round(0.2126 * r + 0.7152 * g + 0.0722 * b);
      histL[y]++; sumLum += y; sumLum2 += y * y;
      const rl = LIN[r], gl = LIN[g], bl = LIN[b];
      const k = y * 3;
      binLin[k] += rl; binLin[k + 1] += gl; binLin[k + 2] += bl;
      const ci = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4), ck = ci * 3;
      cbin[ci]++; cbinSum[ck] += r; cbinSum[ck + 1] += g; cbinSum[ck + 2] += b;
      const mx = r > g ? (r > b ? r : b) : (g > b ? g : b), mn = r < g ? (r < b ? r : b) : (g < b ? g : b);
      if (mx === mn) continue; // 無彩色は彩度 0
      sumSatHsv += (mx - mn) / mx;
      const [L, a, bb] = linToLab(rl, gl, bl);
      const c = Math.hypot(a, bb);
      sumChroma += c; sumA += a; sumB += bb;
      // 肌色域のおおまかな判定（Lab の色相 35〜75°、中程度の彩度と明るさ）
      if (c >= 12 && c <= 45 && L >= 30 && L <= 88) {
        const hue = Math.atan2(bb, a) * 180 / Math.PI;
        if (hue >= 35 && hue <= 75) skin++;
      }
    }
    this.n += count;
    this.sumChroma += sumChroma; this.sumSatHsv += sumSatHsv; this.skin += skin;
    this.sumLum += sumLum; this.sumLum2 += sumLum2; this.sumA += sumA; this.sumB += sumB;
    return this;
  }

  /** 累積した統計から解析結果（数値のみ）を作る。width / height は表示用 */
  result(width, height) {
    const { n, histL, binLin } = this;
    if (!n) throw new Error('画像データが空です');
    const pct = (p) => percentile(histL, n, p);
    const p5 = pct(0.05), p25 = pct(0.25), p50 = pct(0.5), p75 = pct(0.75), p95 = pct(0.95);

    // シャドウ = 輝度 p25 以下、ハイライト = p75 以上、全体 = すべてのビン
    const zoneSum = (from, to) => {
      const s = [0, 0, 0, 0];
      for (let y = from; y <= to; y++) { s[0] += binLin[y * 3]; s[1] += binLin[y * 3 + 1]; s[2] += binLin[y * 3 + 2]; s[3] += histL[y]; }
      return s;
    };
    const zone = (s) => {
      const lin = [s[0] / s[3], s[1] / s[3], s[2] / s[3]];
      const [L, a, b] = linToLab(...lin);
      return { L, a, b, rgb: lin.map(toSrgb), ...describeCast(L, a, b) };
    };

    let clipB = 0, clipW = 0;
    for (let i = 0; i <= CLIP.black; i++) clipB += histL[i];
    for (let i = CLIP.white; i < 256; i++) clipW += histL[i];
    const mean = this.sumLum / n;
    const { sumChroma, sumA, sumB } = this;

    return {
      width, height, pixels: n,
      hist: { r: this.histR, g: this.histG, b: this.histB, l: histL },
      clipBlack: clipB / n * 100, clipWhite: clipW / n * 100,
      p5, p50, p95,
      contrast: p95 - p5,                                  // コントラスト指標（0〜255）
      lumaStd: Math.sqrt(Math.max(0, this.sumLum2 / n - mean * mean)),
      meanLuma: mean,
      chroma: sumChroma / n,                               // 平均彩度（Lab C*）
      saturation: this.sumSatHsv / n * 100,                // 平均彩度（HSV S, %）
      skinRatio: this.skin / n,
      // 色相のそろい具合（0〜1）。1 に近いほど画像全体が 1 色に染まっている（セピア調・調色モノクロ）
      hueConsistency: sumChroma > 0 ? Math.hypot(sumA, sumB) / sumChroma : 0,
      meanA: sumA / n, meanB: sumB / n,
      meanHue: (Math.atan2(sumB, sumA) * 180 / Math.PI + 360) % 360,
      shadows: zone(zoneSum(0, p25)),
      highlights: zone(zoneSum(p75, 255)),
      overall: zone(zoneSum(0, 255)),
      palette: dominantColors(this.cbin, this.cbinSum, 5), // 代表色（'#rrggbb'、多い順）
    };
  }
}

const hex2 = (v) => Math.round(v).toString(16).padStart(2, '0');
/**
 * 代表色: 量子化したビンを多い順に見て、すでに選んだ色と Lab で離れている色だけを採る（似た色ばかりにならないように）。
 * 離れた色が足りなければ距離の条件をゆるめて、count 色になるまで足す。
 */
export function dominantColors(cbin, cbinSum, count = 5) {
  const order = [];
  for (let i = 0; i < cbin.length; i++) if (cbin[i]) order.push(i);
  order.sort((a, b) => cbin[b] - cbin[a]);
  const avg = (i) => [cbinSum[i * 3] / cbin[i], cbinSum[i * 3 + 1] / cbin[i], cbinSum[i * 3 + 2] / cbin[i]];
  const lab = (c) => linToLab(LIN[Math.round(c[0])], LIN[Math.round(c[1])], LIN[Math.round(c[2])]);
  const picked = [];
  for (const minDist of [24, 14, 6, 0]) {
    for (const i of order.slice(0, 600)) {
      if (picked.length >= count) break;
      if (picked.some((p) => p.i === i)) continue;
      const c = avg(i), L = lab(c);
      if (picked.every((p) => Math.hypot(p.L[0] - L[0], p.L[1] - L[1], p.L[2] - L[2]) >= minDist)) picked.push({ i, c, L });
    }
    if (picked.length >= count) break;
  }
  return picked.map((p) => `#${p.c.map(hex2).join('')}`);
}

/**
 * @param {Uint8ClampedArray|Uint8Array} data RGBA
 * @returns 解析結果（数値のみ）
 */
export function analyze(data, width, height) {
  const n = width * height;
  if (!n || data.length < n * 4) throw new Error('画像データが空です');
  return new Accumulator().add(data, n).result(width, height);
}

/* ---- 全ピクセル解析（タイル分割） ---- */

// iOS Safari の Canvas は面積 16,777,216px（4096²）が上限で、端末によってはもっと小さい。
// 余裕を見て 1 タイル 4MP・一辺 4096px までに収める。
export const TILE_MAX_AREA = 4_194_304;
export const TILE_MAX_EDGE = 4096;

/** 画像をタイル（横帯。幅が広すぎるときは縦にも分割）に分ける。各タイルは {x, y, w, h} */
export function tilePlan(width, height, maxArea = TILE_MAX_AREA, maxEdge = TILE_MAX_EDGE) {
  if (!(width > 0 && height > 0)) throw new Error('画像サイズが不正です');
  const tw = Math.min(width, maxEdge);
  const th = Math.max(1, Math.min(height, maxEdge, Math.floor(maxArea / tw)));
  const tiles = [];
  for (let y = 0; y < height; y += th) for (let x = 0; x < width; x += tw) tiles.push({ x, y, w: Math.min(tw, width - x), h: Math.min(th, height - y) });
  return tiles;
}

export class AbortError extends Error { constructor() { super('キャンセルしました'); this.name = 'AbortError'; } }

/**
 * 全ピクセルをタイルごとに読み込んで解析する（DOM 非依存）。
 * @param {(x:number, y:number, w:number, h:number) => (Uint8ClampedArray|Promise<Uint8ClampedArray>)} read タイルの RGBA を返す
 * @param {object} [opt]
 * @param {(done:number, total:number) => void} [opt.onProgress] 解析済みピクセル数
 * @param {{aborted:boolean}} [opt.signal] AbortSignal など。true になったら AbortError
 * @param {() => Promise<void>} [opt.yieldFn] タイルごとに呼ぶ（メインスレッドで描画を譲るため）
 */
export async function analyzeTiled(read, width, height, opt = {}) {
  const { onProgress, signal, yieldFn, maxArea, maxEdge } = opt;
  const acc = new Accumulator();
  const total = width * height;
  let done = 0;
  onProgress?.(0, total);
  for (const t of tilePlan(width, height, maxArea, maxEdge)) {
    if (signal?.aborted) throw new AbortError();
    const data = await read(t.x, t.y, t.w, t.h);
    if (signal?.aborted) throw new AbortError();
    acc.add(data, t.w * t.h);
    done += t.w * t.h;
    onProgress?.(done, total);
    if (yieldFn) await yieldFn();
  }
  return acc.result(width, height);
}

/** Canvas 2D コンテキストを使うタイル読み込み関数（Worker の OffscreenCanvas / メインスレッドの canvas 共通） */
export function canvasReader(source, makeCanvas) {
  let canvas = null, g = null;
  return (x, y, w, h) => {
    if (!canvas || canvas.width < w || canvas.height < h) {
      canvas = makeCanvas(w, h);
      g = canvas.getContext('2d', { willReadFrequently: true });
    }
    g.clearRect(0, 0, w, h);
    // ソース矩形で必要な範囲だけを等倍で描く（縮小しない）
    g.drawImage(source, x, y, w, h, 0, 0, w, h);
    return g.getImageData(0, 0, w, h).data;
  };
}

/** 長辺を ANALYZE_MAX_EDGE に収めたサイズ */
export function fitSize(w, h, max = ANALYZE_MAX_EDGE) {
  const s = Math.min(1, max / Math.max(w, h));
  return { width: Math.max(1, Math.round(w * s)), height: Math.max(1, Math.round(h * s)) };
}
