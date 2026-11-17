// ロケ地データ → レシピ（DOM 非依存）
import * as X from './xt3.js';

/** ロケ地の推定レシピ（保存前の形） */
export function locationRecipe(loc) {
  const base = X.defaultRecipe();
  const r = { ...base, ...loc.recipe, wb: { ...base.wb, ...loc.recipe.wb }, wbShift: { ...base.wbShift, ...loc.recipe.wbShift } };
  const mono = X.isMono(r.filmSim);
  r.monoFilter = mono ? (r.monoFilter || 'none') : null;
  r.monoWC = mono ? (r.monoWC ?? 0) : null;
  r.name = `${loc.titleEn} — ${loc.city}`.slice(0, X.LIMITS.name);
  r.source = 'location';
  r.sourceRef = loc.id;
  r.notes = `推定レシピ（${loc.title} / ${loc.year}）。${loc.place}。\n色味: ${loc.look}`;
  return r;
}
