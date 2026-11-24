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

  // ホワイトバランス: 中間調（輝度 p25〜p75）の平均色だけから決める（シャドウ / ハイライトの色の差は使わない）。
  //   色温度 K = 撮影条件の基準 K を、中間調の b*（+ が黄）1 あたり miredPerB ミレッド暖色側へずらした値（kStep 刻み）
  //   WB シフト R = 中間調の a*（+ が赤〜マゼンタ、− がグリーン）× shiftRPerA、B = a* × shiftBPerA
  //   WB シフトは ±shiftMax を基本の幅とし、超えるときは ±shiftMax で止めて警告を出す
  //   中間調の彩度 C* が minChroma 未満で、撮影条件が昼光なら WB は AUTO のまま
  wb: { minChroma: 3, miredPerB: 3, kStep: 100, shiftRPerA: 1 / 3, shiftBPerA: 1 / 6, shiftMax: 4 },
  // スプリットトーン: シャドウとハイライトの (a*, b*) の差が minDiff 以上なら「カメラ内では再現できない」と注記する。
  //   ハイライト（上位 25%）の明るさ L* が minHighL 未満の暗い画像では、上位 25% もまだ暗部なので判定しない
  split: { minDiff: 10, minHighL: 40 },

  // 黒が浮いている画像のシャドウトーン（0〜-2。柔らかくする方向）: p5 がこの値以下なら → トーン
  shadowToneLifted: [[24, 0], [40, -1], [255, -2]],

  // ダイナミックレンジ（光源）: 暗い画像（露出の目安が maxEV 以下）では、光源の面積（%）がこの値以上なら
  //   その DR にする（白飛び率から決めた DR より強いほうを採る）。看板・ネオン・街灯の白飛びを抑えるため
  drLight: { maxEV: -1, table: [[3, 'dr400'], [0.5, 'dr200'], [0, 'dr100']] },
  // 夜景（撮影条件が夜の街）の ISO の目安
  nightIso: [3200, 6400],
  // 露出補正の目安: X-T3 のダイヤルの範囲（±3EV、1/3 段刻み）に収める
  exposure: { max: 3 },
  // トーンカーブ: 黒が浮いている画像では、出力の黒を p1 × liftBlack まで持ち上げる（最大 maxBlack）
  curve: { liftBlack: 0.9, maxBlack: 48 },

  // カラークローム・エフェクト: 彩度がこの値以上なら
  colorChrome: [[38, 'strong'], [26, 'weak'], [0, 'off']],

  // 撮影条件（光源の種類）の自動推定。上から順に当てはめる
  //   night: 露出の目安が maxEV 以下で、暗部（輝度 64 以下）が minDark 以上 → 夜の街
  //   tungsten: 露出の目安が maxEV 以下で、中間調の b*（黄み）が minMidB 以上、色相が hue の範囲 → 室内（電球）
  //   sunset: 光源の色相が hue の範囲（オレンジ〜イエロー）で彩度 C* が minLightC 以上、ハイライトの b* が minHighB 以上 → 夕方
  //   cloudy: コントラスト（p95−p5）が maxContrast 以下・白飛びが maxClipWhite% 以下・露出の目安が ev の範囲 → 曇り・日陰
  //   どれでもなければ昼光
  scene: {
    night: { maxEV: -2, minDark: 0.6 },
    tungsten: { maxEV: -0.8, minMidB: 10, hue: [40, 100] },
    sunset: { hue: [30, 100], minLightC: 20, minHighB: 15 },
    cloudy: { maxContrast: 120, maxClipWhite: 0.5, ev: [-1.5, 1] },
  },

  // 要約の言葉: 露出の目安（EV）がこの値以下 → 言葉
  summaryEV: [[-2.5, 'かなり暗い'], [-1.2, '暗め'], [1, null /* 標準 */], [2, '明るめ'], [Infinity, 'かなり明るい']],
  // 要約: 光源の面積（割合）がこの値未満 → 言葉
  summaryLightArea: [[0.02, '少しだけ'], [0.1, 'ところどころに'], [Infinity, '広く']],

  // 確度
  //   以下のどれかに当てはまる画像は、色の情報が少ないので「高」を出さない（理由を表示する）
  //   maxDark: 暗部（輝度 64 以下）の割合がこれを超える / minChroma: カラー画像で平均彩度 C* がこれ未満 /
  //   minRestChroma: 色の強い光源（C* が lightChroma 以上）があり、光源以外の平均彩度 C* がこれ未満
  confidence: { lowClip: 30, lowContrast: 20, lowScore: 0.5, highScore: 0.95, highGap: 0.3, monoHighChroma: 1.5,
    maxDark: 0.85, minChroma: 6, minRestChroma: 6, lightChroma: 20 },
};

/** 撮影条件。kelvin = その光の下で白が白に写る色温度（WB の K 値の基準） */
export const SCENES = [
  { id: 'auto', label: '自動' },
  { id: 'daylight', label: '昼光', kelvin: 5500 },
  { id: 'cloudy', label: '曇り・日陰', kelvin: 7000 },
  { id: 'sunset', label: '夕方', kelvin: 4500 },
  { id: 'night', label: '夜の街（街灯・ネオン）', kelvin: 4000 },
  { id: 'tungsten', label: '室内（電球）', kelvin: 3200 },
];
export const sceneOf = (id) => SCENES.find((x) => x.id === id) ?? SCENES[1];

const inRange = (x, [lo, hi]) => x >= lo && x <= hi;
/** 暗さと光源の色から撮影条件を推定する（'auto' 以外の id を返す） */
export function guessScene(a) {
  const S = RULES.scene;
  if (a.exposureEV <= S.night.maxEV && a.darkRatio >= S.night.minDark) return 'night';
  const m = a.midtones;
  if (m && a.exposureEV <= S.tungsten.maxEV && m.b >= S.tungsten.minMidB && inRange(m.hue, S.tungsten.hue)) return 'tungsten';
  if (a.light && inRange(a.light.hue, S.sunset.hue) && a.light.chroma >= S.sunset.minLightC && a.highlights.b >= S.sunset.minHighB) return 'sunset';
  if (a.contrast <= S.cloudy.maxContrast && a.clipWhite <= S.cloudy.maxClipWhite && inRange(a.exposureEV, S.cloudy.ev)) return 'cloudy';
  return 'daylight';
}

// 色名 → 形容（要約用）
const COLOR_WORD = { レッド: '赤い', オレンジ: 'オレンジの', アンバー: '琥珀色の', イエロー: '黄色い', グリーン: '緑の', ティール: '青緑の', シアン: '水色の',
  ブルー: '青い', パープル: '紫の', マゼンタ: 'マゼンタの', ニュートラル: '白い' };
const fmtEV = (ev) => { const v = Math.round(ev * 10) / 10; return `${v > 0 ? '+' : v < 0 ? '-' : '±'}${Math.abs(v).toFixed(1)}EV`; };

/** 結果の冒頭に出す、言葉の要約（1〜2 文） */
export function summarize(a, sceneId = guessScene(a)) {
  const R = RULES;
  const word = R.summaryEV.find(([max]) => a.exposureEV <= max)[1];
  const noun = sceneId === 'night' ? '夜景' : '画像';
  const first = word ? `全体が${word}（約${fmtEV(a.exposureEV)}）${noun}。` : `明るさは標準的（約${fmtEV(a.exposureEV)}）な${noun}。`;
  const lift = a.blackLift ? '黒が浮いた' : a.clipBlack >= 5 ? '黒がつぶれた' : '';
  const cast = (z) => (z.strength === 'なし' ? 'ニュートラルな' : `${z.name}寄りの`);
  const dark = a.exposureEV <= R.summaryEV[1][0];
  let second;
  if (dark) {
    second = `${lift}${cast(a.shadows)}暗部`;
    if (a.light) second += `に、${COLOR_WORD[a.light.name] ?? ''}光源が${R.summaryLightArea.find(([max]) => a.light.ratio < max)[1]}ある`;
    else second += 'で、明るい光源は無い';
  } else {
    second = `${lift ? `${lift}、` : ''}シャドウは${a.shadows.strength === 'なし' ? 'ニュートラル' : a.shadows.name}、ハイライトは${a.highlights.strength === 'なし' ? 'ニュートラル' : a.highlights.name}`;
    if (a.light && a.light.strength !== 'なし' && a.light.chroma >= 20) second += `。${COLOR_WORD[a.light.name] ?? ''}光源がある`;
  }
  return `${first}${second}。`;
}

const clamp = (v, { min, max }) => Math.min(max, Math.max(min, v));
const member = (x, [lo, hi], soft) => (x < lo ? Math.max(0, 1 - (lo - x) / soft) : x > hi ? Math.max(0, 1 - (x - hi) / soft) : 1);
const pickGE = (table, x) => table.find(([min]) => x >= min)[1];
const pickLE = (table, x) => table.find(([max]) => x <= max)[1];

/** フィルムシミュレーション候補（上位 2〜3 件）と確度 */
export function estimate(a, { scene = 'auto' } = {}) {
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
  // 色の情報が少ない画像（「高」を出さない理由）
  const weak = [];
  if (a.darkRatio > C.maxDark) weak.push(`暗部（輝度64以下）が ${Math.round(a.darkRatio * 100)}% で、色の情報が少ない`);
  if (!isMonoImage && a.chroma < C.minChroma) weak.push(`彩度 C* が ${a.chroma.toFixed(1)} と低く、色の手がかりが少ない`);
  if (!isMonoImage && a.light && a.light.chroma >= C.lightChroma && a.chromaNonLight < C.minRestChroma) weak.push('色が光源に偏っていて、光源以外の色の情報が少ない');
  if (reasons.length) level = '低';
  else if (toned) { level = '中'; reasons.push('調色の色味は推定。モノクロ調整の値は目安'); }
  else if (isMonoImage ? a.chroma < C.monoHighChroma : (top >= C.highScore && gap >= C.highGap)) { level = '高'; reasons.push('特徴が 1 つの候補にはっきり当てはまる'); }
  else { level = '中'; reasons.push('複数の候補が近い。候補を切り替えて比べてください'); }
  if (weak.length && level !== '低') {
    if (level === '高') { level = '中'; reasons.length = 0; }
    reasons.push(...weak);
  }
  const auto = !scene || scene === 'auto';
  const id = auto ? guessScene(a) : sceneOf(scene).id;
  return { candidates, confidence: { level, reasons }, scene: { id, label: sceneOf(id).label, auto } };
}

/** 露出補正の目安（1/3 段刻み、±3EV まで）の表記: +3EV / -2 1/3EV / -2/3EV / ±0EV */
export function formatEV(ev) {
  const max = RULES.exposure.max;
  const thirds = Math.round(Math.min(max, Math.max(-max, ev)) * 3);
  if (thirds === 0) return '±0EV';
  const sign = thirds > 0 ? '+' : '-', whole = Math.floor(Math.abs(thirds) / 3), frac = Math.abs(thirds) % 3;
  return `${sign}${whole || ''}${whole && frac ? ' ' : ''}${frac ? `${frac}/3` : ''}EV`;
}

/** スプリットトーン（シャドウとハイライトの色の差）があれば { diff, shadow, highlight }、無ければ null */
export function splitTone(a) {
  const diff = Math.hypot(a.highlights.a - a.shadows.a, a.highlights.b - a.shadows.b);
  if (diff < RULES.split.minDiff || a.highlights.L < RULES.split.minHighL) return null;
  const nm = (z) => (z.strength === 'なし' ? 'ニュートラル' : z.name);
  return { diff, shadow: nm(a.shadows), highlight: nm(a.highlights) };
}

/**
 * 候補 1 件について X-T3 の範囲に収めたレシピ（name なし）と、その説明を組み立てる。
 * @param {object} [opt]
 * @param {string} [opt.scene] 撮影条件の id（SCENES）。'auto' か省略で推定する
 * @returns {{ recipe, notes: string[], warnings: string[] }} notes = カメラ内で再現できないことなどの注記 / warnings = 警告
 */
export function planRecipe(a, cand, { scene = 'auto' } = {}) {
  const R = RULES, W = R.wb;
  const sceneId = !scene || scene === 'auto' ? guessScene(a) : sceneOf(scene).id;
  const sc = sceneOf(sceneId);
  const notes = [], warnings = [];
  const mono = X.isMono(cand.filmSim);
  const r = X.defaultRecipe();
  r.filmSim = cand.filmSim;
  r.monoFilter = mono ? (cand.monoFilter || 'none') : null;
  r.monoWC = mono ? (cand.monoWC ?? 0) : null;

  // トーン: 黒が浮いている画像では締めない（0〜-2）
  if (a.blackLift) {
    r.shadow = clamp(pickLE(R.shadowToneLifted, a.p5), X.RANGES.shadow);
    notes.push(`黒が浮いている（p5 = ${a.p5}）。黒の浮きそのものはカメラ内では作れないので、シャドウトーンは ${X.signed(r.shadow)}（柔らかく）にとどめ、RAW現像のトーンカーブ出力で黒を持ち上げる`);
  } else r.shadow = clamp(pickLE(R.shadowTone, a.p5), X.RANGES.shadow);
  r.highlight = clamp(pickGE(R.highlightTone, a.p95), X.RANGES.highlight);

  // DR: 白飛び率に加えて、暗い画像では光源の面積も見る
  const order = X.DR_MODES.map((d) => d.id);
  r.dr = pickGE(R.dr, a.clipWhite);
  if (a.light && a.exposureEV <= R.drLight.maxEV) {
    const byLight = pickGE(R.drLight.table, a.light.ratio * 100);
    if (order.indexOf(byLight) > order.indexOf(r.dr)) {
      r.dr = byLight;
      notes.push(`光源（${a.light.label}・面積 ${(a.light.ratio * 100).toFixed(1)}%）の白飛びを抑えるため ${X.labelOf(X.DR_MODES, r.dr)}`);
    }
  }
  const minIso = X.DR_MODES.find((d) => d.id === r.dr).minIso;
  if (sceneId === 'night') {
    const [lo, hi] = R.nightIso;
    r.isoNote = `ISO ${Math.max(lo, minIso || 0)}〜${hi}（夜景の目安）`;
  } else r.isoNote = minIso ? `ISO ${minIso}〜` : '';

  // 露出補正の目安（中央値と中間グレーの差。ダイヤルの ±3EV に収める）
  r.exposureNote = `${formatEV(a.exposureEV)}（目安。元画像の中央値は${a.exposureEV >= 0 ? '+' : '-'}${Math.abs(a.exposureEV).toFixed(1)}EV）`;
  if (Math.abs(a.exposureEV) > R.exposure.max + 1 / 6) notes.push(`元画像の明るさは露出補正の範囲（±${R.exposure.max}EV）を超えている。残りは RAW 現像で調整`);

  if (X.hasColor(cand.filmSim)) {
    r.color = clamp(Math.round((a.chroma - R.colorCenter[cand.filmSim]) / R.colorStep), X.RANGES.color);
    r.colorChrome = pickGE(R.colorChrome, a.chroma);
    // WB: 中間調だけから決める
    const m = a.midtones ?? a.overall;
    if (m.chroma >= W.minChroma || sceneId !== 'daylight') {
      const mired = 1e6 / sc.kelvin - W.miredPerB * m.b;
      const k = mired > 0 ? 1e6 / mired : X.RANGES.kelvin.max;
      r.wb = { mode: 'kelvin', kelvin: clamp(Math.round(k / W.kStep) * W.kStep, X.RANGES.kelvin) };
      const lim = { min: -W.shiftMax, max: W.shiftMax };
      const raw = { r: Math.round(m.a * W.shiftRPerA), b: Math.round(m.a * W.shiftBPerA) };
      r.wbShift = { r: clamp(raw.r, lim), b: clamp(raw.b, lim) };
      if (raw.r !== r.wbShift.r || raw.b !== r.wbShift.b) {
        warnings.push(`中間調の色被り（${m.name}）が強く、WB シフトが基本の幅（±${W.shiftMax}）の上限に達した。この設定で撮ると全体が染まりやすいので、残りは RAW 現像で調整`);
      }
    }
    const sp = splitTone(a);
    if (sp) notes.push(`シャドウ（${sp.shadow}）とハイライト（${sp.highlight}）の色の差（スプリットトーン）はカメラ内では再現できない。WB には入れず、RAW現像のトーンカーブで再現（下のトーンカーブに反映済み）`);
  }
  r.source = 'analyzer';
  return { recipe: r, notes, warnings, scene: { id: sceneId, label: sc.label } };
}

/** 候補 1 件について X-T3 の範囲に収めたレシピ（name なし）を組み立てる */
export function buildRecipe(a, cand, opt) { return planRecipe(a, cand, opt).recipe; }

/* ---- RAW 現像用トーンカーブ ---- */
const CURVE_INPUTS = [0, 32, 64, 128, 192, 224, 255];

/** R/G/B 個別カーブの座標（入力 → 出力、7 点） */
export function toneCurves(a) {
  // ベース: 黒の浮き・白の上限・S 字の強さを輝度分布から決める
  // 黒が浮いている画像では、出力の黒を p1 付近まで持ち上げる（カメラ内では作れない部分）
  const black = (a.blackLift ?? a.p5 >= 15) ? Math.min(RULES.curve.maxBlack, Math.round(a.p1 * RULES.curve.liftBlack)) : 0;
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

export function curvesText(curves, a) {
  const head = ['# RAW現像用トーンカーブ（入力 → 出力）'];
  const sp = a && splitTone(a);
  if (sp) head.push(`# スプリットトーン: シャドウ ${sp.shadow} / ハイライト ${sp.highlight}（カメラ内では再現できない分）`);
  if (a?.blackLift) head.push(`# 黒の浮き: 出力の黒を約 ${curves[1]?.points[0][1] ?? 0} に持ち上げる`);
  return [...head, ...curves.map((c) => `${c.channel}: ${c.points.map(([x, y]) => `${x}→${y}`).join(', ')}`)].join('\n');
}
