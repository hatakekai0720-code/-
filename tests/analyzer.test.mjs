// 解析ロジックの数値テスト。単色などの合成画像（RGBA 配列）で検証する。
// 実行: node tests/analyzer.test.mjs
import assert from 'node:assert/strict';
import { analyze, fitSize, tilePlan, analyzeTiled, Accumulator, TILE_MAX_AREA, TILE_MAX_EDGE, detectBars, excludedRects } from '../js/analyzer.js';
import { makeImage, sceneImage, withBars, nightImage, NIGHT, tealOrangeImage } from './fixtures.mjs';
import { estimate, buildRecipe, toneCurves, curvesText, summarize, planRecipe, guessScene, SCENES, RULES as TR } from '../js/translator.js';
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
  // シャドウとハイライトの色の差は WB では表さない（スプリットトーンの注記になる）
  const plan = planRecipe(a, estimate(a).candidates[0]);
  assert.ok(Math.abs(plan.recipe.wbShift.r) < 4 && Math.abs(plan.recipe.wbShift.b) < 4, JSON.stringify(plan.recipe.wbShift));
  assert.ok(plan.notes.some((n) => /スプリットトーン/.test(n)));
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


/* ---- 解析範囲（黒帯の自動除外・手動除外） ---- */
// 2.39:1 の映画を 16:9 の画面でスクショした想定: 400×168 の本編の上下に 28〜29px の黒帯
const SW = 400, SH = 168;
const scene = sceneImage(SW, SH);
const barred = withBars(scene, SW, SH, { top: 28, bottom: 29 });
const mainKeys = (a) => { const e = estimate(a); const r = buildRecipe(a, e.candidates[0]); return { shadowCast: a.shadows.name, shadow: r.shadow, highlight: r.highlight, first: e.candidates[0].filmSim }; };

test('黒帯: 除外しないと結果が変わってしまう（問題の再現）', () => {
  const plain = analyze(scene, SW, SH), withBar = analyze(barred.data, barred.width, barred.height);
  assert.ok(withBar.clipBlack > 15, `黒帯込みの黒つぶれ ${withBar.clipBlack}`);
  assert.notDeepEqual(mainKeys(withBar), mainKeys(plain));
});
test('黒帯: 上下の黒帯を自動検出し、除外すると黒帯なしと主要な結果が一致', () => {
  const bars = detectBars(barred.data, barred.width, barred.height);
  near(bars.top * barred.height, 28, 1, '上の黒帯'); near(bars.bottom * barred.height, 29, 1, '下の黒帯');
  assert.equal(bars.left, 0); assert.equal(bars.right, 0);
  const a = analyze(barred.data, barred.width, barred.height, { exclude: { bars } });
  const plain = analyze(scene, SW, SH);
  assert.deepEqual(mainKeys(a), mainKeys(plain));
  assert.equal(a.pixels, SW * SH, '解析した画素数 = 本編だけ');
  assert.equal(a.totalPixels, barred.width * barred.height);
  near(a.excludedRatio * 100, 57 / 225 * 100, 0.01, '除外した割合（%）');
  near(a.clipBlack, plain.clipBlack, 0.01, '黒つぶれ');
});
test('黒帯: 左右の黒帯（ピラーボックス）も検出', () => {
  const pb = withBars(scene, SW, SH, { left: 40, right: 40 });
  const bars = detectBars(pb.data, pb.width, pb.height);
  near(bars.left * pb.width, 40, 1, '左'); near(bars.right * pb.width, 40, 1, '右'); assert.equal(bars.top, 0); assert.equal(bars.bottom, 0);
});
test('黒帯: ふつうの写真・暗い夜景・黒い服などは黒帯と誤検出しない', () => {
  for (const [d, w, h] of [[scene, SW, SH], [makeImage(200, 100, (x, y) => (y < 20 ? [30, 32, 30] : [90, 100, 110])), 200, 100],
    [makeImage(200, 100, (x, y) => (y > 70 && x > 60 && x < 140 ? [2, 2, 2] : [120, 120, 120])), 200, 100]]) {
    assert.deepEqual(detectBars(d, w, h), { top: 0, bottom: 0, left: 0, right: 0 });
  }
});
test('手動除外: 字幕を模した白い帯を除外すると白飛び率が下がる', () => {
  // 本編の下のほうに白い字幕（横 60%・高さ 10px）
  const sub = makeImage(SW, SH, (x, y) => (y >= 140 && y < 150 && x >= 80 && x < 320 ? [255, 255, 255] : scene.subarray((y * SW + x) * 4, (y * SW + x) * 4 + 3)));
  const before = analyze(sub, SW, SH);
  const after = analyze(sub, SW, SH, { exclude: { rects: [{ x: 70 / SW, y: 136 / SH, w: 260 / SW, h: 18 / SH }] } });
  assert.ok(before.clipWhite > 3, `字幕込みの白飛び ${before.clipWhite}`);
  assert.ok(after.clipWhite < before.clipWhite && after.clipWhite < 0.5, `除外後の白飛び ${after.clipWhite}`);
  assert.equal(after.pixels, SW * SH - 260 * 18);
});
test('除外範囲: 重なった長方形も二重に数えない・タイル分割でも同じ結果', async () => {
  const exclude = { bars: { top: 0.1, bottom: 0.1, left: 0, right: 0 }, rects: [{ x: 0.1, y: 0.05, w: 0.3, h: 0.3 }, { x: 0.2, y: 0.2, w: 0.3, h: 0.3 }] };
  const rects = excludedRects(exclude, 100, 100);
  assert.ok(rects.every((r) => r.x0 >= 0 && r.y0 >= 0 && r.x1 <= 100 && r.y1 <= 100));
  const d = makeImage(100, 100, (x, y) => [x * 2, y * 2, 100]);
  const a = analyze(d, 100, 100, { exclude });
  let want = 0;
  for (let y = 0; y < 100; y++) for (let x = 0; x < 100; x++) {
    const ex = y < 10 || y >= 90 || (x >= 10 && x < 40 && y >= 5 && y < 35) || (x >= 20 && x < 50 && y >= 20 && y < 50);
    if (!ex) want++;
  }
  assert.equal(a.pixels, want);
  const read = (x, y, w, h) => { const o = new Uint8ClampedArray(w * h * 4); for (let r = 0; r < h; r++) o.set(d.subarray(((y + r) * 100 + x) * 4, ((y + r) * 100 + x + w) * 4), r * w * 4); return o; };
  const t = await analyzeTiled(read, 100, 100, { exclude, maxArea: 1500, maxEdge: 64 });
  assert.equal(t.pixels, want); assert.deepEqual([...t.hist.l], [...a.hist.l]); assert.deepEqual(t.shadows.rgb, a.shadows.rgb);
  assert.throws(() => analyze(d, 100, 100, { exclude: { rects: [{ x: 0, y: 0, w: 1, h: 1 }] } }), /除外/);
});

/* ---- 指標: 暗部・明部・黒の浮き・露出の目安・光源 ---- */
const night = analyze(nightImage(), NIGHT.w, NIGHT.h);
test('夜景: 暗部・明部の割合、黒の浮き（p1・p5）、露出の目安', () => {
  assert.equal(night.clipBlack, 0, '真っ黒（輝度 0〜2）は無い');
  assert.ok(night.darkRatio > 0.98, `暗部（輝度 64 以下）${night.darkRatio}`);
  near(night.brightRatio, 0, 0.001, '明部（輝度 192 以上）');
  assert.ok(night.p1 >= 15 && night.p5 >= 15, `p1 ${night.p1} / p5 ${night.p5}`);
  assert.equal(night.blackLift, true, '黒が浮いている');
  assert.ok(night.exposureEV <= -2.5 && night.exposureEV >= -3.5, `露出の目安 ${night.exposureEV}`);
});
test('夜景: 光源（上位 2% かつ輝度 128 以上）の色はブルー系、面積は 0.8%', () => {
  assert.ok(night.light, '光源がある');
  assert.equal(night.light.name, 'ブルー'); assert.equal(night.light.label, 'ブルー系');
  near(night.light.ratio, 0.008, 0.0001, '光源の面積');
  assert.ok(!['ブルー'].includes(night.highlights.name) || night.highlights.L < 30, 'ハイライト（上位 25%）では看板の青を拾えない');
  assert.ok(night.chromaNonLight < night.chroma, '光源以外の彩度');
});
test('光源: 明るい画素が無ければ null、単色グレーも null', () => {
  assert.equal(solid(40, 40, 40).light, null); assert.equal(solid(128, 128, 128).light, null);
  const a = image((x, y) => (x < 2 && y < 1 ? [255, 110, 90] : [60, 60, 60]));
  assert.equal(a.light.label, 'レッド系');
});
test('露出の目安: 中間グレー（リニア 18%）で 0EV、1 段明るいと +1EV', () => {
  near(solid(118, 118, 118).exposureEV, 0, 0.1, '18% グレー'); near(solid(161, 161, 161).exposureEV, 1, 0.1, '+1EV');
  assert.equal(solid(130, 130, 130).blackLift, true); assert.equal(image((x) => (x < 4 ? [0, 0, 0] : [200, 200, 200])).blackLift, false);
});
test('要約: 夜景は「暗い」「黒が浮いた」「青い光源」を含む', () => {
  const s = summarize(night);
  assert.match(s, /暗い/); assert.match(s, /黒が浮いた/); assert.match(s, /青い光源/); assert.match(s, /夜景/);
  assert.ok(s.length <= 90, s);
  const day = summarize(analyze(sceneImage(200, 100), 200, 100));
  assert.ok(!/夜景/.test(day), day);
});

/* ---- 推定レシピの考え方 ---- */
const near0 = (x) => Math.abs(x);
test('ティール＆オレンジ: WB シフトが上限に張り付かず、スプリットトーンは注記とトーンカーブに出る', () => {
  const a = analyze(tealOrangeImage(256, 8), 256, 8);
  assert.equal(a.shadows.name, 'ティール'); assert.ok(['オレンジ', 'アンバー'].includes(a.highlights.name), a.highlights.name);
  const est = estimate(a, { scene: 'daylight' });
  const plan = planRecipe(a, est.candidates[0], { scene: 'daylight' });
  const { wbShift, wb } = plan.recipe;
  assert.ok(near0(wbShift.r) < TR.wb.shiftMax && near0(wbShift.b) < TR.wb.shiftMax, `WB シフト ${JSON.stringify(wbShift)}`);
  assert.ok(!plan.warnings.length, plan.warnings.join());
  if (wb.mode === 'kelvin') near(wb.kelvin, 5500, 400, '中間調がほぼニュートラル → 昼光の基準に近い');
  assert.ok(plan.notes.some((n) => /スプリットトーン/.test(n) && /カメラ内では再現できない/.test(n) && /トーンカーブ/.test(n)), plan.notes.join('\n'));
  const c = toneCurves(a);
  assert.ok(c[2].points[1][1] > c[0].points[1][1], 'シャドウ側で B > R（ティール）'); assert.ok(c[0].points[5][1] > c[2].points[5][1], 'ハイライト側で R > B（オレンジ）');
  assert.match(curvesText(c, a), /スプリットトーン/);
});
test('WB は中間調だけから決める: 中間調がグリーンに強く被ると WB シフトは ±4 で止まり、警告が出る', () => {
  const a = image((x) => { const v = 60 + x * 4; return [v - 40, v + 25, v - 40]; });
  const plan = planRecipe(a, estimate(a).candidates.find((c) => c.filmSim !== 'monochrome' && c.filmSim !== 'acros') ?? { filmSim: 'provia' }, { scene: 'daylight' });
  assert.ok(near0(plan.recipe.wbShift.r) <= TR.wb.shiftMax && near0(plan.recipe.wbShift.b) <= TR.wb.shiftMax);
  assert.ok(plan.recipe.wbShift.r < 0, 'グリーン → R−');
  assert.ok(plan.warnings.some((w) => /WB シフト/.test(w)), plan.warnings.join());
});
test('撮影条件: K 値の基準が条件ごとに変わる（電球 < 夜の街 < 夕方 < 昼光 < 曇り・日陰）', () => {
  assert.deepEqual(SCENES.map((s) => s.id), ['auto', 'daylight', 'cloudy', 'sunset', 'night', 'tungsten']);
  const a = image((x) => { const v = 40 + x * 5; return [v + 6, v, v - 6]; });
  const k = (scene) => planRecipe(a, { filmSim: 'provia' }, { scene }).recipe.wb.kelvin;
  assert.ok(k('tungsten') < k('night') && k('night') < k('sunset') && k('sunset') < k('daylight') && k('daylight') < k('cloudy'),
    ['tungsten', 'night', 'sunset', 'daylight', 'cloudy'].map(k).join(' < '));
  const est = estimate(a, { scene: 'tungsten' });
  assert.deepEqual([est.scene.id, est.scene.auto], ['tungsten', false]);
});
test('夜景: 撮影条件は自動で「夜の街」、露出補正・ISO の目安、シャドウトーン 0 以下、確度は「高」ではない', () => {
  const est = estimate(night);
  assert.deepEqual([est.scene.id, est.scene.auto], ['night', true]); assert.equal(guessScene(night), 'night');
  const plan = planRecipe(night, est.candidates[0], { scene: est.scene.id });
  const r = plan.recipe;
  assert.ok(r.shadow <= 0, `シャドウトーン ${r.shadow}`);
  assert.match(r.exposureNote, /^-3EV/); assert.ok(r.exposureNote.length <= 60);
  assert.match(r.isoNote, /ISO \d+/); assert.match(r.isoNote, /夜景/); assert.ok(r.isoNote.length <= 60);
  assert.notEqual(r.dr, 'dr100', '光源の面積を考えて DR を上げる');
  assert.ok(plan.notes.some((n) => /黒の浮き/.test(n) && /トーンカーブ/.test(n)), plan.notes.join('\n'));
  assert.notEqual(est.confidence.level, '高');
  assert.ok(est.confidence.reasons.some((x) => /暗部/.test(x)), est.confidence.reasons.join());
  assert.ok(toneCurves(night).every((c) => c.points[0][1] >= 15), 'トーンカーブで黒を持ち上げる');
  assert.deepEqual(validateRecipe({ ...r, name: 't' }), []);
});
test('露出補正の目安は ±3EV に収める・1/3 段刻み', () => {
  assert.match(buildRecipe(solid(250, 250, 250), { filmSim: 'provia' }).exposureNote, /^\+2 1\/3EV/);
  const dark = planRecipe(solid(5, 5, 5), { filmSim: 'provia' });
  assert.match(dark.recipe.exposureNote, /^-3EV/, 'ダイヤルの下限 -3EV で止める'); assert.ok(dark.notes.some((n) => /範囲/.test(n)));
  assert.match(buildRecipe(solid(118, 118, 118), { filmSim: 'provia' }).exposureNote, /^±0EV/);
  assert.match(buildRecipe(solid(94, 94, 94), { filmSim: 'provia' }).exposureNote, /^-2\/3EV/);
});
test('黒が浮いた画像のシャドウトーンは 0〜-2', () => {
  for (const v of [16, 30, 60]) {
    const a = image((x) => (x < W / 2 ? [v, v, v] : [200, 190, 180]));
    const r = buildRecipe(a, { filmSim: 'provia' });
    assert.ok(r.shadow <= 0 && r.shadow >= -2, `p5 ${a.p5} → ${r.shadow}`);
  }
});
test('確度: 彩度 C* が 6 未満のカラー画像は「高」にしない', () => {
  const a = image((x) => (x % 2 ? [110, 118, 120] : [150, 147, 140]));
  assert.ok(a.chroma < 6 && a.chroma >= 3, `彩度 ${a.chroma}`);
  const est = estimate(a);
  assert.notEqual(est.confidence.level, '高');
  assert.ok(est.confidence.reasons.some((x) => /彩度/.test(x)));
});

for (const [name, fn] of queue) { await fn(); count++; console.log('ok  ', name); }
console.log(`\n${count} 件のテストに合格`);
