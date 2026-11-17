// ⑤ C1〜C7 カスタムスロットボード
import { h, toast, sheet } from '../ui/dom.js';
import { paramSummary, recipePicker } from '../ui/recipe-ui.js';
import * as X from '../xt3.js';
import * as store from '../store.js';

export function render(root) {
  const redraw = () => { root.replaceChildren(); render(root); };

  const pick = (slot) => {
    const cur = store.slots()[slot];
    sheet(`${slot} に割り当てるレシピ`, (close) => [
      recipePicker((id) => { store.setSlot(slot, id); close(); toast(`${slot} に割り当てました`); redraw(); }, cur),
      cur ? h('button', { type: 'button', class: 'btn danger block', style: 'margin-top:10px', onclick: () => { store.setSlot(slot, null); close(); redraw(); } }, '割り当てを解除') : null,
    ]);
  };

  const slotEl = (slot) => {
    const r = store.getRecipe(store.slots()[slot]);
    const el = h('div', { class: `card slot ${r ? 'filled' : ''}` },
      h('div', { class: 'slot-id' }, slot),
      h('button', { type: 'button', class: 'slot-main', 'aria-label': r ? `${slot} ${r.name} を Qメニューで開く` : `${slot} にレシピを割り当て`,
        onclick: () => (r ? (location.hash = `#/qmenu/${encodeURIComponent(r.id)}`) : pick(slot)) },
        r ? [h('div', { class: 'slot-name' }, r.name), h('div', { class: 'small muted' }, X.filmLabel(r)), paramSummary(r)]
          : h('div', { class: 'muted' }, '未割り当て — タップして選択')),
      r ? h('button', { type: 'button', class: 'btn', onclick: () => pick(slot) }, '変更') : null);
    el.addEventListener('dragover', (e) => { e.preventDefault(); el.classList.add('dragover'); });
    el.addEventListener('dragleave', () => el.classList.remove('dragover'));
    el.addEventListener('drop', (e) => {
      e.preventDefault();
      const id = e.dataTransfer.getData('text/plain');
      if (store.getRecipe(id)) { store.setSlot(slot, id); toast(`${slot} に割り当てました`); redraw(); }
      else el.classList.remove('dragover');
    });
    return el;
  };

  const list = [...store.recipes()].sort((a, b) => a.name.localeCompare(b.name, 'ja'));
  root.append(
    h('div', { class: 'stack' }, X.SLOT_IDS.map(slotEl)),
    h('div', { class: 'section-title' }, 'レシピ（PC ではスロットへドラッグ）'),
    list.length
      ? h('div', { class: 'drag-list' }, list.map((r) => h('div', { class: 'chip drag-chip', draggable: true,
        ondragstart: (e) => { e.dataTransfer.setData('text/plain', r.id); e.dataTransfer.effectAllowed = 'copy'; } }, r.name)))
      : h('p', { class: 'muted small' }, 'レシピがまだありません。'));
}
