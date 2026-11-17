// 講座 各回の本文
import { h, toast } from '../ui/dom.js';
import { paramSummary } from '../ui/recipe-ui.js';
import { loadLessons, lessonRecipe, hasBody } from '../lessons.js';
import { progressGauge, doneToggle } from './academy.js';
import * as X from '../xt3.js';
import * as store from '../store.js';

// 本文中の【要確認】を目立たせる
function rich(text) {
  return text.split(/(【要確認】)/).map((s) => (s === '【要確認】' ? h('mark', { class: 'verify' }, s) : s));
}

export function render(root, { id }) {
  const no = Number(id);
  const body = h('div', { class: 'stack' }, h('p', { class: 'muted' }, '読み込み中…'));
  root.append(body);
  let alive = true;
  loadLessons().then((data) => { if (alive) draw(data); }).catch(() => {
    body.replaceChildren(h('div', { class: 'notice' }, '講座データを読み込めませんでした。'));
  });

  function draw(data) {
    const l = data.lessons.find((x) => x.no === no);
    if (!l) { body.replaceChildren(h('div', { class: 'empty' }, '講座が見つかりません。')); return; }
    const ch = data.chapters.find((c) => c.no === l.chapter);
    const prev = data.lessons.find((x) => x.no === no - 1), next = data.lessons.find((x) => x.no === no + 1);
    const r = lessonRecipe(l);
    const done = store.completedLessons().includes(no);
    const redraw = () => draw(data);

    body.replaceChildren(...[
      progressGauge(),
      h('div', null,
        h('div', { class: 'small muted' }, `第${ch.no}章 ${ch.title}`),
        h('div', { class: 'row', style: 'align-items:flex-start;margin-top:4px' },
          h('span', { class: 'num lesson-no big' }, String(no).padStart(2, '0')),
          h('h2', { class: 'grow', style: 'font-size:18px;line-height:1.45' }, l.title))),
      !hasBody(l) ? h('div', { class: 'notice info' }, 'この回の本文は準備中です。') : [
        l.summary ? h('p', { class: 'lead' }, l.summary) : null,
        h('section', { class: 'lesson-sec' }, h('h3', null, h('span', { class: 'sec-no' }, '①'), '理論と仕組み'),
          l.theory.split(/\n\n+/).map((p) => h('p', null, rich(p)))),
        h('section', { class: 'lesson-sec' }, h('h3', null, h('span', { class: 'sec-no' }, '②'), 'X-T3での操作手順'),
          h('ol', { class: 'steps' }, l.steps.map((s) => h('li', null, rich(s))))),
        h('section', { class: 'lesson-sec mission' }, h('h3', null, h('span', { class: 'sec-no' }, '③'), '実践ミッション'),
          l.mission.split(/\n\n+/).map((p) => h('p', null, rich(p)))),
      ],
      r ? h('div', { class: 'card stack', style: 'gap:6px' },
        h('div', { class: 'row' }, h('span', { class: 'grow', style: 'font-weight:600' }, '練習用レシピ'), h('span', { class: 'small muted' }, X.filmLabel(r))),
        paramSummary(r),
        h('a', { class: 'btn primary block', href: `#/qmenu/lesson-${no}` }, '練習用レシピを Qメニューで開く')) : null,
      h('button', { type: 'button', class: `btn block ${done ? '' : 'primary'}`, onclick: () => {
        store.setLessonDone(no, !done); toast(done ? '未完了に戻しました' : `第${no}回を完了にしました`); redraw();
      } }, done ? '✓ 完了済み（タップで未完了に戻す）' : 'この回を完了にする'),
      h('div', { class: 'row' },
        prev ? h('a', { class: 'btn grow', href: `#/academy/${prev.no}` }, `← 第${prev.no}回`) : h('span', { class: 'grow' }),
        h('a', { class: 'btn', href: '#/academy' }, '一覧'),
        next ? h('a', { class: 'btn grow', href: `#/academy/${next.no}` }, `第${next.no}回 →`) : h('span', { class: 'grow' })),
    ].flat(Infinity).filter(Boolean));
  }
  return () => { alive = false; };
}
