// ロケ地写真（同梱の Wikimedia Commons の写真）とクレジット。写真の下に必ず「撮影者 / ライセンス / Wikimedia Commons」を出す
import { h } from './dom.js';
import { photoFor, creditOf } from '../photos.js';

const ext = (href, text) => h('a', { href, target: '_blank', rel: 'noopener noreferrer' }, text);

/** クレジットの行（写真が読めなくても出す） */
export function creditLine(credit) {
  if (!credit) return null;
  return h('figcaption', { class: 'photo-credit small muted' },
    '撮影: ', credit.author, ' / ',
    credit.licenseUrl ? ext(credit.licenseUrl, credit.license) : credit.license === 'Public domain' ? 'パブリックドメイン' : credit.license,
    ' / ', ext(credit.sourceUrl, 'Wikimedia Commons'));
}

/** 写真とクレジット。写真が無いロケ地は null */
export function photoFigure(loc, { alt } = {}) {
  if (!loc?.photo) return null;
  const box = h('div', { class: 'photo-box' }, h('div', { class: 'photo-wait small muted' }, '写真を読み込み中…'));
  const fig = h('figure', { class: 'loc-photo' }, box, creditLine(creditOf(loc, null)));
  photoFor(loc).then((res) => {
    if (res?.entry) fig.lastChild.replaceWith(creditLine(creditOf(loc, res.entry)));
    if (!res?.blob) { box.replaceChildren(h('div', { class: 'photo-wait small muted' }, '写真はまだダウンロードされていません（オンラインのときに自動で保存されます）')); return; }
    const url = URL.createObjectURL(res.blob);
    const img = h('img', { src: url, alt: alt || `${loc.place}（${loc.city}）の写真`, decoding: 'async', loading: 'lazy' });
    img.addEventListener('load', () => URL.revokeObjectURL(url), { once: true });
    img.addEventListener('error', () => { URL.revokeObjectURL(url); box.replaceChildren(h('div', { class: 'photo-wait small muted' }, '写真を表示できませんでした')); }, { once: true });
    box.replaceChildren(img);
  }).catch(() => box.replaceChildren(h('div', { class: 'photo-wait small muted' }, '写真を表示できませんでした')));
  return fig;
}
