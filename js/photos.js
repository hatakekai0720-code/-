// アプリに同梱するロケ地写真（Wikimedia Commons の自由ライセンス写真、data/photos/<locationId>.webp）
// ・data/photos/index.json にファイルの sha256・サイズと、Commons API で確認したクレジット（撮影者・ライセンス）がある
//   （.github/workflows/fetch-photos.yml → scripts/fetch-photos.mjs が作る）
// ・Service Worker の ASSETS には入れず、街路地図と同じ仕組み（js/bgdownload.js）で裏で Cache Storage（xt3cine-photos）へ保存する
// ・表示するときは必ず「撮影者 / ライセンス / Wikimedia Commons」のクレジットを添える
import { createDownloader } from './bgdownload.js';

export const PHOTOS_CACHE = 'xt3cine-photos';
export const PHOTOS_DIR = 'data/photos/';
export const ALLOWED_LICENSE = /^(CC0|Public domain|CC BY(-SA)? \d\.\d)$/;

const dl = createDownloader({
  cacheName: PHOTOS_CACHE, dir: PHOTOS_DIR, fileRe: /^[a-z0-9-]+\.webp$/, contentType: 'image/webp',
  extra: (f) => typeof f.license === 'string' && ALLOWED_LICENSE.test(f.license) && typeof f.author === 'string' && f.author.length > 0,
});

/* ---- 純粋関数 ---- */

export const parseIndex = dl.parseIndex;
export const planDownloads = dl.planDownloads;

/**
 * 表示するクレジット。index.json（Commons API で確認した値）を優先し、無ければ locations.json の photo。
 * @returns {{ author: string, license: string, licenseUrl: string|null, sourceUrl: string } | null}
 */
export function creditOf(loc, indexEntry) {
  const p = loc?.photo;
  if (!p) return null;
  const src = indexEntry && indexEntry.sourceUrl === p.sourceUrl ? indexEntry : p;
  return { author: src.author, license: src.license, licenseUrl: src.licenseUrl ?? null, sourceUrl: p.sourceUrl };
}

/* ---- ブラウザ ---- */

export const events = dl.events;
export const getStatus = dl.getStatus;
export const startDownload = dl.startDownload;
export const stopDownload = dl.stopDownload;
export const cachedBytes = dl.cachedBytes;
export const clearAll = dl.clearAll;
export const autoDownloadPhotos = (enabled) => dl.autoDownload(enabled, 2000);

/** 写真の Blob と index の項目。キャッシュに無ければ同じオリジンから読む（オフラインなら null） */
export async function photoFor(loc) {
  if (!loc?.photo) return null;
  const url = `${PHOTOS_DIR}${loc.id}.webp`;
  const entry = (await dl.cachedFiles()).find((f) => f.id === loc.id) || null;
  let blob = await dl.cachedBlob(url);
  if (!blob) {
    try {
      const res = await fetch(url);
      if (res.ok && (res.headers.get('content-type') || '').includes('image')) blob = await res.blob();
    } catch { /* オフライン */ }
  }
  return blob ? { blob, entry } : { blob: null, entry };
}
