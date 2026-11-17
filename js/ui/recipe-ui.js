// レシピ表示の共通部品
import { h } from './dom.js';
import * as X from '../xt3.js';
import * as store from '../store.js';

/** 主要パラメータの等幅 1〜2 行要約 */
export function paramSummary(r) {
  const mono = X.isMono(r.filmSim);
  const parts = [
    ['DR', X.labelOf(X.DR_MODES, r.dr).replace('DR', '')],
    ['WB', `${X.wbLabel(r)} R${X.signed(r.wbShift.r)} B${X.signed(r.wbShift.b)}`],
    ['H', X.signed(r.highlight)], ['S', X.signed(r.shadow)],
    ['C', mono ? '—' : X.signed(r.color)], ['SH', X.signed(r.sharpness)], ['NR', X.signed(r.nr)],
    ['GR', X.labelOf(X.EFFECT_LEVELS, r.grain)], ['CC', X.labelOf(X.EFFECT_LEVELS, r.colorChrome)],
  ];
  return h('div', { class: 'params' }, parts.map(([k, v], i) => [i ? ' · ' : '', h('span', { class: 'pair' }, `${k} `, h('b', null, v))]));
}

export function slotBadges(recipeId) {
  return store.slotsOf(recipeId).map((s) => h('span', { class: 'badge' }, s));
}

export function recipeCard(r) {
  return h('a', { class: 'card recipe-card stack', href: `#/recipes/${encodeURIComponent(r.id)}`, style: 'gap:4px' },
    h('div', { class: 'row' }, h('h3', { class: 'grow' }, r.name), slotBadges(r.id)),
    h('div', { class: 'film' }, X.filmLabel(r)),
    paramSummary(r),
    r.tags.length ? h('div', { class: 'row wrap', style: 'gap:4px;margin-top:2px' }, r.tags.map((t) => h('span', { class: 'chip' }, t))) : null);
}

/** レシピ選択リスト（シート内で使う） */
export function recipePicker(onPick, currentId = null) {
  const list = [...store.recipes()].sort((a, b) => a.name.localeCompare(b.name, 'ja'));
  if (!list.length) return h('p', { class: 'muted' }, 'レシピがありません。先にレシピを作成してください。');
  return h('div', { class: 'stack', style: 'gap:6px' }, list.map((r) =>
    h('button', { type: 'button', class: `list-btn ${r.id === currentId ? 'on' : ''}`, onclick: () => onPick(r.id) },
      h('div', null, r.name), h('div', { class: 'small muted' }, X.filmLabel(r)))));
}
