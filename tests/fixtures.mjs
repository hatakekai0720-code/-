// テスト用の合成画像（RGBA 配列）。ユーザーの写真はリポジトリに入れず、ここで数式から作る。

/** 決定的な乱数（テストの再現性のため） */
export function rng(seed = 1) { return () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648; }

/** fn(x, y) → [r, g, b] で w×h の RGBA を作る */
export function makeImage(w, h, fn) {
  const d = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const [r, g, b] = fn(x, y); const p = (y * w + x) * 4; d[p] = r; d[p + 1] = g; d[p + 2] = b; d[p + 3] = 255; }
  return d;
}

/**
 * 夜景を模した画像: 全体が輝度 20〜50 の黒が浮いた暗いグリーン、0.8% だけ青い光源（看板）。
 * 400×250 = 100,000 画素のうち 800 画素（40×20 の看板）が青。
 */
export const NIGHT = { w: 400, h: 250 };
export function nightImage() {
  const rnd = rng(5);
  return makeImage(NIGHT.w, NIGHT.h, (x, y) => {
    if (x >= 300 && x < 340 && y >= 60 && y < 80) return [70, 150, 255]; // 青い看板（輝度 約 133）
    const v = 20 + Math.floor(rnd() * 31);                                 // 輝度 20〜50
    return [v - 5, v + 3, v - 4];                                          // グリーン寄り
  });
}

/** ふつうのシーン（中彩度・柔らかめのコントラスト。肌色少なめ） */
export function sceneImage(w, h) {
  const rnd = rng(9);
  return makeImage(w, h, (x, y) => {
    const t = y / h, s = x / w, n = (rnd() - 0.5) * 16;
    const v = 60 + 130 * (1 - t) + 30 * s + n;
    return t < 0.5 ? [v * 0.8, v * 0.95, v * 1.15 + 10] : [v * 1.15 + 10, v * 0.95, v * 0.7]; // 上は青い空、下は暖色の地面
  });
}

/** 画像の上下（と任意で左右）に黒帯を付ける。帯は輝度 0〜3 のノイズ */
export function withBars(src, w, h, { top = 0, bottom = 0, left = 0, right = 0 } = {}) {
  const W = w + left + right, H = h + top + bottom;
  const rnd = rng(3);
  const d = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const p = (y * W + x) * 4, ix = x - left, iy = y - top;
    if (ix >= 0 && ix < w && iy >= 0 && iy < h) { const q = (iy * w + ix) * 4; d[p] = src[q]; d[p + 1] = src[q + 1]; d[p + 2] = src[q + 2]; }
    else { const v = Math.floor(rnd() * 4); d[p] = v; d[p + 1] = v; d[p + 2] = v; }
    d[p + 3] = 255;
  }
  return { data: d, width: W, height: H };
}

/** ティール＆オレンジ: 輝度のグラデーションに、シャドウはティール、ハイライトはオレンジの色を乗せる（中間調はほぼニュートラル） */
export function tealOrangeImage(w, h) {
  return makeImage(w, h, (x) => {
    const t = x / (w - 1), v = 10 + 235 * t;
    const sh = Math.max(0, 1 - t / 0.4), hi = Math.max(0, (t - 0.6) / 0.4);
    return [v - 22 * sh + 28 * hi, v + 6 * sh + 4 * hi, v + 8 * sh - 30 * hi];
  });
}

/* ---- 質感（粒状感・シャープさ）のテスト用 ---- */

/** 決定的なガウス乱数（Box-Muller） */
export function gauss(seed = 7) {
  const r = rng(seed);
  return () => Math.sqrt(-2 * Math.log(Math.max(1e-12, r()))) * Math.cos(2 * Math.PI * r());
}

/**
 * 質感テストの元画像: なめらかなグラデーションの上に、くっきりした輪郭の長方形（段差）を並べた画像。
 * 平らな部分（グラデーション・長方形の内側）とエッジ（長方形の縁）の両方がある
 */
export function edgesImage(w, h) {
  return makeImage(w, h, (x, y) => {
    let v = 70 + 90 * (x / w) + 30 * (y / h);
    const cx = Math.floor(x / 120), cy = Math.floor(y / 120), ix = x % 120, iy = y % 120;
    if (ix >= 30 && ix < 90 && iy >= 30 && iy < 90) v += (cx + cy) % 2 ? 70 : -55;
    return [v * 1.05, v, v * 0.92];
  });
}

/** ガウスノイズ（輝度 σ）を足す（フィルムの粒子・高感度ノイズの代わり） */
export function addNoise(src, sigma, seed = 3) {
  const g = gauss(seed), out = new Uint8ClampedArray(src);
  for (let p = 0; p < out.length; p += 4) { const n = g() * sigma; out[p] += n; out[p + 1] += n; out[p + 2] += n; }
  return out;
}

/** ガウスぼかし（半径 3σ の分離フィルター） */
export function blur(src, w, h, sigma) {
  const r = Math.ceil(sigma * 3), k = [];
  for (let i = -r; i <= r; i++) k.push(Math.exp(-(i * i) / (2 * sigma * sigma)));
  const ks = k.reduce((a, b) => a + b, 0);
  const pass = (inp, dx, dy) => {
    const out = new Uint8ClampedArray(inp.length);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) for (let c = 0; c < 3; c++) {
      let s = 0;
      for (let i = -r; i <= r; i++) {
        const xx = Math.min(w - 1, Math.max(0, x + dx * i)), yy = Math.min(h - 1, Math.max(0, y + dy * i));
        s += inp[(yy * w + xx) * 4 + c] * k[i + r];
      }
      out[(y * w + x) * 4 + c] = s / ks;
    }
    for (let p = 3; p < out.length; p += 4) out[p] = 255;
    return out;
  };
  return pass(pass(src, 1, 0), 0, 1);
}
