// 講座データのテスト。実行: node tests/lessons.test.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { lessonRecipe, hasBody, rankOf, TOTAL } from '../js/lessons.js';
import { validateRecipe, drWarning } from '../js/xt3.js';

let count = 0;
const test = (name, fn) => { fn(); count++; console.log('ok  ', name); };
const data = JSON.parse(readFileSync(new URL('../data/lessons.json', import.meta.url)));

test('全50回・各章10回・番号が連続', () => {
  assert.equal(data.lessons.length, TOTAL);
  assert.equal(data.chapters.length, 5);
  data.lessons.forEach((l, i) => {
    assert.equal(l.no, i + 1);
    assert.equal(l.chapter, Math.floor(i / 10) + 1);
    assert.ok(typeof l.title === 'string' && l.title.length > 3);
  });
});
test('仕様どおりのタイトル（抜き取り）', () => {
  const t = (n) => data.lessons[n - 1].title;
  assert.equal(t(1), 'オート卒業！X-T3の「3つの物理ダイヤル」と露出の三角形');
  assert.equal(t(3), 'X-T3「9つのフィルムシミュレーション」完全解説');
  assert.equal(t(22), 'WBシフトで作る「ティール＆オレンジ」');
  assert.equal(t(39), 'ボディ内手ブレ補正非搭載のX-T3で低速シャッターを切る構え方');
  assert.match(t(50), /^卒業制作/);
});
test('本文がある回はスキーマどおり', () => {
  for (const l of data.lessons.filter(hasBody)) {
    assert.ok(l.summary && l.theory && l.mission, `第${l.no}回`);
    assert.ok(Array.isArray(l.steps) && l.steps.length >= 3 && l.steps.every((s) => typeof s === 'string' && s), `第${l.no}回 steps`);
  }
  for (const ch of [1, 2, 3, 4, 5]) assert.ok(data.lessons.filter((l) => l.chapter === ch).every(hasBody), `第${ch}章は全回本文あり`);
});
test('練習用レシピはすべて xt3.js の範囲内', () => {
  for (const l of data.lessons) {
    const r = lessonRecipe(l);
    if (!l.recipe) { assert.equal(r, null); continue; }
    assert.deepEqual(validateRecipe(r), [], `第${l.no}回`);
    assert.equal(r.source, 'lesson'); assert.equal(r.sourceRef, l.no);
    assert.notEqual(drWarning(r)?.level, 'warn', `第${l.no}回: ${drWarning(r)?.text}`);
  }
});
test('X-T3 に無い機能をレシピ・手順として扱っていない', () => {
  // 名前を出すこと自体（「X-T3には無い」という説明）は許可。手順やレシピに入っていないことを確認する
  const banned = /クラシックネガ|ノスタルジック|カラークローム・?ブルー|クラリティ|グレイン.*サイズ|ETERNA ?ブリーチ/;
  for (const l of data.lessons.filter(hasBody)) {
    for (const s of l.steps) assert.ok(!banned.test(s), `第${l.no}回 手順: ${s}`);
    if (l.recipe) assert.ok(!banned.test(JSON.stringify(l.recipe)), `第${l.no}回 レシピ`);
  }
});
test('ランク', () => {
  assert.deepEqual([0, 9, 10, 19, 20, 30, 40, 49, 50].map(rankOf),
    ['見習いカメラマン', '見習いカメラマン', 'ストリートスナッパー', 'ストリートスナッパー', 'カラーリスト', 'レンズマスター', 'シネマトグラファー', 'シネマトグラファー', 'ディレクター']);
});
console.log(`\n${count} 件のテストに合格`);
