// 同梱データを裏で 1 ファイルずつ Cache Storage に保存する仕組み（街路地図 js/streets.js・ロケ地写真 js/photos.js で共用）
// ・<dir>index.json に各ファイルの sha256・サイズが書いてある（GitHub Actions のスクリプトが作る）
// ・Service Worker のインストールとは別に、アプリ起動後に裏で保存する。中断しても保存済みのファイルは残り、次回は続きから
// ・sha256 が変わったファイルだけ差し替え、index から消えたファイルは削除する
// ・前半は DOM 非依存の純粋関数（tests/streets.test.mjs・tests/photos.test.mjs でテスト）

const SHA_HEADER = 'x-xt3cine-sha256';

/* ---- 純粋関数 ---- */

/** index.json の検証。不正な項目は捨てる（fileRe: ファイル名の形式、extra: 追加の検証） */
export function parseIndexWith(json, fileRe, extra = () => true) {
  const files = Array.isArray(json?.files) ? json.files : [];
  return {
    version: json?.version ?? null,
    files: files.filter((f) => f && typeof f.id === 'string' && /^[a-z0-9-]+$/.test(f.id)
      && typeof f.file === 'string' && fileRe.test(f.file)
      && Number.isFinite(f.bytes) && f.bytes > 0 && typeof f.sha256 === 'string' && /^[0-9a-f]{64}$/.test(f.sha256)
      && extra(f)),
  };
}

/**
 * ダウンロード計画。cached は Map<url, sha256|null>（キャッシュにあるもの）。
 * @returns {{ todo: object[], done: object[], remove: string[], total: number, totalBytes: number, doneBytes: number }}
 */
export function planDownloadsIn(dir, index, cached) {
  const indexUrl = `${dir}index.json`;
  const todo = [], done = [];
  const urls = new Set();
  for (const f of index.files) {
    const url = dir + f.file;
    urls.add(url);
    (cached.get(url) === f.sha256 ? done : todo).push(f);
  }
  const remove = [...cached.keys()].filter((u) => u !== indexUrl && !urls.has(u)); // index から消えたもの
  const sum = (a) => a.reduce((s, f) => s + f.bytes, 0);
  return { todo, done, remove, total: index.files.length, totalBytes: sum(index.files), doneBytes: sum(done) };
}

export async function sha256Hex(buf) {
  const d = await crypto.subtle.digest('SHA-256', buf);
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/* ---- ブラウザ ---- */

/**
 * @param {{ cacheName: string, dir: string, fileRe: RegExp, contentType: string, extra?: (f: object) => boolean }} opt
 */
export function createDownloader({ cacheName, dir, fileRe, contentType, extra }) {
  const indexUrl = `${dir}index.json`;
  const parseIndex = (json) => parseIndexWith(json, fileRe, extra);
  const hasCaches = () => typeof caches !== 'undefined';
  // 読み出し専用で開く（無ければ null。caches.open は空のキャッシュを作ってしまうため）
  const openExisting = async () => (hasCaches() && await caches.has(cacheName) ? caches.open(cacheName) : null);

  /** キャッシュにあるファイル → sha256 */
  async function cachedMap(cache) {
    const out = new Map();
    for (const req of await cache.keys()) {
      const url = dir + new URL(req.url).pathname.split('/').pop();
      if (url === indexUrl) continue;
      const res = await cache.match(req);
      out.set(url, res?.headers.get(SHA_HEADER) || null);
    }
    return out;
  }

  /** 最新の index.json（オンラインならネットワーク、だめならキャッシュの控え） */
  async function loadIndex(cache) {
    try {
      const res = await fetch(indexUrl, { cache: 'no-store' });
      if (res.ok) {
        const json = await res.clone().json();
        await cache.put(indexUrl, res);
        return parseIndex(json);
      }
      if (res.status === 404) return { version: null, files: [], missing: true }; // まだ配信されていない
    } catch { /* オフライン */ }
    const hit = await cache.match(indexUrl);
    return hit ? parseIndex(await hit.json()) : null;
  }

  /** 保存済みのファイルの index 項目（index.json の控えにあり、ファイルもキャッシュにあるもの） */
  async function cachedFiles() {
    try {
      const cache = await openExisting();
      if (!cache) return [];
      const hit = await cache.match(indexUrl);
      if (!hit) return [];
      const index = parseIndex(await hit.json());
      const have = await cachedMap(cache);
      return index.files.filter((f) => have.has(dir + f.file)).map((f) => ({ ...f, url: dir + f.file }));
    } catch { return []; }
  }

  /** キャッシュ済みファイルの Blob（無ければ null。ネットワークには行かない） */
  async function cachedBlob(url) {
    const cache = await openExisting();
    const res = cache && await cache.match(url);
    return res ? res.blob() : null;
  }

  const events = new EventTarget(); // 'status'（進捗）, 'file'（1 ファイル保存した）
  let status = { state: 'idle', done: 0, total: 0, doneBytes: 0, totalBytes: 0, current: null, error: null };
  let running = null;
  let abort = null;
  const setStatus = (patch) => { status = { ...status, ...patch }; events.dispatchEvent(new Event('status')); };
  const getStatus = () => status;

  /** 裏で 1 ファイルずつ保存する。すでに動いていれば同じ Promise を返す。enabled() が false になったら止まる */
  function startDownload(enabled = () => true) {
    if (running) return running;
    if (!hasCaches() || typeof fetch !== 'function') { setStatus({ state: 'unsupported' }); return Promise.resolve(); }
    abort = new AbortController();
    const signal = abort.signal;
    running = (async () => {
      try {
        setStatus({ state: 'checking', error: null });
        const cache = await caches.open(cacheName);
        const index = await loadIndex(cache);
        if (!index) { setStatus({ state: 'offline' }); return; }
        if (index.missing) { setStatus({ state: 'nodata', total: 0, done: 0, totalBytes: 0, doneBytes: 0 }); return; }
        const have = await cachedMap(cache);
        const plan = planDownloadsIn(dir, index, have);
        for (const url of plan.remove) await cache.delete(url);
        let { doneBytes } = plan, done = plan.done.length;
        setStatus({ state: plan.todo.length ? 'running' : 'done', done, total: plan.total, doneBytes, totalBytes: plan.totalBytes });
        if (plan.todo.length) navigator.storage?.persist?.().catch(() => {}); // 端末の空き容量が減っても消されにくくする
        for (const f of plan.todo) {
          if (signal.aborted || !enabled()) { setStatus({ state: 'paused', current: null }); return; }
          setStatus({ current: f.id });
          const url = dir + f.file;
          const res = await fetch(url, { cache: 'no-store', signal });
          if (!res.ok) throw new Error(`${f.file}: HTTP ${res.status}`);
          const buf = await res.arrayBuffer();
          const sha = await sha256Hex(buf);
          if (sha !== f.sha256) throw new Error(`${f.file}: ハッシュが一致しません（配信中のファイルが更新途中の可能性）`);
          // 全体を受け取って検証してから保存するので、途中で止まっても壊れたファイルは残らない
          await cache.put(url, new Response(buf, { headers: { 'content-type': contentType, 'content-length': String(buf.byteLength), [SHA_HEADER]: sha } }));
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

  const stopDownload = () => abort?.abort();

  /** 保存済みの容量（バイト） */
  async function cachedBytes() {
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
  function autoDownload(enabled, delay = 3000) {
    const kick = () => { if (enabled() && !['done', 'nodata', 'cleared'].includes(status.state)) startDownload(enabled); };
    const later = () => setTimeout(() => (window.requestIdleCallback ? requestIdleCallback(kick, { timeout: 5000 }) : kick()), delay);
    if (document.readyState === 'complete') later(); else window.addEventListener('load', later, { once: true });
    window.addEventListener('online', kick);
  }

  /** 全削除（ダウンロード中なら止める） */
  async function clearAll() {
    stopDownload();
    try { await running; } catch { /* 無視 */ }
    if (hasCaches()) await caches.delete(cacheName);
    setStatus({ state: 'cleared', done: 0, doneBytes: 0, current: null, error: null });
    events.dispatchEvent(new CustomEvent('file', { detail: null }));
  }

  return { indexUrl, parseIndex, planDownloads: (index, cached) => planDownloadsIn(dir, index, cached), cachedFiles, cachedBlob,
    events, getStatus, startDownload, stopDownload, cachedBytes, autoDownload, clearAll };
}
