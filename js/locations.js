// ロケ地データ → レシピ（DOM 非依存）
import * as X from './xt3.js';

/** ロケ地の推定レシピ（保存前の形） */
export function locationRecipe(loc) {
  const r = X.fromPartial(loc.recipe);
  r.name = `${loc.titleEn} — ${loc.city}`.slice(0, X.LIMITS.name);
  r.source = 'location';
  r.sourceRef = loc.id;
  r.notes = `推定レシピ（${loc.title} / ${loc.year}）。${loc.place}。\n色味: ${loc.look}`;
  return r;
}

/** data/locations.json（一度だけ読み込む。SW のプリキャッシュから返る） */
let cache = null;
export function loadLocations() {
  cache ??= fetch('data/locations.json').then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); }).then((d) => d.locations);
  cache.catch(() => { cache = null; });
  return cache;
}
