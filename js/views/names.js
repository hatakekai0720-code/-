// 人物・会社の作品一覧（監督・撮影・出演・製作・配給の名前をタップしたとき）
import { h } from '../ui/dom.js';
import { loadLocations } from '../locations.js';
import { worksByName } from '../film.js';
import { workItem, ROLE_LABEL } from './search.js';

export function render(root, { id }) {
  const name = id;
  const body = h('div', { class: 'stack' }, h('p', { class: 'muted' }, '読み込み中…'));
  root.append(body);
  let alive = true;
  loadLocations().then((locs) => {
    if (!alive) return;
    const list = worksByName(locs, name);
    document.title = `${name} — X-T3 Cinematic Lab`;
    body.replaceChildren(
      h('h2', { class: 'loc-title' }, name),
      h('div', { class: 'small muted' }, 'このアプリのロケ地に出てくる作品 ', h('span', { class: 'num' }, list.length), ' 本'),
      list.length ? h('div', { class: 'stack', style: 'gap:6px' }, list.map(({ work, roles }) => workItem(work,
        roles.map((r) => `${ROLE_LABEL[r.role]}${r.detail ? `（${r.detail}）` : ''}`).join('・')))) : h('p', { class: 'muted small' }, '見つかりませんでした。'),
      h('a', { class: 'btn', href: '#/search' }, '検索に戻る'));
  }).catch(() => body.replaceChildren(h('div', { class: 'notice' }, 'ロケ地データを読み込めませんでした。')));
  return () => { alive = false; };
}
