// 撮影スポットの詳細: カテゴリのおすすめレシピ（Qメニュー表示・レシピ帳に取り込み）・撮影のコツ・関連する講座・「行った」
import { h, toast } from '../ui/dom.js';
import { paramSummary } from '../ui/recipe-ui.js';
import { formatLatLng, haversine, formatKm } from '../geo.js';
import { loadSpots, loadCategories, categoryRecipe, SOURCE_LABELS } from '../spots.js';
import { loadLessons } from '../lessons.js';
import { visitCard } from './location.js';
import * as X from '../xt3.js';
import * as store from '../store.js';

const hostOf = (u) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return u; } };
const ext = (href, text, cls) => h('a', { class: cls, href, target: '_blank', rel: 'noopener noreferrer' }, text);

/** カテゴリの印（色つきの角丸の四角 + 1 文字。地図のピンと同じ形） */
export function catBadge(cat, size = 22) {
  return h('span', { class: 'spot-badge', style: `--c:${cat.color};width:${size}px;height:${size}px;font-size:${Math.round(size * 0.58)}px`, 'aria-hidden': 'true' }, cat.icon);
}

/** カテゴリのおすすめレシピのカード（Qメニュー表示・レシピ帳に取り込み） */
export function recipeCard(cat) {
  const recipe = categoryRecipe(cat);
  const existing = store.findBySource('spot', cat.id);
  const importBtn = () => (store.findBySource('spot', cat.id)
    ? h('a', { class: 'btn grow', href: `#/recipes/${encodeURIComponent(store.findBySource('spot', cat.id).id)}` }, 'レシピ帳で開く')
    : h('button', { type: 'button', class: 'btn grow', onclick: (e) => {
      const res = store.saveRecipe(recipe);
      if (res.errors) return toast(res.errors[0], 4000);
      toast('レシピ帳に取り込みました');
      e.currentTarget.replaceWith(importBtn());
    } }, 'レシピ帳に取り込む'));
  return h('div', { class: 'card stack', style: 'gap:6px' },
    h('div', { class: 'row' }, h('span', { class: 'grow', style: 'font-weight:600' }, recipe.name), h('span', { class: 'small muted' }, X.filmLabel(recipe))),
    paramSummary(recipe),
    h('div', { class: 'small muted num' }, recipe.isoNote, recipe.exposureNote ? ` / ${recipe.exposureNote}` : ''),
    h('div', { class: 'row', style: 'gap:8px;margin-top:4px' },
      h('a', { class: 'btn primary grow', href: `#/qmenu/${encodeURIComponent(existing ? existing.id : `spot-${cat.id}`)}` }, 'Qメニュー表示'),
      importBtn()));
}

export function render(root, { id }) {
  const body = h('div', { class: 'stack' }, h('p', { class: 'muted' }, '読み込み中…'));
  root.append(body);
  let alive = true;
  Promise.all([loadSpots(), loadCategories(), loadLessons().catch(() => null)]).then(([spots, cats, lessons]) => { if (alive) draw(spots, cats, lessons); })
    .catch(() => body.replaceChildren(h('div', { class: 'notice' }, '撮影スポットのデータを読み込めませんでした。')));

  function draw(spots, cats, lessons) {
    const s = spots.find((x) => x.id === id);
    if (!s) { body.replaceChildren(h('div', { class: 'empty' }, '撮影スポットが見つかりません（データを取得中の場合は、しばらくしてから開き直してください）。'), h('a', { class: 'btn block', href: '#/map' }, '地図に戻る')); return; }
    const cat = cats.find((c) => c.id === s.category);
    document.title = `${s.name}（${cat.name}） — X-T3 Cinematic Lab`;
    const also = (s.alsoIn || []).map((cid) => cats.find((c) => c.id === cid)).filter(Boolean);
    const rel = cat.lessons.map((no) => lessons?.lessons.find((x) => x.no === no)).filter(Boolean);
    body.replaceChildren(...[
      h('div', null,
        h('div', { class: 'row', style: 'gap:10px;align-items:flex-start' }, catBadge(cat, 30),
          h('div', { class: 'grow' }, h('h2', { class: 'loc-title', style: 'margin:0' }, s.name),
            h('div', { class: 'small muted' }, `${cat.name} · ${s.pref}${s.city ? `・${s.city}` : ''} `, h('span', { class: 'num' }, formatLatLng(s.lat, s.lng))))),
        h('div', { class: 'row wrap', style: 'gap:6px;margin-top:8px' },
          h('span', { class: 'chip spot-chip', style: `--c:${cat.color}` }, cat.name),
          ...also.map((c) => h('span', { class: 'chip spot-chip', style: `--c:${c.color}` }, `${c.name}にも該当`)),
          store.getVisited(s.id) ? h('span', { class: 'chip visited' }, '✓ 行った') : null)),
      s.note ? h('p', { class: 'small', style: 'margin:0' }, s.note) : null,
      h('div', { class: 'notice small' }, '撮影可否は現地のルールを確認してください。営業時間・料金・撮影ルールは変わるため載せていません。'),
      s.verified === false ? h('div', { class: 'notice info small' }, '座標は概略です（OpenStreetMap でまだ確認していません）。現地の案内で場所を確かめてください。') : null,
      h('div', { class: 'section-title' }, 'おすすめレシピ'),
      recipeCard(cat),
      h('div', { class: 'section-title' }, '撮影のコツ'),
      h('ul', { class: 'tips' }, cat.tips.map((t) => h('li', null, t))),
      rel.length ? [h('div', { class: 'section-title' }, '関連する講座'),
        h('div', { class: 'stack', style: 'gap:6px' }, rel.map((x) => h('a', { class: 'list-btn', href: `#/academy/${x.no}` },
          h('span', { class: 'num lesson-no' }, String(x.no).padStart(2, '0')), h('span', { class: 'grow' }, x.title))))] : null,
      visitCard(s),
      h('div', { class: 'row', style: 'gap:8px' },
        h('a', { class: 'btn grow', href: `#/map/${encodeURIComponent(s.id)}` }, '地図で見る'),
        h('a', { class: 'btn grow', href: '#/spots' }, '制覇率')),
      s.website ? h('div', null, ext(s.website, `公式サイト（${hostOf(s.website)}）`, 'btn block')) : null,
      h('p', { class: 'small muted sources', style: 'overflow-wrap:anywhere' }, '出典（外部サイト）: ',
        s.sources.map((u, i) => [i ? ' / ' : '', ext(u, hostOf(u))]),
        h('br'), `データ: ${SOURCE_LABELS[s.source]}`, s.source !== 'osm' && s.osmId ? '・座標は OpenStreetMap（ODbL）' : '',
        s.source === 'osm' ? '。© OpenStreetMap contributors' : ''),
    ].flat(Infinity).filter((x) => x != null && x !== ''));
  }
  return () => { alive = false; };
}

/** 現在地からの距離の表示（シートなどで使う） */
export const kmFrom = (here, s) => (here ? formatKm(haversine(here.lat, here.lng, s.lat, s.lng)) : null);
