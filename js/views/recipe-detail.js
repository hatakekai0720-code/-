// レシピ詳細
import { h, toast, confirmSheet, sheet } from '../ui/dom.js';
import { slotBadges } from '../ui/recipe-ui.js';
import * as X from '../xt3.js';
import * as store from '../store.js';

const SOURCE_LABEL = { manual: '手入力', analyzer: '画像解析', location: 'ロケ地', lesson: '講座' };

export function render(root, { id }) {
  const r = store.getRecipe(id);
  if (!r) {
    root.append(h('div', { class: 'empty' }, 'レシピが見つかりません。', h('div', { style: 'margin-top:12px' }, h('a', { class: 'btn', href: '#/recipes' }, '一覧へ戻る'))));
    return;
  }
  const mono = X.isMono(r.filmSim);
  const cell = (k, v, wide) => h('div', { class: wide ? 'wide' : '' }, h('div', { class: 'k' }, k), h('div', { class: 'v' }, v));
  const warn = X.drWarning(r);
  const eid = encodeURIComponent(r.id);

  const assign = () => sheet('スロットに割り当て', (close) => h('div', { class: 'stack', style: 'gap:6px' }, X.SLOT_IDS.map((s) => {
    const cur = store.getRecipe(store.slots()[s]);
    return h('button', { type: 'button', class: `list-btn ${cur?.id === r.id ? 'on' : ''}`, onclick: () => {
      store.setSlot(s, cur?.id === r.id ? null : r.id);
      close(); toast(cur?.id === r.id ? `${s} から外しました` : `${s} に割り当てました`); rerender();
    } }, h('span', { class: 'num' }, s), '　', h('span', { class: 'muted' }, cur ? cur.name : '未割り当て'));
  })));
  const rerender = () => { root.replaceChildren(); render(root, { id }); };

  root.append(h('div', { class: 'stack' },
    h('div', null,
      h('div', { class: 'row' }, h('h2', { class: 'grow', style: 'font-size:18px;overflow-wrap:anywhere' }, r.name), slotBadges(r.id)),
      h('div', { class: 'muted small' }, `${SOURCE_LABEL[r.source]} · 更新 `, h('span', { class: 'num' }, r.updatedAt.slice(0, 10)))),
    h('a', { class: 'btn primary block', href: `#/qmenu/${eid}` }, 'X-T3 Qメニュー表示'),
    warn ? h('div', { class: `notice ${warn.level === 'info' ? 'info' : ''}` }, warn.text) : null,
    h('div', { class: 'spec' },
      cell('フィルムシミュレーション', X.filmLabel(r), true),
      cell('ダイナミックレンジ', X.labelOf(X.DR_MODES, r.dr)),
      cell('ホワイトバランス', X.wbLabel(r)),
      cell('WB シフト', `R${X.signed(r.wbShift.r)} B${X.signed(r.wbShift.b)}`),
      cell('カラー', mono ? '—' : X.signed(r.color)),
      cell('ハイライトトーン', X.signed(r.highlight)),
      cell('シャドウトーン', X.signed(r.shadow)),
      cell('シャープネス', X.signed(r.sharpness)),
      cell('ノイズリダクション', X.signed(r.nr)),
      cell('グレイン・エフェクト', X.labelOf(X.EFFECT_LEVELS, r.grain)),
      cell('カラークローム・エフェクト', X.labelOf(X.EFFECT_LEVELS, r.colorChrome)),
      cell('ISO メモ', r.isoNote || '—'),
      cell('露出メモ', r.exposureNote || '—')),
    r.tags.length ? h('div', { class: 'row wrap', style: 'gap:4px' }, r.tags.map((t) => h('span', { class: 'chip' }, t))) : null,
    r.notes ? h('div', { class: 'card', style: 'white-space:pre-wrap;overflow-wrap:anywhere' }, r.notes) : null,
    h('button', { type: 'button', class: 'btn block', onclick: assign }, 'C1〜C7 スロットに割り当て'),
    h('div', { class: 'actions' },
      h('a', { class: 'btn', href: `#/recipes/${eid}/edit` }, '編集'),
      h('button', { type: 'button', class: 'btn', onclick: () => {
        const copy = store.duplicateRecipe(r.id);
        if (copy) { toast('複製しました'); location.hash = `#/recipes/${encodeURIComponent(copy.id)}/edit`; } else toast('複製できませんでした');
      } }, '複製'),
      h('button', { type: 'button', class: 'btn danger', onclick: async () => {
        if (await confirmSheet('レシピを削除', `「${r.name}」を削除します。割り当て済みのスロットからも外れます。`, '削除', true)) {
          store.deleteRecipe(r.id); toast('削除しました'); location.hash = '#/recipes';
        }
      } }, '削除'))));
}
