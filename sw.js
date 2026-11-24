// Service Worker: 全静的ファイルをプリキャッシュし、初回アクセス後は完全オフラインで動かす。
// ・ファイルを追加・変更したら CACHE_VERSION を上げる（ASSETS の一覧は tests/sw.test.mjs が実ファイルと照合する）
// ・GitHub Pages では同じユーザーの全リポジトリが同一オリジンになるため、キャッシュ名は必ず xt3cine- で始め、
//   削除するのも自分のキャッシュだけにする
// ・ユーザーの画像はキャッシュしない（画像は fetch を通らず、ここに来ても ASSETS 以外は保存しない）
const CACHE_VERSION = '2026-11-24.7';
const PREFIX = 'xt3cine-';
const CACHE = `${PREFIX}${CACHE_VERSION}`;
const STREETS_CACHE = `${PREFIX}streets`; // js/streets.js の STREETS_CACHE と同じ。街路データは ASSETS に入れない
const PHOTOS_CACHE = `${PREFIX}photos`; // js/photos.js の PHOTOS_CACHE と同じ。ロケ地写真も ASSETS に入れない

const ASSETS = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/style.css',
  './js/app.js',
  './js/store.js',
  './js/xt3.js',
  './js/analyzer.js',
  './js/analyze-worker.js',
  './js/translator.js',
  './js/exif.js',
  './js/similar.js',
  './js/geo.js',
  './js/cluster.js',
  './js/locations.js',
  './js/film.js',
  './js/lessons.js',
  './js/pwa.js',
  './js/bgdownload.js',
  './js/streets.js',
  './js/photos.js',
  './js/ui/dom.js',
  './js/ui/photo.js',
  './js/ui/recipe-ui.js',
  './js/ui/theme.js',
  './js/views/academy.js',
  './js/views/analyze.js',
  './js/views/compare.js',
  './js/views/lesson.js',
  './js/views/location.js',
  './js/views/map.js',
  './js/views/names.js',
  './js/views/qmenu.js',
  './js/views/recipe-detail.js',
  './js/views/recipe-edit.js',
  './js/views/recipes.js',
  './js/views/search.js',
  './js/views/settings.js',
  './js/views/slots.js',
  './js/views/work.js',
  './data/countries-50m.json',
  './data/countries-10m.json',
  './data/admin1-10m.json',
  './data/places-10m.json',
  './data/lessons.json',
  './data/locations.json',
  './data/recipes-seed.json',
  './vendor/leaflet/leaflet.js',
  './vendor/leaflet/leaflet.css',
  './vendor/leaflet/images/layers.png',
  './vendor/leaflet/images/layers-2x.png',
  './vendor/leaflet/images/marker-icon.png',
  './vendor/leaflet/images/marker-icon-2x.png',
  './vendor/leaflet/images/marker-shadow.png',
  './vendor/topojson-client.min.js',
  './vendor/pmtiles/pmtiles.js',
  './vendor/protomaps-leaflet/protomaps-leaflet.js',
  './icons/icon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/apple-touch-icon.png',
  './icons/favicon-32.png',
];

self.addEventListener('install', (event) => {
  // cache: 'reload' で HTTP キャッシュを経由せず最新を取る。1 つでも失敗したらインストール失敗（中途半端なキャッシュを作らない）
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS.map((u) => new Request(u, { cache: 'reload' })))));
  // skipWaiting はしない。更新はページ側の「更新する」ボタンで行う
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    // 街路地図（xt3cine-streets）とロケ地写真（xt3cine-photos）はページ側が管理するので消さない
    await Promise.all(keys.filter((k) => k.startsWith(PREFIX) && ![CACHE, STREETS_CACHE, PHOTOS_CACHE].includes(k)).map((k) => caches.delete(k)));
    await self.clients.claim(); // 初回からこのページをオフライン対応にする
  })());
});

self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
  if (event.data?.type === 'GET_VERSION') event.source?.postMessage({ type: 'VERSION', version: CACHE_VERSION });
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  const scope = new URL(self.registration.scope);
  if (url.origin !== scope.origin || !url.pathname.startsWith(scope.pathname)) return; // 他のアプリ・外部には触らない

  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    if (req.mode === 'navigate') {
      // ハッシュルーティングなので、ページ遷移は常に index.html
      return (await cache.match('./index.html')) || fetch(req);
    }
    const hit = await cache.match(req, { ignoreSearch: true });
    if (hit) return hit;
    return fetch(req); // プリキャッシュ外はネットワークのみ（保存しない）
  })());
});
