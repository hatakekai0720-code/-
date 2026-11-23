// ロケ地の詳細: 「作品情報／撮影ガイド／レシピ」のタブ
import { h, toast } from '../ui/dom.js';
import { paramSummary } from '../ui/recipe-ui.js';
import { photoFigure } from '../ui/photo.js';
import { locationRecipe, loadLocations } from '../locations.js';
import { loadLessons } from '../lessons.js';
import { workKey, groupWorks, needs169, ROLE_LABEL } from '../film.js';
import { formatLatLng } from '../geo.js';
import { typeOf, TYPE_LABELS } from '../cluster.js';
import * as X from '../xt3.js';
import * as store from '../store.js';

const TABS = [['info', '作品情報'], ['guide', '撮影ガイド'], ['recipe', 'レシピ']];
let lastTab = 'info'; // 画面を移っても同じタブを開く（メモリのみ）
const CONF_LABEL = { high: '確度 高', medium: '確度 中' };
const hostOf = (u) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return u; } };
const ext = (href, text, cls = 'btn') => h('a', { class: cls, href, target: '_blank', rel: 'noopener noreferrer' }, text);
export const nameLink = (name) => h('a', { class: 'name-link', href: `#/names/${encodeURIComponent(name)}` }, name);
const names = (s) => String(s || '').split('、').map((x) => x.trim()).filter(Boolean);
const joinLinks = (list) => list.flatMap((n, i) => [i ? '、' : '', nameLink(n)]);
const dash = h.bind(null, 'span', { class: 'muted' }, '—');

/** 5 色のパレット（数値は等幅） */
export function paletteRow(colors, label) {
  return h('div', { class: 'palette', role: 'img', 'aria-label': `${label}: ${colors.join(' ')}` },
    colors.map((c) => h('div', { class: 'pal-cell' }, h('span', { class: 'pal-swatch', style: `background:${c}` }), h('span', { class: 'num pal-hex' }, c))));
}

/** 「行った」チェック（日付とメモだけ。写真は保存しない） */
export function visitCard(loc, onChange) {
  const box = h('div', { class: 'card stack visit-card', style: 'gap:8px' });
  const draw = () => {
    const v = store.getVisited(loc.id);
    const today = new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10);
    const date = h('input', { class: 'input num', type: 'date', value: v?.date || today, max: today, 'aria-label': '行った日' });
    const memo = h('textarea', { class: 'input', maxLength: store.VISIT_LIMITS.memo, value: v?.memo || '', placeholder: 'メモ（任意）', 'aria-label': '行ったときのメモ', rows: 2 });
    const check = h('input', { type: 'checkbox', class: 'switch', role: 'switch', checked: !!v, 'aria-label': '行った',
      onchange: () => {
        if (check.checked) {
          const res = store.setVisited(loc.id, { date: date.value, memo: memo.value });
          if (res.errors) { check.checked = false; return toast(res.errors[0], 3500); }
          toast('「行った」にしました');
        } else { store.clearVisited(loc.id); toast('「行った」を外しました'); }
        draw(); onChange?.();
      } });
    box.replaceChildren(...[
      h('label', { class: 'row', style: 'gap:10px;cursor:pointer' }, h('span', { class: 'grow', style: 'font-weight:600' }, v ? `✓ 行った（${v.date}）` : '行った'), check),
      h('div', { class: 'row', style: 'gap:8px' }, h('div', { style: 'width:170px' }, date), h('div', { class: 'small muted grow' }, '日付とメモだけを端末に保存します（写真は保存しません）')),
      memo,
      v ? h('button', { type: 'button', class: 'btn', onclick: () => {
        const res = store.setVisited(loc.id, { date: date.value, memo: memo.value });
        if (res.errors) return toast(res.errors[0], 3500);
        toast('保存しました'); draw(); onChange?.();
      } }, '日付とメモを更新') : null].filter(Boolean));
  };
  draw();
  return box;
}

export function render(root, { id }) {
  const body = h('div', { class: 'stack' }, h('p', { class: 'muted' }, '読み込み中…'));
  root.append(body);
  let alive = true;
  Promise.all([loadLocations(), loadLessons().catch(() => null)]).then(([locs, lessons]) => { if (alive) draw(locs, lessons); })
    .catch(() => body.replaceChildren(h('div', { class: 'notice' }, 'ロケ地データを読み込めませんでした。')));

  function draw(locs, lessons) {
    const l = locs.find((x) => x.id === id);
    if (!l) { body.replaceChildren(h('div', { class: 'empty' }, 'ロケ地が見つかりません。'), h('a', { class: 'btn block', href: '#/map' }, '地図に戻る')); return; }
    document.title = `${l.title}（${l.place}） — X-T3 Cinematic Lab`;
    const work = groupWorks(locs).find((w) => w.key === workKey(l));
    const panel = h('div', { class: 'stack tab-panel', role: 'tabpanel' });
    const tabBtns = TABS.map(([k, label]) => h('button', { type: 'button', role: 'tab', class: 'tab', id: `tab-${k}`, 'aria-controls': 'loc-panel',
      onclick: () => { lastTab = k; show(); } }, label));
    panel.id = 'loc-panel';
    const show = () => {
      for (const [i, [k]] of TABS.entries()) { tabBtns[i].setAttribute('aria-selected', String(k === lastTab)); tabBtns[i].tabIndex = k === lastTab ? 0 : -1; }
      panel.setAttribute('aria-labelledby', `tab-${lastTab}`);
      panel.replaceChildren(...({ info: infoTab, guide: guideTab, recipe: recipeTab }[lastTab])(l, work, lessons).flat(Infinity).filter(Boolean));
    };
    const tablist = h('div', { class: 'tabs', role: 'tablist', 'aria-label': 'ロケ地の情報', onkeydown: (e) => {
      const i = TABS.findIndex(([k]) => k === lastTab);
      const j = e.key === 'ArrowRight' ? (i + 1) % TABS.length : e.key === 'ArrowLeft' ? (i + TABS.length - 1) % TABS.length : -1;
      if (j < 0) return;
      lastTab = TABS[j][0]; show(); tabBtns[j].focus();
    } }, tabBtns);

    body.replaceChildren(
      h('div', null,
        h('h2', { class: 'loc-title' }, l.title),
        h('div', { class: 'small muted' }, `${l.titleEn} · `, h('span', { class: 'num' }, l.year), ' · ', joinLinks(names(l.director))),
        h('div', { class: 'loc-place' }, h('div', { style: 'font-weight:600' }, l.place),
          h('div', { class: 'small muted' }, `${l.city}・${l.country} `, h('span', { class: 'num' }, formatLatLng(l.lat, l.lng)))),
        h('div', { class: 'row wrap', style: 'gap:6px;margin-top:6px' },
          h('span', { class: `chip type-${typeOf(l)}` }, TYPE_LABELS[typeOf(l)]),
          h('span', { class: `chip conf-${l.confidence}` }, CONF_LABEL[l.confidence]),
          store.getVisited(l.id) ? h('span', { class: 'chip visited' }, '✓ 行った') : null,
          work && work.locations.length > 1 ? h('a', { class: 'chip', href: `#/works/${work.key}` }, `この作品のロケ地 `, h('span', { class: 'num' }, work.locations.length), ' 件') : null),
        typeOf(l) === 'model' ? h('div', { class: 'notice small', style: 'margin-top:8px' }, '撮影地ではなくモデル地です（作品の舞台のモデルになった実在の場所）。レシピは、この場所で撮るときの色作りの目安です。') : null),
      tablist, panel,
      h('div', { class: 'row', style: 'gap:8px;margin-top:6px' },
        h('a', { class: 'btn grow', href: `#/map/${encodeURIComponent(l.id)}` }, '地図で見る'),
        work ? h('a', { class: 'btn grow', href: `#/works/${work.key}` }, '作品ページ') : null));
    show();
  }
  return () => { alive = false; };
}

/* ---- 作品情報 ---- */
function infoTab(l, work) {
  const saved = work && store.getPalette(work.key);
  const row = (k, v) => h('div', { class: 'kv' }, h('div', { class: 'k small muted' }, k), h('div', { class: 'v' }, v ?? dash()));
  const d = l.distributor || {};
  const links = l.links || {};
  const linkBtns = [
    links.eigacom ? ext(links.eigacom, '映画.com') : null,
    links.trailer ? ext(links.trailer, '予告編') : null,
    links.wikipedia ? ext(links.wikipedia, 'Wikipedia') : null,
  ].filter(Boolean);
  return [
    photoFigure(l),
    l.palette?.length ? [h('div', { class: 'section-title' }, 'パレット（作品の色味から）'), paletteRow(l.palette, '作品のパレット')] : null,
    saved ? [h('div', { class: 'section-title' }, 'あなたの解析パレット'), paletteRow(saved.colors, 'あなたの解析パレット'),
      h('div', { class: 'small muted' }, '画像解析の代表色を保存したものです（数値のみ）。')] : null,
    l.synopsis ? h('p', { class: 'synopsis' }, l.synopsis) : null,
    h('div', { class: 'card kv-list' },
      row('監督', joinLinks(names(l.director))),
      row('撮影', l.cinematographer ? joinLinks(names(l.cinematographer)) : null),
      row('出演', l.cast?.length ? h('div', { class: 'stack', style: 'gap:2px' }, l.cast.map((c) => h('div', null, nameLink(c.name), c.role ? h('span', { class: 'muted small' }, `（${c.role}）`) : null))) : null),
      row('製作', l.production?.length ? [joinLinks(l.production), l.committee ? h('div', { class: 'small muted' }, '製作委員会方式') : null]
        : l.committee ? h('span', { class: 'small muted' }, '製作委員会方式（制作会社は未確認）') : null),
      row('配給', (d.original || d.japan) ? h('div', { class: 'stack', style: 'gap:2px' },
        h('div', null, h('span', { class: 'small muted' }, '原題国: '), d.original ? joinLinks(names(d.original)) : dash()),
        h('div', null, h('span', { class: 'small muted' }, '日本（初公開）: '), d.japan ? joinLinks(names(d.japan)) : dash())) : null),
      row('ジャンル', l.genre),
      row('撮影形式', l.format?.capture ? h('span', null, l.format.capture) : null),
      row('画面比', l.format?.aspect ? h('span', { class: 'num' }, l.format.aspect) : null)),
    linkBtns.length ? h('div', { class: 'row wrap', style: 'gap:8px' }, linkBtns) : null,
    h('p', { class: 'small muted' }, '外部リンクと作品情報は、出典で確認できたものだけを載せています（— は未確認）。外部サイトはブラウザで開きます。'),
    l.sources?.length ? h('p', { class: 'small muted sources', style: 'overflow-wrap:anywhere' }, '出典（外部サイト）: ',
      l.sources.map((u, i) => [i ? ' / ' : '', h('a', { href: u, target: '_blank', rel: 'noopener noreferrer' }, hostOf(u)),
        i === (l.spotSources ?? l.sources.length) - 1 && i < l.sources.length - 1 ? h('span', { class: 'muted' }, '（ここまで撮影地）') : null])) : null,
  ];
}

/* ---- 撮影ガイド ---- */
function guideTab(l, work, lessons) {
  const g = l.guide || {};
  const row = (k, v) => h('div', { class: 'kv' }, h('div', { class: 'k small muted' }, k), h('div', { class: 'v' }, v ?? dash()));
  const rel = (l.lessons || []).map((no) => lessons?.lessons.find((x) => x.no === no)).filter(Boolean);
  return [
    h('p', null, l.scene),
    h('div', { class: 'small muted' }, '色味: ', l.look),
    h('div', { class: 'card kv-list' },
      row('場面の時間帯', l.sceneTime),
      row('天気', l.weather),
      row('焦点距離（35mm 換算）', g.focal ? h('span', { class: 'num' }, g.focal) : null),
      row('アングル', g.angle),
      row('おすすめの時間', g.bestTime)),
    l.visitNotes ? h('div', { class: 'notice info small' }, l.visitNotes) : null,
    rel.length ? [h('div', { class: 'section-title' }, '関連する講座'),
      h('div', { class: 'stack', style: 'gap:6px' }, rel.map((x) => h('a', { class: 'list-btn', href: `#/academy/${x.no}` },
        h('span', { class: 'num lesson-no' }, String(x.no).padStart(2, '0')), h('span', { class: 'grow' }, x.title))))] : null,
    visitCard(l),
  ];
}

/* ---- レシピ ---- */
function recipeTab(l) {
  const recipe = locationRecipe(l);
  const existing = store.findBySource('location', l.id);
  const wide = needs169(l.format?.aspect);
  return [
    h('div', { class: 'card stack', style: 'gap:6px' },
      h('div', { class: 'row' }, h('span', { class: 'grow', style: 'font-weight:600' }, '推定レシピ'), h('span', { class: 'small muted' }, X.filmLabel(recipe))),
      paramSummary(recipe),
      recipe.isoNote ? h('div', { class: 'small muted num' }, recipe.isoNote, recipe.exposureNote ? ` / ${recipe.exposureNote}` : '') : null,
      l.recipe?.sizeNote || wide ? h('div', { class: 'small' }, '📐 ', l.recipe?.sizeNote || `画像サイズ 16:9（原作は ${l.format.aspect}）`,
        h('span', { class: 'muted' }, '。X-T3 の画像サイズは 3:2 / 16:9 / 1:1 から選べます')) : null),
    existing
      ? h('a', { class: 'btn block', href: `#/recipes/${encodeURIComponent(existing.id)}` }, 'インポート済み — レシピを開く')
      : h('button', { type: 'button', class: 'btn primary block', onclick: (e) => {
        const res = store.saveRecipe(recipe);
        if (res.errors) return toast(res.errors[0], 4000);
        toast('レシピ帳にインポートしました');
        e.target.replaceWith(h('a', { class: 'btn block', href: `#/recipes/${encodeURIComponent(res.recipe.id)}` }, 'インポート済み — レシピを開く'));
      } }, 'レシピ帳にインポート'),
    h('p', { class: 'small muted' }, 'レシピは作品の色味から考えた推定で、公式の設定ではありません。'),
  ];
}

export { ROLE_LABEL };
