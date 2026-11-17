// ロケ地写真（Wikimedia Commons）を取得して data/photos/<locationId>.webp に保存する（GitHub Actions 用。アプリの実行には不要）
//
//   data/locations.json の photo.sourceUrl（Commons のファイルページ）ごとに、Commons API（imageinfo / extmetadata）で
//   ライセンスを確認する。CC0 / パブリックドメイン / CC BY / CC BY-SA 以外が 1 件でもあれば、何も書き換えずに失敗する。
//   長辺 1000px・WebP（品質 75）に変換し、data/photos/index.json（sha256・サイズ・API で確認した撮影者とライセンス）を作り直す。
//   すでに同じ写真・同じ設定で作ったファイルは作り直さない（--refresh ですべて作り直す）。photo が null になったロケ地のファイルは消す。
//
// 使い方: SHARP_DIR=<sharp を npm install したフォルダ> node scripts/fetch-photos.mjs [--refresh]
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, unlinkSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { join } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const OUT = join(ROOT, 'data/photos');
const LONG_SIDE = 1000;
const QUALITY = 75;
const API = 'https://commons.wikimedia.org/w/api.php';
// Wikimedia の User-Agent ポリシーに沿って用途を名乗る。連絡先（URL など）は環境変数 WIKIMEDIA_CONTACT があれば付ける
const UA = `XT3CinematicLab-PhotoFetcher/1.1 (offline PWA; bundles freely licensed location photos${process.env.WIKIMEDIA_CONTACT ? `; ${process.env.WIKIMEDIA_CONTACT}` : ''})`;
const THUMB_WIDTH = 1280; // Commons の標準サムネイル幅（標準外の幅は生成を断られることがある）
const PACE_MS = 1500;     // 画像 1 枚ごとの間隔
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 429 / 503 は Retry-After（無ければ 5→10→20→40→60 秒）待って最大 6 回まで再試行する */
export async function fetchRetry(url, init = {}, { tries = 6, wait = sleep } = {}) {
  let last;
  for (let i = 0; i < tries; i++) {
    const res = await fetch(url, { ...init, headers: { 'user-agent': UA, ...(init.headers || {}) } });
    if (res.status !== 429 && res.status !== 503) return res;
    last = res;
    const ra = Number(res.headers.get('retry-after'));
    const ms = Number.isFinite(ra) && ra > 0 ? Math.min(ra, 120) * 1000 : Math.min(5000 * 2 ** i, 60000);
    console.log(`  ${res.status} のため ${Math.round(ms / 1000)} 秒待って再試行（${i + 1}/${tries - 1}）: ${String(url).slice(0, 100)}`);
    if (i < tries - 1) await wait(ms);
  }
  return last;
}
const REFRESH = process.argv.includes('--refresh');

/** Commons の LicenseShortName / License を、アプリで表示する短い名前にする。許可外なら null */
export function normalizeLicense(shortName, code) {
  const s = String(shortName || '').trim();
  const c = String(code || '').trim().toLowerCase();
  if (/^cc0/i.test(s) || c === 'cc0') return 'CC0';
  if (/^public domain$/i.test(s) || /^pd($|-)/.test(c)) return 'Public domain';
  const m = s.match(/^CC BY(-SA)? (\d\.\d)/i) || c.match(/^cc-by(-sa)?-(\d\.\d)/);
  if (m) return `CC BY${m[1] ? '-SA' : ''} ${m[2]}`;
  return null;
}
/** 複数ライセンスのファイル（例: GFDL と CC BY-SA の併記）は、Commons のライセンスのカテゴリーから許可されたものを選ぶ */
export function licenseFromCategories(categories) {
  const names = (categories || []).map((c) => String(c.title || c).replace(/^Category:/, ''));
  for (const n of names) { const m = n.match(/^CC-BY(-SA)?-(\d\.\d)/); if (m) return `CC BY${m[1] ? '-SA' : ''} ${m[2]}`; }
  if (names.some((n) => /^CC-Zero$/i.test(n))) return 'CC0';
  if (names.some((n) => /^PD[- ]/.test(n) || /^Public domain$/i.test(n))) return 'Public domain';
  return null;
}
export const licenseUrlOf = (license) => {
  if (license === 'CC0') return 'https://creativecommons.org/publicdomain/zero/1.0/';
  const m = license.match(/^CC (BY(?:-SA)?) (\d\.\d)$/);
  return m ? `https://creativecommons.org/licenses/${m[1].toLowerCase()}/${m[2]}/` : null;
};
/** HTML（Artist など）からタグを除いた短い文字列 */
export const plain = (html) => String(html || '').replace(/<[^>]*>/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#0?39;/g, "'")
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120);
/** Commons のファイルページ URL → API に渡すタイトル（File:...） */
export function fileTitle(sourceUrl) {
  const m = String(sourceUrl).match(/^https:\/\/commons\.wikimedia\.org\/wiki\/(File:[^?#]+)$/);
  return m ? decodeURIComponent(m[1]).replace(/_/g, ' ') : null;
}

async function api(titles) {
  const out = new Map();
  let cont = {};
  for (let guard = 0; guard < 20; guard++) { // カテゴリーが多いと続きのページに分かれる
    const q = new URLSearchParams({ action: 'query', format: 'json', formatversion: '2', prop: 'imageinfo|categories', titles: titles.join('|'),
      iiprop: 'url|size|mime|extmetadata', iiurlwidth: String(THUMB_WIDTH), iiextmetadatafilter: 'Artist|LicenseShortName|License|LicenseUrl',
      cllimit: 'max', ...cont });
    const res = await fetchRetry(`${API}?${q}`);
    if (!res.ok) throw new Error(`Commons API: HTTP ${res.status}`);
    const json = await res.json();
    const norm = new Map((json.query?.normalized || []).map((n) => [n.to, n.from]));
    for (const p of json.query?.pages || []) {
      const key = norm.get(p.title) || p.title;
      const cur = out.get(key);
      if (cur) cur.categories = [...(cur.categories || []), ...(p.categories || [])];
      else out.set(key, p);
    }
    if (!json.continue) break;
    const { continue: _c, ...rest } = json.continue;
    cont = { ...rest, continue: _c };
  }
  return out;
}

async function main() {
  const sharp = createRequire(join(process.env.SHARP_DIR || ROOT, 'package.json'))('sharp');
  const { locations } = JSON.parse(readFileSync(join(ROOT, 'data/locations.json'), 'utf8'));
  const wanted = locations.filter((l) => l.photo?.sourceUrl);
  mkdirSync(OUT, { recursive: true });
  const prev = new Map();
  try { for (const f of JSON.parse(readFileSync(join(OUT, 'index.json'), 'utf8')).files) prev.set(f.id, f); } catch { /* 初回 */ }

  // 1) ライセンスの再確認（20 件ずつ）。許可外が 1 件でもあれば何も書き換えずに失敗する
  const info = new Map();
  const bad = [];
  for (let i = 0; i < wanted.length; i += 20) {
    const chunk = wanted.slice(i, i + 20);
    const titles = chunk.map((l) => fileTitle(l.photo.sourceUrl));
    for (const [j, t] of titles.entries()) if (!t) bad.push(`${chunk[j].id}: Commons のファイルページの URL ではありません（${chunk[j].photo.sourceUrl}）`);
    const pages = await api(titles.filter(Boolean));
    for (const l of chunk) {
      const t = fileTitle(l.photo.sourceUrl);
      if (!t) continue;
      const p = pages.get(t);
      const ii = p?.imageinfo?.[0];
      if (!p || p.missing || !ii) { bad.push(`${l.id}: Commons にファイルがありません（${t}）`); continue; }
      const em = ii.extmetadata || {};
      const byMeta = normalizeLicense(em.LicenseShortName?.value, em.License?.value);
      const license = byMeta || licenseFromCategories(p.categories);
      if (!license) { bad.push(`${l.id}: 許可外のライセンス「${plain(em.LicenseShortName?.value) || '不明'}」（${t}）`); continue; }
      if (!/^image\/(jpeg|png|webp|tiff)$/.test(ii.mime)) { bad.push(`${l.id}: 写真ではありません（${ii.mime}）`); continue; }
      info.set(l.id, { title: t, thumb: ii.thumburl || ii.url, width: ii.width, height: ii.height, license,
        licenseUrl: license === 'Public domain' ? null : (byMeta && em.LicenseUrl?.value) || licenseUrlOf(license), author: plain(em.Artist?.value) || '不明' });
    }
  }
  if (bad.length) { console.error(`写真を取得できません（${bad.length} 件）:\n- ${bad.join('\n- ')}`); process.exit(1); }

  // 2) 変換（同じ写真・同じ設定で作ったファイルは作り直さない）
  const files = [];
  const mismatch = [];
  const failed = [];
  let streak = 0; // 連続で失敗した数（混み合っているときは途中でやめて、次回の実行で続きから）
  for (const l of wanted) {
    const m = info.get(l.id);
    const file = `${l.id}.webp`;
    const path = join(OUT, file);
    const old = prev.get(l.id);
    const same = old && old.sourceUrl === l.photo.sourceUrl && old.longSide === LONG_SIDE && old.quality === QUALITY && existsSync(path);
    let buf;
    if (same && !REFRESH) buf = readFileSync(path);
    else if (streak >= 3) { failed.push(`${l.id}: 連続で失敗したため今回は取得しません`); continue; }
    else {
      try {
        const res = await fetchRetry(m.thumb);
        if (!res.ok) throw new Error(`HTTP ${res.status}（${m.thumb}）${(await res.text().catch(() => '')).replace(/\s+/g, ' ').slice(0, 200)}`);
        const src = Buffer.from(await res.arrayBuffer());
        buf = await sharp(src).rotate().resize({ width: LONG_SIDE, height: LONG_SIDE, fit: 'inside', withoutEnlargement: true })
          .webp({ quality: QUALITY }).toBuffer();
        writeFileSync(path, buf);
        streak = 0;
        console.log(`photo ${l.id}  ${(buf.length / 1024).toFixed(0)} KB  ${m.license}  ${m.author}`);
      } catch (err) {
        streak++;
        failed.push(`${l.id}: ${err.message}`);
        console.log(`  失敗 ${l.id}: ${err.message}`);
        if (!same) continue;
        buf = readFileSync(path); // 前回のファイルが使えるならそれを残す
      }
      await sleep(PACE_MS); // Commons への負荷を抑える
    }
    const meta = await sharp(buf).metadata();
    if (m.author !== l.photo.author || m.license !== l.photo.license) mismatch.push(`${l.id}: locations.json「${l.photo.author} / ${l.photo.license}」→ Commons「${m.author} / ${m.license}」`);
    files.push({ id: l.id, file, bytes: buf.length, sha256: createHash('sha256').update(buf).digest('hex'), width: meta.width, height: meta.height,
      longSide: LONG_SIDE, quality: QUALITY, sourceUrl: l.photo.sourceUrl, author: m.author, license: m.license, licenseUrl: m.licenseUrl });
  }

  // 3) locations.json から消えた写真を削除し、index.json を書き直す
  const keep = new Set(files.map((f) => f.file));
  for (const f of readdirSync(OUT)) if (f.endsWith('.webp') && !keep.has(f)) { unlinkSync(join(OUT, f)); console.log(`remove ${f}`); }
  const index = { version: 1, source: 'Wikimedia Commons（CC0 / パブリックドメイン / CC BY / CC BY-SA）', longSide: LONG_SIDE, quality: QUALITY, files };
  writeFileSync(join(OUT, 'index.json'), `${JSON.stringify(index, null, 1)}\n`);
  if (mismatch.length) console.log(`\nクレジットは Commons の値で index.json に記録しました（アプリはこちらを表示）:\n- ${mismatch.join('\n- ')}`);
  console.log(`\n写真 ${files.length} 件`);
  // 取得できなかった写真があれば、できた分は書き出したうえで失敗にする（ワークフローはできた分をコミットし、再実行で続きから）
  if (failed.length) { console.error(`\n取得できなかった写真 ${failed.length} 件（再実行すると続きから取得します）:\n- ${failed.join('\n- ')}`); process.exitCode = 1; }
}

if (process.argv[1] && new URL(import.meta.url).pathname === process.argv[1]) await main();
