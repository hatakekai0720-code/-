// 映画ロケ地ワールドマップ — フェーズ 3 で実装する
import { h } from '../ui/dom.js';

export function render(root) {
  root.append(h('div', { class: 'empty' }, '映画ロケ地ワールドマップ', h('div', { class: 'small', style: 'margin-top:6px' }, 'フェーズ ', h('span', { class: 'num' }, '3'), ' で実装します。')));
}
