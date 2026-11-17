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
- アプリのファイルを変えたら `sw.js` の `CACHE_VERSION` を上げる。ファイルを追加・削除したら `sw.js` の `ASSETS` も更新する（`data/streets/` の街路データは ASSETS に入れない）。
- テストを全部通す：
  ```sh
  node tests/analyzer.test.mjs && node tests/map.test.mjs && node tests/lessons.test.mjs && node tests/sw.test.mjs && node tests/streets.test.mjs
  ```
- ロジックを足したら対応するテストも足す。
- 作業はブランチで行い、終わったら変更内容を日本語で報告して止まる（main へのマージは私が確認してから）。

## 構成メモ
- `js/app.js` ルーティング（ハッシュ）と下部ナビ / `js/store.js` 保存・移行・エクスポート / `js/xt3.js` パラメータ定義
- `js/analyzer.js` 画像解析（全ピクセル。`Accumulator` で統計を累積、`tilePlan`/`analyzeTiled` で最大 4MP のタイルに分けて読む）/ `js/analyze-worker.js` 解析用 Worker（OffscreenCanvas。無ければ `views/analyze.js` がメインスレッドで 0.5MP ずつ await しながら処理）/ `js/translator.js` 推定レシピ（ルール表は冒頭）
- `js/geo.js` 距離・日付変更線・都市名ラベルの間引き（`pickLabels`）
- `js/cluster.js` 地図のピンのクラスタ（自前実装。ズームごとにワールドピクセル座標で貪欲法、半径 44px、件数で 3 段階）・放射状展開（`spiderOffsets`）・地域/国の絞り込み（`facetCounts`/`filterLocations`）。ロケ地とマイピンは別クラスタ。描画は単独ピン = Canvas の circleMarker、クラスタ = divIcon
- `js/streets.js` 街路地図: `data/streets/index.json` を見て裏で 1 件ずつ Cache Storage `xt3cine-streets` に保存（sha256 で更新判定・中断再開）、`BlobSource` でキャッシュ済みファイルから PMTiles の Range を切り出す。SW はこのキャッシュを消さない
- `js/views/*` 各画面 / `js/ui/*` 共通部品・テーマ / `js/pwa.js` SW 登録と更新通知
- 地図のズーム: 〜 国境 50m / 4〜 県・州の境界（`data/admin1-10m.json`）/ 5〜 国境・海岸線 10m（`data/countries-10m.json`）/ 6〜 都市名（`data/places-10m.json`）/ 通常の最大 8。ダウンロード済みのロケ地付近だけ 10〜 街路（`vendor/protomaps-leaflet` + `vendor/pmtiles`）、最大 18（データは 15 まで、それ以上は拡大表示）。ダウンロード中は地図の右上に進捗（n/N）
- `data/lessons.json` 講座50回 / `data/countries-50m.json` 地図（Natural Earth 由来）
- `data/locations.json` ロケ地（必須: id・作品情報・place/city/country・region（asia / middle-east / europe / north-america / latin-america / africa / oceania）・lat/lng（小数4桁）・confidence（出典2件以上で high、1件で medium）・streets（市街地なら true）・scene/look（自分の言葉で）・sources（撮影地点を確認できる https の出典 URL。外部 URL はここだけ許可。アプリは表示するだけで通信しない）・recipe）。追加は出典で撮影地点を確認できたものだけ
- `scripts/build-natural-earth.sh` Natural Earth データの再生成 / `scripts/extract-streets.sh` 街路データの切り出し（`streets: true` のロケ地だけ、半径約 1km・ズーム 10〜15。合計が 500MB を超えそうなら止まる。ロケ地を増やしたら再実行。要 pmtiles CLI と build.protomaps.com への接続）
- 設定 `settings.streetsAuto === false` で街路の自動ダウンロードをオフ（未設定 = オン。スキーマのバージョンは変えていない）

## 未確認事項
- モノクロ／ACROS の「モノクロ調整（暖色〜寒色）」は X-T3 に存在しない可能性がある（X-Pro3 / X-T4 以降の機能では？）。実機で確認できるまで触らない。確認が取れたら `xt3.js` から削除するか、この項目を消す。
