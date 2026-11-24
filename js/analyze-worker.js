// 画像の全ピクセル解析を行う Web Worker（module worker）。
// メインスレッドから ImageBitmap を受け取り、OffscreenCanvas にタイルごとに等倍で描いて読み、統計を累積する。
// 画像はこの Worker のメモリ上だけで扱い、終わったら close() する。どこにも保存しない。
import { analyzeTiled, canvasReader } from './analyzer.js';

self.onmessage = async (e) => {
  const { bitmap, exclude } = e.data || {};
  if (!bitmap) return;
  let last = 0;
  try {
    const read = canvasReader(bitmap, (w, h) => new OffscreenCanvas(w, h));
    const result = await analyzeTiled(read, bitmap.width, bitmap.height, {
      exclude, // 黒帯・字幕など解析から除外する範囲（割合）
      onProgress: (done, total) => {
        const now = Date.now();
        if (done === total || now - last > 80) { last = now; self.postMessage({ type: 'progress', done, total }); }
      },
    });
    self.postMessage({ type: 'done', result });
  } catch (err) {
    self.postMessage({ type: 'error', message: String(err?.message || err) });
  } finally {
    bitmap.close?.();
  }
};
