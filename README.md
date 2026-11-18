# X-T3 Cinematic Lab

FUJIFILM X-T3 で「映画のような写真」を撮るための、スマホ向けWebアプリ（PWA）です。
ビルド不要の素の HTML / CSS / JavaScript だけで作られており、**一度開けば機内モードでも全機能が動きます**。

| 画面 | できること |
|---|---|
| 解析 | 写真を読み込み、ヒストグラム・白飛び/黒つぶれ・シャドウ/ハイライトの色被りを解析。X-T3 の**推定レシピ**と、RAW 現像用の RGB トーンカーブを出力 |
| レシピ | X-T3 で設定できる値だけで作るレシピ帳（作成・編集・複製・削除・検索・絞り込み）。ビフォーアフター比較 |
| Qメニュー | レシピをカメラ背面の Q メニュー風 4×4 で全画面表示。WB シフトは座標グリッドで表示。画面スリープ防止 |
| 地図 | 映画ロケ地 18 件の世界地図（タイル無し・同梱データのみ）。現在地から近い順、長押しでマイピン追加 |
| 講座 | 撮影講座 全 50 回（5 章）。進捗ゲージとランク、練習用レシピを Q メニューで開く |
| C1-C7 | カメラのカスタム設定 C1〜C7 に何を登録したかを管理 |

設定（右上の歯車）から、テーマ（ダーク/ライト/自動）、データのエクスポート/インポート、保存容量、オフライン状態の確認ができます。

## GitHub Pages で公開する

1. このリポジトリを GitHub に push します（`index.html` がリポジトリ直下にある状態）。
2. GitHub のリポジトリ画面で **Settings → Pages** を開きます。
3. **Build and deployment** の **Source** を「Deploy from a branch」にします。
4. **Branch** で公開したいブランチ（例: `main`）と、フォルダ **`/ (root)`** を選び、**Save** を押します。
5. 数分待つと `https://<ユーザー名>.github.io/<リポジトリ名>/` で公開されます。Pages の画面上部に URL が表示されます。

補足:

- すべてのパスは相対パスなので、`/<リポジトリ名>/` のようなサブパスでもそのまま動きます。Service Worker のスコープも自動的にそのサブパスになります。
- リポジトリ直下の `.nojekyll` は、GitHub Pages の Jekyll 処理を無効にするためのファイルです。消さないでください。
- Service Worker は HTTPS（または `localhost`）でしか動きません。GitHub Pages は HTTPS なので問題ありません。

### スマホのホーム画面に追加する

- **iPhone（Safari）**：共有ボタン →「ホーム画面に追加」
- **Android（Chrome）**：メニュー →「ホーム画面に追加」または「アプリをインストール」

ホーム画面から開くと、ブラウザの枠なしで全画面のアプリとして動きます。

### 更新を公開するとき

アプリのファイルを変更したら、**`sw.js` の `CACHE_VERSION` を必ず変更**してください（例: `'2026-11-17.1'` → `'2026-11-20.1'`）。

- 利用者が次にアプリを開くと、新しいバージョンを裏でダウンロードし、画面下に「新しいバージョンがあります ／ 更新する」が表示されます。「更新する」を押すと切り替わります。
- ファイルを追加・削除したときは、`sw.js` の `ASSETS` 一覧も更新します。`node tests/sw.test.mjs` を実行すると、一覧と実際のファイルが一致しているかを確認できます。

## 手元で動かす

ES Modules と Service Worker を使うため、`file://` で直接開くことはできません。リポジトリ直下で簡易サーバーを起動してください。

```sh
python3 -m http.server 8000
# ブラウザで http://localhost:8000/ を開く
```

`npx serve` など、静的ファイルを配信できるものなら何でも動きます。ビルドやパッケージのインストールは不要です。

### オフライン動作の確認

1. 一度ページを開き、設定画面の「オフライン」に「● オフラインで使えます」と表示されるまで待ちます。
2. DevTools の Network タブで「Offline」にする（またはスマホを機内モードにする）。
3. 再読み込みし、解析・レシピ・地図・講座・Qメニューがすべて動くことを確認します。

### テスト

ブラウザ不要の数値テストを Node.js（v18 以降）で実行できます。

```sh
node tests/analyzer.test.mjs   # 画像解析と推定レシピ（合成画像で検証）
node tests/map.test.mjs        # 距離計算・ロケ地データ（必須項目・座標・出典）・クラスタ
node tests/lessons.test.mjs    # 講座データ・練習用レシピ
node tests/sw.test.mjs         # Service Worker のキャッシュ一覧・外部 URL が無いこと
node tests/streets.test.mjs    # 街路地図のダウンロード計画・範囲判定・PMTiles の Range 読み込み
node tests/photos.test.mjs     # ロケ地写真のライセンス判定・クレジット・index.json
node tests/film.test.mjs       # 作品のまとめ・検索・年代・代表色・保存データ v3（行った・パレット）
node tests/locations.test.mjs  # locations.json のスキーマ（作品情報・撮影ガイド・links・photo）と外部リンクの形式
```

## 街路地図とロケ地写真を GitHub Actions で作る（スマホの GitHub アプリから）

街路地図（`data/streets/`）とロケ地写真（`data/photos/`）は、GitHub Actions のワークフローが作ってこのブランチにコミットします。
`data/locations.json` を変更して push すると自動で動きます。手動で動かすときは、スマホの GitHub アプリで次の手順です。

1. GitHub アプリでこのリポジトリを開き、**Actions** を開きます（リポジトリのトップ画面の下の方にあります。見つからなければ「…」→「Actions」）。
2. 一覧から **「街路データを生成」**（`extract-streets.yml`）または **「ロケ地写真を取得」**（`fetch-photos.yml`）を選びます。
3. 右上の **「Run workflow」**（または「…」→「Run workflow」）を押し、ブランチを選びます。
   - 街路地図: `refresh`（すべて作り直す）、`radius_km`（半径 km、既定 1）、`limit_mb`（合計の上限 MB、既定 500）を指定できます。
   - 写真: `refresh`（すべて取得し直す）を指定できます。
4. **Run** を押すと実行が始まります。終わると、ワークフローの画面の **Summary** にファイルごとのサイズと合計が出ます（95MB を超えるファイルがあると失敗します）。
5. 成功すると `github-actions[bot]` が `data/streets/` または `data/photos/` をコミットします。アプリは次に開いたときに裏でダウンロードします。

補足:
- 写真のワークフローは Commons API でライセンスを確認し、CC0 / パブリックドメイン / CC BY / CC BY-SA 以外が 1 件でもあると何もせずに失敗します。その場合は `data/locations.json` の該当する `photo` を別の写真にするか `null` にしてください。
- Wikimedia が混み合っていると（HTTP 429）一部の写真を取得できないことがあります。取得できた分はコミットされるので、時間をおいてもう一度「Run workflow」を押すと続きから取得します。
  Wikimedia に名乗る連絡先を付けたいときは、リポジトリの Settings → Secrets and variables → Actions → **Variables** に `WIKIMEDIA_CONTACT`（例: 連絡用の URL）を追加します（任意）。
- `data/streets/` や `data/photos/` だけの変更ではワークフローは動きません（bot のコミットで無限に動かないように）。

## データとプライバシー

- **あなたの写真はどこにも保存・送信しません。** 解析はブラウザ内の Canvas で行い、結果の数値（レシピ・代表色）だけを保存できます。
- 「行った」チェックは日付とメモだけを保存します（写真は持ちません）。
- 保存先は端末の `localStorage` だけで、キーは `xt3cine:db` です（GitHub Pages では同じユーザーの全リポジトリが同じオリジンになるため、`xt3cine:` を接頭辞にしています）。
- Service Worker のキャッシュ名も `xt3cine-` で始まり、このアプリのキャッシュ以外は削除しません。
- 現在地は「近い順」の計算に使うだけで、保存しません。
- 外部サーバーへの通信はありません（Web フォント・CDN・外部の地図タイルも使っていません）。
- ロケ地周辺の街路地図（OpenStreetMap）とロケ地写真（Wikimedia Commons の自由ライセンス写真）は、このアプリと同じサイトから裏で 1 件ずつダウンロードし、Cache Storage（`xt3cine-streets`・`xt3cine-photos`）に保存します。設定画面でオフ・全削除できます。
- ロケ地の出典・映画.com などの外部リンク・写真のクレジットは表示するだけで、アプリは通信しません。タップしたときだけブラウザで開きます。
- 機種変更やバックアップには、設定画面の「エクスポート」で JSON ファイルを書き出し、新しい端末で「インポート」します。

## ファイル構成

```
index.html               画面の骨組み
manifest.webmanifest     PWA の設定
sw.js                    Service Worker（プリキャッシュ・更新通知）
css/style.css            スタイル（ダーク/ライト）
js/app.js                ルーティングと下部ナビ
js/xt3.js                X-T3 パラメータ定義（範囲・バリデーションの唯一の基準）
js/store.js              localStorage・スキーマ移行・エクスポート/インポート
js/analyzer.js           画像解析
js/translator.js         解析結果 → 推定レシピ（冒頭の RULES 表で調整）
js/views/                各画面
data/lessons.json        講座 全 50 回
data/locations.json      ロケ地（出典 URL つき）
data/recipes-seed.json   初期レシピ
data/countries-50m.json  国境データ（world-atlas / Natural Earth）
data/countries-10m.json  国境・海岸線 10m（ズーム 5 以上）
data/admin1-10m.json     県・州の境界線（ズーム 4 以上）
data/places-10m.json     主要都市名（ズーム 6 以上）
data/streets/            ロケ地周辺の街路地図 PMTiles（scripts/extract-streets.sh で作成。プリキャッシュしない）
data/photos/             ロケ地写真 WebP と index.json（scripts/fetch-photos.mjs で作成。プリキャッシュしない）
js/analyze-worker.js     全ピクセル解析の Web Worker
js/bgdownload.js         同梱データを裏で 1 件ずつ Cache Storage に保存する共通部品
js/streets.js            街路地図のダウンロードと読み出し
js/photos.js             ロケ地写真のダウンロードとクレジット
js/film.js               作品ごとのまとめ・検索・年代・講座との対応
js/cluster.js            地図のピンのクラスタと地域・国の絞り込み
vendor/                  Leaflet・topojson-client・pmtiles・protomaps-leaflet
scripts/                 データ作成用スクリプト（アプリの実行には不要）
.github/workflows/       街路地図・写真を作る GitHub Actions
icons/                   アプリアイコン
tests/                   Node.js のテスト
SPEC.md                  開発仕様書
```

## 注意事項

- 推定レシピ・ロケ地のレシピは、色の傾向から考えた**推定**で、公式の設定ではありません。
- 講座本文のうち、X-T3 の実機メニュー名や手順に確信が持てない箇所には【要確認】と記しています。
- FUJIFILM、X-T3、フィルムシミュレーション名などは富士フイルム株式会社の商標です。本アプリは非公式のファンメイドツールです。

## ライセンス表記（同梱ライブラリ・データ）

| 名称 | バージョン | ライセンス | ファイル |
|---|---|---|---|
| [Leaflet](https://leafletjs.com/) | 1.9.4 | BSD-2-Clause | `vendor/leaflet/LICENSE` |
| [topojson-client](https://github.com/topojson/topojson-client) | 3.1.0 | ISC | `vendor/topojson-client.LICENSE` |
| [world-atlas](https://github.com/topojson/world-atlas) | 2.0.2 | ISC | `data/world-atlas.LICENSE` |
| [Natural Earth](https://www.naturalearthdata.com/) | 4.1.0 / 5.x | パブリックドメイン | `data/natural-earth.LICENSE` |
| [pmtiles](https://github.com/protomaps/PMTiles) | 4.5.0 | BSD-3-Clause | `vendor/pmtiles/LICENSE` |
| [protomaps-leaflet](https://github.com/protomaps/protomaps-leaflet) | 5.1.0 | BSD-3-Clause | `vendor/protomaps-leaflet/LICENSE` |
| [OpenStreetMap](https://www.openstreetmap.org/copyright)（Protomaps basemap） | daily build | ODbL 1.0 | `data/streets/LICENSE` |

### 同梱データ

| データ | 出典 | ライセンス | 表示・ファイル |
|---|---|---|---|
| 国境・海岸線・県境・都市名 | [Natural Earth](https://www.naturalearthdata.com/)・[world-atlas](https://github.com/topojson/world-atlas) | パブリックドメイン / ISC | `data/natural-earth.LICENSE`・`data/world-atlas.LICENSE` |
| ロケ地周辺の街路地図 | [OpenStreetMap](https://www.openstreetmap.org/copyright)（[Protomaps](https://protomaps.com/) basemap） | ODbL 1.0 | 地図に「© OpenStreetMap contributors」・`data/streets/LICENSE` |
| ロケ地写真 | [Wikimedia Commons](https://commons.wikimedia.org/) | 写真ごとに CC0 / パブリックドメイン / CC BY / CC BY-SA | 写真の下に撮影者・ライセンス・Commons へのリンク。`data/photos/index.json` に記録 |
| ロケ地・作品情報（`data/locations.json`） | 各ロケ地の `sources` に記した出典で確認した事実。あらすじ・撮影ガイド・レシピ・パレットはこのアプリのオリジナル | — | 出典はロケ地の詳細に表示 |
| 講座（`data/lessons.json`）・初期レシピ | このアプリのオリジナル | — | — |

- 写真は CC BY-SA のものを含みます。写真を取り出して再配布するときは、各写真のライセンス（表示・継承）に従ってください。
- 作品のタイトル・人名・会社名は事実として記載しています。ポスター・場面写真・予告編の画像は同梱していません。
