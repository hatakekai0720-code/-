# CLAUDE.md — X-T3 Cinematic Lab

このリポジトリで作業する前に必ず読むこと。詳しい元仕様は `SPEC.md`、公開・運用手順は `README.md`。

## プロジェクト
- FUJIFILM X-T3 向けのシネマティック撮影支援 PWA。公開先: https://hatakekai0720-code.github.io/-/
- フェーズ1〜5（基盤・解析・地図・講座50回・PWA）は完成済みで `main` にマージ済み。今後は改良フェーズ。

## 絶対に守るルール
1. **ビルド不要**：Vanilla JS（ES Modules）＋素の CSS。npm ビルド・バンドラー・Tailwind・フレームワークは入れない。
2. **完全オフライン**：CDN・Web フォント・地図タイル・外部 API など外部ドメインへの通信は禁止。ライブラリは `vendor/`、データは `data/` に同梱する（街路地図 `data/streets/` とロケ地写真 `data/photos/` も同じオリジンから配信し、Cache Storage に保存して使う）。
   - 外部 URL を書いてよいのは `data/locations.json` の `sources`（出典）・`links`（映画.com／予告編／Wikipedia）・`photo`（写真のクレジット）だけ。アプリはこれらに通信せず、ユーザーがタップしたときに外部ブラウザで開くだけ（`target="_blank" rel="noopener noreferrer"`）。
3. **ユーザーの画像は保存しない**：ユーザーがアップロード・選択した画像（解析画像など）はメモリ上（Canvas）だけで扱い、localStorage / IndexedDB / Cache に書かない。保存してよいのは解析結果の数値（レシピ・代表色など）だけ。
   - アプリに同梱する自由ライセンスのロケ地写真（`data/photos/`、Wikimedia Commons の CC0 / パブリックドメイン / CC BY / CC BY-SA）はこのルールの対象外。表示するときは必ず撮影者・ライセンス・Wikimedia Commons のクレジットを添える。
4. **保存は localStorage のみ**：キーは `xt3cine:` 接頭辞（本体は `xt3cine:db`）。スキーマを変えるときは `js/store.js` に移行処理を書き、バージョンを上げる。エクスポート/インポートとの互換性を保つ。
5. **X-T3 の実機仕様だけ**：パラメータは `js/xt3.js` が唯一の真実。X-T3 に無い機能（カラークローム・ブルー、クラリティ、トーン0.5刻み、グレインサイズ、Classic Neg、Nostalgic Neg など）は追加しない。実機仕様に自信が無い項目は実装前に確認を求める。
6. **相対パスのみ**（GitHub Pages のサブパス `/-/` で動かすため）。
7. **スマホ縦画面優先**（375px 幅で崩れないこと）。デザインはダーク基調（#0a0a0a / #1a1a1a / 境界線 #2a2a2a / 文字 #f3f4f6・#9ca3af / アクセント #f59e0b）、数値はすべて等幅フォント（`.num`）。ライトテーマも維持する。

## 変更したら毎回やること
- アプリのファイルを変えたら `sw.js` の `CACHE_VERSION` を上げる。ファイルを追加・削除したら `sw.js` の `ASSETS` も更新する（`data/streets/` の街路データと `data/photos/` の写真は ASSETS に入れない）。
- テストを全部通す：
  ```sh
  node tests/analyzer.test.mjs && node tests/map.test.mjs && node tests/lessons.test.mjs && node tests/sw.test.mjs && node tests/streets.test.mjs && node tests/photos.test.mjs && node tests/film.test.mjs && node tests/locations.test.mjs
  ```
- ロジックを足したら対応するテストも足す。
- 作業はブランチで行い、終わったら変更内容を日本語で報告して止まる（main へのマージは私が確認してから）。

## 構成メモ
- `js/app.js` ルーティング（ハッシュ）と下部ナビ / `js/store.js` 保存・移行・エクスポート / `js/xt3.js` パラメータ定義
- `js/analyzer.js` 画像解析（全ピクセル。`Accumulator` で統計を累積、`tilePlan`/`analyzeTiled` で最大 4MP のタイルに分けて読む）/ `js/analyze-worker.js` 解析用 Worker（OffscreenCanvas。無ければ `views/analyze.js` がメインスレッドで 0.5MP ずつ await しながら処理）/ `js/translator.js` 推定レシピ（ルール表は冒頭）
- `js/geo.js` 距離・日付変更線・都市名ラベルの間引き（`pickLabels`）
- `js/cluster.js` 地図のピンのクラスタ（自前実装。ズームごとにワールドピクセル座標で貪欲法、半径 44px、件数で 3 段階）・放射状展開（`spiderOffsets`）・地域/国の絞り込み（`facetCounts`/`filterLocations`）。ロケ地とマイピンは別クラスタ。描画は単独ピン = Canvas の circleMarker、クラスタ = divIcon
- `js/bgdownload.js` 同梱データを裏で 1 件ずつ Cache Storage に保存する共通部品（index.json の sha256 で更新判定・中断再開）。街路地図と写真で使う
- `js/photos.js` ロケ地写真: `data/photos/index.json`（`scripts/fetch-photos.mjs` が Commons API で確認したクレジット入り）を見て Cache Storage `xt3cine-photos` に保存。ASSETS には入れない。表示は `js/ui/photo.js`（写真の下に必ず「撮影者 / ライセンス / Wikimedia Commons」）
- `js/streets.js` 街路地図: `data/streets/index.json` を見て裏で 1 件ずつ Cache Storage `xt3cine-streets` に保存（sha256 で更新判定・中断再開）、`BlobSource` でキャッシュ済みファイルから PMTiles の Range を切り出す。SW はこのキャッシュを消さない
- `js/film.js` 作品単位のまとめ（キー = 英題と年、`workKey`）・検索（作品名・監督・撮影・出演・製作・配給。`fold` で中黒・空白・全角半角を無視）・年代（〜1960年代/70/80/90/2000/2010年代〜）・講座 ↔ ロケ地・画面比（1.85:1 以上は 16:9）
- `js/views/*` 各画面 / `js/ui/*` 共通部品・テーマ / `js/pwa.js` SW 登録と更新通知
- 画面: `#/locations/<id>` ロケ地詳細（作品情報／撮影ガイド／レシピのタブ）・`#/works/<workKey>` 作品ページ・`#/search` 検索と年代・`#/names/<名前>` 人物・会社の作品一覧・`#/map/<id>` 地図をそのロケ地に合わせて開く。地図のシートは要約と「詳細」ボタン
- 保存データ v3: `visited`（行ったロケ地 `{ [locationId]: { date: 'YYYY-MM-DD', memo } }`。写真は持たない）・`palettes`（画像解析の代表色を作品のパレットとして `{ [workKey]: { colors: ['#rrggbb'…], savedAt } }`。数値のみ）。v2 からの移行あり、エクスポート/インポートに含む
- 地図のズーム: 〜 国境 50m / 4〜 県・州の境界（`data/admin1-10m.json`）/ 5〜 国境・海岸線 10m（`data/countries-10m.json`）/ 6〜 都市名（`data/places-10m.json`）/ 通常の最大 8。ダウンロード済みのロケ地付近だけ 10〜 街路（`vendor/protomaps-leaflet` + `vendor/pmtiles`）、最大 18（データは 15 まで、それ以上は拡大表示）。ダウンロード中は地図の右上に進捗（n/N）
- `data/lessons.json` 講座50回 / `data/countries-50m.json` 地図（Natural Earth 由来）
- `data/locations.json` ロケ地（必須: id・作品情報・place/city/country・region（asia / middle-east / europe / north-america / latin-america / africa / oceania）・lat/lng（小数4桁）・confidence・spotSources・streets（市街地なら true）・scene/look（自分の言葉で）・sources・recipe）。追加は出典で撮影地点を確認できたものだけ
  - `sources` は https の出典 URL。先頭の `spotSources` 件が撮影地点を確認できる出典、その後ろが作品情報の出典。`confidence` は撮影地点の出典の件数で決める（2 件以上で high、1 件で medium。作品情報の出典は数えない）
  - 作品情報（出典で確認できたものだけ。確認できなければ null。推測で埋めない）: `cinematographer`・`cast`（2〜3 人 `{ name, role }`）・`production`（最大 3 社。日本映画の製作委員会方式は制作会社を入れて `committee: true`）・`distributor`（`{ original, japan }`。japan は日本初公開時の配給。リバイバルは使わない。日本未公開なら null）・`genre`・`format`（`{ capture, aspect }`。1997 年以前の劇映画は capture をフィルムとしている）・`links`（`{ eigacom, trailer, wikipedia }`。eigacom は検索でタイトルと年が一致すると確認できた https://eiga.com/movie/<id>/ だけ。同じ作品は同じ URL。trailer は配給会社・公式チャンネルのものだけ。wikipedia は日本語版があれば日本語版）
  - 自分の言葉（ガイド）: `synopsis`（ネタバレなし 100 字以内）・`sceneTime`（朝/昼/夕方/マジックアワー/夜）・`weather`（晴れ/曇り/雨/雪/霧）・`guide`（`{ focal: 35mm 換算と近い XF, angle, bestTime }`）・`visitNotes`（最寄り駅・私有地や撮影の注意。料金・営業時間は書かない）・`lessons`（講座番号 1〜3 件）・`palette`（look に基づく 5 色）
  - `photo`: `{ sourceUrl: Commons のファイルページ, author, license, licenseUrl }` か null。ロケ地そのものを写した写真だけ（映画のスチル・ポスター・人物が主役の写真は不可）。CC0 / Public domain / CC BY / CC BY-SA のみ
  - 画面比が 1.85:1 以上なら `recipe.sizeNote` に「画像サイズ 16:9」を書く（X-T3 は 3:2 / 16:9 / 1:1）
- `scripts/build-natural-earth.sh` Natural Earth データの再生成 / `scripts/extract-streets.sh` 街路データの切り出し（`streets: true` のロケ地だけ、半径約 1km・ズーム 10〜15。合計が 500MB を超えそうなら止まる。ロケ地を増やしたら再実行。要 pmtiles CLI と build.protomaps.com への接続）
- `.github/workflows/extract-streets.yml`（街路データを生成）・`.github/workflows/fetch-photos.yml`（ロケ地写真を取得）: `data/locations.json` を変えた push と手動実行で動き、`github-actions[bot]` が `data/streets/`・`data/photos/` をコミットする（これらだけの変更では動かない）。95MB を超えるファイルがあれば失敗。サイズは Summary に出る
- `scripts/fetch-photos.mjs` 写真の取得: Commons API でライセンスを再確認（許可外が 1 件でもあれば何もせず失敗）、長辺 1000px・WebP 品質 75。429 は再試行し、取得できた分だけでもコミットして次回は続きから。任意でリポジトリ変数 `WIKIMEDIA_CONTACT` を User-Agent に付ける
- 設定 `settings.streetsAuto === false` で街路地図と写真の自動ダウンロードをオフ（未設定 = オン）

## 作品情報の調べ方（追加・更新するとき）
- 1 作品ずつ検索し（例:「映画.com <邦題> <年> 撮影 キャスト 役名 配給」）、出典に書いてあることだけを使う。映画.com の URL は、そのページのタイトルと製作年が一致すると確認できたときだけ（eiga.com の製作年が違う・候補が複数ならnull）
- 写真は Commons のファイルページで撮影者とライセンスを確かめてから。GFDL のみ・NC/ND は不可（GFDL と CC BY-SA の併記は可。ワークフローがカテゴリーから判定する）

## 未確認事項
- モノクロ／ACROS の「モノクロ調整（暖色〜寒色）」は X-T3 に存在しない可能性がある（X-Pro3 / X-T4 以降の機能では？）。実機で確認できるまで触らない。確認が取れたら `xt3.js` から削除するか、この項目を消す。
