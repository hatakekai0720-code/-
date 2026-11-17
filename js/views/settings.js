// 設定（ヘッダーの歯車）: エクスポート / インポート、保存容量、Qメニュー配置リセット
import { h, toast, sheet, confirmSheet, select } from '../ui/dom.js';
import { applyTheme, THEMES } from '../ui/theme.js';
import * as store from '../store.js';

export function render(root) {
  const redraw = () => { root.replaceChildren(); render(root); };
  const u = store.usage();

  const doExport = () => {
    const blob = new Blob([store.exportData()], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const d = new Date();
    const stamp = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
    const a = h('a', { href: url, download: `xt3cine-backup-${stamp}.json` });
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast('エクスポートしました');
  };

  const file = h('input', { type: 'file', accept: 'application/json,.json', hidden: true, onchange: async () => {
    const f = file.files[0];
    file.value = '';
    if (!f) return;
    let res;
    try { res = store.validateDb(JSON.parse(await f.text())); }
    catch { res = { ok: false, errors: ['JSON として読み込めませんでした'] }; }
    if (!res.ok) {
      sheet('インポートできません', (close) => [
        h('ul', { class: 'small', style: 'padding-left:18px;margin:0 0 12px' }, res.errors.slice(0, 8).map((e) => h('li', null, e))),
        res.errors.length > 8 ? h('p', { class: 'small muted' }, `ほか ${res.errors.length - 8} 件`) : null,
        h('button', { type: 'button', class: 'btn block', onclick: close }, '閉じる')]);
      return;
    }
    const inc = res.db;
    const apply = (mode, close) => {
      const ok = store.importData(inc, mode);
      close(); applyTheme(); toast(ok ? 'インポートしました' : '保存できませんでした'); redraw();
    };
    sheet('インポート方法を選択', (close) => [
      h('p', { class: 'muted small', style: 'margin-bottom:12px' }, 'ファイルの内容: レシピ ', h('span', { class: 'num' }, inc.recipes.length), ' 件 / ピン ', h('span', { class: 'num' }, inc.pins.length), ' 件 / 講座完了 ', h('span', { class: 'num' }, inc.academy.completed.length), ' 回'),
      h('div', { class: 'stack' },
        h('button', { type: 'button', class: 'btn primary', onclick: () => apply('merge', close) }, 'マージ（今のデータに追加）'),
        h('button', { type: 'button', class: 'btn danger', onclick: () => apply('replace', close) }, '上書き（今のデータを置き換え）'),
        h('button', { type: 'button', class: 'btn', onclick: close }, 'キャンセル')),
      h('p', { class: 'muted small', style: 'margin-top:10px' }, 'マージでは、同じ ID のレシピは更新日時が新しい方を残します。')]);
  } });

  root.append(
    h('div', { class: 'section-title', style: 'margin-top:0' }, '表示'),
    h('div', { class: 'card' },
      h('div', { class: 'field', style: 'padding-top:0' }, h('div', { class: 'label' }, 'テーマ'),
        select(THEMES, store.getSetting('theme') || 'auto', (v) => { store.setSetting('theme', v === 'auto' ? undefined : v); applyTheme(); }, { 'aria-label': 'テーマ' }),
        h('div', { class: 'hint' }, '「自動」は端末の設定に合わせます。Qメニュー表示は屋外での見やすさのため常にダークです。'))),
    h('div', { class: 'section-title' }, 'データ'),
    h('div', { class: 'card stack' },
      h('p', { class: 'small muted' }, 'レシピ・スロット・ピン・講座の進捗を 1 つの JSON ファイルに書き出します。画像は含まれません。'),
      h('button', { type: 'button', class: 'btn', onclick: doExport }, 'エクスポート（JSON を保存）'),
      h('button', { type: 'button', class: 'btn', onclick: () => file.click() }, 'インポート（JSON を読み込む）'),
      file),
    h('div', { class: 'section-title' }, '保存容量'),
    h('div', { class: 'card' },
      h('div', { class: 'num', style: 'font-size:18px' }, `${(u.bytes / 1024).toFixed(1)} KB`, h('span', { class: 'muted', style: 'font-size:13px' }, ` / 約 ${(u.quota / 1024 / 1024).toFixed(0)} MB（${(u.ratio * 100).toFixed(2)}%）`)),
      h('div', { style: 'height:4px;background:var(--line);border-radius:2px;margin-top:8px;overflow:hidden' },
        h('div', { style: `height:100%;width:${Math.min(100, Math.max(u.bytes ? 1 : 0, u.ratio * 100))}%;background:var(--accent-bg)` })),
      h('p', { class: 'small muted', style: 'margin-top:8px' }, 'レシピ ', h('span', { class: 'num' }, store.recipes().length), ' 件。上限はブラウザによって異なる目安です。')),
    h('div', { class: 'section-title' }, 'Qメニュー'),
    h('div', { class: 'card stack' },
      h('p', { class: 'small muted' }, '16 マスの並びは Qメニュー表示の「並び替え」で入れ替えられます。'),
      h('button', { type: 'button', class: 'btn', onclick: () => { store.setSetting('qmenuOrder', undefined); toast('初期配置に戻しました'); } }, '並びを初期配置に戻す')),
    h('div', { class: 'section-title' }, '危険な操作'),
    h('div', { class: 'card' },
      h('button', { type: 'button', class: 'btn danger block', onclick: async () => {
        if (await confirmSheet('全データを削除', 'レシピ・スロット・ピン・進捗をすべて削除します。元に戻せません。先にエクスポートしておくことをおすすめします。', '全て削除', true)) {
          store.resetAll(); applyTheme(); toast('削除しました'); redraw();
        }
      } }, '全データを削除')));
}
