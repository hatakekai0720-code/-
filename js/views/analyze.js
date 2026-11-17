// 画像解析と推定レシピ — フェーズ 2 で実装する
import { h } from '../ui/dom.js';

export function render(root) {
  root.append(h('div', { class: 'empty' }, '画像解析と推定レシピ', h('div', { class: 'small', style: 'margin-top:6px' }, 'フェーズ ', h('span', { class: 'num' }, '2'), ' で実装します。')));
}
