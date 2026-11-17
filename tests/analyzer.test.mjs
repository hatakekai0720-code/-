// 解析ロジックの数値テスト。単色などの合成画像（RGBA 配列）で検証する。
// 実行: node tests/analyzer.test.mjs
import assert from 'node:assert/strict';
import { analyze, fitSize, tilePlan, analyzeTiled, Accumulator, TILE_MAX_AREA, TILE_MAX_EDGE } from '../js/analyzer.js';
import { estimate, buildRecipe, toneCurves, curvesText } from '../js/translator.js';
import { validateRecipe, RANGES, WB_MODES, FILM_SIMS } from '../js/xt3.js';
import { validateDb, VERSION } from '../js/store.js';

const W = 40, H = 40;
/** fn(x, y) → [r, g, b] で画像を作る */
function image(fn) {
  const d = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const [r, g, b] = fn(x, y); d.set([r, g, b, 255], (y * W + x) * 4); }
  return analyze(d, W, H);
}
const solid = (r, g, b) => image(() => [r, g, b]);
const near = (v, want, tol, msg) => assert.ok(Math.abs(v - want) <= tol, `${msg}: ${v} (期待 ${want}±${tol})`);
let count = 0;
const queue = [];
const test = (name, fn) => queue.push([name, fn]);

test('グレー単色: ヒストグラム・パーセンタイル・彩度ゼロ', () => {
  const a = solid(128, 128, 128);
  assert.equal(a.hist.r[128], W * H); assert.equal(a.hist.l[128], W * H);
  assert.deepEqual([a.p5, a.p50, a.p95, a.contrast], [128, 128, 128, 0]);
  assert.equal(a.clipBlack, 0); assert.equal(a.clipWhite, 0);
  near(a.chroma, 0, 0.01, '彩度'); assert.equal(a.saturation, 0);
  assert.equal(a.shadows.name, 'ニュートラル'); assert.equal(a.highlights.name, 'ニュートラル');
});
test('黒単色 → 黒つぶれ 100%', () => { const a = solid(0, 0, 0); assert.equal(a.clipBlack, 100); assert.equal(a.clipWhite, 0); });
test('白単色 → 白飛び 100%', () => { const a = solid(255, 255, 255); assert.equal(a.clipWhite, 100); assert.equal(a.clipBlack, 0); });
test('白黒 2 分割 → コントラスト 255、黒つぶれ・白飛び 各 50%', () => {
  const a = image((x) => (x < W / 2 ? [0, 0, 0] : [255, 255, 255]));
  assert.deepEqual([a.p5, a.p95, a.contrast], [0, 255, 255]);
  assert.equal(a.clipBlack, 50); assert.equal(a.clipWhite, 50);
  near(a.lumaStd, 127.5, 0.01, '標準偏差');
});
test('横グラデーション → p5/p50/p95 がほぼ線形', () => {
  const a = image((x) => { const v = Math.round(x / (W - 1) * 255); return [v, v, v]; });
  near(a.p5, 13, 8, 'p5'); near(a.p50, 127, 8, 'p50'); near(a.p95, 242, 8, 'p95');
});
test('輝度は Rec.709 係数', () => { assert.equal(solid(255, 0, 0).p50, 54); assert.equal(solid(0, 255, 0).p50, 182); assert.equal(solid(0, 0, 255).p50, 18); });
test('純色の Lab 値（既知の値と一致）', () => {
  const a = solid(255, 0, 0).overall;
  near(a.L, 53.24, 0.1, 'L'); near(a.a, 80.09, 0.2, 'a'); near(a.b, 67.2, 0.2, 'b');
});
test('色被りの名前', () => {
  const names = { 'レッド': [255, 0, 0], 'オレンジ': [255, 140, 0], 'アンバー': [255, 191, 0], 'イエロー': [255, 255, 0], 'グリーン': [0, 255, 0],
    'ティール': [0, 128, 128], 'シアン': [0, 255, 255], 'ブルー': [0, 0, 255], 'マゼンタ': [255, 0, 255] };
  for (const [name, rgb] of Object.entries(names)) {
    const a = solid(...rgb);
    assert.equal(a.shadows.name, name, `${rgb} のシャドウ`); assert.equal(a.highlights.name, name); assert.equal(a.shadows.strength, '強');
    assert.deepEqual(a.overall.rgb, rgb, '平均色が元の色に戻る');
  }
});
test('HSV 彩度: 純色 100%、半分の彩度 50%', () => { assert.equal(solid(255, 0, 0).saturation, 100); near(solid(200, 100, 100).saturation, 50, 0.01, 'S'); });
test('シャドウがティール、ハイライトがアンバーを分離して検出', () => {
  const a = image((x, y) => (y < H / 2 ? [20, 70, 75] : [235, 190, 120]));
  assert.equal(a.shadows.name, 'ティール'); assert.ok(['アンバー', 'オレンジ'].includes(a.highlights.name), a.highlights.name);
  assert.deepEqual(a.shadows.rgb, [20, 70, 75]); assert.deepEqual(a.highlights.rgb, [235, 190, 120]);
  const r = buildRecipe(a, estimate(a).candidates[0]);
  assert.equal(r.wb.mode, 'kelvin'); assert.ok(r.wb.kelvin < 5500, `シャドウが青緑 → 色温度を下げる (${r.wb.kelvin})`);
  assert.ok(r.wbShift.r > 0 && r.wbShift.b < 0, `ハイライトが暖色 → R+ / B- (${JSON.stringify(r.wbShift)})`);
});
test('肌色域の割合', () => { near(solid(224, 172, 140).skinRatio, 1, 0, '肌色'); assert.equal(solid(0, 0, 255).skinRatio, 0); });

test('トランスレーター: 無彩色 → モノクロ系（コントラストで選び分け）', () => {
  const hard = image((x) => (x % 2 ? [8, 8, 8] : [245, 245, 245]));
  assert.equal(estimate(hard).candidates[0].filmSim, 'acros');
  const soft = image((x) => (x % 2 ? [100, 100, 100] : [160, 160, 160]));
  assert.equal(estimate(soft).candidates[0].filmSim, 'monochrome');
  const r = buildRecipe(hard, estimate(hard).candidates[0]);
  assert.equal(r.monoFilter, 'none'); assert.equal(r.wb.mode, 'auto'); assert.equal(r.monoWC, 0);
});
test('トランスレーター: 高彩度 → Velvia、低彩度・低コントラスト → ETERNA', () => {
  assert.equal(estimate(image((x) => (x % 2 ? [200, 30, 30] : [30, 60, 200]))).candidates[0].filmSim, 'velvia');
  assert.equal(estimate(image((x) => (x % 2 ? [110, 120, 125] : [150, 145, 135]))).candidates[0].filmSim, 'eterna');
});
test('トランスレーター: 低〜中彩度・高コントラスト → クラシッククローム', () => {
  const a = image((x, y) => (y < H / 2 ? [25, 40, 45] : [225, 205, 180]));
  assert.equal(estimate(a).candidates[0].filmSim, 'classic-chrome');
});
test('トランスレーター: 肌色が多い → PRO Neg が候補に入る', () => {
  const a = image((x) => (x % 2 ? [205, 160, 135] : [185, 140, 118]));
  assert.ok(estimate(a).candidates.some((c) => c.filmSim.startsWith('pro-neg')));
});
test('トランスレーター: 白飛びが多い → DR400 / 少し → DR200、ISO メモが条件を満たす', () => {
  const a = image((x) => (x < 4 ? [255, 255, 255] : [120, 110, 100])); // 10%
  const r = buildRecipe(a, estimate(a).candidates[0]);
  assert.equal(r.dr, 'dr400'); assert.equal(r.isoNote, 'ISO 640〜');
  const b = image((x, y) => (x === 0 && y < 32 ? [255, 255, 255] : [120, 110, 100])); // 2%
  assert.equal(buildRecipe(b, estimate(b).candidates[0]).dr, 'dr200');
});
test('トランスレーター: シャドウ / ハイライトトーン', () => {
  const crushed = image((x) => (x < W / 2 ? [2, 2, 4] : [252, 250, 248]));
  const r1 = buildRecipe(crushed, estimate(crushed).candidates[0]);
  assert.equal(r1.shadow, 3); assert.equal(r1.highlight, 2);
  const flat = image((x) => (x < W / 2 ? [70, 72, 80] : [180, 175, 170]));
  const r2 = buildRecipe(flat, estimate(flat).candidates[0]);
  assert.equal(r2.shadow, -2); assert.equal(r2.highlight, -2);
});
test('どんな入力でも推定レシピは xt3.js の範囲内・候補は 2〜3 件', () => {
  let seed = 7; const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  for (let i = 0; i < 300; i++) {
    const c1 = [rnd() * 256 | 0, rnd() * 256 | 0, rnd() * 256 | 0], c2 = [rnd() * 256 | 0, rnd() * 256 | 0, rnd() * 256 | 0], cut = rnd() * H;
    const a = image((x, y) => (y < cut ? c1 : c2));
    const est = estimate(a);
    assert.ok(est.candidates.length >= 2 && est.candidates.length <= 3);
    assert.ok(['高', '中', '低'].includes(est.confidence.level));
    for (const c of est.candidates) assert.deepEqual(validateRecipe({ ...buildRecipe(a, c), name: 't' }), [], JSON.stringify([c1, c2]));
    for (const c of toneCurves(a)) {
      assert.equal(c.points.length, 7);
      c.points.forEach(([x, y], j) => { assert.ok(y >= 0 && y <= 255 && Number.isInteger(y)); if (j) assert.ok(y >= c.points[j - 1][1], '単調増加'); });
    }
  }
});
test('トーンカーブ: グレーは 3 チャンネル同一、暖色ハイライトは R > B', () => {
  const g = toneCurves(image((x) => { const v = Math.round(x / (W - 1) * 255); return [v, v, v]; }));
  assert.deepEqual(g[0].points, g[1].points); assert.deepEqual(g[1].points, g[2].points);
  const c = toneCurves(image((x, y) => (y < H / 2 ? [20, 70, 75] : [235, 190, 120])));
  assert.ok(c[0].points[5][1] > c[2].points[5][1], 'ハイライト側で R > B'); assert.ok(c[0].points[1][1] < c[2].points[1][1], 'シャドウ側で R < B');
  assert.match(curvesText(c), /^# RAW.*\nR: 0→\d+, 32→\d+.*\nG: .*\nB: /);
});
test('fitSize: 長辺 800px に縮小、小さい画像は拡大しない', () => {
  assert.deepEqual(fitSize(4000, 3000), { width: 800, height: 600 }); assert.deepEqual(fitSize(3000, 6000), { width: 400, height: 800 });
  assert.deepEqual(fitSize(320, 200), { width: 320, height: 200 }); assert.ok(RANGES);
});
test('セピア調の画像 → セピアが第 1 候補、カラー設定なし', () => {
  const a = image((x) => { const v = x / (W - 1); return [Math.round(55 + 190 * v), Math.round(45 + 175 * v), Math.round(32 + 150 * v)]; });
  assert.ok(a.hueConsistency > 0.95, `色相のそろい ${a.hueConsistency}`);
  const est = estimate(a);
  assert.equal(est.candidates[0].filmSim, 'sepia'); assert.ok(est.candidates.some((c) => c.filmSim === 'monochrome' || c.filmSim === 'acros'));
  const r = buildRecipe(a, est.candidates[0]);
  assert.equal(r.monoFilter, null); assert.equal(r.monoWC, null); assert.equal(r.color, 0); assert.equal(r.wb.mode, 'auto');
  const m = buildRecipe(a, est.candidates[1]);
  assert.ok(m.monoWC > 0, `暖色の調色 → WC+ (${m.monoWC})`);
  assert.deepEqual(validateRecipe({ ...r, name: 't' }), []); assert.deepEqual(validateRecipe({ ...m, name: 't' }), []);
});
test('寒色に調色したモノクロ → モノクロ系で WC−', () => {
  const a = image((x) => { const v = x / (W - 1); return [Math.round(30 + 190 * v), Math.round(38 + 195 * v), Math.round(55 + 195 * v)]; });
  const est = estimate(a);
  assert.ok(['monochrome', 'acros'].includes(est.candidates[0].filmSim), est.candidates[0].filmSim);
  assert.ok(buildRecipe(a, est.candidates[0]).monoWC < 0);
});
test('カラー写真（色相がばらばら）は調色モノクロと判定しない', () => {
  const a = image((x, y) => (y < H / 2 ? [60, 90, 110] : [200, 160, 120]));
  assert.ok(!['sepia', 'monochrome', 'acros'].includes(estimate(a).candidates[0].filmSim));
});
test('xt3.js: セピア・カスタムWB1〜3・モノクロ調整の範囲', () => {
  assert.ok(FILM_SIMS.some((f) => f.id === 'sepia'));
  assert.deepEqual(WB_MODES.filter((w) => w.id.startsWith('custom')).map((w) => w.id), ['custom1', 'custom2', 'custom3']);
  const base = { name: 'x', filmSim: 'acros', monoFilter: 'ye', monoWC: 9, dr: 'auto', grain: 'off', colorChrome: 'off', wb: { mode: 'custom3', kelvin: null }, wbShift: { r: 0, b: 0 },
    highlight: 0, shadow: 0, color: 0, sharpness: 0, nr: 0, isoNote: '', exposureNote: '', tags: [], source: 'manual', sourceRef: null, notes: '' };
  assert.deepEqual(validateRecipe(base), []);
  assert.ok(validateRecipe({ ...base, monoWC: 10 }).length);
  assert.ok(validateRecipe({ ...base, monoWC: null }).length);
  assert.ok(validateRecipe({ ...base, filmSim: 'sepia' }).length, 'セピアにフィルター / WC は不可');
  assert.deepEqual(validateRecipe({ ...base, filmSim: 'sepia', monoFilter: null, monoWC: null }), []);
  assert.ok(validateRecipe({ ...base, filmSim: 'provia', monoFilter: null, monoWC: 1 }).length);
  assert.ok(validateRecipe({ ...base, wb: { mode: 'custom', kelvin: null } }).length, '旧 custom は不可');
});
test('store: version 1 のデータを移行（custom → custom1、monoWC 追加）', () => {
  const r = { id: 'a', name: 'a', filmSim: 'acros', monoFilter: 'r', dr: 'auto', grain: 'off', colorChrome: 'off', wb: { mode: 'custom', kelvin: null }, wbShift: { r: 0, b: 0 },
    highlight: 0, shadow: 0, color: 0, sharpness: 0, nr: 0, isoNote: '', exposureNote: '', tags: [], source: 'manual', sourceRef: null, notes: '' };
  const v1 = { version: 1, recipes: [r, { ...r, id: 'b', filmSim: 'velvia', monoFilter: null }], slots: {}, pins: [], academy: { completed: [] }, settings: {} };
  const res = validateDb(v1);
  assert.ok(res.ok, res.errors?.join());
  assert.equal(res.db.version, VERSION);
  assert.equal(res.db.recipes[0].wb.mode, 'custom1'); assert.equal(res.db.recipes[0].monoWC, 0); assert.equal(res.db.recipes[1].monoWC, null);
  assert.equal(v1.recipes[0].wb.mode, 'custom', '元のオブジェクトは変更しない');
});

/* ---- 全ピクセル解析（タイル分割） ---- */
test('tilePlan: X-T3 の 6240×4160 を重なり・抜けなく分割、各タイルは面積・一辺の上限内', () => {
  for (const [w, h] of [[6240, 4160], [4160, 6240], [20000, 300], [1, 1], [801, 3]]) {
    const tiles = tilePlan(w, h);
    let area = 0;
    const rows = new Uint32Array(h);
    for (const t of tiles) {
      assert.ok(t.w * t.h <= TILE_MAX_AREA && t.w <= TILE_MAX_EDGE && t.h <= TILE_MAX_EDGE, JSON.stringify(t));
      assert.ok(t.x >= 0 && t.y >= 0 && t.x + t.w <= w && t.y + t.h <= h);
      area += t.w * t.h;
      for (let y = t.y; y < t.y + t.h; y++) rows[y] += t.w;
    }
    assert.equal(area, w * h, `${w}×${h} の面積`);
    assert.ok(rows.every((v) => v === w), '各行がちょうど 1 回ずつ');
  }
  assert.equal(tilePlan(6240, 4160)[0].w, 4096, '横 4096px を超える画像は縦にも分割');
});

// 合成の大きな画像（空のグラデーション + 細かいテクスチャ + 1px の鏡面反射 + 細い黒線）
const BW = 3200, BH = 2400;
const big = new Uint8ClampedArray(BW * BH * 4);
{
  let seed = 11; const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  for (let y = 0; y < BH; y++) for (let x = 0; x < BW; x++) {
    const p = (y * BW + x) * 4, t = y / BH, n = (rnd() - 0.5) * 24;
    let r = 40 + 170 * (1 - t) + n, g = 70 + 120 * (1 - t) + n, b = 85 + 60 * (1 - t) + n; // 上が明るい暖色、下が暗い青緑
    if (x % 16 === 0 && y % 16 === 0) r = g = b = 255;           // 鏡面反射（1px の点）
    if (x % 50 === 0) { r = 1; g = 1; b = 2; }                    // 細い黒線（電線など）
    big[p] = r; big[p + 1] = g; big[p + 2] = b; big[p + 3] = 255;
  }
}
const readBig = (x, y, w, h) => {
  const out = new Uint8ClampedArray(w * h * 4);
  for (let r = 0; r < h; r++) out.set(big.subarray(((y + r) * BW + x) * 4, ((y + r) * BW + x + w) * 4), r * w * 4);
  return out;
};
/** ブラウザの縮小描画（面積平均）相当で 800px 版を作る */
function downscale(src, w, h, dw, dh) {
  const out = new Uint8ClampedArray(dw * dh * 4);
  for (let y = 0; y < dh; y++) for (let x = 0; x < dw; x++) {
    const x0 = Math.floor(x * w / dw), x1 = Math.floor((x + 1) * w / dw), y0 = Math.floor(y * h / dh), y1 = Math.floor((y + 1) * h / dh);
    const s = [0, 0, 0]; let c = 0;
    for (let yy = y0; yy < y1; yy++) for (let xx = x0; xx < x1; xx++) { const p = (yy * w + xx) * 4; s[0] += src[p]; s[1] += src[p + 1]; s[2] += src[p + 2]; c++; }
    out.set([s[0] / c, s[1] / c, s[2] / c, 255], (y * dw + x) * 4);
  }
  return out;
}

test('タイル分割の結果は一括解析と完全に一致（7.7MP を 1MP タイルで）', async () => {
  const progress = [];
  const tiled = await analyzeTiled(readBig, BW, BH, { maxArea: 1_000_000, onProgress: (d, t) => progress.push([d, t]) });
  const whole = analyze(big, BW, BH);
  assert.equal(tiled.pixels, BW * BH);
  for (const k of ['r', 'g', 'b', 'l']) assert.deepEqual([...tiled.hist[k]], [...whole.hist[k]], `hist.${k}`);
  for (const k of ['p5', 'p50', 'p95', 'clipBlack', 'clipWhite']) assert.equal(tiled[k], whole[k], k);
  for (const k of ['chroma', 'saturation', 'meanLuma', 'lumaStd', 'skinRatio', 'hueConsistency']) near(tiled[k], whole[k], 1e-9, k);
  for (const z of ['shadows', 'highlights', 'overall']) { assert.deepEqual(tiled[z].rgb, whole[z].rgb, z); assert.equal(tiled[z].name, whole[z].name); }
  assert.deepEqual(progress[0], [0, BW * BH]); assert.deepEqual(progress.at(-1), [BW * BH, BW * BH]);
  assert.ok(progress.length >= 9, 'タイルごとに進捗が出る');
});

test('全ピクセル解析と 800px 版の差: 全体の傾向は一致し、細部（鏡面反射・細線）は全ピクセルでだけ捉えられる', async () => {
  const full = await analyzeTiled(readBig, BW, BH);
  const { width: dw, height: dh } = fitSize(BW, BH);
  const small = analyze(downscale(big, BW, BH, dw, dh), dw, dh);
  const diff = {
    p5: full.p5 - small.p5, p50: full.p50 - small.p50, p95: full.p95 - small.p95,
    clipWhite: full.clipWhite - small.clipWhite, clipBlack: full.clipBlack - small.clipBlack,
    chroma: full.chroma - small.chroma, lumaStd: full.lumaStd - small.lumaStd,
  };
  console.log('     全ピクセル − 800px:', Object.entries(diff).map(([k, v]) => `${k} ${v >= 0 ? '+' : ''}${(+v).toFixed(2)}`).join(', '));
  // 全体の傾向（中間調・平均色・色被りの判定）はほぼ同じ
  near(full.p50, small.p50, 3, 'p50'); near(full.meanLuma, small.meanLuma, 1, '平均輝度');
  for (let i = 0; i < 3; i++) near(full.overall.rgb[i], small.overall.rgb[i], 2, `平均色 ${i}`);
  assert.equal(full.shadows.name, small.shadows.name); assert.equal(full.highlights.name, small.highlights.name);
  near(full.chroma, small.chroma, small.chroma * 0.15, '平均彩度');
  // 細部: 1px の鏡面反射と細い黒線は 800px に縮小すると平均化されて消える
  near(full.clipWhite, 100 / 256, 0.05, '白飛び（全ピクセル）'); assert.ok(small.clipWhite < 0.01, `白飛び（800px）${small.clipWhite}`);
  assert.ok(full.clipBlack >= 1.9, `黒つぶれ（全ピクセル）${full.clipBlack}`); assert.ok(small.clipBlack < 0.5, `黒つぶれ（800px）${small.clipBlack}`);
  assert.ok(full.lumaStd > small.lumaStd, '細かいテクスチャの分だけ輝度のばらつきが大きい');
  // 推定レシピも範囲内
  for (const c of estimate(full).candidates) assert.deepEqual(validateRecipe({ ...buildRecipe(full, c), name: 't' }), []);
});

test('キャンセル: signal.aborted で AbortError、途中まで読んだタイルだけで止まる', async () => {
  const signal = { aborted: false };
  let reads = 0;
  await assert.rejects(analyzeTiled((x, y, w, h) => { if (++reads === 3) signal.aborted = true; return readBig(x, y, w, h); }, BW, BH, { maxArea: 1_000_000, signal }), { name: 'AbortError' });
  assert.equal(reads, 3);
});

test('Accumulator: 空のまま result() はエラー、add を分けても同じ結果', () => {
  assert.throws(() => new Accumulator().result(1, 1));
  const d = big.subarray(0, 4000 * 4);
  const a = new Accumulator().add(d.subarray(0, 1234 * 4)).add(d.subarray(1234 * 4)).result(4000, 1);
  const b = analyze(d, 4000, 1);
  assert.deepEqual(a.shadows.rgb, b.shadows.rgb); near(a.chroma, b.chroma, 1e-9, 'chroma');
});

for (const [name, fn] of queue) { await fn(); count++; console.log('ok  ', name); }
console.log(`\n${count} 件のテストに合格`);
