// 解析ロジックの数値テスト。単色などの合成画像（RGBA 配列）で検証する。
// 実行: node tests/analyzer.test.mjs
import assert from 'node:assert/strict';
import { analyze, fitSize } from '../js/analyzer.js';
import { estimate, buildRecipe, toneCurves, curvesText } from '../js/translator.js';
import { validateRecipe, RANGES } from '../js/xt3.js';

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
const test = (name, fn) => { fn(); count++; console.log('ok  ', name); };

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
  assert.equal(r.monoFilter, 'none'); assert.equal(r.wb.mode, 'auto');
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
console.log(`\n${count} 件のテストに合格`);
