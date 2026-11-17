// 講座データの読み込みと練習用レシピ（DOM 非依存の部分）
import * as X from './xt3.js';

export const TOTAL = 50;
export const RANKS = [
  [50, 'ディレクター'], [40, 'シネマトグラファー'], [30, 'レンズマスター'],
  [20, 'カラーリスト'], [10, 'ストリートスナッパー'], [0, '見習いカメラマン'],
];
export const rankOf = (done) => RANKS.find(([min]) => done >= min)[1];

let cache = null;
export function loadLessons() {
  cache ??= fetch('data/lessons.json').then((r) => {
    if (!r.ok) throw new Error('lessons.json を読み込めません');
    return r.json();
  });
  cache.catch(() => { cache = null; });
  return cache;
}

/** 練習用レシピ（保存前の形）。recipe が無い回は null */
export function lessonRecipe(lesson) {
  if (!lesson?.recipe) return null;
  const r = X.fromPartial(lesson.recipe);
  r.name = (lesson.recipe.name || `講座 ${lesson.no}: ${lesson.title}`).slice(0, X.LIMITS.name);
  r.source = 'lesson';
  r.sourceRef = lesson.no;
  r.notes = lesson.recipe.notes || `撮影講座 第${lesson.no}回の練習用レシピ。`;
  return r;
}

/** 本文があるか（章ごとに順次追加するため） */
export const hasBody = (l) => !!(l.theory && l.steps?.length && l.mission);
