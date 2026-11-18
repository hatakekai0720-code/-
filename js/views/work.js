// 作品ページ: 同じ作品のロケ地をまとめて表示
import { h } from '../ui/dom.js';
import { loadLocations } from '../locations.js';
import { groupWorks } from '../film.js';
import { photoFigure } from '../ui/photo.js';
import { nameLink, paletteRow } from './location.js';
import * as store from '../store.js';

const names = (s) => String(s || '').split('、').map((x) => x.trim()).filter(Boolean);
const joinLinks = (list) => list.flatMap((n, i) => [i ? '、' : '', nameLink(n)]);

export function render(root, { id }) {
  const body = h('div', { class: 'stack' }, h('p', { class: 'muted' }, '読み込み中…'));
  root.append(body);
  let alive = true;
  loadLocations().then((locs) => { if (alive) draw(locs); })
    .catch(() => body.replaceChildren(h('div', { class: 'notice' }, 'ロケ地データを読み込めませんでした。')));

  function draw(locs) {
    const w = groupWorks(locs).find((x) => x.key === id);
    if (!w) { body.replaceChildren(h('div', { class: 'empty' }, '作品が見つかりません。'), h('a', { class: 'btn block', href: '#/search' }, '作品を探す')); return; }
    document.title = `${w.title} — X-T3 Cinematic Lab`;
    const l = w.info;
    const saved = store.getPalette(w.key);
    const withPhoto = w.locations.find((x) => x.photo);
    body.replaceChildren(...[
      h('div', null,
        h('h2', { class: 'loc-title' }, w.title),
        h('div', { class: 'small muted' }, `${w.titleEn} · `, h('span', { class: 'num' }, w.year), ' · ', joinLinks(names(w.director)))),
      withPhoto ? photoFigure(withPhoto) : null,
      l.synopsis ? h('p', { class: 'synopsis' }, l.synopsis) : null,
      l.cinematographer || l.cast?.length ? h('div', { class: 'small' },
        l.cinematographer ? h('div', null, h('span', { class: 'muted' }, '撮影: '), joinLinks(names(l.cinematographer))) : null,
        l.cast?.length ? h('div', null, h('span', { class: 'muted' }, '出演: '), l.cast.flatMap((c, i) => [i ? '、' : '', nameLink(c.name)])) : null) : null,
      saved ? [h('div', { class: 'section-title' }, 'あなたの解析パレット'), paletteRow(saved.colors, 'あなたの解析パレット'),
        h('button', { type: 'button', class: 'btn', onclick: () => { store.deletePalette(w.key); draw(locs); } }, 'このパレットを削除')] : null,
      h('div', { class: 'section-title' }, 'ロケ地 ', h('span', { class: 'num' }, w.locations.length), ' 件'),
      h('div', { class: 'stack', style: 'gap:6px' }, w.locations.map((x) => h('a', { class: 'list-btn near', href: `#/locations/${encodeURIComponent(x.id)}` },
        h('span', { class: 'pal-dot', style: `background:${x.palette?.[0] || 'var(--accent)'}` }),
        h('div', { class: 'grow' }, h('div', { class: 'near-title' }, x.place), h('div', { class: 'small muted' }, `${x.city}・${x.country}${x.sceneTime ? ` / ${x.sceneTime}` : ''}`)),
        store.getVisited(x.id) ? h('span', { class: 'chip visited small' }, '✓ 行った') : null))),
      l.links?.eigacom ? h('a', { class: 'btn', href: l.links.eigacom, target: '_blank', rel: 'noopener noreferrer' }, '映画.com') : null,
    ].flat(Infinity).filter(Boolean));
  }
  return () => { alive = false; };
}
