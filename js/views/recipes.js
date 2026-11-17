// ⑥ レシピ・カードデータベース（一覧）
import { h, select } from '../ui/dom.js';
import { recipeCard } from '../ui/recipe-ui.js';
import * as X from '../xt3.js';
import * as store from '../store.js';

// 画面を離れても絞り込み条件を保持する（メモリ上のみ）
const state = { q: '', film: '', tags: new Set() };

export function render(root) {
  const all = store.recipes();
  const allTags = [...new Set(all.flatMap((r) => r.tags))].sort((a, b) => a.localeCompare(b, 'ja'));
  for (const t of [...state.tags]) if (!allTags.includes(t)) state.tags.delete(t);

  const list = h('div', { class: 'recipe-list stack' });
  const count = h('div', { class: 'small muted num', style: 'margin-bottom:8px' });

  const draw = () => {
    const q = state.q.trim().toLowerCase();
    const hits = all
      .filter((r) => !q || r.name.toLowerCase().includes(q))
      .filter((r) => !state.film || r.filmSim === state.film)
      .filter((r) => [...state.tags].every((t) => r.tags.includes(t)))
      .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
    count.textContent = `${hits.length} / ${all.length} 件`;
    list.replaceChildren(...(hits.length ? hits.map(recipeCard)
      : [h('div', { class: 'empty' }, all.length ? '条件に合うレシピがありません' : 'レシピがまだありません。「新規」から作成できます。')]));
  };

  const tagRow = h('div', { class: 'filters' }, allTags.map((t) => {
    const b = h('button', { type: 'button', class: `chip ${state.tags.has(t) ? 'on' : ''}`, 'aria-pressed': String(state.tags.has(t)), onclick: () => {
      state.tags.has(t) ? state.tags.delete(t) : state.tags.add(t);
      b.classList.toggle('on', state.tags.has(t));
      b.setAttribute('aria-pressed', String(state.tags.has(t)));
      draw();
    } }, t);
    return b;
  }));

  root.append(
    h('div', { class: 'toolbar' },
      h('input', { class: 'input', type: 'search', placeholder: '名前で検索', 'aria-label': '名前で検索', value: state.q, oninput: (e) => { state.q = e.target.value; draw(); } }),
      h('a', { class: 'btn primary', href: '#/recipes/new' }, '＋ 新規')),
    h('div', { style: 'margin-bottom:8px' },
      select([{ id: '', label: 'すべてのフィルムシミュレーション' }, ...X.FILM_SIMS], state.film, (v) => { state.film = v; draw(); }, { 'aria-label': 'フィルムシミュレーションで絞り込み' })),
    ...(allTags.length ? [tagRow] : []),
    count, list,
    h('div', { class: 'section-title' }, 'ツール'),
    h('a', { class: 'btn block', href: '#/compare' }, 'ビフォーアフター比較（2 枚の画像を見比べる）'));
  draw();
}
