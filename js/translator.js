// ② 解析結果 → X-T3 レシピの「推定」。ルールベース。
// 調整したいときは下の RULES だけを書き換える。
import * as X from './xt3.js';

export const RULES = {
  // 彩度（平均 Lab C*）がこれ未満ならモノクロ系。コントラストが高ければ ACROS を第 1 候補にする
  mono: { maxChroma: 3, acrosMinContrast: 150 },
  // 調色モノクロ: 平均彩度がこの範囲で、色相がほぼ 1 色にそろっている画像
  toned: { maxChroma: 18, minHueConsistency: 0.9 },
  // セピア: 調色モノクロのうち、色相がこの範囲（オレンジ〜イエロー）で彩度がこれ以上
  sepia: { hue: [40, 100], minChroma: 6 },
  // モノクロ調整（WC）: 平均 b*（+ が黄 = 暖色）× この係数。実機の WC と b* の対応は未較正の目安値
  wcPerB: 0.6,

  // フィルムシミュレーション候補。sat = 平均彩度 C* の範囲、contrast = (p95 - p5) の範囲、
  // skin = 肌色域の割合がこれ以上のときだけ候補にする
  film: [
    { id: 'eterna',         sat: [4, 18],   contrast: [0, 140],   why: '低彩度・低コントラスト' },
    { id: 'classic-chrome', sat: [8, 26],   contrast: [140, 255], why: '低〜中彩度・中〜高コントラスト' },
    { id: 'velvia',         sat: [38, 200], contrast: [0, 255],   why: '高彩度' },
    { id: 'provia',         sat: [22, 38],  contrast: [150, 255], why: '中彩度・標準的なコントラスト' },
    { id: 'astia',          sat: [22, 38],  contrast: [0, 150],   why: '中彩度・柔らかいコントラスト' },
    { id: 'pro-neg-std',    sat: [10, 30],  contrast: [0, 150],   skin: 0.15, why: '肌色域が多く、柔らかいコントラスト' },
    { id: 'pro-neg-hi',     sat: [10, 30],  contrast: [150, 255], skin: 0.15, why: '肌色域が多く、やや硬いコントラスト' },
  ],
  // 範囲から外れたとき、この幅で徐々にスコアを下げる
  softness: { sat: 8, contrast: 40 },

  // カラー: (彩度 − そのフィルムの基準彩度) / colorStep を -4〜+4 に丸める
  colorCenter: { velvia: 42, provia: 30, astia: 28, 'classic-chrome': 18, 'pro-neg-hi': 22, 'pro-neg-std': 20, eterna: 12 },
  colorStep: 6,

  // シャドウトーン: p5 がこの値以下なら → トーン（黒が締まっているほど +）
  shadowTone: [[6, 3], [14, 2], [24, 1], [38, 0], [52, -1], [255, -2]],
  // ハイライトトーン: p95 がこの値以上なら → トーン（白が明るいほど +）
  highlightTone: [[250, 2], [240, 1], [220, 0], [195, -1], [0, -2]],

  // ダイナミックレンジ: 白飛び率（%）がこの値以上なら
  dr: [[5, 'dr400'], [1.5, 'dr200'], [0, 'dr100']],

  // ホワイトバランス: シャドウの b*（青⇔黄）を色温度へ、
  // ハイライトとシャドウの b* の差（スプリットトーン）と全体の a*（緑⇔赤）を WB シフトへ変換
  wb: { minChroma: 3, baseK: 5500, kPerB: 110, kStep: 100, shiftRPerA: 1 / 3, shiftRPerSplit: 1 / 6, shiftBPerSplit: -1 / 4 },

  // カラークローム・エフェクト: 彩度がこの値以上なら
  colorChrome: [[38, 'strong'], [26, 'weak'], [0, 'off']],

  // 確度
  confidence: { lowClip: 30, lowContrast: 20, lowScore: 0.5, highScore: 0.95, highGap: 0.3, monoHighChroma: 1.5 },
};

const clamp = (v, { min, max }) => Math.min(max, Math.max(min, v));
const member = (x, [lo, hi], soft) => (x < lo ? Math.max(0, 1 - (lo - x) / soft) : x > hi ? Math.max(0, 1 - (x - hi) / soft) : 1);
const pickGE = (table, x) => table.find(([min]) => x >= min)[1];
const pickLE = (table, x) => table.find(([max]) => x <= max)[1];

/** フィルムシミュレーション候補（上位 2〜3 件）と確度 */
export function estimate(a) {
  const R = RULES;
  const neutral = a.chroma < R.mono.maxChroma;
  const toned = !neutral && a.chroma < R.toned.maxChroma && a.hueConsistency >= R.toned.minHueConsistency;
  const isMonoImage = neutral || toned;
  let candidates;
  if (isMonoImage) {
    const hard = a.contrast >= R.mono.acrosMinContrast;
    const monoWC = clamp(Math.round(a.meanB * R.wcPerB), X.RANGES.monoWC);
    const tone = monoWC > 0 ? '・暖色寄り' : monoWC < 0 ? '・寒色寄り' : '';
    const base = neutral ? '彩度ほぼゼロ' : `全体が 1 色に調色${tone}`;
    const acros = { filmSim: 'acros', monoFilter: 'none', monoWC, score: hard ? 1 : 0.7, why: `${base}・コントラスト高め` };
    const mono = { filmSim: 'monochrome', monoFilter: 'none', monoWC, score: hard ? 0.7 : 1, why: `${base}・コントラスト控えめ` };
    candidates = hard ? [acros, mono] : [mono, acros];
    const [h0, h1] = R.sepia.hue;
    if (toned && a.meanHue >= h0 && a.meanHue <= h1 && a.chroma >= R.sepia.minChroma) {
      candidates = [{ filmSim: 'sepia', monoFilter: null, monoWC: null, score: 1, why: '全体がセピア調（オレンジ〜イエロー）に調色' }, ...candidates.map((c) => ({ ...c, score: c.score * 0.7 }))].slice(0, 3);
    }
  } else {
    candidates = R.film
      .map((f) => ({ filmSim: f.id, monoFilter: null, why: f.why,
        score: (f.skin != null && a.skinRatio < f.skin) ? 0 : member(a.chroma, f.sat, R.softness.sat) * member(a.contrast, f.contrast, R.softness.contrast) }))
      .filter((c) => c.score > 0)
      .sort((p, q) => q.score - p.score)
      .slice(0, 3);
    // 必ず 2 件以上になるよう標準的な候補で補う
    for (const id of ['provia', 'astia']) {
      if (candidates.length >= 2) break;
      if (!candidates.some((c) => c.filmSim === id)) candidates.push({ filmSim: id, monoFilter: null, score: 0.1, why: '該当ルールが少ないため標準候補' });
    }
  }

  const C = R.confidence;
  const top = candidates[0].score, gap = top - (candidates[1]?.score ?? 0);
  const reasons = [];
  let level;
  if (a.clipBlack + a.clipWhite > C.lowClip) reasons.push('黒つぶれ・白飛びが多く、色の情報が少ない');
  if (a.contrast < C.lowContrast) reasons.push('輝度の幅が極端に狭い');
  if (top < C.lowScore) reasons.push('どのフィルムシミュレーションの特徴にもはっきり当てはまらない');
  if (reasons.length) level = '低';
  else if (toned) { level = '中'; reasons.push('調色の色味は推定。モノクロ調整の値は目安'); }
  else if (isMonoImage ? a.chroma < C.monoHighChroma : (top >= C.highScore && gap >= C.highGap)) { level = '高'; reasons.push('特徴が 1 つの候補にはっきり当てはまる'); }
  else { level = '中'; reasons.push('複数の候補が近い。候補を切り替えて比べてください'); }
  return { candidates, confidence: { level, reasons } };
}

/** 候補 1 件について X-T3 の範囲に収めたレシピ（name なし）を組み立てる */
export function buildRecipe(a, cand) {
  const R = RULES, W = R.wb;
  const mono = X.isMono(cand.filmSim);
  const r = X.defaultRecipe();
  r.filmSim = cand.filmSim;
  r.monoFilter = mono ? (cand.monoFilter || 'none') : null;
  r.monoWC = mono ? (cand.monoWC ?? 0) : null;
  r.shadow = clamp(pickLE(R.shadowTone, a.p5), X.RANGES.shadow);
  r.highlight = clamp(pickGE(R.highlightTone, a.p95), X.RANGES.highlight);
  r.dr = pickGE(R.dr, a.clipWhite);
  const minIso = X.DR_MODES.find((d) => d.id === r.dr).minIso;
  r.isoNote = minIso ? `ISO ${minIso}〜` : '';

  if (X.hasColor(cand.filmSim)) {
    r.color = clamp(Math.round((a.chroma - R.colorCenter[cand.filmSim]) / R.colorStep), X.RANGES.color);
    r.colorChrome = pickGE(R.colorChrome, a.chroma);
    const split = a.highlights.b - a.shadows.b;
    const tinted = Math.max(a.shadows.chroma, a.highlights.chroma, a.overall.chroma) >= W.minChroma;
    if (tinted) {
      const k = W.baseK + W.kPerB * a.shadows.b;
      r.wb = { mode: 'kelvin', kelvin: clamp(Math.round(k / W.kStep) * W.kStep, X.RANGES.kelvin) };
      r.wbShift = {
        r: clamp(Math.round(a.overall.a * W.shiftRPerA + split * W.shiftRPerSplit), X.RANGES.wbShift),
        b: clamp(Math.round(split * W.shiftBPerSplit), X.RANGES.wbShift),
      };
    }
  }
  r.source = 'analyzer';
  return r;
}

/* ---- RAW 現像用トーンカーブ ---- */
const CURVE_INPUTS = [0, 32, 64, 128, 192, 224, 255];

/** R/G/B 個別カーブの座標（入力 → 出力、7 点） */
export function toneCurves(a) {
  // ベース: 黒の浮き・白の上限・S 字の強さを輝度分布から決める
  const black = a.p5 > 20 ? Math.min(40, Math.round((a.p5 - 20) * 0.6)) : 0;
  const white = a.p95 >= 240 ? 255 : Math.max(215, a.p95 + 12);
  const k = Math.min(0.6, Math.max(-0.5, (a.contrast - 150) / 400));
  const base = (x) => { const t = x / 255; return black + (white - black) * (t - k * Math.sin(2 * Math.PI * t) / (2 * Math.PI)); };
  // 色: シャドウとハイライトそれぞれの「グレーからのずれ」をチャンネルごとに補間して足す
  const dev = (z) => { const g = 0.2126 * z.rgb[0] + 0.7152 * z.rgb[1] + 0.0722 * z.rgb[2]; return z.rgb.map((c) => c - g); };
  const dS = dev(a.shadows), dH = dev(a.highlights);
  return ['r', 'g', 'b'].map((ch, i) => {
    let prev = 0;
    const points = CURVE_INPUTS.map((x) => {
      const t = x / 255;
      const edge = Math.sin(Math.PI * t) ** 0.5; // 両端（純黒・純白）では色ずれを弱める
      let y = Math.round(base(x) + (dS[i] * (1 - t) + dH[i] * t) * (0.4 + 0.6 * edge));
      y = Math.min(255, Math.max(prev, y)); // 0〜255 に収め、単調増加を保つ
      prev = y;
      return [x, y];
    });
    return { channel: ch.toUpperCase(), points };
  });
}

export function curvesText(curves) {
  return ['# RAW現像用トーンカーブ（入力 → 出力）', ...curves.map((c) => `${c.channel}: ${c.points.map(([x, y]) => `${x}→${y}`).join(', ')}`)].join('\n');
}
