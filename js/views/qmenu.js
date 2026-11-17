// ③ Qメニュー再現・実機入力アシスト。
// 4×4 の並びはこのアプリ独自の初期配置で、実機のデフォルト配置を再現したものではない。
import { h, toast } from '../ui/dom.js';
import * as X from '../xt3.js';
import * as store from '../store.js';
import { loadLessons, lessonRecipe } from '../lessons.js';

const fx = (v) => ({ off: 'OFF', weak: '弱', strong: '強' }[v]);

/** WB シフトの座標グリッド（横軸 R、縦軸 B。上が B+） */
export function wbShiftSvg(r, b, detailed = false) {
  const { min, max } = X.RANGES.wbShift;
  let lines = '';
  for (let i = min; i <= max; i++) {
    const c = i === 0 ? '#9ca3af' : '#2a2a2a';
    const w = i === 0 ? 0.12 : 0.05;
    if (!detailed && i % 3 !== 0) continue;
    lines += `<line x1="${i}" y1="${min}" x2="${i}" y2="${max}" stroke="${c}" stroke-width="${w}"/><line x1="${min}" y1="${i}" x2="${max}" y2="${i}" stroke="${c}" stroke-width="${w}"/>`;
  }
  const labels = detailed
    ? `<g fill="#9ca3af" font-size="1.3" font-family="ui-monospace,Menlo,Consolas,monospace" stroke="none"><text x="9.4" y="-0.5" text-anchor="end">R+</text><text x="-9.4" y="-0.5">R-</text><text x="0.5" y="-8.4">B+</text><text x="0.5" y="9.3">B-</text></g>`
    : '';
  const wrap = document.createElement('div');
  wrap.innerHTML = `<svg viewBox="-10.5 -10.5 21 21" role="img" aria-label="WB シフト R${X.signed(r)} B${X.signed(b)}"><rect x="-9" y="-9" width="18" height="18" fill="#0a0a0a" stroke="none"/>${lines}${labels}<circle cx="${r}" cy="${-b}" r="${detailed ? 0.75 : 1.4}" fill="#f59e0b" stroke="none"/></svg>`;
  return wrap.firstChild;
}

// 16 マスの定義。value は文字列または要素を返す。
export const Q_ITEMS = {
  filmSim: { label: 'FILM SIM', value: (r) => X.filmSim(r.filmSim)?.q ?? '—' },
  monoFilter: { label: 'FILTER', value: (r) => (X.isMono(r.filmSim) ? X.MONO_FILTERS.find((m) => m.id === r.monoFilter)?.q ?? 'STD' : null) },
  dr: { label: 'DYNAMIC RANGE', value: (r) => X.labelOf(X.DR_MODES, r.dr) },
  wb: { label: 'WHITE BALANCE', value: (r) => X.wbLabel(r) },
  wbShift: { label: 'WB SHIFT', value: (r) => wbShiftSvg(r.wbShift.r, r.wbShift.b) },
  highlight: { label: 'HIGHLIGHT', value: (r) => X.signed(r.highlight) },
  shadow: { label: 'SHADOW', value: (r) => X.signed(r.shadow) },
  monoWC: { label: 'MONO WC', value: (r) => (X.isMono(r.filmSim) ? X.signed(r.monoWC) : null) },
  color: { label: 'COLOR', value: (r) => (X.hasColor(r.filmSim) ? X.signed(r.color) : null) },
  sharpness: { label: 'SHARPNESS', value: (r) => X.signed(r.sharpness) },
  nr: { label: 'NOISE REDUCTION', value: (r) => X.signed(r.nr) },
  grain: { label: 'GRAIN', value: (r) => fx(r.grain) },
  colorChrome: { label: 'COLOR CHROME', value: (r) => fx(r.colorChrome) },
  iso: { label: 'ISO メモ', value: (r) => r.isoNote.replace(/^ISO\s*/i, '') || null },
  exposure: { label: '露出メモ', value: (r) => r.exposureNote || null },
  slot: { label: 'CUSTOM', value: (r) => store.slotsOf(r.id).join(' ') || null },
};
export const DEFAULT_ORDER = ['filmSim', 'dr', 'wb', 'wbShift', 'highlight', 'shadow', 'color', 'sharpness', 'nr', 'grain', 'colorChrome', 'monoFilter', 'monoWC', 'iso', 'exposure', 'slot'];

export function getOrder() {
  // 旧配置の TAGS マスはモノクロ調整に置き換える
  const o = store.getSetting('qmenuOrder')?.map((k) => (k === 'tags' && !store.getSetting('qmenuOrder').includes('monoWC') ? 'monoWC' : k));
  const valid = Array.isArray(o) && o.length === 16 && new Set(o).size === 16 && o.every((k) => k in Q_ITEMS);
  return valid ? [...o] : [...DEFAULT_ORDER];
}

export function render(root, { id }) {
  const stored = store.getRecipe(id);
  if (stored) return draw(root, stored);
  // 講座の練習用レシピ: レシピ帳に保存しなくても開ける
  const m = /^lesson-(\d{1,2})$/.exec(id);
  if (m) {
    let cleanup = null, alive = true;
    loadLessons().then((data) => {
      if (!alive) return;
      const r = lessonRecipe(data.lessons.find((l) => l.no === Number(m[1])));
      if (r) cleanup = draw(root, { ...r, id }, true); else draw(root, null);
    }).catch(() => alive && draw(root, null));
    return () => { alive = false; cleanup?.(); };
  }
  return draw(root, null);
}

function draw(root, r, transient = false) {
  if (!r) {
    root.append(h('div', { class: 'qmenu' }, h('div', { class: 'empty' }, 'レシピが見つかりません。', h('div', { style: 'margin-top:12px' }, h('a', { class: 'btn', href: '#/recipes' }, 'レシピ一覧へ')))));
    return;
  }
  let order = getOrder();
  let editing = false;
  let picked = null;

  const grid = h('div', { class: 'q-grid' });
  const hint = h('p', { class: 'q-hint', hidden: true }, '入れ替えたい 2 つのマスを順にタップしてください');
  const editBtn = h('button', { type: 'button', class: 'btn', onclick: () => { editing = !editing; picked = null; draw(); } });

  const draw = () => {
    editBtn.textContent = editing ? '完了' : '並び替え';
    hint.hidden = !editing;
    grid.replaceChildren(...order.map((key, i) => {
      const item = Q_ITEMS[key];
      const v = item.value(r);
      const isNode = v && v.nodeType;
      const len = isNode || v == null ? 0 : Math.max(...String(v).split('\n').map((s) => [...s].reduce((n, c) => n + (c.charCodeAt(0) > 255 ? 2 : 1), 0)));
      const size = len <= 3 ? '' : len <= 6 ? 'm' : 's';
      const body = isNode ? v : h('div', { class: `q-val ${size}` }, v ?? '—');
      const cls = `q-cell ${v == null ? 'dim' : ''} ${picked === i ? 'sel' : ''}`;
      const kids = [h('div', { class: 'q-label' }, item.label), body];
      if (!editing) return h('div', { class: cls }, kids);
      return h('button', { type: 'button', class: cls, 'aria-pressed': String(picked === i), onclick: () => {
        if (picked == null) picked = i;
        else {
          if (picked !== i) { [order[picked], order[i]] = [order[i], order[picked]]; store.setSetting('qmenuOrder', order); }
          picked = null;
        }
        draw();
      } }, kids);
    }));
  };

  // 画面スリープ防止（対応ブラウザのみ）
  const wake = h('span', { class: 'wake', hidden: !('wakeLock' in navigator) }, 'SLEEP LOCK −');
  let lock = null;
  let alive = true;
  const acquire = async () => {
    if (!('wakeLock' in navigator) || !alive || document.visibilityState !== 'visible') return;
    try {
      lock = await navigator.wakeLock.request('screen');
      if (!alive) { lock.release().catch(() => {}); return; }
      wake.textContent = 'SLEEP LOCK ON'; wake.classList.add('on');
      lock.addEventListener('release', () => { wake.textContent = 'SLEEP LOCK −'; wake.classList.remove('on'); });
    } catch { /* 省電力モード等で拒否された場合は何もしない */ }
  };
  const onVis = () => { if (document.visibilityState === 'visible') acquire(); };
  document.addEventListener('visibilitychange', onVis);
  acquire();

  const close = () => (history.length > 1 ? history.back() : (location.hash = transient ? `#/academy/${r.sourceRef}` : `#/recipes/${encodeURIComponent(r.id)}`));
  const saveBtn = () => {
    const existing = store.findBySource('lesson', r.sourceRef);
    if (existing) return h('a', { class: 'btn block', style: 'margin-top:12px', href: `#/recipes/${encodeURIComponent(existing.id)}` }, 'レシピ帳に保存済み — 開く');
    return h('button', { type: 'button', class: 'btn primary block', style: 'margin-top:12px', onclick: (e) => {
      const { id: _drop, ...data } = r;
      const res = store.saveRecipe(data);
      if (res.errors) return toast(res.errors[0], 4000);
      toast('レシピ帳に保存しました');
      e.currentTarget.replaceWith(saveBtn());
    } }, 'このレシピをレシピ帳に保存');
  };
  const warn = X.drWarning(r);

  root.append(h('div', { class: 'qmenu' },
    h('div', { class: 'q-top' },
      h('button', { type: 'button', class: 'icon-btn', 'aria-label': '閉じる', onclick: close }, '✕'),
      h('h2', null, r.name), wake, editBtn),
    grid, hint,
    h('div', { class: 'q-wb' },
      wbShiftSvg(r.wbShift.r, r.wbShift.b, true),
      h('div', null,
        h('div', { class: 'k' }, 'WB SHIFT'),
        h('div', { class: 'big' }, `R ${X.signed(r.wbShift.r)}`), h('div', { class: 'big' }, `B ${X.signed(r.wbShift.b)}`),
        h('div', { class: 'k', style: 'margin-top:6px' }, 'WHITE BALANCE'), h('div', { class: 'num' }, X.wbLabel(r)),
        h('div', { class: 'k', style: 'margin-top:6px' }, 'FILM SIMULATION'), h('div', { class: 'small' }, X.filmLabel(r)),
        X.isMono(r.filmSim) ? [h('div', { class: 'k', style: 'margin-top:6px' }, 'MONO WC'), h('div', { class: 'num' }, X.wcLabel(r.monoWC))] : null)),
    warn?.level === 'warn' ? h('div', { class: 'notice', style: 'margin-top:10px' }, warn.text) : null,
    r.notes ? h('div', { class: 'q-notes' }, r.notes) : null,
    transient ? saveBtn() : null,
    h('p', { class: 'small muted', style: 'margin-top:12px' }, '※ マスの並びはこのアプリ独自のものです。')));
  draw();

  return () => {
    alive = false;
    document.removeEventListener('visibilitychange', onVis);
    lock?.release().catch(() => {});
  };
}
