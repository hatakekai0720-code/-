// localStorage ラッパー。キーは必ず xt3cine: で始める。画像は一切保存しない。
import { SLOT_IDS, validateRecipe, cleanRecipe, isMono } from './xt3.js';
import { validateCalibration, cleanCalibration, CAL_LIMITS } from './calibration.js';
import { sanitizeViews } from './japan.js';

export const PREFIX = 'xt3cine:';
const KEY = PREFIX + 'db';
export const VERSION = 4;
const QUOTA_ESTIMATE = 5 * 1024 * 1024; // ブラウザの一般的な上限の目安

let db = null;

const emptyDb = () => ({
  version: VERSION,
  recipes: [],
  slots: Object.fromEntries(SLOT_IDS.map((s) => [s, null])),
  pins: [],
  academy: { completed: [] },
  visited: {},   // 行ったロケ地: { [locationId]: { date: 'YYYY-MM-DD', memo } }（写真は持たない）
  palettes: {},  // 画像解析の代表色を作品のパレットとして保存: { [workKey]: { colors: ['#rrggbb', …], savedAt } }（数値のみ）
  calibration: [], // 較正データ: [{ id, savedAt, model, shotAt, settings: { 実際の設定 }, stats: { 解析の数値 } }]（画像は持たない）
  settings: {},
});

// スキーマ移行: MIGRATIONS[n] が version n → n+1 へ変換する
const MIGRATIONS = {
  // v1 → v2: WB「カスタム」を「カスタム1〜3」に分割、モノクロ調整（monoWC）を追加
  1: (d) => ({
    ...d,
    version: 2,
    recipes: Array.isArray(d.recipes) ? d.recipes.map((r) => {
      if (!r || typeof r !== 'object') return r;
      const wb = r.wb && r.wb.mode === 'custom' ? { ...r.wb, mode: 'custom1' } : r.wb;
      return { ...r, wb, monoWC: r.monoWC ?? (isMono(r.filmSim) ? 0 : null) };
    }) : d.recipes,
  }),
  // v2 → v3: 「行った」チェック（visited）と、作品ごとの解析パレット（palettes）を追加
  2: (d) => ({ ...d, version: 3, visited: isObj(d.visited) ? d.visited : {}, palettes: isObj(d.palettes) ? d.palettes : {} }),
  // v3 → v4: 判定ルールの較正データ（calibration）を追加
  3: (d) => ({ ...d, version: 4, calibration: Array.isArray(d.calibration) ? d.calibration : [] }),
};
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
    if (JSON.parse(raw).version !== VERSION) save(); // 移行したら新しい形式で書き戻す
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

/* ---- pins（ユーザー追加ピン。写真は持たない） ---- */
export const PIN_LIMITS = { name: 60, memo: 2000 };
export const pins = () => db.pins;
export const getPin = (id) => db.pins.find((p) => p.id === id) || null;

export function validatePin(p) {
  const e = [];
  if (typeof p.name !== 'string' || !p.name.trim() || p.name.length > PIN_LIMITS.name) e.push(`名前は 1〜${PIN_LIMITS.name} 文字で入力してください`);
  if (typeof (p.memo ?? '') !== 'string' || (p.memo ?? '').length > PIN_LIMITS.memo) e.push('メモが長すぎます');
  if (!Number.isFinite(p.lat) || Math.abs(p.lat) > 90 || !Number.isFinite(p.lng) || Math.abs(p.lng) > 180) e.push('座標が不正です');
  if (p.recipeId != null && !getRecipe(p.recipeId)) e.push('紐づけるレシピが見つかりません');
  return e;
}

/** 新規作成または更新 */
export function savePin(input, id = null) {
  const errors = validatePin(input);
  if (errors.length) return { errors };
  const clean = { name: input.name.trim(), memo: input.memo ?? '', lat: +input.lat.toFixed(6), lng: +input.lng.toFixed(6), recipeId: input.recipeId ?? null };
  let pin = id && getPin(id);
  if (pin) Object.assign(pin, clean);
  else { pin = { id: uid(), ...clean, createdAt: now() }; db.pins.push(pin); }
  return save() ? { pin } : { errors: ['保存できませんでした'] };
}

export function deletePin(id) {
  db.pins = db.pins.filter((p) => p.id !== id);
  save();
}

/** ロケ地などから取り込んだレシピ（source と sourceRef が一致するもの） */
export const findBySource = (source, ref) => db.recipes.find((r) => r.source === source && r.sourceRef === ref) || null;

/* ---- academy ---- */
export const completedLessons = () => db.academy.completed;
export function setLessonDone(no, done) {
  const set = new Set(db.academy.completed);
  if (done) set.add(no); else set.delete(no);
  db.academy.completed = [...set].sort((a, b) => a - b);
  save();
}

/* ---- 行った（ロケ地） ---- */
export const VISIT_LIMITS = { memo: 500 };
export const visited = () => db.visited;
export const getVisited = (id) => db.visited[id] || null;
const ID_RE = /^[a-z0-9-]{1,80}$/;
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const validDay = (s) => typeof s === 'string' && DAY_RE.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`)) && new Date(`${s}T00:00:00Z`).toISOString().startsWith(s);
export function validateVisit(id, v) {
  const e = [];
  if (typeof id !== 'string' || !ID_RE.test(id)) e.push('ロケ地が不正です');
  if (!validDay(v?.date)) e.push('日付を入力してください');
  if (typeof (v?.memo ?? '') !== 'string' || (v?.memo ?? '').length > VISIT_LIMITS.memo) e.push(`メモは ${VISIT_LIMITS.memo} 文字までです`);
  return e;
}
/** 行った日とメモを保存（写真は保存しない） */
export function setVisited(id, v) {
  const errors = validateVisit(id, v);
  if (errors.length) return { errors };
  db.visited[id] = { date: v.date, memo: v.memo ?? '' };
  return save() ? { visit: db.visited[id] } : { errors: ['保存できませんでした'] };
}
export function clearVisited(id) { delete db.visited[id]; save(); }

/* ---- 作品のパレット（画像解析の代表色。数値のみ） ---- */
const WORK_RE = /^[a-z0-9-]{1,120}$/;
const HEX_RE = /^#[0-9a-f]{6}$/;
export const palettes = () => db.palettes;
export const getPalette = (workKey) => db.palettes[workKey] || null;
export function savePalette(workKey, colors) {
  const list = (colors || []).map((c) => String(c).toLowerCase());
  if (!WORK_RE.test(workKey) || !list.length || list.length > 8 || !list.every((c) => HEX_RE.test(c))) return { errors: ['パレットが不正です'] };
  db.palettes[workKey] = { colors: list, savedAt: now() };
  return save() ? { palette: db.palettes[workKey] } : { errors: ['保存できませんでした'] };
}
export function deletePalette(workKey) { delete db.palettes[workKey]; save(); }

/* ---- 較正データ（JPEG の実際の設定 + 解析の数値。画像は保存しない） ---- */
export const calibration = () => db.calibration;
/** 追加。同じ機種・撮影日時・フィルムの組があれば置き換える */
export function addCalibration(entry) {
  const errors = validateCalibration(entry);
  if (errors.length) return { errors };
  const clean = cleanCalibration(entry);
  const same = (e) => clean.shotAt && e.shotAt === clean.shotAt && e.model === clean.model && e.settings.filmSim === clean.settings.filmSim;
  const prev = db.calibration.find(same);
  const rec = { id: prev?.id || uid(), savedAt: now(), ...clean };
  if (prev) db.calibration[db.calibration.indexOf(prev)] = rec;
  else {
    if (db.calibration.length >= CAL_LIMITS.entries) return { errors: [`較正データは ${CAL_LIMITS.entries} 件までです`] };
    db.calibration.push(rec);
  }
  return save() ? { entry: rec, replaced: !!prev } : { errors: ['保存できませんでした'] };
}
export function deleteCalibration(id) { db.calibration = db.calibration.filter((e) => e.id !== id); save(); }
export function clearCalibration() { db.calibration = []; save(); }

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
  if (obj && typeof obj === 'object') obj = structuredClone(obj);
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
  if (src.visited != null && !isObj(src.visited)) errors.push('visited が不正です');
  else for (const [id, v] of Object.entries(src.visited || {})) {
    if (!isObj(v) || validateVisit(id, v).length) { errors.push(`行ったロケ地「${String(id).slice(0, 40)}」: 形式が不正です`); continue; }
    out.visited[id] = { date: v.date, memo: v.memo ?? '' };
  }
  if (src.palettes != null && !isObj(src.palettes)) errors.push('palettes が不正です');
  else for (const [k, p] of Object.entries(src.palettes || {})) {
    const ok = WORK_RE.test(k) && isObj(p) && Array.isArray(p.colors) && p.colors.length >= 1 && p.colors.length <= 8 && p.colors.every((c) => typeof c === 'string' && HEX_RE.test(c.toLowerCase()));
    if (!ok) { errors.push(`パレット「${String(k).slice(0, 40)}」: 形式が不正です`); continue; }
    out.palettes[k] = { colors: p.colors.map((c) => c.toLowerCase()), savedAt: isDate(p.savedAt) ? p.savedAt : now() };
  }
  if (src.calibration != null && !Array.isArray(src.calibration)) errors.push('calibration が配列ではありません');
  else {
    const seen = new Set();
    (src.calibration || []).slice(0, CAL_LIMITS.entries).forEach((e, i) => {
      const errs = isObj(e) && typeof e.id === 'string' && e.id && e.id.length <= 80 && !seen.has(e.id) ? validateCalibration(e) : ['id が不正です'];
      if (errs.length) return errors.push(`較正データ ${i + 1}: ${errs[0]}`);
      seen.add(e.id);
      out.calibration.push({ id: e.id, savedAt: isDate(e.savedAt) ? e.savedAt : now(), ...cleanCalibration(e) });
    });
  }
  if (src.settings != null && !isObj(src.settings)) errors.push('settings が不正です');
  else out.settings = sanitizeSettings(src.settings || {});
  return errors.length ? { ok: false, errors } : { ok: true, db: out };
}

// 設定は既知のキーだけ通す
function sanitizeSettings(s) {
  const out = {};
  if (s.seeded === true) out.seeded = true;
  if (s.theme === 'light' || s.theme === 'dark') out.theme = s.theme;
  if (s.streetsAuto === false) out.streetsAuto = false; // 街路地図の自動ダウンロード（未設定 = オン）
  if (isObj(s.mapView) && Number.isFinite(s.mapView.lat) && Number.isFinite(s.mapView.lng) && Number.isFinite(s.mapView.zoom)) out.mapView = { lat: s.mapView.lat, lng: s.mapView.lng, zoom: s.mapView.zoom };
  const views = sanitizeViews(s.mapViews); // モードごとの最後の表示位置
  if (views) out.mapViews = views;
  if (['films', 'spots', 'all'].includes(s.mapMode)) out.mapMode = s.mapMode; // 地図の表示モード
  if (Array.isArray(s.spotCats) && s.spotCats.length <= 50 && s.spotCats.every((k) => typeof k === 'string' && /^[a-z0-9-]{1,40}$/.test(k))) out.spotCats = [...new Set(s.spotCats)]; // 撮影スポットの選択中のカテゴリ
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
    for (const [id, v] of Object.entries(incoming.visited || {})) if (!db.visited[id]) db.visited[id] = v;
    for (const [k, p] of Object.entries(incoming.palettes || {})) if (!db.palettes[k] || p.savedAt > db.palettes[k].savedAt) db.palettes[k] = p;
    for (const e of incoming.calibration || []) if (!db.calibration.some((x) => x.id === e.id) && db.calibration.length < CAL_LIMITS.entries) db.calibration.push(e);
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
    for (const s0 of seeds) {
      const s = { monoWC: isMono(s0.filmSim) ? 0 : null, ...s0 };
      if (validateRecipe(s).length || getRecipe(s.id)) continue;
      db.recipes.push({ id: s.id, createdAt: t, updatedAt: t, ...cleanRecipe(s) });
    }
    db.settings.seeded = true;
    save();
  } catch (err) {
    console.warn('初期レシピを読み込めませんでした', err);
  }
}
