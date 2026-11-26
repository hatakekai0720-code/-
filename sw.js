// Service Worker: 全静的ファイルをプリキャッシュし、初回アクセス後は完全オフラインで動かす。
// ・ファイルを追加・変更したら CACHE_VERSION を上げる（ASSETS の一覧は tests/sw.test.mjs が実ファイルと照合する）
// ・GitHub Pages では同じユーザーの全リポジトリが同一オリジンになるため、キャッシュ名は必ず xt3cine- で始め、
//   削除するのも自分のキャッシュだけにする
// ・ユーザーの画像はキャッシュしない（画像は fetch を通らず、ここに来ても ASSETS 以外は保存しない）
const CACHE_VERSION = '2026-11-26.1';
const PREFIX = 'xt3cine-';
const CACHE = `${PREFIX}${CACHE_VERSION}`;
const STREETS_CACHE = `${PREFIX}streets`; // js/streets.js の STREETS_CACHE と同じ。街路データは ASSETS に入れない
const PHOTOS_CACHE = `${PREFIX}photos`; // js/photos.js の PHOTOS_CACHE と同じ。ロケ地写真も ASSETS に入れない
const SPOTS_CACHE = `${PREFIX}spots`; // js/spots.js の SPOTS_CACHE と同じ。撮影スポット（data/spots/）は ASSETS に入れない
const SHA_HEADER = 'x-xt3cine-sha256'; // js/bgdownload.js と同じ

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
  './js/calibration.js',
  './js/geo.js',
  './js/cluster.js',
  './js/locations.js',
  './js/film.js',
  './js/lessons.js',
  './js/pwa.js',
  './js/bgdownload.js',
  './js/streets.js',
  './js/photos.js',
  './js/spots.js',
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
  './data/spot-categories.json',
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
  event.waitUntil((async () => {
    const c = await caches.open(CACHE);
    await c.addAll(ASSETS.map((u) => new Request(u, { cache: 'reload' })));
    await precacheSpots().catch(() => {}); // 撮影スポットは失敗してもインストールを止めない（あとでページ側が裏で保存する）
  })());
  // skipWaiting はしない。更新はページ側の「更新する」ボタンで行う
});

// 撮影スポット（data/spots/）: index.json の precache が true（合計 5MB 以下）なら、インストール時にまとめて保存する。
// 保存先はページ側（js/spots.js → js/bgdownload.js）と同じ xt3cine-spots で、sha256 も同じ形で付ける。
// 5MB を超えるときは何もしない（ページ側が街路地図と同じく裏で 1 ファイルずつ保存する）
async function precacheSpots() {
  const res = await fetch('./data/spots/index.json', { cache: 'reload' });
  if (!res.ok) return;
  const index = await res.clone().json();
  if (index.precache !== true || !Array.isArray(index.files)) return;
  const cache = await caches.open(SPOTS_CACHE);
  for (const f of index.files) {
    if (!/^[a-z0-9-]+\.json$/.test(f.file) || !/^[0-9a-f]{64}$/.test(f.sha256)) continue;
    const url = `./data/spots/${f.file}`;
    const have = await cache.match(url);
    if (have?.headers.get(SHA_HEADER) === f.sha256) continue;
    const r = await fetch(url, { cache: 'reload' });
    if (!r.ok) continue;
    const buf = await r.arrayBuffer();
    const d = await crypto.subtle.digest('SHA-256', buf);
    const sha = [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
    if (sha !== f.sha256) continue; // 配信中のファイルが更新途中
    await cache.put(url, new Response(buf, { headers: { 'content-type': 'application/json', 'content-length': String(buf.byteLength), [SHA_HEADER]: sha } }));
  }
  await cache.put('./data/spots/index.json', res);
}

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    // 街路地図（xt3cine-streets）・ロケ地写真（xt3cine-photos）・撮影スポット（xt3cine-spots）はページ側が管理するので消さない
    await Promise.all(keys.filter((k) => k.startsWith(PREFIX) && ![CACHE, STREETS_CACHE, PHOTOS_CACHE, SPOTS_CACHE].includes(k)).map((k) => caches.delete(k)));
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
    // 撮影スポットは xt3cine-spots にあればそれを返す（オフラインでも読める）。index.json はネットワークを優先する
    if (url.pathname.startsWith(`${scope.pathname}data/spots/`)) {
      const spots = await caches.open(SPOTS_CACHE);
      if (url.pathname.endsWith('/index.json')) {
        try { const r = await fetch(req); if (r.ok) return r; } catch { /* オフライン */ }
        return (await spots.match(req, { ignoreSearch: true })) || fetch(req);
      }
      const s = await spots.match(req, { ignoreSearch: true });
      if (s) return s;
    }
    return fetch(req); // プリキャッシュ外はネットワークのみ（保存しない）
  })());
});
