// ① シネマティック画像解析 + ② 推定レシピ。
// 画像はメモリ上の Canvas で扱うだけで、どこにも保存しない。保存するのは数値（レシピ）のみ。
import { h, toast, sheet } from '../ui/dom.js';
import { paramSummary } from '../ui/recipe-ui.js';
import { themeColors } from '../ui/theme.js';
import { analyzeTiled, canvasReader, fitSize, detectBars, excludedRects } from '../analyzer.js';
import { estimate, planRecipe, toneCurves, curvesText, summarize, textureEstimate, SCENES } from '../translator.js';
import * as X from '../xt3.js';
import * as store from '../store.js';
import { loadLocations } from '../locations.js';
import { groupWorks, fold } from '../film.js';
import { paletteRow } from './location.js';
import { similarWorks } from '../similar.js';
import { readExifFromFile, decodeFuji, shotInfo, recipeFromJpeg, notesFromJpeg, isXT3 } from '../exif.js';

// 画面を切り替えても直前の結果を残す（メモリのみ。リロードで消える。画像ファイルも保存はしない）
// { file, canvas, fileName, bars, auto, rects, result, est, pick, mode, ms }
let last = null;

const MAIN_TILE_AREA = 524_288;
const MIN_RECT = 0.02; // 手動除外: 幅・高さがこの割合未満の長方形は、指が少し触れただけとみなして無視する

/** Worker + OffscreenCanvas で解析できる環境か */
function workerCapable() {
  try { return typeof Worker === 'function' && typeof OffscreenCanvas === 'function' && !!new OffscreenCanvas(1, 1).getContext('2d'); }
  catch { return false; }
}

/**
 * 全ピクセル解析のジョブ。Worker が使えればそこで、使えなければメインスレッドでタイルごとに await しながら処理する。
 * @returns {{ promise: Promise<{result, mode}>, cancel: () => void }}
 */
function startAnalysis(img, file, onProgress, exclude) {
  let cancelled = false, worker = null, reject = null;
  const ctrl = { aborted: false };
  const mainThread = async (source) => {
    const read = canvasReader(source, (w, h) => h_canvas(w, h));
    const result = await analyzeTiled(read, source.width, source.height, {
      // メインスレッドではタイルを小さく（0.5MP ≒ 数十 ms）して、1 タイルごとに描画・操作を譲る
      maxArea: MAIN_TILE_AREA, onProgress, signal: ctrl, exclude, yieldFn: () => new Promise((r) => setTimeout(r, 0)),
    });
    return { result, mode: 'main' };
  };
  const viaWorker = () => new Promise((resolve, rej) => {
    reject = rej;
    worker = new Worker(new URL('../analyze-worker.js', import.meta.url), { type: 'module' });
    worker.onmessage = (e) => {
      const m = e.data;
      if (m.type === 'progress') onProgress(m.done, m.total);
      else if (m.type === 'done') { worker.terminate(); resolve({ result: m.result, mode: 'worker' }); }
      else if (m.type === 'error') { worker.terminate(); rej(new Error(m.message)); }
    };
    worker.onerror = (e) => { e.preventDefault?.(); worker.terminate(); rej(new Error('worker')); };
    worker.postMessage({ bitmap: img, exclude }, [img]); // ImageBitmap は Worker に移す（メインスレッドからは消える）
  });
  const promise = (async () => {
    if (workerCapable() && typeof ImageBitmap === 'function' && img instanceof ImageBitmap) {
      try { return await viaWorker(); }
      catch (err) {
        if (cancelled) throw err;
        // Worker 内で失敗したとき（module worker 非対応など）は、もう一度デコードしてメインスレッドで解析する
        const again = await decode(file);
        try { return await mainThread(again); } finally { again.close?.(); }
      }
    }
    try { return await mainThread(img); } finally { img.close?.(); }
  })();
  return {
    promise,
    cancel: () => { cancelled = true; ctrl.aborted = true; if (worker) { worker.terminate(); reject?.(Object.assign(new Error('キャンセルしました'), { name: 'AbortError' })); } },
  };
}
const h_canvas = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };

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

  let job = null;
  /** 画像を選んだとき: 縮小プレビューを作り、黒帯を検出してから解析する */
  async function load(file) {
    job?.cancel(); job = null;
    try {
      // JPEG なら EXIF / MakerNote（実際の設定）をファイルの先頭だけから読む。画像の解析と並行して進める
      const exifP = /jpe?g$/i.test(file.type || '') || /\.jpe?g$/i.test(file.name || '') ? readExifFromFile(file).catch(() => null) : Promise.resolve(null);
      const img = await decode(file);
      const { width, height } = fitSize(img.width, img.height);
      const canvas = h('canvas', { class: 'preview', width, height });
      const g = canvas.getContext('2d', { willReadFrequently: true });
      g.drawImage(img, 0, 0, width, height); // 表示用は縮小のまま
      // 黒帯は縮小プレビューで検出する（境目のにじんだ 1px も黒帯側に入れる）
      const bars = detectBars(g.getImageData(0, 0, width, height).data, width, height, { pad: 1 });
      const state = { file, canvas, fileName: file.name.replace(/\.[^.]+$/, ''), bars, auto: true, rects: [], scene: last?.scene ?? 'auto', exif: await exifP };
      await run(state, img);
    } catch {
      out.replaceChildren(h('div', { class: 'notice' }, 'この画像は読み込めませんでした。JPEG / PNG / WebP などをお試しください。'));
    }
  }

  const excludeOf = (st) => ({ bars: st.auto ? st.bars : null, rects: st.rects });

  /** state の除外範囲で全ピクセルを解析する。img を省略するとファイルからもう一度デコードする（Worker に渡すと手元から消えるため） */
  async function run(state, img) {
    job?.cancel(); job = null;
    const bar = h('span');
    const meter = h('div', { class: 'progress', role: 'progressbar', 'aria-label': '解析の進捗', 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': '0' }, bar);
    const label = h('span', { class: 'num small muted grow' }, '読み込み中…');
    const cancelBtn = h('button', { type: 'button', class: 'btn', onclick: () => job?.cancel() }, 'キャンセル');
    out.replaceChildren(previewBlock(state, false), h('div', { class: 'card stack', style: 'gap:8px' }, h('div', null, '全ピクセルを解析中'), meter, h('div', { class: 'row' }, label, cancelBtn)));
    const t0 = performance.now();
    let mine = null;
    try {
      img ??= await decode(state.file);
      mine = job = startAnalysis(img, state.file, (done, total) => {
        const p = total ? done / total * 100 : 0;
        bar.style.width = `${p}%`; meter.setAttribute('aria-valuenow', String(Math.round(p)));
        label.textContent = `${(done / 1e6).toFixed(1)} / ${(total / 1e6).toFixed(1)} MP（${Math.round(p)}%）`;
      }, excludeOf(state));
      const { result, mode } = await mine.promise;
      if (job !== mine) return;
      job = null;
      last = Object.assign(state, { result, est: estimate(result, { scene: state.scene }), pick: 0, mode, ms: performance.now() - t0, dirty: false });
      show();
    } catch (err) {
      if (mine && job !== mine) return; // 別の画像に切り替わった
      job = null;
      if (err?.name === 'AbortError') {
        toast('解析をキャンセルしました');
        if (last) show(); else out.replaceChildren();
        return;
      }
      if (/除外/.test(err?.message || '')) {
        toast('除外した範囲が画像全体です。範囲を減らしてください', 3500);
        state.rects = []; state.dirty = false;
        return run(state);
      }
      out.replaceChildren(h('div', { class: 'notice' }, 'この画像は読み込めませんでした。JPEG / PNG / WebP などをお試しください。'));
    }
  }

  /**
   * プレビューと解析範囲の操作。除外した範囲は斜線で表示する。
   * interactive = false のとき（解析中）は操作できない。
   */
  function previewBlock(state, interactive = true) {
    const { canvas } = state;
    const overlay = h('canvas', { class: 'preview-overlay', width: canvas.width, height: canvas.height, 'aria-hidden': 'true' });
    const stage = h('div', { class: 'preview-stage' }, canvas, overlay);
    let drawing = false, dragRect = null;
    const paint = () => {
      const g = overlay.getContext('2d');
      const W = overlay.width, H = overlay.height;
      g.clearRect(0, 0, W, H);
      const rects = excludedRects(excludeOf(state), W, H);
      if (dragRect) rects.push(...excludedRects({ rects: [dragRect] }, W, H));
      if (!rects.length) return;
      const s = Math.max(1, W / 400); // 斜線の間隔（表示サイズに合わせる）
      g.save();
      g.beginPath();
      for (const r of rects) g.rect(r.x0, r.y0, r.x1 - r.x0, r.y1 - r.y0);
      g.clip();
      g.fillStyle = 'rgba(0,0,0,.45)'; g.fillRect(0, 0, W, H);
      g.strokeStyle = 'rgba(245,158,11,.85)'; g.lineWidth = 1.5 * s;
      g.beginPath();
      for (let x = -H; x < W; x += 10 * s) { g.moveTo(x, H); g.lineTo(x + H, 0); }
      g.stroke();
      g.restore();
      g.strokeStyle = '#f59e0b'; g.lineWidth = 1.5 * s; g.setLineDash([4 * s, 3 * s]);
      for (const r of rects) g.strokeRect(r.x0 + 0.5, r.y0 + 0.5, r.x1 - r.x0 - 1, r.y1 - r.y0 - 1);
    };
    const frac = (e) => { const b = overlay.getBoundingClientRect(); return [Math.min(1, Math.max(0, (e.clientX - b.left) / b.width)), Math.min(1, Math.max(0, (e.clientY - b.top) / b.height))]; };
    let start = null;
    overlay.addEventListener('pointerdown', (e) => { if (!drawing) return; e.preventDefault(); overlay.setPointerCapture(e.pointerId); start = frac(e); dragRect = { x: start[0], y: start[1], w: 0, h: 0 }; });
    overlay.addEventListener('pointermove', (e) => { if (!start) return; const [x, y] = frac(e); dragRect = { x: start[0], y: start[1], w: x - start[0], h: y - start[1] }; paint(); });
    const end = () => {
      if (!start) return;
      const r = dragRect; start = null; dragRect = null;
      if (r && Math.abs(r.w) >= MIN_RECT && Math.abs(r.h) >= MIN_RECT) {
        state.rects.push({ x: Math.min(r.x, r.x + r.w), y: Math.min(r.y, r.y + r.h), w: Math.abs(r.w), h: Math.abs(r.h) });
        state.dirty = true; sync();
      }
      paint();
    };
    overlay.addEventListener('pointerup', end); overlay.addEventListener('pointercancel', end);

    const b = state.bars, has = b.top + b.bottom + b.left + b.right > 0;
    const barText = has ? [b.top + b.bottom > 0 ? `上下 ${((b.top + b.bottom) * 100).toFixed(1)}%` : '', b.left + b.right > 0 ? `左右 ${((b.left + b.right) * 100).toFixed(1)}%` : ''].filter(Boolean).join('・') : '見つかりません';
    const autoBtn = h('button', { type: 'button', class: `chip ${state.auto && has ? 'on' : ''}`, 'aria-pressed': String(state.auto && has), disabled: !has || !interactive,
      onclick: () => { state.auto = !state.auto; run(state); } }, `黒帯を自動で除外（${barText}）`);
    const drawBtn = h('button', { type: 'button', class: 'chip', 'aria-pressed': 'false', disabled: !interactive, onclick: () => { drawing = !drawing; sync(); } });
    const undoBtn = h('button', { type: 'button', class: 'chip', disabled: !interactive, onclick: () => { state.rects.pop(); state.dirty = true; sync(); paint(); } }, '1 つ戻す');
    const clearBtn = h('button', { type: 'button', class: 'chip', disabled: !interactive, onclick: () => { state.rects = []; state.dirty = true; sync(); paint(); } }, '手動の除外を全部消す');
    const rerun = h('button', { type: 'button', class: 'btn primary', disabled: !interactive, onclick: () => { drawing = false; run(state); } }, 'この範囲で再解析');
    const hint = h('div', { class: 'small muted' });
    const sync = () => {
      stage.classList.toggle('drawing', drawing);
      drawBtn.classList.toggle('on', drawing); drawBtn.setAttribute('aria-pressed', String(drawing));
      drawBtn.textContent = drawing ? '範囲を描く: オン' : '範囲を除外（指で長方形を描く）';
      undoBtn.hidden = clearBtn.hidden = !state.rects.length;
      rerun.hidden = !state.dirty;
      hint.textContent = drawing ? '字幕・再生バー・ロゴなどを囲んでください（いくつでも）。描き終えたら「この範囲で再解析」' : '';
    };
    sync();
    requestAnimationFrame(paint);
    return h('div', { class: 'stack', style: 'gap:8px' },
      h('div', { class: 'preview-wrap' }, stage),
      h('div', { class: 'row wrap', style: 'gap:6px' }, autoBtn, drawBtn, undoBtn, clearBtn),
      hint, rerun);
  }

  function show() {
    const { result: a } = last;
    const hist = h('canvas', { class: 'hist', 'aria-label': 'RGB と輝度のヒストグラム' });
    const stat = (k, v) => h('div', null, h('div', { class: 'k' }, k), h('div', { class: 'v' }, v));
    const zone = (label, z, extra) => (z ? h('div', { class: 'cast' },
      h('span', { class: 'swatch', style: `background:rgb(${z.rgb.join(',')})` }),
      h('div', { class: 'grow' }, h('div', { class: 'small muted' }, label), h('div', null, z.label ?? z.name, z.strength !== 'なし' ? h('span', { class: 'muted small' }, `（${z.strength}）`) : null, extra)),
      h('div', { class: 'num small muted', style: 'text-align:right' }, `h ${Math.round(z.hue)}°`, h('br'), `C ${z.chroma.toFixed(1)}`))
      : h('div', { class: 'cast' }, h('span', { class: 'swatch' }), h('div', { class: 'grow' }, h('div', { class: 'small muted' }, label), h('div', null, 'なし'))));
    const total = a.totalPixels ?? a.pixels;
    const ev = (v) => `${v > 0.05 ? '+' : v < -0.05 ? '−' : '±'}${Math.abs(v).toFixed(1)}EV`;

    out.replaceChildren(
      previewBlock(last),
      h('div', { class: 'small muted' }, h('span', { class: 'num' }, `${a.width}×${a.height}px`), ' のうち ',
        h('span', { class: 'num' }, a.pixels.toLocaleString('en-US')), ' / ', h('span', { class: 'num' }, total.toLocaleString('en-US')), ' 画素を解析',
        h('span', { class: 'num' }, `（除外 ${pct((a.excludedRatio ?? 0) * 100)}）`),
        last.mode ? h('span', { class: 'num' }, `・${last.mode === 'worker' ? 'Worker' : 'メインスレッド'}・${(last.ms / 1000).toFixed(1)} 秒`) : null),
      h('div', { class: 'card summary' }, summarize(a, last.est.scene.id)),
      h('div', { class: 'section-title' }, 'ヒストグラム'),
      h('div', { class: 'card' }, hist, h('div', { class: 'hist-scale num small muted' }, h('span', null, '0'), h('span', null, '128'), h('span', null, '255'))),
      h('div', { class: 'section-title' }, '輝度'),
      h('div', { class: 'spec' },
        stat('露出の目安（中央値と中間グレーの差）', ev(a.exposureEV)),
        stat('黒の浮き（p1 / p5）', h('span', null, `${a.p1} / ${a.p5}`, a.blackLift ? h('span', { class: 'small', style: 'color:var(--accent);margin-left:6px' }, '黒が浮いている') : null)),
        stat('暗部（輝度64以下）', pct(a.darkRatio * 100)), stat('明部（輝度192以上）', pct(a.brightRatio * 100)),
        stat('黒つぶれ（真っ黒・輝度0〜2）', pct(a.clipBlack)), stat('白飛び（真っ白・輝度253〜255）', pct(a.clipWhite)),
        stat('p50', a.p50), stat('p95', a.p95), stat('コントラスト（p95−p5）', a.contrast),
        stat('平均彩度 C*', a.chroma.toFixed(1)), stat('平均彩度 HSV', pct(a.saturation))),
      h('div', { class: 'small muted' }, '「暗部」は暗く見える部分、「黒つぶれ」は階調が残っていない真っ黒の部分です。暗い画像でも黒が浮いていれば黒つぶれは 0% になります。'),
      h('div', { class: 'section-title' }, '色被り（Lab）'),
      h('div', { class: 'card stack', style: 'gap:8px' }, zone('シャドウ（輝度 下位25%）', a.shadows), zone('ハイライト（輝度 上位25%）', a.highlights),
        zone('光源（輝度 上位2%・128以上）', a.light, a.light ? h('span', { class: 'num small muted', style: 'margin-left:6px' }, `面積 ${pct(a.light.ratio * 100)}`) : null)),
      ...(a.texture ? [h('div', { class: 'section-title' }, '質感（粒状感・シャープさ）'), textureBlock(a.texture)] : []),
      ...(a.palette?.length ? [h('div', { class: 'section-title' }, '代表色'), paletteBlock(a.palette)] : []),
      ...(last.exif ? [h('div', { class: 'section-title' }, '実際の設定（JPEG に記録された値）'), jpegBlock()] : []),
      h('div', { class: 'section-title' }, '推定レシピ'),
      recipeBlock(),
      h('div', { class: 'section-title' }, 'RAW 現像用トーンカーブ'),
      curveBlock(),
      h('div', { class: 'section-title' }, 'この写真に近い映画'),
      similarBlock());
    requestAnimationFrame(() => drawHistogram(hist, a.hist));
  }

  function recipeBlock() {
    const { result: a, est } = last;
    const box = h('div', { class: 'stack' });
    const lvl = { 高: 'high', 中: 'mid', 低: 'low' }[est.confidence.level];
    // 撮影条件（K 値の基準）。変えたら推定し直す（再解析はしない）
    const sceneRow = h('div', { class: 'stack', style: 'gap:6px' },
      h('div', { class: 'label small muted' }, '撮影条件（WB の色温度の基準）'),
      h('div', { class: 'row wrap', style: 'gap:6px' }, SCENES.map((sc) => {
        const on = (last.scene ?? 'auto') === sc.id;
        return h('button', { type: 'button', class: `chip ${on ? 'on' : ''}`, 'aria-pressed': String(on), onclick: () => {
          last.scene = sc.id; last.est = estimate(a, { scene: sc.id }); show();
        } }, sc.id === 'auto' && est.scene.auto ? `自動（推定: ${est.scene.label}）` : sc.label);
      })));
    const draw = () => {
      const cand = est.candidates[last.pick];
      const plan = planRecipe(a, cand, { scene: est.scene.id });
      const r = plan.recipe;
      const name = h('input', { class: 'input', type: 'text', maxLength: X.LIMITS.name, value: `推定: ${last.fileName}`.slice(0, X.LIMITS.name), 'aria-label': 'レシピ名' });
      box.replaceChildren(
        h('div', { class: 'card stack', style: 'gap:8px' },
          h('div', { class: 'row' }, h('span', { class: 'grow', style: 'font-weight:600' }, '推定レシピ'), h('span', { class: `conf ${lvl}` }, `確度 ${est.confidence.level}`)),
          h('div', { class: 'small muted' }, est.confidence.reasons.join(' / ')),
          sceneRow,
          h('div', { class: 'label small muted' }, 'フィルムシミュレーション候補'),
          h('div', { class: 'row wrap', style: 'gap:6px' }, est.candidates.map((c, i) =>
            h('button', { type: 'button', class: `chip ${i === last.pick ? 'on' : ''}`, 'aria-pressed': String(i === last.pick), onclick: () => { last.pick = i; draw(); } },
              `${i + 1}. ${X.filmSim(c.filmSim).label}`))),
          h('div', { class: 'small muted' }, `理由: ${cand.why}`),
          paramSummary(r),
          r.exposureNote ? h('div', { class: 'small muted' }, '露出補正 ', h('span', { class: 'num' }, r.exposureNote)) : null,
          r.isoNote ? h('div', { class: 'small muted' }, `${X.labelOf(X.DR_MODES, r.dr)}・${est.scene.label} の `, h('span', { class: 'num' }, r.isoNote), ' で撮影') : null,
          ...plan.warnings.map((w) => h('div', { class: 'notice' }, w)),
          plan.notes.length ? h('ul', { class: 'small muted plan-notes' }, plan.notes.map((n) => h('li', null, n))) : null),
        h('div', { class: 'row' }, h('div', { class: 'grow' }, name),
          h('button', { type: 'button', class: 'btn primary', onclick: () => {
            const notes = [`画像解析からの推定レシピ（確度 ${est.confidence.level}・撮影条件 ${est.scene.label}）。`, ...plan.warnings, ...plan.notes, curvesText(toneCurves(a), a)].join('\n');
            const res = store.saveRecipe({ ...r, name: name.value, notes: notes.slice(0, X.LIMITS.notes) });
            if (res.errors) return toast(res.errors[0], 4000);
            toast('レシピとして保存しました');
            location.hash = `#/recipes/${encodeURIComponent(res.recipe.id)}`;
          } }, 'レシピとして保存')));
    };
    draw();
    return box;
  }

  function textureBlock(t) {
    const tx = textureEstimate(t);
    const lvl = { 高: 'high', 中: 'mid', 低: 'low' }[t.reliability.level];
    const stat = (k, v) => h('div', null, h('div', { class: 'k' }, k), h('div', { class: 'v' }, v));
    return h('div', { class: 'card stack', style: 'gap:8px' },
      h('div', { class: 'row' }, h('span', { class: 'grow' }, tx ? tx.words : '測れませんでした'), h('span', { class: `conf ${lvl}` }, `確度 ${t.reliability.level}`)),
      t.reliability.reasons.length ? h('div', { class: 'small muted' }, t.reliability.reasons.join(' / ')) : null,
      h('div', { class: 'spec' },
        stat('粒状感（平らな部分のノイズ σ）', t.grain == null ? '—' : t.grain.toFixed(1)),
        stat('シャープさ（輪郭の立ち上がり 0〜1）', t.sharpness == null ? '—' : t.sharpness.toFixed(2)),
        stat('平らなブロック / 輪郭のブロック', `${t.flatBlocks.toLocaleString('en-US')} / ${t.edgeBlocks.toLocaleString('en-US')}`),
        stat('8px 境目の段差（圧縮）', `${t.blockiness.toFixed(2)}×`)),
      tx ? h('div', { class: 'small muted' }, `推定レシピへの反映: グレイン ${X.labelOf(X.EFFECT_LEVELS, tx.grain)}・シャープネス ${X.signed(tx.sharpness)}・NR ${X.signed(tx.nr)}`) : null);
  }

  // JPEG の EXIF / MakerNote から読んだ「実際の設定」（推定ではない）。数値と文字だけで、画像は保存しない
  function jpegBlock() {
    const e = last.exif;
    const items = decodeFuji(e.fuji);
    const info = shotInfo(e);
    const row = (k, v, note, bad) => h('div', null, h('div', { class: 'k' }, k), h('div', { class: 'v' }, v,
      note ? h('div', { class: 'small', style: `color:var(${bad ? '--danger' : '--accent'});font-family:var(--sans)` }, note) : null));
    const notices = [];
    if (!e.fuji) notices.push('富士フイルムの MakerNote が無いため、撮影時の設定は読めません。読めた撮影情報だけを表示します。');
    else if (!isXT3(e)) notices.push(`X-T3 以外（${e.model || '機種不明'}）で撮影された画像です。X-T3 に無い設定は「X-T3では設定できない」と表示します。`);
    const card = h('div', { class: 'card stack', style: 'gap:8px' },
      h('div', { class: 'row' }, h('span', { class: 'grow', style: 'font-weight:600' }, '実際の設定'), h('span', { class: 'conf high' }, '推定ではない')),
      h('div', { class: 'small muted' }, 'カメラが JPEG に記録した値です（EXIF と富士フイルムの MakerNote）。位置情報（GPS）は読みません。'),
      ...notices.map((t) => h('div', { class: 'notice' }, t)),
      items.length ? h('div', { class: 'spec' }, items.map((it) => row(it.label, it.text, it.ok ? it.note : it.note || 'X-T3では設定できない', !it.ok))) : null,
      info.length ? h('div', { class: 'label small muted' }, '撮影情報') : null,
      info.length ? h('div', { class: 'spec' }, info.map((x) => row(x.label, x.text))) : null);
    if (!items.length) return card;
    const plan = recipeFromJpeg(e);
    const stamp = (e.dateTime || '').slice(0, 10).replace(/:/g, '-');
    const name = h('input', { class: 'input', type: 'text', maxLength: X.LIMITS.name, value: `JPEG: ${[e.model, stamp].filter(Boolean).join(' ') || last.fileName}`.slice(0, X.LIMITS.name), 'aria-label': 'レシピ名' });
    card.append(
      h('div', { class: 'label small muted' }, 'レシピとして保存する内容'),
      paramSummary(plan.recipe),
      plan.skipped.length ? h('div', { class: 'small muted' }, `X-T3では設定できない項目は既定値で保存します: ${plan.skipped.join(' / ')}`) : null,
      h('div', { class: 'row' }, h('div', { class: 'grow' }, name),
        h('button', { type: 'button', class: 'btn primary', onclick: () => {
          const res = store.saveRecipe({ ...plan.recipe, name: name.value, notes: notesFromJpeg(e, plan).slice(0, X.LIMITS.notes) });
          if (res.errors) return toast(res.errors[0], 4000);
          toast('レシピとして保存しました');
          location.hash = `#/recipes/${encodeURIComponent(res.recipe.id)}`;
        } }, 'レシピとして保存')));
    return card;
  }

  // 代表色を作品のパレットとして保存（色の数値だけ。画像は保存しない）
  function paletteBlock(colors) {
    const pick = () => loadLocations().then((locs) => {
      const works = groupWorks(locs).sort((x, y) => x.title.localeCompare(y.title, 'ja'));
      sheet('どの作品のパレットにしますか', (close) => {
        const list = h('div', { class: 'stack', style: 'gap:6px;max-height:50vh;overflow:auto' });
        const draw = (q) => list.replaceChildren(...works.filter((w) => !q || fold(w.title).includes(fold(q)) || fold(w.titleEn).includes(fold(q))).slice(0, 60)
          .map((w) => h('button', { type: 'button', class: 'list-btn', onclick: () => {
            const res = store.savePalette(w.key, colors);
            if (res.errors) return toast(res.errors[0], 3500);
            close(); toast(`「${w.title}」のパレットとして保存しました`);
          } }, h('span', { class: 'grow' }, w.title), h('span', { class: 'num small muted' }, w.year),
          store.getPalette(w.key) ? h('span', { class: 'small muted', style: 'margin-left:6px' }, '（上書き）') : null)));
        const input = h('input', { class: 'input', type: 'search', placeholder: '作品名で絞り込み', 'aria-label': '作品名で絞り込み', oninput: (e) => draw(e.target.value) });
        draw('');
        return [input, list];
      });
    }).catch(() => toast('ロケ地データを読み込めませんでした', 3500));
    return h('div', { class: 'card stack', style: 'gap:8px' },
      paletteRow(colors, '代表色'),
      h('button', { type: 'button', class: 'btn', onclick: pick }, '作品のパレットとして保存'),
      h('div', { class: 'small muted' }, '色の数値だけを保存します（画像は保存しません）。作品ページとロケ地の作品情報に表示されます。'));
  }

  // 解析結果と各ロケ地（代表色・look・レシピ・時間帯）を比べ、雰囲気の近い作品（同じ作品は 1 件にまとめる）
  function similarBlock() {
    const box = h('div', { class: 'stack', style: 'gap:8px' }, h('div', { class: 'small muted' }, '読み込み中…'));
    const a = last.result;
    loadLocations().then((locs) => {
      if (last?.result !== a) return;
      const list = similarWorks(a, locs);
      box.replaceChildren(...list.map((w, i) => h('div', { class: 'card stack', style: 'gap:6px' },
        h('div', { class: 'row', style: 'gap:8px' },
          h('span', { class: 'num muted' }, `${i + 1}`),
          h('a', { class: 'grow', style: 'font-weight:600', href: `#/works/${w.key}` }, w.title, ' ', h('span', { class: 'num small muted' }, `(${w.year})`)),
          h('span', { class: 'num small muted' }, `${Math.round(w.score * 100)}%`)),
        h('div', { class: 'small' }, w.reason),
        h('a', { class: 'small', href: `#/locations/${encodeURIComponent(w.location.id)}` }, `ロケ地: ${w.location.place}（${w.location.city}）`, w.count > 1 ? h('span', { class: 'muted' }, ` ほか ${w.count - 1} 件`) : null),
        w.location.palette?.length ? h('div', { class: 'row', style: 'gap:2px' }, w.location.palette.map((c) => h('span', { class: 'swatch', style: `background:${c};width:22px;height:14px` }))) : null)),
      h('div', { class: 'small muted' }, '代表色・中間調 / シャドウ / ハイライト / 光源の色・明るさ・コントラスト・彩度・黒の浮き・粒状感を、各ロケ地の色（代表色・look・推定レシピ・時間帯）と比べています。'));
    }).catch(() => box.replaceChildren(h('div', { class: 'small muted' }, 'ロケ地データを読み込めませんでした')));
    return box;
  }

  function curveBlock() {
    const text = curvesText(toneCurves(last.result), last.result);
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
  return () => { mo.disconnect(); job?.cancel(); job = null; };
}
