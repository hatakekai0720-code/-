# X-T3 Cinematic Lab

FUJIFILM X-T3 で「映画のような写真」を撮るための、スマホ向けWebアプリ（PWA）です。
ビルド不要の素の HTML / CSS / JavaScript だけで作られており、**一度開けば機内モードでも全機能が動きます**。

| 画面 | できること |
|---|---|
| 解析 | 写真を読み込み、ヒストグラム・白飛び/黒つぶれ・暗部/明部・黒の浮き・露出の目安・シャドウ/ハイライト/光源の色・粒状感とシャープさを解析（映画のスクショの黒帯は自動で除外、字幕などは指で囲んで除外）。X-T3 の**推定レシピ**（撮影条件を選べる）と、RAW 現像用の RGB トーンカーブ、**この写真に近い映画**を出力。自分の X-T3 の JPEG なら、EXIF に記録された**実際の設定**も並べて表示 |
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
node tests/exif.test.mjs       # JPEG の EXIF / 富士フイルム MakerNote の読み取り（tests/fixtures/README.md）
node tests/similar.test.mjs    # この写真に近い映画
node tests/calibration.test.mjs # 較正データ（保存データ v4）・分布・RULES の更新案
node tests/spots.test.mjs      # 撮影スポット（カテゴリ・データの検証・重複・表示モードとカテゴリ切り替え・近い順・制覇率）
```

## 自分の JPEG から実際の設定を読む

解析画面で X-T3 の JPEG（カメラで撮ったままのファイル）を読み込むと、EXIF と富士フイルムの MakerNote から、フィルムシミュレーション・DR・グレイン・カラークローム・WB・WB シフト・トーン・カラー・シャープネス・NR と撮影情報（機種・レンズ・焦点距離・SS・F 値・ISO・露出補正・撮影日時）を読み取り、推定レシピと並べて**実際の設定**として表示します。

- ファイルの先頭（EXIF の部分）だけを読みます。位置情報（GPS）は読みませんし、保存もしません。
- 「レシピとして保存」でレシピ帳に入ります（撮影情報はメモに入ります）。X-T3 に無い設定（他機種の JPEG）は「X-T3では設定できない」と表示し、既定値で保存します。
- 写真アプリによっては、共有・書き出しのときに EXIF を消すことがあります。カメラから取り込んだ元のファイルを選んでください。
- タグの対応は ExifTool の FujiFilm タグ表に基づきます。実機で確かめていない項目には【要確認】と表示します（一覧は `js/exif.js` 冒頭と CLAUDE.md）。

## 判定ルールを較正する（フィルムシミュレーション ブラケット）

推定レシピのルール（`js/translator.js` の `RULES`）は目安の値です。自分の X-T3 で撮った JPEG の「実際の設定」と解析の数値を集めると、フィルムシミュレーションごとの彩度・コントラストの実際の分布と比べられます。

1. X-T3 のドライブを **BKT（ブラケット）** にし、ブラケットの種類を **フィルムシミュレーション BKT** にして、3 種類のフィルムシミュレーションを選びます（例: PROVIA / クラシッククローム / ETERNA）。【要確認】メニューの名前と場所は実機の表示で確かめてください。
2. 画質を **JPEG**（または FINE+RAW）にし、グレイン・カラー・トーンなどは 0 / OFF にしておきます（比べたいフィルム以外の差を減らすため）。
3. 同じ場面（色のある被写体と、空や壁などの平らな部分、はっきりした輪郭がある場面）で 1 回シャッターを切ると、3 種類の JPEG が記録されます。昼・曇り・夜など場面を変えて何回か撮ります。
4. JPEG をスマホに取り込み、アプリの **解析** で 1 枚ずつ読み込んで、「実際の設定」の下の **較正データに追加** を押します。保存されるのは解析の数値と設定の組だけで、画像は保存しません。
5. **設定 → 較正** で、フィルムごとの分布（点）と現在のルールの範囲（枠）・差を確かめます。1 つのフィルムに 3 件以上たまると、**この値で RULES を更新する案（JSON）を書き出す** で更新案を保存できます。
6. 更新案を見ながら、`js/translator.js` の `RULES.film`（sat・contrast）・`RULES.colorCenter`・`RULES.texture` を手で書き換えます（アプリは自動では書き換えません）。書き換えたらテストを通してください。

較正データはエクスポートの JSON に含まれます。

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

## 日本の撮影スポット

地図の上部で **映画ロケ地 / 撮影スポット / すべて** を切り替えられます。撮影スポットは日本国内の次のカテゴリで、チップで複数選択できます（選択は端末に保存）。

| カテゴリ | データの出どころ |
|---|---|
| 動物園・水族館・植物園・展望台・絶景・灯台・城・城跡・滝・砂浜・海岸・温泉街 | OpenStreetMap（ODbL）。都道府県ごとに Overpass API で取得 |
| 古い町並み | 文化庁「重要伝統的建造物群保存地区一覧」。座標は OpenStreetMap と照合 |
| 棚田 | 農林水産省「日本の棚田百選」（一部）。座標は OpenStreetMap と照合 |
| 神社仏閣 | 手作業で選んだ約 100 件（国宝の建造物・世界遺産の構成資産・全国的に有名なもの）。選定理由と出典つき |

- 星空スポットは、使える公的リスト（環境省の資料）を確認できなかったため、カテゴリを作っていません。
- 詳細画面では、カテゴリのおすすめレシピを Qメニュー表示で開いたり、レシピ帳に取り込んだりできます。営業時間・料金・撮影ルールは変わるので載せていません（「撮影可否は現地のルールを確認」と表示）。
- 「行った」を付けると、`#/spots`（地図の「制覇率」）にカテゴリ別・都道府県別の制覇率が出ます。
- データは GitHub Actions の **「撮影スポットを取得」**（`fetch-spots.yml`）が作ります。手動実行（Actions → 撮影スポットを取得 → Run workflow）と毎月 1 回の定期実行（デフォルトブランチのみ）で動き、検証に通ると `data/spots/` をコミットします。件数・OpenStreetMap と照合できなかったもの・合計サイズは Summary と `data/spots/report.md` に出ます。
  - 元のリストは `scripts/spot-lists/`（重伝建・棚田百選・神社仏閣）。追加・修正はここを直してワークフローを動かします。
  - 温泉街は、OpenStreetMap の `place=village|town|hamlet|suburb|quarter|neighbourhood|locality` のうち名前が「〜温泉」「〜温泉郷」「〜温泉街」で終わるものです（温泉施設は数えない）。
  - 重複（城が絶景にも入っている、重伝建の地区内の温泉街など）は、より具体的なカテゴリに 1 件にまとめます。
- 合計が 5MB 以下なら Service Worker のインストール時に保存し（`index.json` の `precache: true`）、超えるときは街路地図と同じく裏で 1 件ずつ保存します（Cache Storage `xt3cine-spots`）。
- 手元で形式だけ作り直すとき（ネットワークなし）: `node scripts/fetch-spots.mjs --offline`（OpenStreetMap 由来の既存データはそのまま、リストの分は概略座標）→ `node scripts/validate-spots.mjs`

## データとプライバシー

- **あなたの写真はどこにも保存・送信しません。** 解析はブラウザ内の Canvas で行い、結果の数値（レシピ・代表色・較正データ）だけを保存できます。JPEG の EXIF は撮影設定と撮影情報だけを読み、位置情報（GPS）は読みません。
- 「行った」チェックは日付とメモだけを保存します（写真は持ちません）。
- 保存先は端末の `localStorage` だけで、キーは `xt3cine:db` です（GitHub Pages では同じユーザーの全リポジトリが同じオリジンになるため、`xt3cine:` を接頭辞にしています）。
- Service Worker のキャッシュ名も `xt3cine-` で始まり、このアプリのキャッシュ以外は削除しません。
- 現在地は「近い順」の計算に使うだけで、保存しません。
- 外部サーバーへの通信はありません（Web フォント・CDN・外部の地図タイルも使っていません）。
- 撮影スポットのデータも同じサイトから取得し、Cache Storage（`xt3cine-spots`）に保存します。出典・公式サイトのリンクは表示するだけで、タップしたときだけブラウザで開きます。
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
js/exif.js               JPEG の EXIF / 富士フイルム MakerNote の読み取り（実際の設定）
js/similar.js            この写真に近い映画（冒頭の RULES で重みを調整）
js/calibration.js        較正データの分布と RULES の更新案
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
data/spots/              日本の撮影スポット <カテゴリ>.json・index.json・report.md（scripts/fetch-spots.mjs で作成）
data/spot-categories.json 撮影スポットのカテゴリ（名前・アイコン・色・おすすめレシピ・撮影のコツ・講座）
js/analyze-worker.js     全ピクセル解析の Web Worker
js/bgdownload.js         同梱データを裏で 1 件ずつ Cache Storage に保存する共通部品
js/streets.js            街路地図のダウンロードと読み出し
js/photos.js             ロケ地写真のダウンロードとクレジット
js/spots.js              撮影スポットの読み込み・検証・重複のまとめ・絞り込み・近い順・制覇率
js/film.js               作品ごとのまとめ・検索・年代・講座との対応
js/cluster.js            地図のピンのクラスタと地域・国の絞り込み
vendor/                  Leaflet・topojson-client・pmtiles・protomaps-leaflet
scripts/                 データ作成用スクリプト（アプリの実行には不要）
.github/workflows/       街路地図・写真・撮影スポットを作る GitHub Actions
icons/                   アプリアイコン
tests/                   Node.js のテスト
SPEC.md                  開発仕様書
```

## 注意事項

- 推定レシピ・ロケ地のレシピは、色の傾向から考えた**推定**で、公式の設定ではありません（JPEG から読んだ「実際の設定」は推定ではありません）。
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
| 撮影スポット（動物園・展望台・灯台・城・滝・海岸・温泉街など、各スポットの座標） | [OpenStreetMap](https://www.openstreetmap.org/copyright) | ODbL 1.0 | 地図に「撮影スポット © OpenStreetMap contributors（ODbL）」・`data/spots/LICENSE` |
| 撮影スポット（古い町並み） | 文化庁「[重要伝統的建造物群保存地区一覧](https://www.bunka.go.jp/seisaku/bunkazai/shokai/hozonchiku/judenken_ichiran.html)」 | — | 各エントリの `note`・`sources` |
| 撮影スポット（棚田） | 農林水産省「[日本の棚田百選](https://www.maff.go.jp/j/nousin/tanada/)」 | — | 各エントリの `note`・`sources` |
| 撮影スポット（神社仏閣） | 手作業で選定。[国指定文化財等データベース](https://kunishitei.bunka.go.jp/)・[ユネスコ世界遺産センター](https://whc.unesco.org/)・各寺社の公式サイト | — | 各エントリの `note`（選定理由）・`sources` |
| ロケ地・作品情報（`data/locations.json`） | 各ロケ地の `sources` に記した出典で確認した事実。あらすじ・撮影ガイド・レシピ・パレットはこのアプリのオリジナル | — | 出典はロケ地の詳細に表示 |
| 講座（`data/lessons.json`）・初期レシピ | このアプリのオリジナル | — | — |

- 写真は CC BY-SA のものを含みます。写真を取り出して再配布するときは、各写真のライセンス（表示・継承）に従ってください。
- 作品のタイトル・人名・会社名は事実として記載しています。ポスター・場面写真・予告編の画像は同梱していません。
