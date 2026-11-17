// Service Worker の登録と更新通知
import { h } from './ui/dom.js';

let registration = null;
let userAccepted = false;

function showUpdateBanner(worker) {
  if (document.querySelector('.update-banner')) return;
  const bar = h('div', { class: 'update-banner', role: 'status' },
    h('span', { class: 'grow' }, '新しいバージョンがあります'),
    h('button', { type: 'button', class: 'btn', onclick: () => bar.remove() }, 'あとで'),
    h('button', { type: 'button', class: 'btn primary', onclick: () => {
      userAccepted = true;
      worker.postMessage({ type: 'SKIP_WAITING' });
    } }, '更新する'));
  document.body.append(bar);
}

export function initPwa() {
  if (!('serviceWorker' in navigator)) return;
  // 新しい SW が有効になったら一度だけ再読み込み（ユーザーが「更新する」を押したときだけ）
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (userAccepted) { userAccepted = false; location.reload(); }
  });
  navigator.serviceWorker.register('./sw.js').then((reg) => {
    registration = reg;
    if (reg.waiting && navigator.serviceWorker.controller) showUpdateBanner(reg.waiting);
    reg.addEventListener('updatefound', () => {
      const w = reg.installing;
      w?.addEventListener('statechange', () => {
        if (w.state === 'installed' && navigator.serviceWorker.controller) showUpdateBanner(w);
      });
    });
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && navigator.onLine) reg.update().catch(() => {});
    });
  }).catch((err) => console.warn('Service Worker を登録できませんでした', err));
}

/** 設定画面用: オフライン用キャッシュの状態 */
export async function offlineStatus() {
  if (!('serviceWorker' in navigator) || !('caches' in window)) return { supported: false };
  const keys = (await caches.keys()).filter((k) => k.startsWith('xt3cine-') && k !== 'xt3cine-streets');
  const reg = registration || await navigator.serviceWorker.getRegistration();
  return { supported: true, ready: !!navigator.serviceWorker.controller && keys.length > 0, cache: keys.sort().at(-1) || null, waiting: !!reg?.waiting };
}

export async function checkForUpdate() {
  const reg = registration || await navigator.serviceWorker?.getRegistration();
  if (!reg) return 'none';
  await reg.update();
  if (reg.waiting) { showUpdateBanner(reg.waiting); return 'found'; }
  if (reg.installing) return 'installing';
  return 'latest';
}
