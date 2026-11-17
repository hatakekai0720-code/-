// localStorage ラッパー。キーは必ず xt3cine: で始める。画像は一切保存しない。
import { SLOT_IDS, validateRecipe, cleanRecipe } from './xt3.js';

export const PREFIX = 'xt3cine:';
const KEY = PREFIX + 'db';
export const VERSION = 1;
const QUOTA_ESTIMATE = 5 * 1024 * 1024; // ブラウザの一般的な上限の目安

let db = null;

const emptyDb = () => ({
  version: VERSION,
  recipes: [],
  slots: Object.fromEntries(SLOT_IDS.map((s) => [s, null])),
  pins: [],
  academy: { completed: [] },
  settings: {},
});

// スキーマ移行: MIGRATIONS[n] が version n → n+1 へ変換する
const MIGRATIONS = {};
function migrate(obj) {
  let d = obj;
  while (d.version < VERSION) {
    const fn = MIGRATIONS[d.version];
    if (!fn) throw new Error(`version ${d.version} からの移行手順がありません`);
    d = fn(d);
  }
  return d;
}

export const uid = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`);
const now = () => new Date().toISOString();

export function init() {
  const raw = localStorage.getItem(KEY);
  if (raw == null) { db = emptyDb(); return { fresh: true }; }
  try {
    const res = validateDb(JSON.parse(raw));
    if (!res.ok) throw new Error(res.errors[0]);
    db = res.db;
    return { fresh: false };
  } catch (err) {
    // 壊れたデータは退避してから初期化する
    localStorage.setItem(KEY + '.corrupt', raw);
    db = emptyDb();
    return { fresh: true, corrupt: String(err.message || err) };
  }
}

function save() {
  try {
    localStorage.setItem(KEY, JSON.stringify(db));
    return true;
  } catch (err) {
    console.warn('保存に失敗しました', err);
    return false;
  }
}

/* ---- recipes ---- */
export const recipes = () => db.recipes;
export const getRecipe = (id) => db.recipes.find((r) => r.id === id) || null;

/** 新規作成または更新。検証エラー時は { errors } を返す。 */
export function saveRecipe(input, id = null) {
  const errors = validateRecipe(input);
  if (errors.length) return { errors };
  const clean = cleanRecipe(input);
  const t = now();
  let rec;
  if (id && getRecipe(id)) {
    rec = Object.assign(getRecipe(id), clean, { updatedAt: t });
  } else {
    rec = { id: id || uid(), createdAt: t, updatedAt: t, ...clean };
    db.recipes.push(rec);
  }
  return save() ? { recipe: rec } : { errors: ['保存できませんでした（保存容量を確認してください）'] };
}

export function duplicateRecipe(id) {
  const src = getRecipe(id);
  if (!src) return null;
  const name = `${src.name} のコピー`.slice(0, 60);
  return saveRecipe({ ...src, name }).recipe || null;
}

export function deleteRecipe(id) {
  db.recipes = db.recipes.filter((r) => r.id !== id);
  for (const s of SLOT_IDS) if (db.slots[s] === id) db.slots[s] = null;
  for (const p of db.pins) if (p.recipeId === id) p.recipeId = null;
  save();
}

/* ---- slots ---- */
export const slots = () => db.slots;
export const slotsOf = (recipeId) => SLOT_IDS.filter((s) => db.slots[s] === recipeId);
export function setSlot(slot, recipeId) {
  if (!SLOT_IDS.includes(slot)) return;
  db.slots[slot] = recipeId && getRecipe(recipeId) ? recipeId : null;
  save();
}

/* ---- settings ---- */
export const getSetting = (k) => db.settings[k];
export function setSetting(k, v) {
  if (v === undefined) delete db.settings[k]; else db.settings[k] = v;
  save();
}

/* ---- export / import ---- */
export function exportData() {
  return JSON.stringify({ app: 'xt3cine', exportedAt: now(), ...db }, null, 2);
}

const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);
const isDate = (v) => typeof v === 'string' && !Number.isNaN(Date.parse(v));

/** 任意の JSON を検証し、既知フィールドだけで組み直した db を返す。 */
export function validateDb(obj) {
  const errors = [];
  if (!isObj(obj)) return { ok: false, errors: ['JSON の最上位がオブジェクトではありません'] };
  if (!Number.isInteger(obj.version) || obj.version < 1) return { ok: false, errors: ['version がありません'] };
  if (obj.version > VERSION) return { ok: false, errors: [`このアプリより新しい形式（version ${obj.version}）です`] };
  let src;
  try { src = migrate(obj); } catch (err) { return { ok: false, errors: [err.message] }; }

  const out = emptyDb();
  if (!Array.isArray(src.recipes)) errors.push('recipes が配列ではありません');
  else {
    const seen = new Set();
    src.recipes.forEach((r, i) => {
      const tag = `レシピ ${i + 1}${r && typeof r.name === 'string' ? `「${r.name.slice(0, 20)}」` : ''}`;
      if (!isObj(r) || typeof r.id !== 'string' || !r.id || r.id.length > 80) return errors.push(`${tag}: id が不正です`);
      if (seen.has(r.id)) return errors.push(`${tag}: id が重複しています`);
      seen.add(r.id);
      const errs = validateRecipe(r);
      if (errs.length) return errors.push(`${tag}: ${errs[0]}`);
      const t = now();
      out.recipes.push({ id: r.id, createdAt: isDate(r.createdAt) ? r.createdAt : t, updatedAt: isDate(r.updatedAt) ? r.updatedAt : t, ...cleanRecipe(r) });
    });
  }
  const ids = new Set(out.recipes.map((r) => r.id));
  if (src.slots != null && !isObj(src.slots)) errors.push('slots が不正です');
  else for (const s of SLOT_IDS) {
    const v = src.slots?.[s] ?? null;
    out.slots[s] = v && ids.has(v) ? v : null;
  }
  if (src.pins != null && !Array.isArray(src.pins)) errors.push('pins が配列ではありません');
  else (src.pins || []).forEach((p, i) => {
    const ok = isObj(p) && typeof p.id === 'string' && p.id && typeof p.name === 'string' && p.name.length <= 60
      && Number.isFinite(p.lat) && Math.abs(p.lat) <= 90 && Number.isFinite(p.lng) && Math.abs(p.lng) <= 180
      && (p.memo == null || (typeof p.memo === 'string' && p.memo.length <= 2000));
    if (!ok) return errors.push(`ピン ${i + 1}: 形式が不正です`);
    out.pins.push({ id: p.id, name: p.name, lat: p.lat, lng: p.lng, memo: p.memo ?? '', recipeId: ids.has(p.recipeId) ? p.recipeId : null, createdAt: isDate(p.createdAt) ? p.createdAt : now() });
  });
  const done = src.academy?.completed ?? [];
  if (!Array.isArray(done) || done.some((n) => !Number.isInteger(n) || n < 1 || n > 50)) errors.push('academy.completed が不正です');
  else out.academy.completed = [...new Set(done)].sort((a, b) => a - b);
  if (src.settings != null && !isObj(src.settings)) errors.push('settings が不正です');
  else out.settings = sanitizeSettings(src.settings || {});
  return errors.length ? { ok: false, errors } : { ok: true, db: out };
}

// 設定は既知のキーだけ通す
function sanitizeSettings(s) {
  const out = {};
  if (s.seeded === true) out.seeded = true;
  if (s.theme === 'light' || s.theme === 'dark') out.theme = s.theme;
  if (Array.isArray(s.qmenuOrder) && s.qmenuOrder.length === 16 && s.qmenuOrder.every((k) => typeof k === 'string' && k.length < 20)) out.qmenuOrder = [...s.qmenuOrder];
  return out;
}

/** mode: 'replace' = 上書き / 'merge' = マージ（同じ id は更新日時が新しい方を残す） */
export function importData(incoming, mode) {
  if (mode === 'replace') {
    db = incoming;
  } else {
    for (const r of incoming.recipes) {
      const cur = getRecipe(r.id);
      if (!cur) db.recipes.push(r);
      else if (r.updatedAt > cur.updatedAt) Object.assign(cur, r);
    }
    for (const p of incoming.pins) if (!db.pins.some((x) => x.id === p.id)) db.pins.push(p);
    for (const s of SLOT_IDS) if (!db.slots[s] && incoming.slots[s]) db.slots[s] = incoming.slots[s];
    db.academy.completed = [...new Set([...db.academy.completed, ...incoming.academy.completed])].sort((a, b) => a - b);
  }
  db.settings.seeded = true;
  return save();
}

export function resetAll() {
  db = emptyDb();
  db.settings.seeded = true; // 全削除後に初期レシピを勝手に戻さない
  save();
}

/** このアプリが使っている localStorage の概算バイト数（UTF-16 換算）。 */
export function usage() {
  let bytes = 0;
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k.startsWith(PREFIX)) bytes += (k.length + (localStorage.getItem(k) || '').length) * 2;
  }
  return { bytes, quota: QUOTA_ESTIMATE, ratio: bytes / QUOTA_ESTIMATE };
}

/** 初回のみ data/recipes-seed.json を取り込む。 */
export async function seedIfNeeded() {
  if (db.settings.seeded) return;
  try {
    const res = await fetch('data/recipes-seed.json');
    const seeds = await res.json();
    const t = now();
    for (const s of seeds) {
      if (validateRecipe(s).length || getRecipe(s.id)) continue;
      db.recipes.push({ id: s.id, createdAt: t, updatedAt: t, ...cleanRecipe(s) });
    }
    db.settings.seeded = true;
    save();
  } catch (err) {
    console.warn('初期レシピを読み込めませんでした', err);
  }
}
