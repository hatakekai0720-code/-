// ① 画像解析。入力は RGBA のピクセル配列（Canvas の ImageData.data）。
// DOM に依存しないので Node でも数値テストできる（tests/analyzer.test.mjs）。
// 解析結果は数値だけを返し、画像そのものはどこにも保存しない。

export const ANALYZE_MAX_EDGE = 800; // 表示用プレビューの長辺（解析そのものは全ピクセルで行う）

// 解析のしきい値。調整したいときはここだけを書き換える（輝度はすべて 0〜255）
export const RULES = {
  // 黒つぶれ（真っ黒）/ 白飛び（真っ白）とみなす輝度。この値以下 / 以上
  clip: { black: 2, white: 253 },
  // 映画のスクショの黒帯（レターボックス / ピラーボックス）の自動検出。
  // 端から連続して「ほぼ黒で均一」な行・列を黒帯とみなす。
  //   maxMean: 行（列）の平均輝度がこれ以下 / pixelMax: 各画素の輝度がこれ以下の画素が
  //   minDarkShare 以上を占める / minSize〜maxSize: 黒帯の太さ（辺の長さに対する割合）がこの範囲のときだけ採用
  //   （細すぎるのは縁取り、太すぎるのは暗い画像そのもの）
  bars: { maxMean: 12, pixelMax: 24, minDarkShare: 0.98, minSize: 0.01, maxSize: 0.35 },
  // 暗部 / 明部の割合: 輝度がこの値以下 / 以上の画素（見た目の「暗い」「明るい」の目安。真っ黒・真っ白とは別）
  dark: 64, bright: 192,
  // 黒の浮き: p5（暗いほうから 5% の輝度）がこの値以上なら「黒が浮いている」
  blackLift: 15,
  // 露出の目安: 明るさの中央値（p50）をリニアにして、中間グレー（18%）と比べた EV 差
  midGray: 0.18,
  // 光源: 輝度の上位 top（2%）かつ輝度 minLuma 以上の画素。看板・ネオンなど、面積は小さくても印象を決める色を拾う。
  //   同じ輝度の画素が多くて上位 maxRatio を超えるとき（単色に近い画像）は、しきい値より明るい画素だけにする
  light: { top: 0.02, minLuma: 128, maxRatio: 0.1 },
  // 粒状感とシャープさ（質感）。画像を block×block 画素のブロックに分け、ブロックごとに輝度を見る
  //   minLuma〜maxLuma: ブロックの平均輝度がこの範囲のブロックだけ使う（真っ黒・真っ白では粒子が消えるため）
  //   平坦なブロック: 4 つの小ブロック（4×4）の平均の差が flatBase + flatK × そのブロックのノイズ σ 未満。
  //     粒状感 = 平坦なブロックの高周波成分（2 次差分の絶対値の平均 ÷ 1.954 = ガウスノイズなら σ に一致）の中央値
  //   エッジのブロック: 小ブロックの平均の差が edgeQuad 以上で、輝度の幅（最大−最小）が edgeRange 以上。
  //     シャープさ = エッジのブロックの「隣の画素との差の最大 ÷ 輝度の幅」の中央値（くっきりした段差ほど 1 に近い）
  //   確度を下げる条件: 長辺 minLongEdge px 未満 / 平坦なブロックの 8px 境目の段差が内側の maxBlockiness 倍以上で、
  //     差が平均 minBlockStep 以上（強い JPEG 圧縮のブロックノイズ）/
  //     平坦なブロックが minFlat 未満・エッジのブロックが minEdge 未満
  texture: { block: 8, minLuma: 16, maxLuma: 240, flatBase: 4, flatK: 0.8, edgeQuad: 24, edgeRange: 40,
    minLongEdge: 1000, maxBlockiness: 1.35, minBlockStep: 0.5, minFlat: 30, minEdge: 20 },
};
export const CLIP = RULES.clip; // 互換のため（輝度がこの値以下 / 以上を黒つぶれ / 白飛びとみなす）

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
    this.binC = new Float64Array(256); // 輝度ビンごとの彩度 C* の合計（光源以外の彩度を出すため）
    this.sumChroma = 0; this.sumSatHsv = 0; this.skin = 0; this.sumLum = 0; this.sumLum2 = 0; this.sumA = 0; this.sumB = 0;
    // 代表色用: RGB を各 4bit に量子化した 4096 ビンの件数と sRGB 合計
    this.cbin = new Uint32Array(4096); this.cbinSum = new Float64Array(4096 * 3);
    this.texture = new TextureAccumulator(); // 粒状感・シャープさ（addRegion で足したときだけ）
  }

  /** @param {Uint8ClampedArray|Uint8Array} data RGBA。count を省略すると data 全体 */
  add(data, count = data.length >> 2) { return this.addSpan(data, 0, count); }

  /**
   * タイル（全体画像の (tx, ty) から tw×th）のうち、除外範囲 rects（全体画像のピクセル座標 {x0, y0, x1, y1}、x1/y1 は含まない）
   * に入らない画素だけを足す。
   */
  addRegion(data, tx, ty, tw, th, rects) {
    this.texture.add(data, tx, ty, tw, th, rects);
    if (!rects?.length) return this.addSpan(data, 0, tw * th);
    for (let r = 0; r < th; r++) {
      const y = ty + r;
      // この行にかかる除外区間（タイル内の x）をまとめる
      const cut = [];
      for (const q of rects) if (y >= q.y0 && y < q.y1 && q.x1 > tx && q.x0 < tx + tw) cut.push([Math.max(0, q.x0 - tx), Math.min(tw, q.x1 - tx)]);
      cut.sort((p, q) => p[0] - q[0]);
      let x = 0;
      for (const [c0, c1] of cut) { if (c0 > x) this.addSpan(data, r * tw + x, r * tw + c0); if (c1 > x) x = c1; }
      if (x < tw) this.addSpan(data, r * tw + x, r * tw + tw);
    }
    return this;
  }

  /** 画素番号 from〜to（to は含まない）を足す */
  addSpan(data, from, to) {
    const { histR, histG, histB, histL, binLin, binC, cbin, cbinSum } = this;
    let sumChroma = 0, sumSatHsv = 0, skin = 0, sumLum = 0, sumLum2 = 0, sumA = 0, sumB = 0;
    for (let i = from, p = from * 4; i < to; i++, p += 4) {
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
      sumChroma += c; sumA += a; sumB += bb; binC[y] += c;
      // 肌色域のおおまかな判定（Lab の色相 35〜75°、中程度の彩度と明るさ）
      if (c >= 12 && c <= 45 && L >= 30 && L <= 88) {
        const hue = Math.atan2(bb, a) * 180 / Math.PI;
        if (hue >= 35 && hue <= 75) skin++;
      }
    }
    this.n += to - from;
    this.sumChroma += sumChroma; this.sumSatHsv += sumSatHsv; this.skin += skin;
    this.sumLum += sumLum; this.sumLum2 += sumLum2; this.sumA += sumA; this.sumB += sumB;
    return this;
  }

  /** 累積した統計から解析結果（数値のみ）を作る。width / height は表示用 */
  result(width, height) {
    const { n, histL, binLin } = this;
    if (!n) throw new Error('画像データが空です');
    const totalPixels = width * height || n;
    const pct = (p) => percentile(histL, n, p);
    const p1 = pct(0.01), p5 = pct(0.05), p25 = pct(0.25), p50 = pct(0.5), p75 = pct(0.75), p95 = pct(0.95), p98 = pct(1 - RULES.light.top);

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

    const count = (from, to) => { let c = 0; for (let y = from; y <= to; y++) c += histL[y]; return c; };

    // 光源: 上位 2% かつ輝度 128 以上。無ければ null
    const LR = RULES.light;
    let lt = Math.max(p98, LR.minLuma);
    if (count(lt, 255) / n > LR.maxRatio) lt += 1;
    const lightN = lt <= 255 ? count(lt, 255) : 0;
    let lightC = 0;
    for (let y = lt; y <= 255; y++) lightC += this.binC[y];
    const light = lightN ? { ...zone(zoneSum(lt, 255)), ratio: lightN / n, minLuma: lt } : null;
    if (light) light.label = light.name === 'ニュートラル' ? '白（色なし）' : `${light.name}系`;

    let clipB = 0, clipW = 0;
    for (let i = 0; i <= RULES.clip.black; i++) clipB += histL[i];
    for (let i = RULES.clip.white; i < 256; i++) clipW += histL[i];
    const mean = this.sumLum / n;
    const { sumChroma, sumA, sumB } = this;

    return {
      width, height, pixels: n,                            // 解析した画素数（除外した範囲を除く）
      totalPixels, excludedRatio: Math.max(0, 1 - n / totalPixels), // 画像全体の画素数と、除外した割合（0〜1）
      hist: { r: this.histR, g: this.histG, b: this.histB, l: histL },
      clipBlack: clipB / n * 100, clipWhite: clipW / n * 100,
      p1, p5, p25, p50, p75, p95,
      contrast: p95 - p5,                                  // コントラスト指標（0〜255）
      darkRatio: count(0, RULES.dark) / n,                 // 暗部（輝度 64 以下）の割合（0〜1）
      brightRatio: count(RULES.bright, 255) / n,           // 明部（輝度 192 以上）の割合（0〜1）
      blackLift: p5 >= RULES.blackLift,                    // 黒が浮いている（p5 が 15 以上）
      exposureEV: Math.log2(Math.max(LIN[p50], 1e-4) / RULES.midGray), // 露出の目安（中央値と中間グレーの EV 差）
      lumaStd: Math.sqrt(Math.max(0, this.sumLum2 / n - mean * mean)),
      meanLuma: mean,
      chroma: sumChroma / n,                               // 平均彩度（Lab C*）
      chromaNonLight: n - lightN ? (sumChroma - lightC) / (n - lightN) : 0, // 光源以外の平均彩度
      saturation: this.sumSatHsv / n * 100,                // 平均彩度（HSV S, %）
      skinRatio: this.skin / n,
      // 色相のそろい具合（0〜1）。1 に近いほど画像全体が 1 色に染まっている（セピア調・調色モノクロ）
      hueConsistency: sumChroma > 0 ? Math.hypot(sumA, sumB) / sumChroma : 0,
      meanA: sumA / n, meanB: sumB / n,
      meanHue: (Math.atan2(sumB, sumA) * 180 / Math.PI + 360) % 360,
      shadows: zone(zoneSum(0, p25)),
      highlights: zone(zoneSum(p75, 255)),
      midtones: zone(zoneSum(p25, p75)),                   // 中間調（輝度 p25〜p75）。WB はここから決める
      overall: zone(zoneSum(0, 255)),
      light,                                               // 光源（上位 2% かつ輝度 128 以上）の平均色・面積。無ければ null
      palette: dominantColors(this.cbin, this.cbinSum, 5), // 代表色（'#rrggbb'、多い順）
      texture: this.texture.result(width, height),          // 粒状感・シャープさ（addRegion で足していなければ null）
    };
  }
}

/* ---- 粒状感とシャープさ ---- */

const GRAIN_BIN = 0.1, GRAIN_BINS = 600;   // ノイズ σ のヒストグラム（0〜60、0.1 刻み）
const SHARP_BINS = 100;                    // シャープさ（0〜1）のヒストグラム

function histMedian(hist, n) {
  if (!n) return null;
  let acc = 0;
  for (let i = 0; i < hist.length; i++) { acc += hist[i]; if (acc >= n / 2) return i; }
  return hist.length - 1;
}

/**
 * 質感（粒状感・シャープさ・JPEG 圧縮の強さ）の累積器。タイルごとに 8×8 のブロックを見て、ヒストグラムだけを残す。
 * ブロックは画像全体の座標で 8 の倍数に揃える（タイルの境目をまたぐブロックは使わない）。メモリはタイル 1 枚分の輝度だけ。
 */
export class TextureAccumulator {
  constructor() {
    this.grainHist = new Uint32Array(GRAIN_BINS); this.sharpHist = new Uint32Array(SHARP_BINS);
    this.flat = 0; this.edge = 0; this.blocks = 0;
    this.bdSum = 0; this.inSum = 0; this.bdN = 0; // 平坦なブロックの 8px 境目の段差 / 内側の段差 / 比べた組の数
    this.luma = null; this.used = false;
  }

  add(data, tx, ty, tw, th, rects) {
    const T = RULES.texture, B = T.block, n = tw * th;
    this.used = true;
    if (!this.luma || this.luma.length < n) this.luma = new Uint8Array(n);
    const L = this.luma;
    for (let i = 0, p = 0; i < n; i++, p += 4) L[i] = (0.2126 * data[p] + 0.7152 * data[p + 1] + 0.0722 * data[p + 2] + 0.5) | 0;
    const x0 = Math.ceil(tx / B) * B - tx, y0 = Math.ceil(ty / B) * B - ty;
    const q = new Float64Array(4);
    for (let by = y0; by + B <= th; by += B) {
      for (let bx = x0; bx + B <= tw; bx += B) {
        if (rects?.length) {
          const ax = tx + bx, ay = ty + by;
          if (rects.some((r) => ax < r.x1 && ax + B > r.x0 && ay < r.y1 && ay + B > r.y0)) continue;
        }
        let sum = 0, mn = 255, mx = 0, lap = 0, maxD = 0;
        q[0] = q[1] = q[2] = q[3] = 0;
        for (let y = 0; y < B; y++) {
          const row = (by + y) * tw + bx;
          for (let x = 0; x < B; x++) {
            const v = L[row + x];
            sum += v; if (v < mn) mn = v; if (v > mx) mx = v;
            q[(y >= B / 2 ? 2 : 0) + (x >= B / 2 ? 1 : 0)] += v;
            if (x + 1 < B) { const d = Math.abs(L[row + x + 1] - v); if (d > maxD) maxD = d; }
            if (y + 1 < B) { const d = Math.abs(L[row + tw + x] - v); if (d > maxD) maxD = d; }
            if (x > 0 && x < B - 1) lap += Math.abs(2 * v - L[row + x - 1] - L[row + x + 1]);
            if (y > 0 && y < B - 1) lap += Math.abs(2 * v - L[row - tw + x] - L[row + tw + x]);
          }
        }
        const mean = sum / (B * B);
        if (mean < T.minLuma || mean > T.maxLuma) continue;
        this.blocks++;
        const qa = 4 / (B * B);
        const qMax = Math.max(q[0], q[1], q[2], q[3]) * qa, qMin = Math.min(q[0], q[1], q[2], q[3]) * qa, quad = qMax - qMin;
        const sigma = lap / (2 * B * (B - 2)) / 1.954;
        if (quad < T.flatBase + T.flatK * sigma) {
          this.flat++;
          this.grainHist[Math.min(GRAIN_BINS - 1, Math.floor(sigma / GRAIN_BIN))]++;
          // JPEG のブロックノイズ: 右と下の 8px 境目の段差と、ブロック内側（4 列目 / 4 行目）の段差を比べる
          const h2 = B / 2;
          for (let k = 0; k < B; k++) {
            const row = (by + k) * tw + bx;
            if (bx + B < tw) { this.bdN++; this.bdSum += Math.abs(L[row + B] - L[row + B - 1]); this.inSum += Math.abs(L[row + h2] - L[row + h2 - 1]); }
            if (by + B < th) {
              const c = (by + B) * tw + bx + k, c1 = (by + B - 1) * tw + bx + k;
              const m = (by + h2) * tw + bx + k, m1 = (by + h2 - 1) * tw + bx + k;
              this.bdN++; this.bdSum += Math.abs(L[c] - L[c1]); this.inSum += Math.abs(L[m] - L[m1]);
            }
          }
        } else if (quad >= T.edgeQuad && mx - mn >= T.edgeRange) {
          this.edge++;
          this.sharpHist[Math.min(SHARP_BINS - 1, Math.floor(maxD / (mx - mn) * SHARP_BINS))]++;
        }
      }
    }
  }

  /** 解析結果: grain = ノイズ σ（輝度 0〜255）、sharpness = 0〜1、blockiness = 境目 ÷ 内側の段差、reliability = 確度と理由 */
  result(width, height) {
    if (!this.used) return null;
    const T = RULES.texture;
    const g = histMedian(this.grainHist, this.flat), sh = histMedian(this.sharpHist, this.edge);
    const grain = g == null ? null : (g + 0.5) * GRAIN_BIN;
    const sharpness = sh == null ? null : (sh + 0.5) / SHARP_BINS;
    // 内側の段差がほぼ 0（ブロックの中が平らに塗られた）でも比が出るよう、分母は 1 組あたり 0.25 を下限にする
    const blockiness = this.bdN ? this.bdSum / Math.max(this.inSum, 0.25 * this.bdN) : 1;
    const blockStep = this.bdN ? (this.bdSum - this.inSum) / this.bdN : 0; // 境目の段差が内側より平均どれだけ大きいか
    const longEdge = Math.max(width || 0, height || 0);
    const reasons = [];
    if (longEdge < T.minLongEdge) reasons.push(`解像度が低い（長辺 ${longEdge}px）ため、粒子とシャープさは参考程度`);
    const compressed = this.flat >= T.minFlat && blockiness >= T.maxBlockiness && blockStep >= T.minBlockStep;
    if (compressed) reasons.push('強い JPEG 圧縮のブロックノイズがあり、細かい粒子が残っていない可能性がある');
    if (this.flat < T.minFlat) reasons.push('平らな部分が少なく、粒子を測りにくい');
    if (this.edge < T.minEdge) reasons.push('はっきりした輪郭が少なく、シャープさを測りにくい');
    const level = !reasons.length ? '高' : reasons.length === 1 && longEdge >= T.minLongEdge ? '中' : '低';
    return { grain, sharpness, flatBlocks: this.flat, edgeBlocks: this.edge, blocks: this.blocks, blockiness, compressed, longEdge, reliability: { level, reasons } };
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

/* ---- 解析範囲（黒帯・字幕などの除外） ---- */

/**
 * 除外範囲。座標はすべて画像の幅・高さに対する割合（0〜1）なので、プレビュー（800px）と元画像で共通に使える。
 * @typedef {{ bars?: {top:number,bottom:number,left:number,right:number}, rects?: {x:number,y:number,w:number,h:number}[] }} Exclude
 */

/** 除外範囲を、width×height の画像のピクセル座標の長方形 {x0, y0, x1, y1}（x1/y1 は含まない）にする */
export function excludedRects(exclude, width, height) {
  if (!exclude) return [];
  const out = [];
  const push = (x0, y0, x1, y1) => {
    x0 = Math.max(0, Math.min(width, Math.round(x0))); x1 = Math.max(0, Math.min(width, Math.round(x1)));
    y0 = Math.max(0, Math.min(height, Math.round(y0))); y1 = Math.max(0, Math.min(height, Math.round(y1)));
    if (x1 > x0 && y1 > y0) out.push({ x0, y0, x1, y1 });
  };
  const b = exclude.bars;
  if (b) {
    if (b.top > 0) push(0, 0, width, b.top * height);
    if (b.bottom > 0) push(0, height - b.bottom * height, width, height);
    if (b.left > 0) push(0, 0, b.left * width, height);
    if (b.right > 0) push(width - b.right * width, 0, width, height);
  }
  for (const r of exclude.rects || []) {
    const x0 = Math.min(r.x, r.x + r.w), x1 = Math.max(r.x, r.x + r.w), y0 = Math.min(r.y, r.y + r.h), y1 = Math.max(r.y, r.y + r.h);
    push(x0 * width, y0 * height, x1 * width, y1 * height);
  }
  return out;
}

/**
 * 上下左右の黒帯を検出する。返り値は各辺の黒帯の太さ（辺の長さに対する割合、0〜1）。
 * @param {object} [opt]
 * @param {number} [opt.pad] 検出した黒帯を何 px 太らせるか（縮小プレビューで検出したとき、境目のにじんだ行を本編に入れないため）
 */
export function detectBars(data, width, height, { pad = 0 } = {}) {
  const B = RULES.bars;
  const lumaAt = (x, y) => { const p = (y * width + x) * 4; return 0.2126 * data[p] + 0.7152 * data[p + 1] + 0.0722 * data[p + 2]; };
  const isBar = (count, get) => {
    let sum = 0, dark = 0;
    for (let i = 0; i < count; i++) { const v = get(i); sum += v; if (v <= B.pixelMax) dark++; }
    return sum / count <= B.maxMean && dark / count >= B.minDarkShare;
  };
  const run = (len, line) => { let k = 0; while (k < len && line(k)) k++; return k; };
  const accept = (k, len) => (k >= B.minSize * len && k <= B.maxSize * len ? Math.min(len, k + pad) / len : 0);
  const top = accept(run(height, (y) => isBar(width, (x) => lumaAt(x, y))), height);
  const bottom = accept(run(height, (k) => isBar(width, (x) => lumaAt(x, height - 1 - k))), height);
  // 左右は上下の黒帯を除いた範囲で見る（黒帯の中の字幕で途切れないように）
  const y0 = Math.round(top * height), y1 = height - Math.round(bottom * height), rows = Math.max(1, y1 - y0);
  const left = accept(run(width, (x) => isBar(rows, (i) => lumaAt(x, y0 + i))), width);
  const right = accept(run(width, (k) => isBar(rows, (i) => lumaAt(width - 1 - k, y0 + i))), width);
  return { top, bottom, left, right };
}

/**
 * @param {Uint8ClampedArray|Uint8Array} data RGBA
 * @param {object} [opt]
 * @param {Exclude} [opt.exclude] 解析から除外する範囲（黒帯・字幕など）
 * @returns 解析結果（数値のみ）
 */
export function analyze(data, width, height, { exclude } = {}) {
  const n = width * height;
  if (!n || data.length < n * 4) throw new Error('画像データが空です');
  const acc = new Accumulator().addRegion(data, 0, 0, width, height, excludedRects(exclude, width, height));
  if (!acc.n) throw new Error('除外した範囲が画像全体です');
  return acc.result(width, height);
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
  let th = Math.max(1, Math.min(height, maxEdge, Math.floor(maxArea / tw)));
  if (th < height && th >= 8) th -= th % 8; // 質感のブロック（8×8）がタイルの境目をまたがないよう 8 の倍数に

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
 * @param {Exclude} [opt.exclude] 解析から除外する範囲
 */
export async function analyzeTiled(read, width, height, opt = {}) {
  const { onProgress, signal, yieldFn, maxArea, maxEdge, exclude } = opt;
  const acc = new Accumulator();
  const rects = excludedRects(exclude, width, height);
  const total = width * height;
  let done = 0;
  onProgress?.(0, total);
  for (const t of tilePlan(width, height, maxArea, maxEdge)) {
    if (signal?.aborted) throw new AbortError();
    const data = await read(t.x, t.y, t.w, t.h);
    if (signal?.aborted) throw new AbortError();
    acc.addRegion(data, t.x, t.y, t.w, t.h, rects);
    done += t.w * t.h;
    onProgress?.(done, total);
    if (yieldFn) await yieldFn();
  }
  if (!acc.n) throw new Error('除外した範囲が画像全体です');
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
