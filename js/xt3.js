// X-T3 パラメータ定義（唯一の真実）。
// 全ての入力 UI・バリデーション・表示はこのファイルだけを参照する。
// X-T3（X-Processor 4）に存在しない機能は追加しないこと。

export const FILM_SIMS = [
  { id: 'provia', label: 'PROVIA/スタンダード', q: 'PROVIA' },
  { id: 'velvia', label: 'Velvia/ビビッド', q: 'Velvia' },
  { id: 'astia', label: 'ASTIA/ソフト', q: 'ASTIA' },
  { id: 'classic-chrome', label: 'クラシッククローム', q: 'CLASSIC\nCHROME' },
  { id: 'pro-neg-hi', label: 'PRO Neg.Hi', q: 'PRO Neg\nHi' },
  { id: 'pro-neg-std', label: 'PRO Neg.Std', q: 'PRO Neg\nStd' },
  { id: 'eterna', label: 'ETERNA/シネマ', q: 'ETERNA' },
  // mono: フィルター（+Ye/+R/+G）とモノクロ調整（暖色〜寒色）が使える / noColor: カラー設定が効かない
  { id: 'monochrome', label: 'モノクロ', q: 'MONO', mono: true, noColor: true },
  { id: 'acros', label: 'ACROS', q: 'ACROS', mono: true, noColor: true },
  { id: 'sepia', label: 'セピア', q: 'SEPIA', noColor: true },
];

// モノクロ / ACROS 専用のフィルター
export const MONO_FILTERS = [
  { id: 'none', label: 'フィルターなし', q: 'STD' },
  { id: 'ye', label: '+Ye フィルター', q: '+Ye' },
  { id: 'r', label: '+R フィルター', q: '+R' },
  { id: 'g', label: '+G フィルター', q: '+G' },
];

export const DR_MODES = [
  { id: 'auto', label: 'AUTO', minIso: null },
  { id: 'dr100', label: 'DR100', minIso: null },
  { id: 'dr200', label: 'DR200', minIso: 320 },
  { id: 'dr400', label: 'DR400', minIso: 640 },
];

// グレイン・エフェクト / カラークローム・エフェクト 共通
export const EFFECT_LEVELS = [
  { id: 'off', label: 'OFF' },
  { id: 'weak', label: '弱' },
  { id: 'strong', label: '強' },
];

export const WB_MODES = [
  { id: 'auto', label: 'AUTO' },
  { id: 'kelvin', label: '色温度（K 指定）' },
  { id: 'daylight', label: '日光' },
  { id: 'shade', label: '日陰' },
  { id: 'fluorescent1', label: '蛍光灯1' },
  { id: 'fluorescent2', label: '蛍光灯2' },
  { id: 'fluorescent3', label: '蛍光灯3' },
  { id: 'incandescent', label: '電球' },
  { id: 'underwater', label: '水中' },
  { id: 'custom1', label: 'カスタム1' },
  { id: 'custom2', label: 'カスタム2' },
  { id: 'custom3', label: 'カスタム3' },
];

export const RANGES = {
  kelvin: { min: 2500, max: 10000, step: 10 },
  wbShift: { min: -9, max: 9 },
  monoWC: { min: -9, max: 9 }, // モノクロ調整: − が寒色（クール）、+ が暖色（ウォーム）
  highlight: { min: -2, max: 4 },
  shadow: { min: -2, max: 4 },
  color: { min: -4, max: 4 },
  sharpness: { min: -4, max: 4 },
  nr: { min: -4, max: 4 },
};

export const ISO = { nativeMin: 160, nativeMax: 12800, extMin: 80, extMax: 51200 };
export const SLOT_IDS = ['C1', 'C2', 'C3', 'C4', 'C5', 'C6', 'C7'];
export const SOURCES = ['manual', 'analyzer', 'location', 'lesson'];
export const LIMITS = { name: 60, note: 60, notes: 2000, tags: 12, tag: 20 };

const byId = (list, id) => list.find((x) => x.id === id);
export const filmSim = (id) => byId(FILM_SIMS, id);
export const isMono = (id) => !!filmSim(id)?.mono;
export const hasColor = (id) => !filmSim(id)?.noColor;
export const labelOf = (list, id) => byId(list, id)?.label ?? '—';

export const signed = (n) => (n > 0 ? `+${n}` : `${n}`);

export function defaultRecipe() {
  return {
    name: '', filmSim: 'provia', monoFilter: null, monoWC: null,
    dr: 'auto', grain: 'off', colorChrome: 'off',
    wb: { mode: 'auto', kelvin: 5500 }, wbShift: { r: 0, b: 0 },
    highlight: 0, shadow: 0, color: 0, sharpness: 0, nr: 0,
    isoNote: '', exposureNote: '', tags: [],
    source: 'manual', sourceRef: null, notes: '',
  };
}

/** 一部の項目だけ書かれたレシピ（ロケ地・講座のデータ）を既定値で補ったレシピにする */
export function fromPartial(partial) {
  const base = defaultRecipe();
  const r = { ...base, ...partial, wb: { ...base.wb, ...partial.wb }, wbShift: { ...base.wbShift, ...partial.wbShift }, tags: [...(partial.tags || [])] };
  const mono = isMono(r.filmSim);
  r.monoFilter = mono ? (r.monoFilter || 'none') : null;
  r.monoWC = mono ? (r.monoWC ?? 0) : null;
  if (r.wb.mode !== 'kelvin') r.wb.kelvin = null;
  return r;
}

const isInt = (v, { min, max }) => Number.isInteger(v) && v >= min && v <= max;
const isStr = (v, max) => typeof v === 'string' && v.length <= max;

/** パラメータ部分（id・日時以外）の検証。エラーメッセージの配列を返す。空なら有効。 */
export function validateRecipe(r) {
  const e = [];
  if (!r || typeof r !== 'object') return ['レシピの形式が不正です'];
  if (!isStr(r.name, LIMITS.name) || !r.name.trim()) e.push(`名前は 1〜${LIMITS.name} 文字で入力してください`);
  if (!filmSim(r.filmSim)) e.push('フィルムシミュレーションが X-T3 の範囲外です');
  else if (isMono(r.filmSim)) {
    if (!byId(MONO_FILTERS, r.monoFilter)) e.push('モノクロフィルターが不正です');
    if (!isInt(r.monoWC, RANGES.monoWC)) e.push('モノクロ調整（暖色〜寒色）は -9〜+9 の整数です');
  } else {
    if (r.monoFilter != null) e.push('モノクロフィルターはモノクロ / ACROS でのみ指定できます');
    if (r.monoWC != null) e.push('モノクロ調整はモノクロ / ACROS でのみ指定できます');
  }
  if (!byId(DR_MODES, r.dr)) e.push('ダイナミックレンジが不正です');
  if (!byId(EFFECT_LEVELS, r.grain)) e.push('グレイン・エフェクトが不正です');
  if (!byId(EFFECT_LEVELS, r.colorChrome)) e.push('カラークローム・エフェクトが不正です');
  if (!r.wb || !byId(WB_MODES, r.wb.mode)) e.push('ホワイトバランスが不正です');
  else if (r.wb.mode === 'kelvin' || r.wb.kelvin != null) {
    const k = RANGES.kelvin;
    if (!isInt(r.wb.kelvin, k) || r.wb.kelvin % k.step) e.push(`色温度は ${k.min}〜${k.max}K（${k.step}K 刻み）です`);
  }
  if (!r.wbShift || !isInt(r.wbShift.r, RANGES.wbShift) || !isInt(r.wbShift.b, RANGES.wbShift)) e.push('WB シフトは R/B とも -9〜+9 の整数です');
  for (const [key, label] of [['highlight', 'ハイライトトーン'], ['shadow', 'シャドウトーン'], ['color', 'カラー'], ['sharpness', 'シャープネス'], ['nr', 'ノイズリダクション']]) {
    const g = RANGES[key];
    if (!isInt(r[key], g)) e.push(`${label}は ${signed(g.min)}〜${signed(g.max)} の整数です`);
  }
  if (!isStr(r.isoNote ?? '', LIMITS.note)) e.push('ISO メモが長すぎます');
  if (!isStr(r.exposureNote ?? '', LIMITS.note)) e.push('露出メモが長すぎます');
  if (!isStr(r.notes ?? '', LIMITS.notes)) e.push('メモが長すぎます');
  if (!Array.isArray(r.tags) || r.tags.length > LIMITS.tags || r.tags.some((t) => !isStr(t, LIMITS.tag) || !t.trim())) e.push('タグが不正です');
  if (!SOURCES.includes(r.source)) e.push('source が不正です');
  if (r.sourceRef != null && !['string', 'number'].includes(typeof r.sourceRef)) e.push('sourceRef が不正です');
  return e;
}

/** 既知のフィールドだけを取り出したコピー（未知のフィールド＝画像データ等を持ち込ませない）。 */
export function cleanRecipe(r) {
  const mono = isMono(r.filmSim);
  return {
    name: r.name.trim(), filmSim: r.filmSim, monoFilter: mono ? r.monoFilter : null, monoWC: mono ? r.monoWC : null,
    dr: r.dr, grain: r.grain, colorChrome: r.colorChrome,
    wb: { mode: r.wb.mode, kelvin: r.wb.kelvin ?? null }, wbShift: { r: r.wbShift.r, b: r.wbShift.b },
    highlight: r.highlight, shadow: r.shadow, color: r.color, sharpness: r.sharpness, nr: r.nr,
    isoNote: r.isoNote ?? '', exposureNote: r.exposureNote ?? '',
    tags: [...new Set(r.tags.map((t) => t.trim()))],
    source: r.source, sourceRef: r.sourceRef ?? null, notes: r.notes ?? '',
  };
}

export function filmLabel(r) {
  const f = filmSim(r.filmSim);
  if (!f) return '—';
  if (f.mono && r.monoFilter && r.monoFilter !== 'none') return `${f.label} ${byId(MONO_FILTERS, r.monoFilter)?.q ?? ''}`;
  return f.label;
}

export function wbLabel(r) {
  if (r.wb.mode === 'kelvin') return `${r.wb.kelvin}K`;
  return labelOf(WB_MODES, r.wb.mode);
}

/** モノクロ調整の表示: WC +3（暖） / WC -2（寒） / WC 0 */
export function wcLabel(v) {
  if (v == null) return '—';
  return `WC ${signed(v)}${v > 0 ? '（暖）' : v < 0 ? '（寒）' : ''}`;
}

/** DR と ISO メモの組み合わせチェック。問題なければ null。 */
export function drWarning(r) {
  const dr = byId(DR_MODES, r.dr);
  if (!dr?.minIso) return null;
  const isos = (String(r.isoNote ?? '').match(/\d+/g) || []).map(Number).filter((n) => n >= ISO.extMin && n <= ISO.extMax);
  if (!isos.length) return { level: 'info', text: `${dr.label} は ISO${dr.minIso} 以上が必要です` };
  const min = Math.min(...isos);
  if (min < dr.minIso) return { level: 'warn', text: `ISO${min} では ${dr.label} を使えません（ISO${dr.minIso} 以上が必要）` };
  return null;
}
