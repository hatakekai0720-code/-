// 生成したデータのサイズ報告（GitHub Actions 用。アプリの実行には不要）
// 使い方: node scripts/size-report.mjs <ディレクトリ> <拡張子> <タイトル> [1ファイルの上限MB=95]
// ・各ファイルのサイズと合計を表にして出力し、GITHUB_STEP_SUMMARY があればそこにも書く
// ・上限を超えるファイルがあれば終了コード 1（GitHub は 100MB を超えるファイルを受け付けない）
import { readdirSync, statSync, appendFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const [dir, ext, title = 'サイズ', limitArg = '95'] = process.argv.slice(2);
const limit = Number(limitArg) * 1024 * 1024;
const files = existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith(ext)).sort() : [];
const mb = (b) => (b / 1048576).toFixed(2);
let total = 0;
const over = [];
const rows = files.map((f) => {
  const size = statSync(join(dir, f)).size;
  total += size;
  if (size > limit) over.push(f);
  return `| ${f} | ${mb(size)} |${size > limit ? ' ⚠ 上限超え' : ''}`;
});
const md = [
  `### ${title}`, '',
  `合計 **${files.length} 件・${mb(total)} MB**（1 ファイルの上限 ${limitArg} MB）`, '',
  '| ファイル | MB |', '|---|---:|', ...rows, '',
  over.length ? `**上限を超えたファイル: ${over.join(', ')}**` : '', '',
].join('\n');
console.log(md);
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, md + '\n');
if (over.length) { console.error(`${over.length} 件が ${limitArg} MB を超えています`); process.exit(1); }
