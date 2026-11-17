// ① シネマティック画像解析 + ② 推定レシピ。
// 画像はメモリ上の Canvas で扱うだけで、どこにも保存しない。保存するのは数値（レシピ）のみ。
import { h, toast } from '../ui/dom.js';
import { paramSummary } from '../ui/recipe-ui.js';
import { themeColors } from '../ui/theme.js';
import { analyze, fitSize } from '../analyzer.js';
import { estimate, buildRecipe, toneCurves, curvesText } from '../translator.js';
import * as X from '../xt3.js';
import * as store from '../store.js';

// 画面を切り替えても直前の結果を残す（メモリのみ。リロードで消える）
let last = null; // { canvas, result, est, pick, fileName }

async function decode(file) {
  if ('createImageBitmap' in window) {
    try { return await createImageBitmap(file, { imageOrientation: 'from-image' }); } catch { /* 下のフォールバックへ */ }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return img;
  } finally { URL.revokeObjectURL(url); }
}

function drawHistogram(canvas, hist) {
  const c = themeColors();
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const W = canvas.clientWidth || 320, H = 140;
  canvas.width = W * dpr; canvas.height = H * dpr;
  const g = canvas.getContext('2d');
  g.scale(dpr, dpr);
  g.fillStyle = c.bg; g.fillRect(0, 0, W, H);
  g.strokeStyle = c.line; g.lineWidth = 1;
  for (const v of [64, 128, 192]) { const x = Math.round(v / 255 * W) + 0.5; g.beginPath(); g.moveTo(x, 0); g.lineTo(x, H); g.stroke(); }
  // 上位 0.5% の外れ値で潰れないよう、2 番目に大きい山を基準にする
  const peak = Math.max(1, ...['r', 'g', 'b', 'l'].map((k) => [...hist[k]].sort((a, b) => b - a)[1] || 1)) * 1.1;
  const path = (arr) => { g.beginPath(); g.moveTo(0, H); for (let i = 0; i < 256; i++) g.lineTo(i / 255 * W, H - Math.min(1, arr[i] / peak) * (H - 4)); g.lineTo(W, H); g.closePath(); };
  g.globalCompositeOperation = document.documentElement.dataset.theme === 'light' ? 'multiply' : 'screen';
  for (const [k, col] of [['r', 'rgba(239,68,68,.55)'], ['g', 'rgba(34,197,94,.55)'], ['b', 'rgba(59,130,246,.55)']]) { path(hist[k]); g.fillStyle = col; g.fill(); }
  g.globalCompositeOperation = 'source-over';
  path(hist.l); g.strokeStyle = c.text; g.lineWidth = 1.2; g.stroke();
}

const pct = (v) => `${v.toFixed(1)}%`;

export function render(root) {
  const fileInput = h('input', { type: 'file', accept: 'image/*', hidden: true, onchange: () => { const f = fileInput.files[0]; fileInput.value = ''; if (f) load(f); } });
  const drop = h('button', { type: 'button', class: 'dropzone', onclick: () => fileInput.click() },
    h('div', { style: 'font-weight:600' }, '画像を選択'),
    h('div', { class: 'small muted' }, 'タップしてフォトライブラリから / PC はドラッグ＆ドロップ'),
    h('div', { class: 'small muted' }, '画像は端末内で解析するだけで、保存も送信もしません'));
  for (const ev of ['dragenter', 'dragover']) drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('dragover'); });
  for (const ev of ['dragleave', 'drop']) drop.addEventListener(ev, () => drop.classList.remove('dragover'));
  drop.addEventListener('drop', (e) => { e.preventDefault(); const f = [...e.dataTransfer.files].find((x) => x.type.startsWith('image/')); if (f) load(f); else toast('画像ファイルをドロップしてください'); });

  const out = h('div', { class: 'stack' });
  root.append(drop, fileInput, out);

  async function load(file) {
    out.replaceChildren(h('p', { class: 'muted' }, '解析中…'));
    try {
      const img = await decode(file);
      const { width, height } = fitSize(img.width, img.height);
      const canvas = h('canvas', { class: 'preview', width, height });
      const g = canvas.getContext('2d', { willReadFrequently: true });
      g.drawImage(img, 0, 0, width, height);
      img.close?.();
      const result = analyze(g.getImageData(0, 0, width, height).data, width, height);
      last = { canvas, result, est: estimate(result), pick: 0, fileName: file.name.replace(/\.[^.]+$/, '') };
      show();
    } catch {
      out.replaceChildren(h('div', { class: 'notice' }, 'この画像は読み込めませんでした。JPEG / PNG / WebP などをお試しください。'));
    }
  }

  function show() {
    const { canvas, result: a, est } = last;
    const hist = h('canvas', { class: 'hist', 'aria-label': 'RGB と輝度のヒストグラム' });
    const stat = (k, v) => h('div', null, h('div', { class: 'k' }, k), h('div', { class: 'v' }, v));
    const zone = (label, z) => h('div', { class: 'cast' },
      h('span', { class: 'swatch', style: `background:rgb(${z.rgb.join(',')})` }),
      h('div', { class: 'grow' }, h('div', { class: 'small muted' }, label), h('div', null, z.name, z.strength !== 'なし' ? h('span', { class: 'muted small' }, `（${z.strength}）`) : null)),
      h('div', { class: 'num small muted', style: 'text-align:right' }, `h ${Math.round(z.hue)}°`, h('br'), `C ${z.chroma.toFixed(1)}`));

    out.replaceChildren(
      h('div', { class: 'preview-wrap' }, canvas),
      h('div', { class: 'small muted num' }, `${a.width}×${a.height}px で解析`),
      h('div', { class: 'section-title' }, 'ヒストグラム'),
      h('div', { class: 'card' }, hist, h('div', { class: 'hist-scale num small muted' }, h('span', null, '0'), h('span', null, '128'), h('span', null, '255'))),
      h('div', { class: 'section-title' }, '輝度'),
      h('div', { class: 'spec' },
        stat('黒つぶれ', pct(a.clipBlack)), stat('白飛び', pct(a.clipWhite)),
        stat('p5', a.p5), stat('p50', a.p50), stat('p95', a.p95), stat('コントラスト（p95−p5）', a.contrast),
        stat('平均彩度 C*', a.chroma.toFixed(1)), stat('平均彩度 HSV', pct(a.saturation))),
      h('div', { class: 'section-title' }, '色被り（Lab）'),
      h('div', { class: 'card stack', style: 'gap:8px' }, zone('シャドウ（輝度 下位25%）', a.shadows), zone('ハイライト（輝度 上位25%）', a.highlights)),
      h('div', { class: 'section-title' }, '推定レシピ'),
      recipeBlock(),
      h('div', { class: 'section-title' }, 'RAW 現像用トーンカーブ'),
      curveBlock());
    requestAnimationFrame(() => drawHistogram(hist, a.hist));
  }

  function recipeBlock() {
    const { result: a, est } = last;
    const box = h('div', { class: 'stack' });
    const lvl = { 高: 'high', 中: 'mid', 低: 'low' }[est.confidence.level];
    const draw = () => {
      const cand = est.candidates[last.pick];
      const r = buildRecipe(a, cand);
      const name = h('input', { class: 'input', type: 'text', maxLength: X.LIMITS.name, value: `推定: ${last.fileName}`.slice(0, X.LIMITS.name), 'aria-label': 'レシピ名' });
      box.replaceChildren(
        h('div', { class: 'card stack', style: 'gap:8px' },
          h('div', { class: 'row' }, h('span', { class: 'grow', style: 'font-weight:600' }, '推定レシピ'), h('span', { class: `conf ${lvl}` }, `確度 ${est.confidence.level}`)),
          h('div', { class: 'small muted' }, est.confidence.reasons.join(' / ')),
          h('div', { class: 'label small muted' }, 'フィルムシミュレーション候補'),
          h('div', { class: 'row wrap', style: 'gap:6px' }, est.candidates.map((c, i) =>
            h('button', { type: 'button', class: `chip ${i === last.pick ? 'on' : ''}`, 'aria-pressed': String(i === last.pick), onclick: () => { last.pick = i; draw(); } },
              `${i + 1}. ${X.filmSim(c.filmSim).label}`))),
          h('div', { class: 'small muted' }, `理由: ${cand.why}`),
          paramSummary(r),
          r.isoNote ? h('div', { class: 'small muted' }, `${X.labelOf(X.DR_MODES, r.dr)} のため `, h('span', { class: 'num' }, r.isoNote), ' で撮影') : null),
        h('div', { class: 'row' }, h('div', { class: 'grow' }, name),
          h('button', { type: 'button', class: 'btn primary', onclick: () => {
            const res = store.saveRecipe({ ...r, name: name.value, notes: `画像解析からの推定レシピ（確度 ${est.confidence.level}）。\n${curvesText(toneCurves(a))}` });
            if (res.errors) return toast(res.errors[0], 4000);
            toast('レシピとして保存しました');
            location.hash = `#/recipes/${encodeURIComponent(res.recipe.id)}`;
          } }, 'レシピとして保存')));
    };
    draw();
    return box;
  }

  function curveBlock() {
    const text = curvesText(toneCurves(last.result));
    return h('div', { class: 'card stack', style: 'gap:8px' },
      h('pre', { class: 'curve num' }, text),
      h('button', { type: 'button', class: 'btn', onclick: async () => {
        try { await navigator.clipboard.writeText(text); toast('コピーしました'); }
        catch {
          const ta = h('textarea', { value: text, style: 'position:fixed;opacity:0' });
          document.body.append(ta); ta.select();
          toast(document.execCommand('copy') ? 'コピーしました' : 'コピーできませんでした'); ta.remove();
        }
      } }, 'コピー'));
  }

  if (last) show();
  const onTheme = () => { const c = out.querySelector('.hist'); if (c && last) drawHistogram(c, last.result.hist); };
  const mo = new MutationObserver(onTheme);
  mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  return () => mo.disconnect();
}
