// ⑥ ビフォーアフター・スライダー。2 枚の画像を選んで左右スライドで比較するだけ（保存しない）。
import { h } from '../ui/dom.js';

export function render(root) {
  const urls = [null, null];
  let pos = 50;

  const imgs = [h('img', { alt: 'ビフォー', draggable: false }), h('img', { alt: 'アフター', draggable: false })];
  const after = h('div', { class: 'ba-after' }, imgs[1]);
  const handle = h('div', { class: 'ba-handle' });
  const stage = h('div', { class: 'ba-stage', hidden: true }, imgs[0], after, handle,
    h('span', { class: 'ba-tag l' }, 'BEFORE'), h('span', { class: 'ba-tag r' }, 'AFTER'));
  const range = h('input', { type: 'range', min: 0, max: 100, step: 0.1, value: pos, class: 'ba-range', 'aria-label': '比較位置', hidden: true, oninput: (e) => setPos(+e.target.value) });
  const readout = h('div', { class: 'num small muted', hidden: true });

  const setPos = (p) => {
    pos = Math.min(100, Math.max(0, p));
    after.style.clipPath = `inset(0 0 0 ${pos}%)`;
    handle.style.left = `${pos}%`;
    range.value = pos;
    readout.textContent = `${pos.toFixed(0)}%`;
  };
  const drag = (e) => { const r = stage.getBoundingClientRect(); setPos((e.clientX - r.left) / r.width * 100); };
  stage.addEventListener('pointerdown', (e) => { stage.setPointerCapture(e.pointerId); drag(e); });
  stage.addEventListener('pointermove', (e) => { if (stage.hasPointerCapture(e.pointerId)) drag(e); });

  const pick = (i, label) => {
    const input = h('input', { type: 'file', accept: 'image/*', hidden: true, onchange: () => {
      const f = input.files[0]; input.value = '';
      if (!f) return;
      if (urls[i]) URL.revokeObjectURL(urls[i]);
      urls[i] = URL.createObjectURL(f);
      imgs[i].src = urls[i];
      btn.textContent = `${label}: ${f.name}`;
      btn.classList.add('on');
      const ready = urls[0] && urls[1];
      stage.hidden = range.hidden = readout.hidden = !ready;
      if (ready) setPos(pos);
    } });
    const btn = h('button', { type: 'button', class: 'btn block ba-pick', onclick: () => input.click() }, `${label} を選択`);
    return [btn, input];
  };

  root.append(h('div', { class: 'stack' },
    h('p', { class: 'small muted' }, '2 枚の画像を選ぶと左右スライドで見比べられます。画像はこの画面を離れると破棄され、保存されません。'),
    pick(0, 'ビフォー'), pick(1, 'アフター'),
    stage, range, readout));
  setPos(pos);

  return () => urls.forEach((u) => u && URL.revokeObjectURL(u));
}
