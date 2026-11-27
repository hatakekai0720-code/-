// Overpass API への問い合わせと、失敗したときのやり直し（scripts/fetch-spots.mjs から使う。テストは tests/spots.test.mjs）
// ・1 回の問い合わせ（overpassOnce）は、時間切れ（REQUEST_TIMEOUT_MS）で打ち切る。混雑（429 / 502 / 503 / 504）・通信エラー・時間切れはやり直せる
// ・withRetry: 失敗したら待って最大 retries 回やり直す。待ち時間は 1 回目 wait、2 回目 wait×2、3 回目 wait×4
// ・やり直しのたびに問い合わせ先（ENDPOINTS）を交互に変える
// ・環境変数 OVERPASS_WAIT_MS で最初の待ち時間を変えられる（既定 30 秒。動作確認用）

export const ENDPOINTS = [process.env.OVERPASS_URL || 'https://overpass-api.de/api/interpreter', 'https://overpass.private.coffee/api/interpreter'];
export const REQUEST_TIMEOUT_MS = 11 * 60 * 1000; // クエリの [timeout:600] より少し長く
export const RETRYABLE_STATUS = [429, 502, 503, 504];
const sleepReal = (ms) => new Promise((r) => setTimeout(r, ms));

export class OverpassError extends Error {
  constructor(message, retryable) { super(message); this.retryable = retryable; }
}

/** 1 回だけ問い合わせる。失敗は OverpassError（retryable: やり直す価値があるか） */
export async function overpassOnce(query, { endpoint = ENDPOINTS[0], ua = 'xt3cine-spots/1.0', timeoutMs = REQUEST_TIMEOUT_MS, fetchImpl = fetch } = {}) {
  let res;
  try {
    res = await fetchImpl(endpoint, {
      method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', 'user-agent': ua },
      body: `data=${encodeURIComponent(query)}`, signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    const timeout = err?.name === 'TimeoutError' || err?.name === 'AbortError';
    throw new OverpassError(`${endpoint}: ${timeout ? `${Math.round(timeoutMs / 1000)} 秒で時間切れ` : `通信エラー（${err?.message || err}）`}`, true);
  }
  if (!res.ok) throw new OverpassError(`${endpoint}: HTTP ${res.status}`, RETRYABLE_STATUS.includes(res.status));
  let json;
  try { json = await res.json(); } catch { throw new OverpassError(`${endpoint}: 応答が JSON ではありません`, true); }
  // Overpass はサーバー側の時間切れ・メモリ不足でも 200 を返し、remark に書く
  if (json?.remark && /runtime error|timed out|out of memory/i.test(json.remark)) throw new OverpassError(`${endpoint}: ${json.remark}`, true);
  return json?.elements || [];
}

/**
 * 失敗したら待って最大 retries 回やり直す（やり直せない失敗はすぐ投げる）。
 * fn(attempt) の attempt は 0 から。最後の失敗の error.attempts に試した回数
 */
export async function withRetry(fn, { retries = 3, wait = 30000, sleep = sleepReal, onRetry = () => {} } = {}) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn(attempt);
    } catch (err) {
      if (attempt >= retries || err?.retryable === false) {
        if (err && typeof err === 'object') err.attempts = attempt + 1;
        throw err;
      }
      const ms = wait * 2 ** attempt;
      onRetry(err, attempt + 1, ms);
      await sleep(ms);
    }
  }
}

/** やり直しつきの問い合わせ（やり直すたびに問い合わせ先を変える） */
export const overpass = (query, opt = {}) => withRetry(
  (attempt) => overpassOnce(query, { ...opt, endpoint: ENDPOINTS[attempt % ENDPOINTS.length] }),
  { retries: opt.retries ?? 3, wait: opt.wait ?? (Number(process.env.OVERPASS_WAIT_MS) || 30000), sleep: opt.sleep, onRetry: opt.onRetry },
);

/** 取得できなかった都道府県の一覧（Markdown。GitHub Actions の Summary と report.md 用） */
export function failedPrefsMarkdown(failed) {
  if (!failed.length) return ['## OpenStreetMap から取得できなかった都道府県', '', 'なし', ''].join('\n');
  return [
    `## OpenStreetMap から取得できなかった都道府県（${failed.length} 件）`, '',
    'やり直しても取得できなかった（試した回数 0 は、時間の上限に達したため取得しなかった）ため、この都道府県の OpenStreetMap 由来のスポットは前回のデータのまま。次回の実行で取り直す。', '',
    '| 都道府県 | ISO | 試した回数 | 前回のデータから残した件数 | 最後のエラー |', '|---|---|---:|---:|---|',
    ...failed.map((f) => `| ${f.pref} | ${f.iso} | ${f.attempts} | ${f.kept} | ${String(f.error).replace(/\|/g, '\\|').replace(/\s+/g, ' ').slice(0, 200)} |`), '',
  ].join('\n');
}
