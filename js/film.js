// 作品（映画）単位のまとめ・検索・年代の絞り込み（DOM 非依存。tests/film.test.mjs でテスト）
// ・同じ作品のロケ地は titleEn と year が同じもの。作品のキーは英題と年からつくる（例: lost-in-translation-2003）
// ・名前（監督・撮影・出演・製作・配給）で作品を探せる。複数の名前は「、」で区切って入っている

/** 作品のキー（URL に使う） */
export function workKey(l) {
  const slug = String(l.titleEn || l.title).normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return `${slug || 'work'}-${l.year}`;
}

/** 作品ごとにまとめる（作品の情報は最初のロケ地から）。年の新しい順ではなく、データの並び順 */
export function groupWorks(locations) {
  const map = new Map();
  for (const l of locations) {
    const key = workKey(l);
    if (!map.has(key)) map.set(key, { key, title: l.title, titleEn: l.titleEn, year: l.year, director: l.director, info: l, locations: [] });
    map.get(key).locations.push(l);
  }
  return [...map.values()];
}

/* ---- 年代 ---- */
export const DECADES = [
  { id: '1960s-', label: '〜1960年代', from: -Infinity, to: 1969 },
  { id: '1970s', label: '70年代', from: 1970, to: 1979 },
  { id: '1980s', label: '80年代', from: 1980, to: 1989 },
  { id: '1990s', label: '90年代', from: 1990, to: 1999 },
  { id: '2000s', label: '2000年代', from: 2000, to: 2009 },
  { id: '2010s+', label: '2010年代〜', from: 2010, to: Infinity },
];
export const decadeOf = (year) => DECADES.find((d) => year >= d.from && year <= d.to)?.id ?? null;
export const inDecade = (year, id) => id === 'all' || decadeOf(year) === id;
/** 年代ごとの件数（DECADES の順） */
export const decadeCounts = (locations) => DECADES.map((d) => ({ ...d, count: locations.filter((l) => decadeOf(l.year) === d.id).length }));

/* ---- 名前 ---- */
export const ROLE_LABEL = { director: '監督', cinematographer: '撮影', cast: '出演', production: '製作', distributor: '配給' };
const split = (s) => String(s || '').split(/[、,／]/).map((x) => x.trim()).filter(Boolean);

/** ロケ地（作品）に出てくる名前 [{ name, role, detail }]。detail は役名や「日本」など */
export function namesOf(l) {
  const out = [];
  for (const n of split(l.director)) out.push({ name: n, role: 'director', kind: 'person' });
  for (const n of split(l.cinematographer)) out.push({ name: n, role: 'cinematographer', kind: 'person' });
  for (const c of l.cast || []) if (c?.name) out.push({ name: c.name, role: 'cast', kind: 'person', detail: c.role || null });
  for (const n of l.production || []) for (const x of split(n)) out.push({ name: x, role: 'production', kind: 'company' });
  const d = l.distributor || {};
  for (const x of split(d.original)) out.push({ name: x, role: 'distributor', kind: 'company', detail: '原題国' });
  for (const x of split(d.japan)) out.push({ name: x, role: 'distributor', kind: 'company', detail: '日本' });
  return out;
}

/** 検索用に揃える（全角・半角、大文字・小文字、中黒・空白・記号の違いを無視） */
export const fold = (s) => String(s || '').normalize('NFKC').toLowerCase().replace(/[\s・･·\-‐ー=＝.,、。'’"“”!?！？:：()（）「」『』]/g, '');

/**
 * 検索。作品（邦題・英題）と名前（監督・撮影・出演・製作・配給）を探す
 * @returns {{ works: object[], names: { name: string, kind: 'person'|'company', roles: string[], count: number }[] }}
 */
export function search(locations, query, { decade = 'all' } = {}) {
  const q = fold(query);
  const works = groupWorks(locations.filter((l) => inDecade(l.year, decade)));
  if (!q) return { works: [], names: [] };
  const hitWorks = works.filter((w) => fold(w.title).includes(q) || fold(w.titleEn).includes(q));
  const names = new Map();
  for (const w of works) {
    for (const n of namesOf(w.info)) {
      if (!fold(n.name).includes(q)) continue;
      const cur = names.get(n.name) || { name: n.name, kind: n.kind, roles: new Set(), works: new Set() };
      cur.roles.add(n.role); cur.works.add(w.key);
      names.set(n.name, cur);
    }
  }
  return {
    works: hitWorks,
    names: [...names.values()].map((n) => ({ name: n.name, kind: n.kind, roles: [...n.roles], count: n.works.size }))
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'ja')),
  };
}

/** その名前が関わる作品と役割 [{ work, roles: [{ role, detail }] }]（年の古い順） */
export function worksByName(locations, name) {
  const out = [];
  for (const w of groupWorks(locations)) {
    const roles = namesOf(w.info).filter((n) => n.name === name).map((n) => ({ role: n.role, detail: n.detail ?? null }));
    if (roles.length) out.push({ work: w, roles });
  }
  return out.sort((a, b) => a.work.year - b.work.year);
}

/* ---- 講座 ↔ ロケ地 ---- */
export const locationsForLesson = (locations, no) => locations.filter((l) => (l.lessons || []).includes(no));

/* ---- 画面比 ---- */
/** "2.39:1" → 2.39 */
export const aspectValue = (s) => {
  const m = String(s || '').match(/(\d+(?:\.\d+)?)\s*:\s*1(?!\d)/);
  return m ? Number(m[1]) : null;
};
/** 画面比が 1.85:1 以上なら X-T3 の画像サイズは 16:9（X-T3 は 3:2 / 16:9 / 1:1 だけ） */
export const needs169 = (aspect) => (aspectValue(aspect) ?? 0) >= 1.85;

/* ---- 表示用 ---- */
export const SCENE_TIME_LABEL = { 朝: '朝', 昼: '昼', 夕方: '夕方', マジックアワー: 'マジックアワー', 夜: '夜' };
export const isHex = (c) => /^#[0-9a-f]{6}$/i.test(c);
