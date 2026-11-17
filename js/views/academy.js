// 撮影講座（全50回） — フェーズ 4 で実装する
import { h } from '../ui/dom.js';

export function render(root) {
  root.append(h('div', { class: 'empty' }, '撮影講座（全50回）', h('div', { class: 'small', style: 'margin-top:6px' }, 'フェーズ ', h('span', { class: 'num' }, '4'), ' で実装します。')));
}
