// ルーティング（ハッシュ）と下部ナビ
import * as store from './store.js';
import { closeSheets, toast } from './ui/dom.js';
import { applyTheme } from './ui/theme.js';
import * as compare from './views/compare.js';
import * as analyze from './views/analyze.js';
import * as recipes from './views/recipes.js';
import * as recipeDetail from './views/recipe-detail.js';
import * as recipeEdit from './views/recipe-edit.js';
import * as qmenu from './views/qmenu.js';
import * as map from './views/map.js';
import * as academy from './views/academy.js';
import * as slots from './views/slots.js';
import * as settings from './views/settings.js';

const ROUTES = [
  { re: /^\/analyze$/, view: analyze, tab: 'analyze', title: '画像解析' },
  { re: /^\/recipes$/, view: recipes, tab: 'recipes', title: 'レシピ' },
  { re: /^\/recipes\/new$/, view: recipeEdit, tab: 'recipes', title: '新規レシピ', back: '#/recipes' },
  { re: /^\/recipes\/([^/]+)\/edit$/, view: recipeEdit, tab: 'recipes', title: 'レシピを編集', back: '#/recipes' },
  { re: /^\/recipes\/([^/]+)$/, view: recipeDetail, tab: 'recipes', title: 'レシピ詳細', back: '#/recipes' },
  { re: /^\/compare$/, view: compare, tab: 'recipes', title: 'ビフォーアフター比較', back: '#/recipes' },
  { re: /^\/qmenu\/([^/]+)$/, view: qmenu, tab: 'recipes', title: 'Qメニュー', fullscreen: true },
  { re: /^\/map$/, view: map, tab: 'map', title: 'ロケ地マップ' },
  { re: /^\/academy$/, view: academy, tab: 'academy', title: '撮影講座' },
  { re: /^\/slots$/, view: slots, tab: 'slots', title: 'C1〜C7 スロット' },
  { re: /^\/settings$/, view: settings, tab: null, title: '設定', back: '#/analyze' },
];
const DEFAULT = '#/analyze';

const viewEl = document.getElementById('view');
const titleEl = document.getElementById('page-title');
const backBtn = document.getElementById('back-btn');
let cleanup = null;
let backTo = null;

backBtn.addEventListener('click', () => { location.hash = backTo || DEFAULT; });

function route() {
  const path = location.hash.replace(/^#/, '') || '';
  let match = null;
  for (const r of ROUTES) {
    const m = path.match(r.re);
    if (m) { match = { r, id: m[1] ? decodeURIComponent(m[1]) : undefined }; break; }
  }
  if (!match) { location.replace(DEFAULT); return; }

  closeSheets();
  try { cleanup?.(); } catch (err) { console.error(err); }
  cleanup = null;
  viewEl.replaceChildren();

  const { r, id } = match;
  document.body.classList.toggle('fullscreen', !!r.fullscreen);
  titleEl.textContent = r.title;
  document.title = `${r.title} — X-T3 Cinematic Lab`;
  backTo = r.back || null;
  backBtn.hidden = !r.back;
  for (const a of document.querySelectorAll('.tabbar a')) {
    const on = a.dataset.tab === r.tab;
    a.classList.toggle('active', on);
    if (on) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
  }
  cleanup = r.view.render(viewEl, { id }) || null;
  window.scrollTo(0, 0);
}

const boot = store.init();
applyTheme();
if (boot.corrupt) toast('保存データが壊れていたため初期化しました', 5000);
await store.seedIfNeeded();
window.addEventListener('hashchange', route);
route();
