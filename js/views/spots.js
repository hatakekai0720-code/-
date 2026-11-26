// 撮影スポットの制覇率（「行った」/ 全体）: カテゴリ別・都道府県別
import { h } from '../ui/dom.js';
import { loadSpots, loadCategories, completion, percent, getStatus, events } from '../spots.js';
import { catBadge } from './spot.js';
import * as store from '../store.js';

const state = { open: null }; // 都道府県の行を開いたら、その県の行ったスポット一覧（メモリのみ）

export function render(root) {
  const body = h('div', { class: 'stack' }, h('p', { class: 'muted' }, '読み込み中…'));
  root.append(body);
  let alive = true;
  const load = () => Promise.all([loadSpots(), loadCategories()]).then(([spots, cats]) => { if (alive) draw(spots, cats); })
    .catch(() => body.replaceChildren(h('div', { class: 'notice' }, '撮影スポットのデータを読み込めませんでした。')));
  load();
  const onFile = () => load();
  events.addEventListener('file', onFile);

  const row = (label, t, color, extra) => h('div', { class: 'rate-row' },
    h('div', { class: 'stack', style: 'gap:4px' }, h('div', { class: 'row', style: 'gap:8px' }, label),
      h('div', { class: 'bar', style: color ? `--c:${color}` : '' }, h('i', { style: `width:${(t.ratio * 100).toFixed(1)}%` }))),
    h('div', { class: 'num small', style: 'text-align:right' }, `${t.visited}/${t.total}`, h('div', { class: 'muted' }, percent(t.ratio))), extra);

  function draw(spots, cats) {
    const c = completion(spots, store.visited(), cats);
    const catOf = (id) => cats.find((x) => x.id === id);
    const st = getStatus();
    body.replaceChildren(...[
      h('p', { class: 'small muted', style: 'margin:0' }, '撮影スポットの詳細画面で「行った」にすると数えます（日付とメモだけを端末に保存）。'),
      st.state === 'running' ? h('div', { class: 'notice info small' }, 'データを保存中です（', h('span', { class: 'num' }, `${st.done}/${st.total}`), '）。') : null,
      h('div', { class: 'card stack', style: 'gap:6px' }, row(h('span', { style: 'font-weight:600' }, 'すべての撮影スポット'), c.all)),
      h('div', { class: 'section-title' }, 'カテゴリ別'),
      h('div', { class: 'card stack', style: 'gap:10px' }, c.byCategory.map((t) => {
        const cat = catOf(t.id);
        return row([catBadge(cat, 18), h('span', null, cat.name)], t, cat.color);
      })),
      h('div', { class: 'section-title' }, '都道府県別'),
      h('div', { class: 'card stack', style: 'gap:10px' }, c.byPref.map((t) => {
        const open = state.open === t.id;
        const mine = open ? spots.filter((s) => s.pref === t.id && store.getVisited(s.id)) : [];
        return h('div', { class: 'stack', style: 'gap:6px' },
          h('button', { type: 'button', class: 'plain-btn', style: 'all:unset;cursor:pointer;display:block', 'aria-expanded': String(open), onclick: () => { state.open = open ? null : t.id; draw(spots, cats); } },
            row(h('span', null, t.id), t)),
          open ? (mine.length ? h('div', { class: 'stack', style: 'gap:4px;padding-left:6px' }, mine.map((s) => h('a', { class: 'list-btn near', href: `#/spots/${encodeURIComponent(s.id)}` },
            catBadge(catOf(s.category), 18), h('span', { class: 'grow' }, s.name), h('span', { class: 'num small muted' }, store.getVisited(s.id).date))))
            : h('p', { class: 'small muted', style: 'margin:0 0 0 6px' }, 'まだ行ったスポットはありません。')) : null);
      })),
      h('a', { class: 'btn block', href: '#/map' }, '地図で探す'),
    ].filter(Boolean));
  }
  return () => { alive = false; events.removeEventListener('file', onFile); };
}
