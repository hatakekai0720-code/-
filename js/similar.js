// 「この写真に近い映画」: 画像解析の結果と、各ロケ地（palette・look・recipe・sceneTime）を比べて、雰囲気の近い作品を選ぶ。
// DOM 非依存（tests/similar.test.mjs）。比較の重み・しきい値は下の RULES だけを書き換える。
import { rgbToLab } from './analyzer.js';
import { RULES as TR, textureEstimate } from './translator.js';
import { workKey } from './film.js';
import * as X from './xt3.js';

export const RULES = {
  // 比較する項目の重み（合計で割るので比だけが効く）
  weights: { palette: 3, tones: 2, light: 1.5, exposure: 2, contrast: 1, chroma: 1.5, blackLift: 0.5, grain: 0.7 },
  // 近さ（0〜1）= exp(−差 / scale)。palette・tones は Lab の ΔE / Δab、exposure は EV、chroma は C*
  scale: { palette: 28, tones: 18, light: 40 /* 色相の差（度） */, exposure: 2, chroma: 14 },
  // ロケ地の明るさ: 代表色の平均 L* から推定した EV を、時間帯でこの値以下に抑える（夜なら暗いはず）
  sceneTimeEV: { 夜: -2.5, マジックアワー: -1.2, 夕方: -0.5 },
  // 暗い画像（露出の目安が darkEV 以下）は彩度 C* が低く出やすいので、彩度の重みに darkChroma を掛ける
  darkEV: -1.5, darkChroma: 0.4,
  // コントラストの目安（−1 柔らか 〜 +1 硬い）: 画像は (p95−p5 − center) / range、ロケ地はトーン（ハイライト+シャドウ）と look の言葉
  contrast: { center: 170, range: 80, tonePer: 0.25 },
  // 光源: 画像の光源の C* がこれ以上のときだけ「色のある光源」として比べる。ロケ地は L* minL 以上・C* minChroma 以上の代表色を光源の候補にする
  light: { minChroma: 15, minL: 30 },
  // 理由に使う項目: 近さがこれ以上の項目から、重み × 近さの大きい順に 2 つ
  reasonMin: 0.6,
  top: 5,
};

// look の言葉 → 特徴
const LOOK = {
  light: /ネオン|光源|街明かり|看板|照明|街灯|ランプ|灯り|明かり/,
  hard: /高コントラスト|コントラスト強|硬い|深い影|黒く締|締まった/,
  soft: /低コントラスト|低めのコントラスト|柔らか|やわらか|穏やか|フラット|かすんだ|霧|煙/,
  lifted: /浮い|フェード|色あせ|褪せ|くすんだ|淡/,
  grain: /粒子/,
};

const hexToLab = (hex) => { const n = parseInt(hex.slice(1), 16); return rgbToLab((n >> 16) & 255, (n >> 8) & 255, n & 255); };
const chromaOf = ([, a, b]) => Math.hypot(a, b);
const hueOf = ([, a, b]) => (Math.atan2(b, a) * 180 / Math.PI + 360) % 360;
const hueDiff = (x, y) => { const d = Math.abs(x - y) % 360; return d > 180 ? 360 - d : d; };
const near = (d, scale) => Math.exp(-Math.abs(d) / scale);
const clamp1 = (v) => Math.max(-1, Math.min(1, v));
const ev18 = (L) => { const y = L > 8 ? ((L + 16) / 116) ** 3 : L / 903.3; return Math.log2(Math.max(y, 1e-4) / 0.18); };
const GRAIN_LV = { off: 0, weak: 1, strong: 2 };

/** ロケ地の特徴（代表色・レシピ・時間帯・look から） */
export function locationFeatures(loc) {
  const labs = (loc.palette || []).filter((c) => /^#[0-9a-f]{6}$/i.test(c)).map(hexToLab);
  if (!labs.length) return null;
  const byL = [...labs].sort((p, q) => p[0] - q[0]);
  const look = loc.look || '';
  const r = loc.recipe || {};
  const mono = X.isMono(r.filmSim) || r.filmSim === 'sepia' || /モノクロ/.test(look);
  let ev = ev18(labs.reduce((s, c) => s + c[0], 0) / labs.length);
  const cap = RULES.sceneTimeEV[loc.sceneTime];
  if (cap != null) ev = Math.min(ev, cap);
  let contrast = ((r.highlight ?? 0) + (r.shadow ?? 0)) * RULES.contrast.tonePer;
  if (LOOK.hard.test(look)) contrast += 0.5;
  if (LOOK.soft.test(look)) contrast -= 0.5;
  // 色のある代表色（光源の候補）の色相
  const lights = labs.filter((c) => c[0] >= RULES.light.minL && chromaOf(c) >= RULES.light.minChroma).map(hueOf);
  return {
    labs, shadow: byL[0], highlight: byL[byL.length - 1], mid: byL[Math.floor(byL.length / 2)],
    ev, contrast: clamp1(contrast), mono,
    chroma: mono ? 0 : (TR.colorCenter[r.filmSim] ?? 22) + (r.color ?? 0) * TR.colorStep,
    lights,
    lightWord: LOOK.light.test(look),
    lifted: LOOK.lifted.test(look) || (r.shadow ?? 0) <= -2,
    grain: GRAIN_LV[r.grain] ?? (LOOK.grain.test(look) ? 1 : 0),
  };
}

/** 画像の特徴（解析結果から） */
export function imageFeatures(a) {
  const labs = (a.palette || []).map(hexToLab);
  const tx = textureEstimate(a.texture);
  const C = RULES.contrast;
  const lightOk = a.light && a.light.chroma >= RULES.light.minChroma;
  return {
    labs, ev: a.exposureEV, contrast: clamp1((a.contrast - C.center) / C.range), chroma: a.chroma, mono: a.chroma < TR.mono.maxChroma,
    shadow: [a.shadows.L, a.shadows.a, a.shadows.b], highlight: [a.highlights.L, a.highlights.a, a.highlights.b], mid: a.midtones ? [a.midtones.L, a.midtones.a, a.midtones.b] : null,
    light: lightOk ? { hue: a.light.hue, chroma: a.light.chroma, name: a.light.name } : null,
    lifted: !!a.blackLift, grain: tx ? GRAIN_LV[tx.grain] : null, a,
  };
}

// 代表色どうしの距離: それぞれの色に一番近い相手の色との ΔE の平均（両方向）
function paletteDist(p, q) {
  if (!p.length || !q.length) return null;
  const one = (xs, ys) => xs.reduce((s, x) => s + Math.min(...ys.map((y) => Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2]))), 0) / xs.length;
  return (one(p, q) + one(q, p)) / 2;
}
const abDist = (x, y) => Math.hypot(x[1] - y[1], x[2] - y[2]);

/** 項目ごとの近さ（0〜1）。比べられない項目は入れない */
export function compare(img, loc) {
  const S = RULES.scale, s = {};
  const pd = paletteDist(img.labs, loc.labs);
  if (pd != null) s.palette = near(pd, S.palette);
  const tones = [abDist(img.shadow, loc.shadow), abDist(img.highlight, loc.highlight)];
  if (img.mid) tones.push(abDist(img.mid, loc.mid));
  s.tones = near(tones.reduce((x, y) => x + y, 0) / tones.length, S.tones);
  if (img.light) s.light = loc.lights.length ? Math.max(...loc.lights.map((h) => near(hueDiff(img.light.hue, h), S.light))) * (loc.lightWord ? 1 : 0.8) : 0.2;
  else s.light = loc.lightWord ? 0.4 : 0.8;
  s.exposure = near(img.ev - loc.ev, S.exposure);
  s.contrast = 1 - Math.abs(img.contrast - loc.contrast) / 2;
  s.chroma = img.mono !== loc.mono ? 0 : near(img.chroma - loc.chroma, S.chroma);
  s.blackLift = img.lifted === loc.lifted ? 1 : 0.3;
  if (img.grain != null) s.grain = 1 - Math.abs(img.grain - loc.grain) / 2;
  return s;
}

const COLOR_WORD = { レッド: '赤い', オレンジ: 'オレンジの', アンバー: '琥珀色の', イエロー: '黄色い', グリーン: '緑の', ティール: '青緑の', シアン: '水色の',
  ブルー: '青い', パープル: '紫の', マゼンタ: 'マゼンタの', ニュートラル: '白い' };

/** 近いと判断した理由の言葉（画像の側の特徴で言う） */
function phrase(key, img) {
  const a = img.a;
  switch (key) {
    case 'light': return img.light ? `${COLOR_WORD[img.light.name] ?? ''}${a.exposureEV <= -1 ? '光源' : 'ハイライト'}` : '色のある光源が無い';
    case 'exposure': return a.exposureEV <= -2 ? (a.darkRatio >= 0.6 ? '暗い夜景' : '暗い画面') : a.exposureEV <= -1 ? '暗めの画面' : a.exposureEV >= 1 ? '明るい画面' : '標準的な明るさ';
    case 'contrast': return img.contrast >= 0.4 ? '硬いコントラスト' : img.contrast <= -0.4 ? '柔らかいコントラスト' : '穏やかなコントラスト';
    case 'chroma': return img.mono ? 'モノクロ' : a.chroma < 12 ? '抑えた彩度' : a.chroma >= 30 ? '鮮やかな色' : '中くらいの彩度';
    case 'palette': return '色の組み合わせ';
    case 'tones': {
      const z = a.shadows.strength !== 'なし' ? ['暗部', a.shadows] : a.highlights.strength !== 'なし' ? ['ハイライト', a.highlights] : null;
      return z ? `${z[1].name}寄りの${z[0]}` : 'ニュートラルな色調';
    }
    case 'blackLift': return img.lifted ? '浮いた黒' : '締まった黒';
    case 'grain': return img.grain >= 2 ? '粗い粒子' : img.grain === 1 ? '細かい粒子' : 'なめらかな質感';
    default: return '';
  }
}

/** 重み付きの合計（0〜1）と理由 */
export function score(img, loc) {
  const W = { ...RULES.weights }, s = compare(img, loc);
  if (img.ev <= RULES.darkEV) W.chroma *= RULES.darkChroma;
  let sum = 0, wsum = 0;
  const parts = [];
  for (const [k, v] of Object.entries(s)) { const w = W[k] ?? 0; sum += w * v; wsum += w; parts.push({ key: k, sim: v, contrib: w * v }); }
  const reasons = parts.filter((p) => p.sim >= RULES.reasonMin && (W[p.key] ?? 0) > 0).sort((p, q) => q.contrib - p.contrib).slice(0, 2).map((p) => phrase(p.key, img));
  return { score: wsum ? sum / wsum : 0, parts: s, reason: reasons.length ? `${reasons.join('と')}が近い` : '全体の雰囲気がやや近い' };
}

/**
 * 解析結果に近い作品（上位 RULES.top 件）。同じ作品の複数のロケ地は、いちばん近いロケ地 1 件にまとめる。
 * @returns {{ key, title, year, location, score, reason, count }[]}
 */
export function similarWorks(a, locations, { top = RULES.top } = {}) {
  const img = imageFeatures(a);
  const best = new Map();
  for (const loc of locations) {
    const f = locationFeatures(loc);
    if (!f) continue;
    const r = score(img, f);
    const key = workKey(loc);
    const cur = best.get(key);
    if (!cur) best.set(key, { key, title: loc.title, titleEn: loc.titleEn, year: loc.year, location: loc, score: r.score, reason: r.reason, count: 1 });
    else {
      cur.count++;
      if (r.score > cur.score) Object.assign(cur, { location: loc, score: r.score, reason: r.reason });
    }
  }
  return [...best.values()].sort((p, q) => q.score - p.score).slice(0, top);
}
