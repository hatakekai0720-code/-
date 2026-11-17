// 共通 UI ヘルパー: 要素生成、トースト、シート（モーダル）、確認ダイアログ、ステッパー

export function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  for (const kid of kids.flat(Infinity)) {
    if (kid == null || kid === false) continue;
    el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
  }
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k in el) el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  return el;
}

export function toast(msg, ms = 2400) {
  const root = document.getElementById('toast-root');
  const el = h('div', { class: 'toast' }, msg);
  root.append(el);
  while (root.children.length > 2) root.firstElementChild.remove(); // 連続操作で画面を埋めない
  setTimeout(() => el.remove(), ms);
}

const openSheets = new Set();
export function closeSheets() { for (const c of [...openSheets]) c(); }

/** 下からのシート。build(close) がシート内の要素を返す。 */
export function sheet(title, build, onClose) {
  const box = h('div', { class: 'sheet', role: 'dialog', 'aria-modal': 'true', 'aria-label': title }, h('h2', null, title));
  const back = h('div', { class: 'sheet-backdrop' }, box);
  const close = () => {
    if (!openSheets.delete(close)) return;
    back.remove();
    document.removeEventListener('keydown', onKey);
    onClose?.();
  };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  back.addEventListener('click', (e) => { if (e.target === back) close(); });
  document.addEventListener('keydown', onKey);
  box.append(...[build(close)].flat());
  document.body.append(back);
  openSheets.add(close);
  return close;
}

export function confirmSheet(title, message, okLabel = 'OK', danger = false) {
  return new Promise((resolve) => {
    let result = false;
    sheet(title, (close) => [
      h('p', { class: 'muted', style: 'margin-bottom:12px' }, message),
      h('div', { class: 'row' },
        h('button', { type: 'button', class: 'btn grow', onclick: close }, 'キャンセル'),
        h('button', { type: 'button', class: `btn grow ${danger ? 'danger' : 'primary'}`, onclick: () => { result = true; close(); } }, okLabel)),
    ], () => resolve(result));
  });
}

/** 範囲外の値を作れない増減ボタン。steps に複数指定すると粗い刻みのボタンも並ぶ。 */
export function stepper({ value, min, max, steps = [1], format = String, label = '', onChange }) {
  let v = value;
  const out = h('output', { class: 'stepper-val num' });
  const btns = [];
  const mk = (d) => {
    const text = (d > 0 ? '+' : '−') + (steps.length > 1 ? Math.abs(d) : '');
    const b = h('button', { type: 'button', class: 'stepper-btn num', 'aria-label': `${label} ${d > 0 ? '+' : '-'}${Math.abs(d)}`, onclick: () => set(v + d) }, text);
    btns.push([b, d]);
    return b;
  };
  const refresh = () => {
    out.textContent = format(v);
    for (const [b, d] of btns) b.disabled = d < 0 ? v <= min : v >= max;
  };
  const set = (n) => { v = Math.min(max, Math.max(min, n)); refresh(); onChange?.(v); };
  const desc = [...steps].sort((a, b) => b - a);
  const el = h('div', { class: 'stepper' }, desc.map((s) => mk(-s)), out, [...desc].reverse().map((s) => mk(s)));
  refresh();
  return el;
}

export function select(options, value, onChange, attrs = {}) {
  return h('select', { class: 'input', ...attrs, value, onchange: (e) => onChange(e.target.value) },
    options.map((o) => h('option', { value: o.id }, o.label)));
}
