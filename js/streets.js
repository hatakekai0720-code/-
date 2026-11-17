// ロケ地周辺の街路地図（OpenStreetMap / Protomaps の PMTiles）のダウンロードと読み出し。
// ・data/streets/index.json に各ファイルの sha256・サイズ・範囲（bbox）が書いてある（scripts/extract-streets.sh が作る）
// ・アプリ起動後、Service Worker のインストールとは別に、裏で 1 ファイルずつ Cache Storage（xt3cine-streets）へ保存する
//   （仕組みは js/bgdownload.js。ロケ地写真 js/photos.js と共通）
// ・地図はキャッシュ済みのファイルだけを使う（ネットワークから直接は読まない）。PMTiles の Range 読み込みは
//   キャッシュ済みファイル全体（Blob）から切り出して返す
// ・前半は DOM 非依存の純粋関数（tests/streets.test.mjs でテスト）
import { createDownloader } from './bgdownload.js';
export { sha256Hex } from './bgdownload.js';

export const STREETS_CACHE = 'xt3cine-streets';
export const STREETS_DIR = 'data/streets/';
export const INDEX_URL = `${STREETS_DIR}index.json`;
export const STREET_MIN_ZOOM = 10;   // このズーム以上で街路レイヤーを表示
export const STREET_MAX_ZOOM = 18;   // 街路データのある範囲だけ、ここまでズームできる
export const STREET_DATA_ZOOM = 15;  // PMTiles の maxzoom（16〜18 はこれを拡大表示）

const dl = createDownloader({
  cacheName: STREETS_CACHE, dir: STREETS_DIR, fileRe: /^[a-z0-9-]+\.pmtiles$/, contentType: 'application/vnd.pmtiles',
  extra: (f) => Array.isArray(f.bbox) && f.bbox.length === 4 && f.bbox.every(Number.isFinite) && f.bbox[0] < f.bbox[2] && f.bbox[1] < f.bbox[3],
});

/* ---- 純粋関数 ---- */

/** index.json の検証。不正な項目は捨てる */
export const parseIndex = dl.parseIndex;
/** ダウンロード計画。cached は Map<url, sha256|null>（キャッシュにあるもの） */
export const planDownloads = dl.planDownloads;

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

/* ---- ブラウザ ---- */

/** 地図用: ダウンロード済みの街路データ一覧 [{ id, bbox, url }] */
export async function cachedAreas() {
  return (await dl.cachedFiles()).map((f) => ({ id: f.id, bbox: f.bbox, url: f.url }));
}
/** 地図用: キャッシュ済みファイル全体の Blob（無ければ null。ネットワークには行かない） */
export const cachedBlob = dl.cachedBlob;

export const events = dl.events; // 'status'（進捗）, 'file'（1 ファイル保存した）
export const getStatus = dl.getStatus;
/** 裏で街路データを 1 ファイルずつ保存する。enabled() が false になったら、今のファイルを中断して止まる */
export const startDownload = dl.startDownload;
export const stopDownload = dl.stopDownload;
/** 保存済みの街路データの容量（バイト） */
export const cachedBytes = dl.cachedBytes;
/** 起動時の自動ダウンロード */
export const autoDownloadStreets = (enabled) => dl.autoDownload(enabled, 3000);
/** 全削除（ダウンロード中なら止める） */
export const clearAll = dl.clearAll;
