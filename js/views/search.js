// 作品・人物・会社の検索（作品名・監督・撮影・出演・製作・配給）と年代の絞り込み
import { h } from '../ui/dom.js';
import { loadLocations } from '../locations.js';
import { search, groupWorks, DECADES, inDecade } from '../film.js';
import * as store from '../store.js';
import { loadSpots, loadCategories, filterSpots } from '../spots.js';
import { catBadge } from './spot.js';

const SPOT_LIMIT = 50;

// 入力と年代はメモリにだけ持つ（戻ってきたときに続きから）
const state = { q: '', decade: 'all' };
export const ROLE_LABEL = { director: '監督', cinematographer: '撮影', cast: '出演', production: '製作', distributor: '配給' };

/** 作品の 1 行 */
export function workItem(w, note) {
  const visited = w.locations.filter((l) => store.getVisited(l.id)).length;
  return h('a', { class: 'list-btn near', href: `#/works/${w.key}` },
    h('span', { class: 'pal-dot', style: `background:${w.info.palette?.[0] || 'var(--accent)'}` }),
    h('div', { class: 'grow' }, h('div', { class: 'near-title' }, w.title),
      h('div', { class: 'small muted' }, `${w.titleEn} · `, h('span', { class: 'num' }, w.year), ` · ${w.director}`),
      note ? h('div', { class: 'small' }, note) : null),
    h('div', { class: 'small muted', style: 'text-align:right;white-space:nowrap' }, h('span', { class: 'num' }, w.locations.length), ' 件',
      visited ? h('div', { class: 'small', style: 'color:var(--accent)' }, '✓ ', h('span', { class: 'num' }, visited)) : null));
}

export function decadeChips(current, counts, onPick) {
  const chip = (id, label, n) => h('button', { type: 'button', class: `chip ${current === id ? 'on' : ''}`, 'aria-pressed': String(current === id), onclick: () => onPick(id) },
    label, n != null ? h('span', { class: 'num chip-count' }, n) : null);
  return h('div', { class: 'row wrap', style: 'gap:6px', role: 'group', 'aria-label': '年代で絞り込み' },
    chip('all', 'すべての年代', counts?.all), ...DECADES.map((d) => chip(d.id, d.label, counts?.[d.id])));
}

export function render(root) {
  const input = h('input', { class: 'input', type: 'search', value: state.q, placeholder: '作品名・監督・俳優・撮影スポット・地名', 'aria-label': '検索', enterkeyhint: 'search' });
  const decadeEl = h('div');
  const out = h('div', { class: 'stack' });
  root.append(h('div', { class: 'stack' }, input, decadeEl, out));
  let locs = [];
  let alive = true;
  let spots = [], cats = [];
  loadLocations().then((x) => { if (!alive) return; locs = x; draw(); })
    .catch(() => out.replaceChildren(h('div', { class: 'notice' }, 'ロケ地データを読み込めませんでした。')));
  // 撮影スポットも検索の対象（名前・市区町村・都道府県）
  Promise.all([loadSpots(), loadCategories()]).then(([s, c]) => { if (!alive) return; spots = s; cats = c; draw(); }).catch(() => {});
  input.addEventListener('input', () => { state.q = input.value; draw(); });

  function draw() {
    const works = groupWorks(locs);
    const counts = { all: works.length };
    for (const d of DECADES) counts[d.id] = works.filter((w) => inDecade(w.year, d.id)).length;
    decadeEl.replaceChildren(decadeChips(state.decade, counts, (id) => { state.decade = id; draw(); }));
    if (!state.q.trim()) {
      // 未入力なら、年代で絞った作品の一覧（年の古い順）
      const list = works.filter((w) => inDecade(w.year, state.decade)).sort((a, b) => a.year - b.year || a.title.localeCompare(b.title, 'ja'));
      out.replaceChildren(h('div', { class: 'section-title' }, '作品 ', h('span', { class: 'num' }, list.length), ' 本'),
        h('div', { class: 'stack', style: 'gap:6px' }, list.map((w) => workItem(w))));
      return;
    }
    const res = search(locs, state.q, { decade: state.decade });
    const nameRow = (n) => h('a', { class: 'list-btn near', href: `#/names/${encodeURIComponent(n.name)}` },
      h('span', { class: 'grow' }, n.name), h('span', { class: 'small muted' }, n.roles.map((r) => ROLE_LABEL[r]).join('・')),
      h('span', { class: 'num small muted', style: 'margin-left:8px' }, `${n.count} 本`));
    const people = res.names.filter((n) => n.kind === 'person'), companies = res.names.filter((n) => n.kind === 'company');
    const hitSpots = filterSpots(spots, { q: state.q.trim() });
    const spotRow = (sp) => { const cat = cats.find((c) => c.id === sp.category); return h('a', { class: 'list-btn near', href: `#/spots/${encodeURIComponent(sp.id)}` },
      cat ? catBadge(cat, 20) : null, h('div', { class: 'grow' }, h('div', { class: 'near-title' }, sp.name), h('div', { class: 'small muted' }, `${cat?.name ?? ''}・${sp.pref}${sp.city ? ` ${sp.city}` : ''}${store.getVisited(sp.id) ? ' · ✓ 行った' : ''}`))); };
    out.replaceChildren(...[
      res.works.length ? [h('div', { class: 'section-title' }, '作品'), h('div', { class: 'stack', style: 'gap:6px' }, res.works.map((w) => workItem(w)))] : null,
      people.length ? [h('div', { class: 'section-title' }, '人物'), h('div', { class: 'stack', style: 'gap:6px' }, people.map(nameRow))] : null,
      companies.length ? [h('div', { class: 'section-title' }, '会社'), h('div', { class: 'stack', style: 'gap:6px' }, companies.map(nameRow))] : null,
      hitSpots.length ? [h('div', { class: 'section-title' }, '撮影スポット ', h('span', { class: 'num' }, hitSpots.length), ' 件'),
        h('div', { class: 'stack', style: 'gap:6px' }, hitSpots.slice(0, SPOT_LIMIT).map(spotRow)),
        hitSpots.length > SPOT_LIMIT ? h('p', { class: 'small muted' }, `先頭の ${SPOT_LIMIT} 件を表示しています。言葉を足して絞り込んでください。`) : null] : null,
      !res.works.length && !res.names.length && !hitSpots.length ? h('p', { class: 'muted small' }, '見つかりませんでした。') : null,
    ].flat(Infinity).filter(Boolean));
  }
  return () => { alive = false; };
}
