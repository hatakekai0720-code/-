// ロケ地周辺の街路地図（OpenStreetMap / Protomaps の PMTiles）のダウンロードと読み出し。
// ・data/streets/index.json に各ファイルの sha256・サイズ・範囲（bbox）が書いてある（scripts/extract-streets.sh が作る）
// ・アプリ起動後、Service Worker のインストールとは別に、裏で 1 ファイルずつ Cache Storage（xt3cine-streets）へ保存する
//   途中で中断しても、保存済みのファイルは残るので次回は続きから。sha256 が変わったファイルだけ差し替える
// ・地図はキャッシュ済みのファイルだけを使う（ネットワークから直接は読まない）。PMTiles の Range 読み込みは
//   キャッシュ済みファイル全体（Blob）から切り出して返す
// ・前半は DOM 非依存の純粋関数（tests/streets.test.mjs でテスト）

export const STREETS_CACHE = 'xt3cine-streets';
export const STREETS_DIR = 'data/streets/';
export const INDEX_URL = `${STREETS_DIR}index.json`;
export const STREET_MIN_ZOOM = 10;   // このズーム以上で街路レイヤーを表示
export const STREET_MAX_ZOOM = 16;   // 街路データのある範囲だけ、ここまでズームできる
export const STREET_DATA_ZOOM = 15;  // PMTiles の maxzoom（16 はこれを拡大表示）
const SHA_HEADER = 'x-xt3cine-sha256';

/* ---- 純粋関数 ---- */

/** index.json の検証。不正な項目は捨てる */
export function parseIndex(json) {
  const files = Array.isArray(json?.files) ? json.files : [];
  return {
    version: json?.version ?? null,
    files: files.filter((f) => f && typeof f.id === 'string' && /^[a-z0-9-]+$/.test(f.id)
      && typeof f.file === 'string' && /^[a-z0-9-]+\.pmtiles$/.test(f.file)
      && Number.isFinite(f.bytes) && f.bytes > 0 && typeof f.sha256 === 'string' && /^[0-9a-f]{64}$/.test(f.sha256)
      && Array.isArray(f.bbox) && f.bbox.length === 4 && f.bbox.every(Number.isFinite) && f.bbox[0] < f.bbox[2] && f.bbox[1] < f.bbox[3]),
  };
}

/**
 * ダウンロード計画。cached は Map<url, sha256|null>（キャッシュにあるもの）。
 * @returns {{ todo: object[], done: object[], remove: string[], total: number, totalBytes: number, doneBytes: number }}
 */
export function planDownloads(index, cached) {
  const todo = [], done = [];
  const urls = new Set();
  for (const f of index.files) {
    const url = STREETS_DIR + f.file;
    urls.add(url);
    (cached.get(url) === f.sha256 ? done : todo).push(f);
  }
  const remove = [...cached.keys()].filter((u) => u !== INDEX_URL && !urls.has(u)); // ロケ地から消えたもの
  const sum = (a) => a.reduce((s, f) => s + f.bytes, 0);
  return { todo, done, remove, total: index.files.length, totalBytes: sum(index.files), doneBytes: sum(done) };
}

/** 点（緯度・経度）を含むか */
export const bboxContains = (b, lat, lng) => lng >= b[0] && lng <= b[2] && lat >= b[1] && lat <= b[3];
/** 2 つの範囲 [西, 南, 東, 北] が重なるか */
export const bboxIntersects = (a, b) => a[0] <= b[2] && a[2] >= b[0] && a[1] <= b[3] && a[3] >= b[1];

/** 表示範囲 view [西, 南, 東, 北] に重なる街路データ（中心に近い順） */
export function areasInView(areas, view) {
  const cx = (view[0] + view[2]) / 2, cy = (view[1] + view[3]) / 2;
  const d = (a) => Math.hypot((a.bbox[0] + a.bbox[2]) / 2 - cx, (a.bbox[1] + a.bbox[3]) / 2 - cy);
  return areas.filter((a) => bboxIntersects(a.bbox, view)).sort((a, b) => d(a) - d(b));
}

/** Blob（キャッシュ済みファイル全体）から Range 読み込みの結果を切り出す */
export async function readRange(blob, offset, length) {
  if (!(offset >= 0) || !(length >= 0)) throw new Error('範囲が不正です');
  const end = Math.min(blob.size, offset + length);
  return { data: await blob.slice(offset, end).arrayBuffer() };
}

/** pmtiles の Source（getKey / getBytes）。Range をキャッシュ済み Blob から返す */
export class BlobSource {
  constructor(key, blob) { this.key = key; this.blob = blob; }
  getKey() { return this.key; }
  getBytes(offset, length) { return readRange(this.blob, offset, length); }
}

export async function sha256Hex(buf) {
  const d = await crypto.subtle.digest('SHA-256', buf);
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/* ---- ブラウザ: キャッシュ ---- */

const hasCaches = () => typeof caches !== 'undefined';
/** 読み出し専用で開く（無ければ null。caches.open は空のキャッシュを作ってしまうため） */
const openExisting = async () => (hasCaches() && await caches.has(STREETS_CACHE) ? caches.open(STREETS_CACHE) : null);

/** キャッシュにあるファイル → sha256 */
async function cachedMap(cache) {
  const out = new Map();
  for (const req of await cache.keys()) {
    const url = STREETS_DIR + new URL(req.url).pathname.split('/').pop();
    if (url === INDEX_URL) continue;
    const res = await cache.match(req);
    out.set(url, res?.headers.get(SHA_HEADER) || null);
  }
  return out;
}

/** 最新の index.json（オンラインならネットワーク、だめならキャッシュの控え） */
async function loadIndex(cache) {
  try {
    const res = await fetch(INDEX_URL, { cache: 'no-store' });
    if (res.ok) {
      const json = await res.clone().json();
      await cache.put(INDEX_URL, res);
      return parseIndex(json);
    }
    if (res.status === 404) return { version: null, files: [], missing: true }; // まだ街路データが用意されていない
  } catch { /* オフライン */ }
  const hit = await cache.match(INDEX_URL);
  return hit ? parseIndex(await hit.json()) : null;
}

/** 地図用: ダウンロード済みの街路データ一覧 [{ id, bbox, url }] */
export async function cachedAreas() {
  try {
    const cache = await openExisting();
    if (!cache) return [];
    const hit = await cache.match(INDEX_URL);
    if (!hit) return [];
    const index = parseIndex(await hit.json());
    const have = await cachedMap(cache);
    return index.files.filter((f) => have.has(STREETS_DIR + f.file)).map((f) => ({ id: f.id, bbox: f.bbox, url: STREETS_DIR + f.file }));
  } catch { return []; }
}

/** 地図用: キャッシュ済みファイル全体の Blob（無ければ null。ネットワークには行かない） */
export async function cachedBlob(url) {
  const cache = await openExisting();
  const res = cache && await cache.match(url);
  return res ? res.blob() : null;
}

/* ---- ブラウザ: 自動ダウンロード ---- */

export const events = new EventTarget(); // 'status'（進捗）, 'file'（1 ファイル保存した）
let status = { state: 'idle', done: 0, total: 0, doneBytes: 0, totalBytes: 0, current: null, error: null };
let running = null;
let abort = null;

const setStatus = (patch) => { status = { ...status, ...patch }; events.dispatchEvent(new Event('status')); };
export const getStatus = () => status;

/**
 * 裏で街路データを 1 ファイルずつ保存する。すでに動いていれば同じ Promise を返す。
 * enabled() が false になったら、今のファイルを中断して止まる。
 */
export function startDownload(enabled = () => true) {
  if (running) return running;
  if (!hasCaches() || typeof fetch !== 'function') { setStatus({ state: 'unsupported' }); return Promise.resolve(); }
  abort = new AbortController();
  const signal = abort.signal;
  running = (async () => {
    try {
      setStatus({ state: 'checking', error: null });
      const cache = await caches.open(STREETS_CACHE);
      const index = await loadIndex(cache);
      if (!index) { setStatus({ state: 'offline' }); return; }
      if (index.missing) { setStatus({ state: 'nodata', total: 0, done: 0, totalBytes: 0, doneBytes: 0 }); return; }
      const have = await cachedMap(cache);
      const plan = planDownloads(index, have);
      for (const url of plan.remove) await cache.delete(url);
      let { doneBytes } = plan, done = plan.done.length;
      setStatus({ state: plan.todo.length ? 'running' : 'done', done, total: plan.total, doneBytes, totalBytes: plan.totalBytes });
      if (plan.todo.length) navigator.storage?.persist?.().catch(() => {}); // 端末の空き容量が減っても消されにくくする
      for (const f of plan.todo) {
        if (signal.aborted || !enabled()) { setStatus({ state: 'paused', current: null }); return; }
        setStatus({ current: f.id });
        const url = STREETS_DIR + f.file;
        const res = await fetch(url, { cache: 'no-store', signal });
        if (!res.ok) throw new Error(`${f.file}: HTTP ${res.status}`);
        const buf = await res.arrayBuffer();
        const sha = await sha256Hex(buf);
        if (sha !== f.sha256) throw new Error(`${f.file}: ハッシュが一致しません（配信中のファイルが更新途中の可能性）`);
        // 全体を受け取って検証してから保存するので、途中で止まっても壊れたファイルは残らない
        await cache.put(url, new Response(buf, { headers: { 'content-type': 'application/vnd.pmtiles', 'content-length': String(buf.byteLength), [SHA_HEADER]: sha } }));
        done++; doneBytes += f.bytes;
        setStatus({ done, doneBytes });
        events.dispatchEvent(new CustomEvent('file', { detail: { id: f.id, url } }));
      }
      setStatus({ state: 'done', current: null });
    } catch (err) {
      if (err?.name === 'AbortError') setStatus({ state: 'paused', current: null });
      else setStatus({ state: 'error', current: null, error: String(err?.message || err) });
    } finally { running = null; abort = null; }
  })();
  return running;
}

export function stopDownload() { abort?.abort(); }

/** 保存済みの街路データの容量（バイト） */
export async function cachedBytes() {
  const cache = await openExisting();
  if (!cache) return 0;
  let sum = 0;
  for (const req of await cache.keys()) {
    if (req.url.endsWith('/index.json')) continue;
    const res = await cache.match(req);
    sum += Number(res?.headers.get('content-length')) || (await res.blob()).size;
  }
  return sum;
}

/** 起動時の自動ダウンロード。画面の表示が落ち着いてから始め、オンラインに戻ったときも再開する */
export function autoDownloadStreets(enabled) {
  const kick = () => { if (enabled() && !['done', 'nodata', 'cleared'].includes(status.state)) startDownload(enabled); };
  const later = () => setTimeout(() => (window.requestIdleCallback ? requestIdleCallback(kick, { timeout: 5000 }) : kick()), 3000);
  if (document.readyState === 'complete') later(); else window.addEventListener('load', later, { once: true });
  window.addEventListener('online', kick);
}

/** 全削除（ダウンロード中なら止める） */
export async function clearAll() {
  stopDownload();
  try { await running; } catch { /* 無視 */ }
  if (hasCaches()) await caches.delete(STREETS_CACHE);
  setStatus({ state: 'cleared', done: 0, doneBytes: 0, current: null, error: null });
  events.dispatchEvent(new CustomEvent('file', { detail: null }));
}
