// ⑦ 撮影講座 全50回
import { h, toast } from '../ui/dom.js';
import { loadLessons, rankOf, TOTAL, hasBody } from '../lessons.js';
import * as store from '../store.js';

let chapter = null; // 選択中の章（メモリのみ）

export function progressGauge() {
  const done = store.completedLessons().length;
  const pct = Math.round(done / TOTAL * 100);
  return h('div', { class: 'card gauge' },
    h('div', { class: 'row' },
      h('div', { class: 'grow' }, '全', h('span', { class: 'num' }, TOTAL), '回中 ', h('span', { class: 'num gauge-n' }, done), '回完了（', h('span', { class: 'num' }, `${pct}%`), '）'),
      h('span', { class: 'rank' }, rankOf(done))),
    h('div', { class: 'bar', role: 'progressbar', 'aria-valuemin': 0, 'aria-valuemax': TOTAL, 'aria-valuenow': done, 'aria-label': '講座の進捗' },
      h('div', { style: `width:${pct}%` })));
}

export function doneToggle(no, onChange) {
  const on = store.completedLessons().includes(no);
  return h('button', { type: 'button', class: `check ${on ? 'on' : ''}`, 'aria-pressed': String(on), 'aria-label': `第${no}回を${on ? '未完了に戻す' : '完了にする'}`,
    onclick: (e) => { e.preventDefault(); e.stopPropagation(); store.setLessonDone(no, !on); onChange(); } },
    h('svg', { viewBox: '0 0 24 24', 'aria-hidden': 'true' }));
}

export function render(root) {
  const body = h('div', { class: 'stack' }, h('p', { class: 'muted' }, '読み込み中…'));
  root.append(body);
  let alive = true;
  loadLessons().then((data) => { if (alive) draw(data); }).catch(() => {
    body.replaceChildren(h('div', { class: 'notice' }, '講座データを読み込めませんでした。'));
  });

  function draw(data) {
    const done = new Set(store.completedLessons());
    if (chapter == null) {
      // 最初に開いたときは未完了の回がある最初の章
      chapter = data.chapters.find((c) => data.lessons.some((l) => l.chapter === c.no && !done.has(l.no)))?.no ?? 1;
    }
    const ch = data.chapters.find((c) => c.no === chapter);
    const lessons = data.lessons.filter((l) => l.chapter === chapter);
    const chDone = lessons.filter((l) => done.has(l.no)).length;
    const redraw = () => draw(data);

    body.replaceChildren(
      progressGauge(),
      h('div', { class: 'tabs', role: 'tablist' }, data.chapters.map((c) => {
        const n = data.lessons.filter((l) => l.chapter === c.no && done.has(l.no)).length;
        return h('button', { type: 'button', role: 'tab', class: `tab ${c.no === chapter ? 'on' : ''}`, 'aria-selected': String(c.no === chapter),
          onclick: () => { chapter = c.no; redraw(); } }, h('span', null, `第${c.no}章`), h('span', { class: 'num small' }, `${n}/10`));
      })),
      h('div', null,
        h('h2', { style: 'font-size:16px' }, `第${ch.no}章 ${ch.title}`),
        h('div', { class: 'small muted' }, h('span', { class: 'num' }, `${chDone}/${lessons.length}`), ' 回完了')),
      h('div', { class: 'stack', style: 'gap:6px' }, lessons.map((l) => h('a', { class: `card lesson-row ${done.has(l.no) ? 'done' : ''}`, href: `#/academy/${l.no}` },
        h('span', { class: 'num lesson-no' }, String(l.no).padStart(2, '0')),
        h('div', { class: 'grow' },
          h('div', { class: 'lesson-title' }, l.title),
          hasBody(l) ? (l.summary ? h('div', { class: 'small muted' }, l.summary) : null) : h('div', { class: 'small muted' }, '本文は準備中です')),
        doneToggle(l.no, () => { redraw(); toast(store.completedLessons().includes(l.no) ? `第${l.no}回を完了にしました` : `第${l.no}回を未完了に戻しました`); })))));
  }
  return () => { alive = false; };
}
