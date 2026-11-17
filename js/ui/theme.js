// テーマ切り替え（ダーク / ライト / 端末に合わせる）
import * as store from '../store.js';

export const THEMES = [
  { id: 'auto', label: '自動（端末の設定に合わせる）' },
  { id: 'dark', label: 'ダーク（黒）' },
  { id: 'light', label: 'ライト（白）' },
];

const mq = matchMedia('(prefers-color-scheme: light)');

export function applyTheme() {
  const pref = store.getSetting('theme');
  const theme = pref === 'light' || pref === 'dark' ? pref : (mq.matches ? 'light' : 'dark');
  document.documentElement.dataset.theme = theme;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'light' ? '#f4f4f5' : '#0a0a0a');
}
mq.addEventListener('change', applyTheme);

/** Canvas 描画用に現在のテーマ色を取得する */
export function themeColors() {
  const cs = getComputedStyle(document.documentElement);
  const v = (n) => cs.getPropertyValue(n).trim();
  return { bg: v('--bg'), card: v('--card'), line: v('--line'), text: v('--text'), muted: v('--muted'), accent: v('--accent') };
}
