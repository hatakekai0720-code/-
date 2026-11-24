// 設定（ヘッダーの歯車）: エクスポート / インポート、保存容量、Qメニュー配置リセット
import { h, toast, sheet, confirmSheet, select } from '../ui/dom.js';
import { applyTheme, THEMES } from '../ui/theme.js';
import * as store from '../store.js';
import { offlineStatus, checkForUpdate } from '../pwa.js';
import * as streets from '../streets.js';
import * as photos from '../photos.js';
import { summarizeCalibration, proposeRules, MIN_SAMPLES } from '../calibration.js';

export function render(root) {
  const redraw = () => { root.replaceChildren(); render(root); };
  const u = store.usage();

  const doExport = () => {
    const blob = new Blob([store.exportData()], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const d = new Date();
    const stamp = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
    const a = h('a', { href: url, download: `xt3cine-backup-${stamp}.json` });
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast('エクスポートしました');
  };

  const file = h('input', { type: 'file', accept: 'application/json,.json', hidden: true, onchange: async () => {
    const f = file.files[0];
    file.value = '';
    if (!f) return;
    let res;
    try { res = store.validateDb(JSON.parse(await f.text())); }
    catch { res = { ok: false, errors: ['JSON として読み込めませんでした'] }; }
    if (!res.ok) {
      sheet('インポートできません', (close) => [
        h('ul', { class: 'small', style: 'padding-left:18px;margin:0 0 12px' }, res.errors.slice(0, 8).map((e) => h('li', null, e))),
        res.errors.length > 8 ? h('p', { class: 'small muted' }, `ほか ${res.errors.length - 8} 件`) : null,
        h('button', { type: 'button', class: 'btn block', onclick: close }, '閉じる')]);
      return;
    }
    const inc = res.db;
    const apply = (mode, close) => {
      const ok = store.importData(inc, mode);
      close(); applyTheme(); toast(ok ? 'インポートしました' : '保存できませんでした'); redraw();
    };
    sheet('インポート方法を選択', (close) => [
      h('p', { class: 'muted small', style: 'margin-bottom:12px' }, 'ファイルの内容: レシピ ', h('span', { class: 'num' }, inc.recipes.length), ' 件 / ピン ', h('span', { class: 'num' }, inc.pins.length), ' 件 / 講座完了 ', h('span', { class: 'num' }, inc.academy.completed.length), ' 回 / 行ったロケ地 ', h('span', { class: 'num' }, Object.keys(inc.visited || {}).length), ' 件 / パレット ', h('span', { class: 'num' }, Object.keys(inc.palettes || {}).length), ' 件 / 較正データ ', h('span', { class: 'num' }, (inc.calibration || []).length), ' 件'),
      h('div', { class: 'stack' },
        h('button', { type: 'button', class: 'btn primary', onclick: () => apply('merge', close) }, 'マージ（今のデータに追加）'),
        h('button', { type: 'button', class: 'btn danger', onclick: () => apply('replace', close) }, '上書き（今のデータを置き換え）'),
        h('button', { type: 'button', class: 'btn', onclick: close }, 'キャンセル')),
      h('p', { class: 'muted small', style: 'margin-top:10px' }, 'マージでは、同じ ID のレシピは更新日時が新しい方を残します。')]);
  } });

  root.append(
    h('div', { class: 'section-title', style: 'margin-top:0' }, '表示'),
    h('div', { class: 'card' },
      h('div', { class: 'field', style: 'padding-top:0' }, h('div', { class: 'label' }, 'テーマ'),
        select(THEMES, store.getSetting('theme') || 'auto', (v) => { store.setSetting('theme', v === 'auto' ? undefined : v); applyTheme(); }, { 'aria-label': 'テーマ' }),
        h('div', { class: 'hint' }, '「自動」は端末の設定に合わせます。Qメニュー表示は屋外での見やすさのため常にダークです。'))),
    h('div', { class: 'section-title' }, 'データ'),
    h('div', { class: 'card stack' },
      h('p', { class: 'small muted' }, 'レシピ・スロット・ピン・講座の進捗・行ったロケ地（日付とメモ）・作品のパレット（色の数値）・較正データ（数値）を 1 つの JSON ファイルに書き出します。画像は含まれません。'),
      h('button', { type: 'button', class: 'btn', onclick: doExport }, 'エクスポート（JSON を保存）'),
      h('button', { type: 'button', class: 'btn', onclick: () => file.click() }, 'インポート（JSON を読み込む）'),
      file),
    h('div', { class: 'section-title' }, '保存容量'),
    h('div', { class: 'card' },
      h('div', { class: 'num', style: 'font-size:18px' }, `${(u.bytes / 1024).toFixed(1)} KB`, h('span', { class: 'muted', style: 'font-size:13px' }, ` / 約 ${(u.quota / 1024 / 1024).toFixed(0)} MB（${(u.ratio * 100).toFixed(2)}%）`)),
      h('div', { style: 'height:4px;background:var(--line);border-radius:2px;margin-top:8px;overflow:hidden' },
        h('div', { style: `height:100%;width:${Math.min(100, Math.max(u.bytes ? 1 : 0, u.ratio * 100))}%;background:var(--accent-bg)` })),
      h('p', { class: 'small muted', style: 'margin-top:8px' }, 'レシピ ', h('span', { class: 'num' }, store.recipes().length), ' 件。上限はブラウザによって異なる目安です。')),
    h('div', { class: 'section-title' }, 'Qメニュー'),
    h('div', { class: 'card stack' },
      h('p', { class: 'small muted' }, '16 マスの並びは Qメニュー表示の「並び替え」で入れ替えられます。'),
      h('button', { type: 'button', class: 'btn', onclick: () => { store.setSetting('qmenuOrder', undefined); toast('初期配置に戻しました'); } }, '並びを初期配置に戻す')),
    h('div', { class: 'section-title' }, '較正（推定ルールと実機の比較）'),
    calibrationCard(redraw),
    h('div', { class: 'section-title' }, 'オフライン'),
    offlineCard(),
    h('div', { class: 'section-title' }, '街路地図（OpenStreetMap）'),
    streetsCard(),
    h('div', { class: 'section-title' }, '危険な操作'),
    h('div', { class: 'card' },
      h('button', { type: 'button', class: 'btn danger block', onclick: async () => {
        if (await confirmSheet('全データを削除', 'レシピ・スロット・ピン・進捗・行ったロケ地・パレット・較正データをすべて削除します。元に戻せません。先にエクスポートしておくことをおすすめします。', '全て削除', true)) {
          store.resetAll(); applyTheme(); toast('削除しました'); redraw();
        }
      } }, '全データを削除')));
}

const download = (text, name) => {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  const a = h('a', { href: url, download: name });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};

// 分布の帯: 0〜max の軸に、現在の RULES の範囲（枠）と、各サンプル（点）・平均（縦線）
function distBar(d, range, max) {
  const x = (v) => `${Math.max(0, Math.min(100, v / max * 100))}%`;
  const bar = h('div', { class: 'cal-bar', role: 'img', 'aria-label': `平均 ${d.mean.toFixed(1)}、現在の範囲 ${range ? `${range[0]}〜${range[1]}` : 'なし'}` });
  if (range) bar.append(h('span', { class: 'cal-range', style: `left:${x(range[0])};width:calc(${x(Math.min(range[1], max))} - ${x(range[0])})` }));
  for (const v of d.values) bar.append(h('span', { class: 'cal-dot', style: `left:${x(v)}` }));
  bar.append(h('span', { class: 'cal-mean', style: `left:${x(d.mean)}` }));
  return bar;
}

// 較正: JPEG の実際の設定 + 解析の数値の組から、フィルムごとの彩度・コントラストの分布と RULES との差を見る
function calibrationCard(redraw) {
  const list = store.calibration();
  const card = h('div', { class: 'card stack' },
    h('p', { class: 'small muted' }, '解析画面で自分の X-T3 の JPEG を読み込み、「較正データに追加」を押すと、解析の数値と実際の設定の組がここにたまります（画像は保存しません）。推定のルール（translator.js の RULES）と実機の分布を比べ、更新案を JSON で書き出せます。アプリ内のルールは自動では書き換えません。'),
    h('div', { class: 'num' }, `較正データ ${list.length} 件`));
  if (!list.length) return card;
  const sum = summarizeCalibration(list);
  const fmt = (v) => (v == null ? '—' : (v > 0 ? '+' : '') + v.toFixed(1));
  for (const s of sum) {
    card.append(h('div', { class: 'stack cal-film', style: 'gap:4px' },
      h('div', { class: 'row' }, h('span', { class: 'grow', style: 'font-weight:600' }, s.label), h('span', { class: 'num small muted' }, `${s.n} 件${s.n < MIN_SAMPLES ? `（更新案は ${MIN_SAMPLES} 件から）` : ''}`)),
      h('div', { class: 'small muted' }, '彩度 C*（枠 = 現在のルールの範囲）'),
      distBar(s.chroma, s.rule?.sat, 60),
      h('div', { class: 'num small' }, `平均 ${s.chroma.mean.toFixed(1)} ± ${s.chroma.sd.toFixed(1)}（${s.chroma.min.toFixed(1)}〜${s.chroma.max.toFixed(1)}）`,
        s.rule ? ` / ルール ${s.rule.sat[0]}〜${s.rule.sat[1]}・差 ${fmt(s.diff.sat)}` : ' / ルールなし'),
      h('div', { class: 'small muted' }, 'コントラスト（p95−p5）'),
      distBar(s.contrast, s.rule?.contrast, 255),
      h('div', { class: 'num small' }, `平均 ${s.contrast.mean.toFixed(0)} ± ${s.contrast.sd.toFixed(0)}（${s.contrast.min}〜${s.contrast.max}）`,
        s.rule ? ` / ルール ${s.rule.contrast[0]}〜${s.rule.contrast[1]}・差 ${fmt(s.diff.contrast)}` : ''),
      s.rule?.colorCenter != null && s.chromaAtColor0 ? h('div', { class: 'num small' }, `カラー 0 換算の彩度 ${s.chromaAtColor0.mean.toFixed(1)} / ルールの基準 ${s.rule.colorCenter}・差 ${fmt(s.diff.colorCenter)}`) : null));
  }
  const proposal = () => JSON.stringify(proposeRules(list), null, 2);
  card.append(
    h('button', { type: 'button', class: 'btn', onclick: () => { download(proposal(), 'xt3cine-rules-proposal.json'); toast('更新案を書き出しました'); } }, 'この値で RULES を更新する案（JSON）を書き出す'),
    h('button', { type: 'button', class: 'btn danger', onclick: async () => {
      if (!(await confirmSheet('較正データを全削除', `較正データ ${list.length} 件を削除します。`, '全削除', true))) return;
      store.clearCalibration(); toast('削除しました'); redraw();
    } }, '較正データを全削除'));
  return card;
}

function offlineCard() {
  const status = h('div', { class: 'small' }, '確認中…');
  const btn = h('button', { type: 'button', class: 'btn', onclick: async () => {
    if (!navigator.onLine) return toast('オフラインのため確認できません');
    btn.disabled = true;
    try {
      const r = await checkForUpdate();
      toast({ found: '新しいバージョンがあります', installing: '新しいバージョンを準備しています', latest: '最新です', none: '確認できませんでした' }[r]);
    } catch { toast('確認できませんでした'); }
    btn.disabled = false; refresh();
  } }, '更新を確認');
  const refresh = () => offlineStatus().then((s) => {
    if (!s.supported) { status.replaceChildren('このブラウザはオフライン機能に対応していません。'); btn.hidden = true; return; }
    status.replaceChildren(...[
      h('div', null, s.ready ? h('span', { style: 'color:var(--accent)' }, '● オフラインで使えます') : h('span', { class: 'muted' }, '○ オフライン用データを準備中（一度再読み込みすると完了します）')),
      s.cache ? h('div', { class: 'muted num' }, s.cache) : null,
      s.waiting ? h('div', null, '新しいバージョンが待機中です') : null].filter(Boolean));
  });
  refresh();
  return h('div', { class: 'card stack' }, status,
    h('p', { class: 'small muted' }, 'アプリのファイル（地図データ・講座を含む）を端末に保存し、機内モードでも全機能を使えます。あなたが解析した画像は保存しません。'),
    btn);
}

const mb = (b) => `${(b / 1048576).toFixed(1)} MB`;
const STATE_LABEL = {
  idle: '待機中', checking: '確認中…', running: 'ダウンロード中', done: 'すべて保存済み', paused: '一時停止中（オンにすると続きから再開）',
  offline: 'オフラインのため確認できません', nodata: '街路データがまだ配信されていません', error: 'エラー', unsupported: 'このブラウザは対応していません',
  cleared: '削除しました（自動ダウンロードがオンなら次回起動時に再ダウンロード）',
};

// ダウンロードの進捗（街路地図・写真で共通）
function dlStatus(mod, label) {
  const bar = h('span');
  const meter = h('div', { class: 'progress', role: 'progressbar', 'aria-label': `${label}のダウンロード`, 'aria-valuemin': '0', 'aria-valuemax': '100' }, bar);
  const line = h('div', { class: 'small' });
  const count = h('div', { class: 'num small muted' });
  const draw = () => {
    const st = mod.getStatus();
    const p = st.state === 'done' ? 100 : st.totalBytes ? st.doneBytes / st.totalBytes * 100 : 0;
    bar.style.width = `${p}%`; meter.setAttribute('aria-valuenow', String(Math.round(p)));
    line.replaceChildren(h('span', { style: 'font-weight:600' }, `${label}: `), (st.state === 'nodata' ? `${label}はまだ配信されていません` : STATE_LABEL[st.state]) || st.state,
      st.current ? h('span', { class: 'muted' }, `（${st.current}）`) : '',
      st.error ? h('div', { class: 'small', style: 'color:var(--danger)' }, st.error) : '');
    count.textContent = st.total ? `${st.done}/${st.total} 件・${mb(st.doneBytes)} / ${mb(st.totalBytes)}` : '';
  };
  return { el: [line, meter, count], draw };
}

function streetsCard() {
  const enabled = () => store.getSetting('streetsAuto') !== false;
  const mods = [photos, streets];
  const sw = h('input', { type: 'checkbox', role: 'switch', class: 'switch', checked: enabled(), 'aria-label': '街路地図とロケ地写真を自動ダウンロード', onchange: () => {
    store.setSetting('streetsAuto', sw.checked ? undefined : false);
    for (const m of mods) { if (sw.checked) m.startDownload(enabled); else m.stopDownload(); }
  } });
  const ph = dlStatus(photos, 'ロケ地写真');
  const st = dlStatus(streets, '街路地図');
  const storage = h('div', { class: 'num small muted' }, '保存容量: 計算中…');
  const draw = () => { ph.draw(); st.draw(); };
  const measure = async () => {
    try {
      const [usedS, usedP] = await Promise.all([streets.cachedBytes(), photos.cachedBytes()]);
      const est = await navigator.storage?.estimate?.();
      const persisted = await navigator.storage?.persisted?.();
      storage.textContent = `保存容量: 街路地図 ${mb(usedS)}・写真 ${mb(usedP)}` + (est?.quota ? `（端末の空き目安 ${(est.quota / 1073741824).toFixed(1)} GB 中 ${mb(est.usage || 0)} 使用）` : '')
        + (persisted ? '・削除されにくい保存' : '');
    } catch { storage.textContent = '保存容量: 不明'; }
  };
  const last = new Map();
  const onStatus = () => { draw(); for (const m of mods) { const s2 = m.getStatus().state; if (last.get(m) !== s2) { last.set(m, s2); measure(); } } };
  const onFile = () => measure();
  for (const m of mods) { m.events.addEventListener('status', onStatus); m.events.addEventListener('file', onFile); }
  const clearBtn = (mod, label, msg) => h('button', { type: 'button', class: 'btn danger', onclick: async () => {
    if (!(await confirmSheet(`${label}を全削除`, msg, '全削除', true))) return;
    await mod.clearAll(); toast(`${label}を削除しました`); measure();
  } }, `${label}を全削除`);
  const card = h('div', { class: 'card stack' },
    h('label', { class: 'row', style: 'gap:10px;cursor:pointer' }, h('span', { class: 'grow' }, '街路地図とロケ地写真を自動ダウンロード'), sw),
    h('p', { class: 'small muted' }, 'アプリの操作を止めずに、裏で 1 件ずつ保存します。ロケ地写真（Wikimedia Commons の自由ライセンス写真）と、市街地のロケ地の周辺（半径約 1km）の街路地図です。街路地図を保存した場所はズーム 10 以上で街路を表示し、18 まで拡大できます。Wi-Fi での利用をおすすめします。'),
    ...ph.el, ...st.el, storage,
    h('div', { class: 'row', style: 'gap:8px;flex-wrap:wrap' },
      clearBtn(photos, 'ロケ地写真', '保存したロケ地写真をすべて削除します。'),
      clearBtn(streets, '街路地図', '保存した街路地図をすべて削除します。地図は国境・県境だけの表示に戻ります。')),
    h('p', { class: 'small muted' }, '地図データ © OpenStreetMap contributors（ODbL）。Protomaps basemap から切り出しています。ロケ地写真は撮影者とライセンスを写真の下に表示しています。'));
  const mo = new MutationObserver(() => {
    if (!card.isConnected) { for (const m of mods) { m.events.removeEventListener('status', onStatus); m.events.removeEventListener('file', onFile); } mo.disconnect(); }
  });
  queueMicrotask(() => mo.observe(document.getElementById('view') || document.body, { childList: true }));
  draw(); measure();
  return card;
}
