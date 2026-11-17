// レシピ新規作成・編集フォーム。入力 UI は xt3.js の範囲から外れる値を作れない。
import { h, toast, stepper, select } from '../ui/dom.js';
import * as X from '../xt3.js';
import * as store from '../store.js';

const TAG_SUGGEST = ['16mm', '23mm', '35mm', '56mm', '日中', '夕方', '夜', '雨', '街', '旅', 'ポートレート', '風景'];

export function render(root, { id }) {
  const existing = id ? store.getRecipe(id) : null;
  if (id && !existing) { root.append(h('div', { class: 'empty' }, 'レシピが見つかりません。')); return; }
  const d = structuredClone(existing || X.defaultRecipe());
  if (d.wb.kelvin == null) d.wb.kelvin = 5500;

  const field = (label, control, inline = true, extra = null) =>
    h('div', { class: `field ${inline ? 'inline' : ''}` }, h('div', { class: 'label' }, label), control, extra);
  const step = (key, label) => field(label, stepper({ value: d[key], ...X.RANGES[key], format: X.signed, label, onChange: (v) => { d[key] = v; } }));
  const text = (key, label, placeholder, max) => field(label,
    h('input', { class: 'input', type: 'text', value: d[key], maxLength: max, placeholder, 'aria-label': label, oninput: (e) => { d[key] = e.target.value; refresh(); } }), false);

  // 条件付き表示
  const monoField = field('モノクロフィルター', select(X.MONO_FILTERS, d.monoFilter || 'none', (v) => { d.monoFilter = v; }, { 'aria-label': 'モノクロフィルター' }), false);
  const kelvinField = field('色温度', stepper({ value: d.wb.kelvin, min: X.RANGES.kelvin.min, max: X.RANGES.kelvin.max, steps: [X.RANGES.kelvin.step, 100], format: (v) => `${v}K`, label: '色温度', onChange: (v) => { d.wb.kelvin = v; } }), false);
  const colorField = step('color', 'カラー');
  const colorHint = h('div', { class: 'hint' }, 'モノクロ / ACROS ではカラーは使われません');
  colorField.append(colorHint);
  const drHint = h('div', { class: 'hint' });

  const refresh = () => {
    const mono = X.isMono(d.filmSim);
    monoField.hidden = !mono;
    colorHint.hidden = !mono;
    kelvinField.hidden = d.wb.mode !== 'kelvin';
    const w = X.drWarning(d);
    drHint.hidden = !w;
    drHint.textContent = w?.text || '';
    drHint.classList.toggle('warn', w?.level === 'warn');
  };

  // タグ
  const tagBox = h('div', { class: 'row wrap', style: 'gap:6px' });
  const drawTags = () => {
    const known = [...new Set([...d.tags, ...TAG_SUGGEST, ...store.recipes().flatMap((r) => r.tags)])];
    tagBox.replaceChildren(...known.map((t) => {
      const on = d.tags.includes(t);
      return h('button', { type: 'button', class: `chip ${on ? 'on' : ''}`, 'aria-pressed': String(on), onclick: () => {
        if (on) d.tags = d.tags.filter((x) => x !== t);
        else if (d.tags.length < X.LIMITS.tags) d.tags.push(t);
        else toast(`タグは ${X.LIMITS.tags} 個までです`);
        drawTags();
      } }, t);
    }));
  };
  const tagInput = h('input', { class: 'input', type: 'text', maxLength: X.LIMITS.tag, placeholder: 'タグを追加（例: 90mm）', 'aria-label': 'タグを追加' });
  const addTag = () => {
    const t = tagInput.value.trim();
    if (!t) return;
    if (d.tags.length >= X.LIMITS.tags) return toast(`タグは ${X.LIMITS.tags} 個までです`);
    if (!d.tags.includes(t)) d.tags.push(t);
    tagInput.value = ''; drawTags();
  };
  tagInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); addTag(); } });

  const submit = (e) => {
    e.preventDefault();
    const mono = X.isMono(d.filmSim);
    const input = { ...d, monoFilter: mono ? (d.monoFilter || 'none') : null, wb: { mode: d.wb.mode, kelvin: d.wb.mode === 'kelvin' ? d.wb.kelvin : null } };
    const res = store.saveRecipe(input, existing?.id);
    if (res.errors) return toast(res.errors[0], 4000);
    toast('保存しました');
    location.replace(`#/recipes/${encodeURIComponent(res.recipe.id)}`);
  };

  root.append(h('form', { onsubmit: submit, novalidate: true },
    h('div', { class: 'card' },
      field('名前', h('input', { class: 'input', type: 'text', value: d.name, maxLength: X.LIMITS.name, placeholder: '例: Teal & Amber Night', 'aria-label': '名前', oninput: (e) => { d.name = e.target.value; } }), false),
      field('フィルムシミュレーション', select(X.FILM_SIMS, d.filmSim, (v) => { d.filmSim = v; refresh(); }, { 'aria-label': 'フィルムシミュレーション' }), false),
      monoField),
    h('div', { class: 'section-title' }, 'トーン・色'),
    h('div', { class: 'card' },
      field('ダイナミックレンジ', select(X.DR_MODES, d.dr, (v) => { d.dr = v; refresh(); }, { 'aria-label': 'ダイナミックレンジ' }), false, drHint),
      step('highlight', 'ハイライトトーン'), step('shadow', 'シャドウトーン'), colorField,
      step('sharpness', 'シャープネス'), step('nr', 'ノイズリダクション'),
      field('グレイン・エフェクト', select(X.EFFECT_LEVELS, d.grain, (v) => { d.grain = v; }, { 'aria-label': 'グレイン・エフェクト' }), false),
      field('カラークローム・エフェクト', select(X.EFFECT_LEVELS, d.colorChrome, (v) => { d.colorChrome = v; }, { 'aria-label': 'カラークローム・エフェクト' }), false)),
    h('div', { class: 'section-title' }, 'ホワイトバランス'),
    h('div', { class: 'card' },
      field('ホワイトバランス', select(X.WB_MODES, d.wb.mode, (v) => { d.wb.mode = v; refresh(); }, { 'aria-label': 'ホワイトバランス' }), false),
      kelvinField,
      field('WB シフト R', stepper({ value: d.wbShift.r, ...X.RANGES.wbShift, format: X.signed, label: 'WB シフト R', onChange: (v) => { d.wbShift.r = v; } })),
      field('WB シフト B', stepper({ value: d.wbShift.b, ...X.RANGES.wbShift, format: X.signed, label: 'WB シフト B', onChange: (v) => { d.wbShift.b = v; } }))),
    h('div', { class: 'section-title' }, 'メモ・タグ'),
    h('div', { class: 'card' },
      text('isoNote', `ISO メモ（常用 ${X.ISO.nativeMin}〜${X.ISO.nativeMax}）`, '例: ISO 640〜3200', X.LIMITS.note),
      text('exposureNote', '露出メモ', '例: -1/3EV', X.LIMITS.note),
      field('タグ（レンズ・シチュエーション）', h('div', { class: 'stack', style: 'gap:8px' }, tagBox,
        h('div', { class: 'row' }, h('div', { class: 'grow' }, tagInput), h('button', { type: 'button', class: 'btn', onclick: addTag }, '追加'))), false),
      field('メモ', h('textarea', { class: 'input', maxLength: X.LIMITS.notes, value: d.notes, 'aria-label': 'メモ', oninput: (e) => { d.notes = e.target.value; } }), false)),
    h('div', { class: 'form-footer' },
      h('button', { type: 'button', class: 'btn', onclick: () => history.back() }, 'キャンセル'),
      h('button', { type: 'submit', class: 'btn primary' }, '保存'))));
  drawTags(); refresh();
}
