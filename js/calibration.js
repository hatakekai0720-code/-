// 判定ルールの較正（DOM 非依存。tests/calibration.test.mjs）
// 自分の JPEG から読んだ「実際の設定」と、その画像の解析の数値（統計値だけ。画像は持たない）の組を集め、
// フィルムシミュレーションごとの彩度・コントラストの分布を、translator.js の RULES と比べる。
// RULES はアプリ内で自動では書き換えない。「更新案」を JSON で書き出し、人が確かめてから translator.js に反映する。
import { RULES as TR } from './translator.js';
import { decodeFuji } from './exif.js';
import * as X from './xt3.js';

export const CAL_LIMITS = { entries: 1000 };
export const MIN_SAMPLES = 3; // 更新案を出すのに必要な、1 つのフィルムシミュレーションあたりの件数

// 保存する解析の数値（すべて有限の数値）
export const STAT_KEYS = ['chroma', 'chromaNonLight', 'saturation', 'contrast', 'p1', 'p5', 'p50', 'p95', 'exposureEV', 'lumaStd',
  'clipBlack', 'clipWhite', 'darkRatio', 'brightRatio', 'skinRatio', 'hueConsistency', 'meanA', 'meanB', 'midA', 'midB', 'grain', 'sharpness'];
// 保存する実際の設定（xt3.js の id / 数値。読めなかった項目は null）
export const SETTING_KEYS = ['filmSim', 'monoFilter', 'dr', 'grain', 'colorChrome', 'wbMode', 'kelvin', 'highlight', 'shadow', 'color', 'sharpness', 'nr'];

const r3 = (v) => Math.round(v * 1000) / 1000;

/** 解析結果 → 保存する統計値（数値のみ） */
export function calibrationStats(a) {
  const src = { ...a, midA: a.midtones?.a, midB: a.midtones?.b, grain: a.texture?.grain, sharpness: a.texture?.sharpness };
  const out = {};
  for (const k of STAT_KEYS) out[k] = Number.isFinite(src[k]) ? r3(src[k]) : null;
  return out;
}

/** JPEG の実際の設定 → 保存する設定。X-T3 で設定できない値・読めなかった値は null。フィルムが分からなければ null を返す */
export function calibrationSettings(exif) {
  const items = Object.fromEntries(decodeFuji(exif?.fuji).filter((it) => it.ok).map((it) => [it.key, it.value]));
  if (!items.filmSim) return null;
  return {
    filmSim: items.filmSim, monoFilter: items.monoFilter ?? null, dr: items.dr ?? null, grain: items.grain ?? null, colorChrome: items.colorChrome ?? null,
    wbMode: items.wb?.mode ?? null, kelvin: items.wb?.kelvin ?? null,
    highlight: items.highlight ?? null, shadow: items.shadow ?? null, color: items.color ?? null, sharpness: items.sharpness ?? null, nr: items.nr ?? null,
  };
}

/** 較正データ 1 件（id と savedAt は store が付ける）。作れなければ null */
export function calibrationEntry(exif, a) {
  const settings = calibrationSettings(exif);
  if (!settings) return null;
  return { model: String(exif.model || '').slice(0, 40) || null, shotAt: String(exif.dateTime || '').slice(0, 19) || null, settings, stats: calibrationStats(a) };
}

const inList = (list, v) => list.some((x) => x.id === v);
const intIn = (v, { min, max }) => Number.isInteger(v) && v >= min && v <= max;
/** 1 件の検証。エラーメッセージの配列（空なら有効） */
export function validateCalibration(e) {
  const err = [];
  if (!e || typeof e !== 'object') return ['形式が不正です'];
  if (e.model != null && (typeof e.model !== 'string' || e.model.length > 40)) err.push('機種名が不正です');
  if (e.shotAt != null && (typeof e.shotAt !== 'string' || e.shotAt.length > 19)) err.push('撮影日時が不正です');
  const s = e.settings;
  if (!s || typeof s !== 'object' || !X.filmSim(s.filmSim)) return [...err, 'フィルムシミュレーションが不正です'];
  const nul = (v, ok) => v == null || ok(v);
  if (!nul(s.monoFilter, (v) => inList(X.MONO_FILTERS, v))) err.push('フィルターが不正です');
  if (!nul(s.dr, (v) => inList(X.DR_MODES, v))) err.push('DR が不正です');
  if (!nul(s.grain, (v) => inList(X.EFFECT_LEVELS, v)) || !nul(s.colorChrome, (v) => inList(X.EFFECT_LEVELS, v))) err.push('エフェクトが不正です');
  if (!nul(s.wbMode, (v) => inList(X.WB_MODES, v)) || !nul(s.kelvin, (v) => intIn(v, X.RANGES.kelvin))) err.push('WB が不正です');
  for (const k of ['highlight', 'shadow', 'color', 'sharpness', 'nr']) if (!nul(s[k], (v) => intIn(v, X.RANGES[k]))) err.push(`${k} が不正です`);
  if (!e.stats || typeof e.stats !== 'object') err.push('統計値がありません');
  else for (const k of STAT_KEYS) { const v = e.stats[k]; if (v != null && (!Number.isFinite(v) || Math.abs(v) > 1e6)) err.push(`統計値 ${k} が不正です`); }
  return err;
}

/** 既知のフィールドだけのコピー（未知のフィールド＝画像データなどを持ち込ませない） */
export function cleanCalibration(e) {
  return {
    model: e.model ?? null, shotAt: e.shotAt ?? null,
    settings: Object.fromEntries(SETTING_KEYS.map((k) => [k, e.settings[k] ?? null])),
    stats: Object.fromEntries(STAT_KEYS.map((k) => [k, Number.isFinite(e.stats[k]) ? e.stats[k] : null])),
  };
}

/* ---- 分布と RULES の比較 ---- */

function dist(values) {
  const v = values.filter(Number.isFinite).sort((p, q) => p - q);
  if (!v.length) return null;
  const q = (p) => { const i = (v.length - 1) * p, lo = Math.floor(i), hi = Math.ceil(i); return v[lo] + (v[hi] - v[lo]) * (i - lo); };
  const mean = v.reduce((s, x) => s + x, 0) / v.length;
  const sd = Math.sqrt(v.reduce((s, x) => s + (x - mean) ** 2, 0) / v.length);
  return { n: v.length, mean: r3(mean), sd: r3(sd), min: v[0], max: v[v.length - 1], p10: r3(q(0.1)), p50: r3(q(0.5)), p90: r3(q(0.9)), values: v };
}
// 範囲 [lo, hi] からのずれ（中なら 0）
const offRange = (x, [lo, hi]) => (x < lo ? x - lo : x > hi ? x - hi : 0);

/**
 * フィルムシミュレーションごとの分布と、現在の RULES との差
 * @returns {{ id, label, n, chroma, contrast, chromaAtColor0, rule: { sat, contrast, colorCenter } | null, diff }[]}
 */
export function summarizeCalibration(entries) {
  const groups = new Map();
  for (const e of entries) {
    const id = e.settings.filmSim;
    if (!groups.has(id)) groups.set(id, []);
    groups.get(id).push(e);
  }
  return X.FILM_SIMS.filter((f) => groups.has(f.id)).map((f) => {
    const list = groups.get(f.id);
    const chroma = dist(list.map((e) => e.stats.chroma));
    const contrast = dist(list.map((e) => e.stats.contrast));
    // カラー設定の分を引いた彩度（= カラー 0 で撮ったときの彩度の推定）。RULES.colorCenter と比べる
    const chromaAtColor0 = dist(list.map((e) => (Number.isFinite(e.stats.chroma) ? e.stats.chroma - (e.settings.color ?? 0) * TR.colorStep : NaN)));
    const fr = TR.film.find((x) => x.id === f.id);
    const rule = fr ? { sat: fr.sat, contrast: fr.contrast, colorCenter: TR.colorCenter[f.id] ?? null } : null;
    const diff = rule && chroma && contrast ? {
      sat: r3(offRange(chroma.mean, rule.sat)), contrast: r3(offRange(contrast.mean, rule.contrast)),
      colorCenter: rule.colorCenter != null && chromaAtColor0 ? r3(chromaAtColor0.mean - rule.colorCenter) : null,
    } : null;
    return { id: f.id, label: f.label, n: list.length, chroma, contrast, chromaAtColor0, rule, diff };
  });
}

/** 設定値ごとの中央値（例: グレイン OFF / 弱 / 強 ごとの粒状感 σ） */
function medianBy(entries, settingKey, statKey, order) {
  const out = {};
  for (const v of order) {
    const d = dist(entries.filter((e) => e.settings[settingKey] === v).map((e) => e.stats[statKey]));
    if (d) out[v] = { n: d.n, median: d.p50 };
  }
  return out;
}

/**
 * 「この値で RULES を更新する案」。件数が MIN_SAMPLES 以上のフィルムだけ。アプリはこれを自動では反映しない
 */
export function proposeRules(entries, now = new Date().toISOString()) {
  const sum = summarizeCalibration(entries);
  const film = [], colorCenter = {};
  for (const s of sum) {
    if (s.n < MIN_SAMPLES || !s.rule) continue;
    film.push({ id: s.id, n: s.n, sat: [s.chroma.p10, s.chroma.p90].map((v) => Math.round(v)), contrast: [s.contrast.p10, s.contrast.p90].map((v) => Math.round(v)),
      current: { sat: s.rule.sat, contrast: s.rule.contrast } });
    if (s.chromaAtColor0 && s.rule.colorCenter != null) colorCenter[s.id] = { proposed: Math.round(s.chromaAtColor0.mean), current: s.rule.colorCenter };
  }
  // 質感: 設定ごとの中央値の中間をしきい値の案にする
  const grainBy = medianBy(entries, 'grain', 'grain', ['off', 'weak', 'strong']);
  const sharpBy = medianBy(entries, 'sharpness', 'sharpness', [-4, -3, -2, -1, 0, 1, 2, 3, 4]);
  const mid = (p, q) => (p && q ? r3((p.median + q.median) / 2) : null);
  const texture = {
    grainMedianBySetting: grainBy, sharpnessMedianBySetting: sharpBy,
    grainThresholds: { weak: mid(grainBy.off, grainBy.weak), strong: mid(grainBy.weak, grainBy.strong), current: TR.texture.grain.map(([v, id]) => [v, id]) },
  };
  return {
    app: 'xt3cine', kind: 'rules-proposal', generatedAt: now, samples: entries.length, minSamples: MIN_SAMPLES,
    note: '較正データから計算した translator.js の RULES の更新案。sat / contrast は各フィルムの 10〜90 パーセンタイル、colorCenter はカラー設定の分を引いた彩度の平均。アプリは自動で反映しない',
    film, colorCenter, texture,
  };
}
