# CLAUDE.md — X-T3 Cinematic Lab

このリポジトリで作業する前に必ず読むこと。詳しい元仕様は `SPEC.md`、公開・運用手順は `README.md`。

## プロジェクト
- FUJIFILM X-T3 向けのシネマティック撮影支援 PWA。公開先: https://hatakekai0720-code.github.io/-/
- フェーズ1〜5（基盤・解析・地図・講座50回・PWA）は完成済みで `main` にマージ済み。今後は改良フェーズ。

## 絶対に守るルール
1. **ビルド不要**：Vanilla JS（ES Modules）＋素の CSS。npm ビルド・バンドラー・Tailwind・フレームワークは入れない。
2. **完全オフライン**：CDN・Web フォント・地図タイル・外部 API など外部ドメインへの通信は禁止。ライブラリは `vendor/`、データは `data/` に同梱する（街路地図 `data/streets/` とロケ地写真 `data/photos/` も同じオリジンから配信し、Cache Storage に保存して使う）。
   - 外部 URL を書いてよいのは `data/locations.json` の `sources`（出典）・`links`（映画.com／予告編／Wikipedia）・`photo`（写真のクレジット）と、`data/spots/*.json` の `sources`（出典）・`website`（OSM の公式サイト）だけ。アプリはこれらに通信せず、ユーザーがタップしたときに外部ブラウザで開くだけ（`target="_blank" rel="noopener noreferrer"`）。
3. **ユーザーの画像は保存しない**：ユーザーがアップロード・選択した画像（解析画像など）はメモリ上（Canvas）だけで扱い、localStorage / IndexedDB / Cache に書かない。保存してよいのは解析結果の数値（レシピ・代表色など）だけ。
   - アプリに同梱する自由ライセンスのロケ地写真（`data/photos/`、Wikimedia Commons の CC0 / パブリックドメイン / CC BY / CC BY-SA）はこのルールの対象外。表示するときは必ず撮影者・ライセンス・Wikimedia Commons のクレジットを添える。
4. **保存は localStorage のみ**：キーは `xt3cine:` 接頭辞（本体は `xt3cine:db`）。スキーマを変えるときは `js/store.js` に移行処理を書き、バージョンを上げる。エクスポート/インポートとの互換性を保つ。
5. **X-T3 の実機仕様だけ**：パラメータは `js/xt3.js` が唯一の真実。X-T3 に無い機能（カラークローム・ブルー、クラリティ、トーン0.5刻み、グレインサイズ、Classic Neg、Nostalgic Neg など）は追加しない。実機仕様に自信が無い項目は実装前に確認を求める。
6. **相対パスのみ**（GitHub Pages のサブパス `/-/` で動かすため）。
7. **スマホ縦画面優先**（375px 幅で崩れないこと）。デザインはダーク基調（#0a0a0a / #1a1a1a / 境界線 #2a2a2a / 文字 #f3f4f6・#9ca3af / アクセント #f59e0b）、数値はすべて等幅フォント（`.num`）。ライトテーマも維持する。

## 変更したら毎回やること
- アプリのファイルを変えたら `sw.js` の `CACHE_VERSION` を上げる。ファイルを追加・削除したら `sw.js` の `ASSETS` も更新する（`data/streets/` の街路データ・`data/photos/` の写真・`data/spots/` の撮影スポットは ASSETS に入れない）。
- テストを全部通す：
  ```sh
  node tests/analyzer.test.mjs && node tests/map.test.mjs && node tests/lessons.test.mjs && node tests/sw.test.mjs && node tests/streets.test.mjs && node tests/photos.test.mjs && node tests/film.test.mjs && node tests/locations.test.mjs && node tests/exif.test.mjs && node tests/similar.test.mjs && node tests/calibration.test.mjs && node tests/spots.test.mjs
  ```
- ロジックを足したら対応するテストも足す。
- 作業はブランチで行い、終わったら変更内容を日本語で報告して止まる（main へのマージは私が確認してから）。

## 構成メモ
- `js/app.js` ルーティング（ハッシュ）と下部ナビ / `js/store.js` 保存・移行・エクスポート / `js/xt3.js` パラメータ定義
- `js/analyzer.js` 画像解析（全ピクセル。`Accumulator` で統計を累積、`tilePlan`/`analyzeTiled` で最大 4MP のタイルに分けて読む）/ `js/analyze-worker.js` 解析用 Worker（OffscreenCanvas。無ければ `views/analyze.js` がメインスレッドで 0.5MP ずつ await しながら処理）/ `js/translator.js` 推定レシピ（ルール表は冒頭）
  - 解析範囲: 黒帯（端から連続する、ほぼ黒で均一な行・列）を `detectBars` で縮小プレビューから自動検出し、指で描いた長方形（字幕・再生バー・ロゴ）と合わせて除外（`exclude: { bars, rects }`、座標は画像に対する割合 0〜1。`excludedRects` でピクセルに変換し `addRegion` で除外）。結果に `pixels`（解析した画素数）・`totalPixels`・`excludedRatio`。除外範囲を変えたら画像ファイルをもう一度デコードして再解析（ファイルはメモリ上だけ）
  - 指標: 黒つぶれ（真っ黒・輝度0〜2）・白飛び（真っ白・253〜255）・`darkRatio`（輝度64以下）・`brightRatio`（192以上）・`p1`/`p5`/`blackLift`（p5 ≥ 15）・`exposureEV`（中央値をリニアで 18% グレーと比べた EV 差）・`midtones`（p25〜p75 の平均色）・`light`（光源 = 輝度の上位 2% かつ 128 以上の平均色・`label`・面積。無ければ null）・`chromaNonLight`。しきい値は analyzer.js 冒頭の `RULES`
  - 推定レシピ: `estimate(a, { scene })` → 候補・確度・撮影条件（`SCENES`: 自動 / 昼光 / 曇り・日陰 / 夕方 / 夜の街 / 室内（電球）。自動は `guessScene`）。`planRecipe(a, cand, { scene })` → `{ recipe, notes, warnings }`（`buildRecipe` は recipe だけ）。WB は中間調だけから（K = 撮影条件の基準 K をミレッドでずらす、WB シフトは ±4 まで・超えたら警告）。スプリットトーンは WB に入れず注記とトーンカーブへ。黒が浮いた画像はシャドウトーン 0〜-2・トーンカーブで黒を持ち上げる。露出補正の目安（±3EV・1/3 段）は `exposureNote`、夜景の ISO は `isoNote`、DR は暗い画像では光源の面積も見る。暗部 85% 超・C* 6 未満・光源以外の色が少ない画像は確度「高」にしない。`summarize` が結果冒頭の要約。しきい値は translator.js 冒頭の `RULES`
  - 質感: `TextureAccumulator`（`addRegion` で一緒に累積）。8×8 ブロック（画像全体の座標で揃える。タイルの高さは 8 の倍数）で、平坦なブロックの 2 次差分から粒状感 σ、エッジのブロックの「隣との差の最大 ÷ 輝度の幅」からシャープさ、8px 境目の段差から強い JPEG 圧縮。結果は `texture`（`grain`・`sharpness`・`compressed`・`reliability`）。長辺 1000px 未満・圧縮・平坦部やエッジが少ないと確度を下げる。しきい値は analyzer.js の `RULES.texture`、グレイン / シャープネス / NR への反映は translator.js の `RULES.texture` と `textureEstimate`（粗い粒子で柔らかい = フィルム調はシャープネスと NR をマイナス寄り）。要約に質感の一言
  - テストの合成画像（黒帯・夜景・ティール＆オレンジ・輪郭 `edgesImage`・`addNoise`・`blur` など）は `tests/fixtures.mjs`。ユーザーの写真はリポジトリに入れない
- `js/exif.js` JPEG の EXIF / 富士フイルム MakerNote（自前パーサー。APP1 → TIFF/IFD → MakerNote "FUJIFILM"、オフセットは MakerNote 起点で常にリトルエンディアン）。タグと値の対応は ExifTool の FujiFilm タグ表（FujiFilm.pm 2.03）が根拠。GPS IFD はたどらない・保存しない。`decodeFuji` は項目ごとに `{ key, value, text, ok, note }`（X-T3 に無い値は ok: false・「X-T3では設定できない」）。`recipeFromJpeg`（source: `"jpeg"`、設定できない値は既定値）・`notesFromJpeg`（撮影情報をメモへ）。解析画面で推定レシピと並べて「実際の設定」を表示
  - 実機のフィクスチャは `tests/fixtures/jpeg/*.jpg` + `.expected.json`（`scripts/strip-jpeg-exif.mjs` で EXIF だけにし、GPS・サムネイル・シリアル番号を消す。手順と「どの設定で撮ったか」の表は `tests/fixtures/README.md`）。合成の EXIF は `tests/jpeg-builder.mjs`
- `js/similar.js` この写真に近い映画（解析結果とロケ地の palette・look・recipe・sceneTime を比べて上位 5 作品。同じ作品は 1 件に。重み・しきい値は冒頭の `RULES`、理由の一言つき）
- `js/calibration.js` 較正（JPEG の実際の設定 + 解析の統計値の組。フィルムごとの彩度・コントラストの分布と translator.js の RULES の差、`proposeRules` で更新案の JSON。RULES はアプリ内で自動では書き換えない）。設定画面の「較正」
- `js/geo.js` 距離・日付変更線・都市名ラベルの間引き（`pickLabels`）
- `js/cluster.js` 地図のピンのクラスタ（自前実装。ズームごとにワールドピクセル座標で貪欲法、半径 44px、件数で 3 段階）・放射状展開（`spiderOffsets`）・地域/国の絞り込み（`facetCounts`/`filterLocations`）。ロケ地とマイピンは別クラスタ。地図の絞り込みは 種類（実写／モデル地。`typeOf`/`typeCounts`）・地域・国・年代。描画は単独ピン = Canvas の circleMarker、クラスタ = divIcon
- `js/bgdownload.js` 同梱データを裏で 1 件ずつ Cache Storage に保存する共通部品（index.json の sha256 で更新判定・中断再開）。街路地図と写真で使う
- `js/photos.js` ロケ地写真: `data/photos/index.json`（`scripts/fetch-photos.mjs` が Commons API で確認したクレジット入り）を見て Cache Storage `xt3cine-photos` に保存。ASSETS には入れない。表示は `js/ui/photo.js`（写真の下に必ず「撮影者 / ライセンス / Wikimedia Commons」）
- `js/streets.js` 街路地図: `data/streets/index.json` を見て裏で 1 件ずつ Cache Storage `xt3cine-streets` に保存（sha256 で更新判定・中断再開）、`BlobSource` でキャッシュ済みファイルから PMTiles の Range を切り出す。SW はこのキャッシュを消さない
- `js/film.js` 作品単位のまとめ（キー = 英題と年、`workKey`）・検索（作品名・監督・撮影・出演・製作・配給。`fold` で中黒・空白・全角半角を無視）・年代（〜1960年代/70/80/90/2000/2010年代〜）・講座 ↔ ロケ地・画面比（1.85:1 以上は 16:9）
- `js/views/*` 各画面 / `js/ui/*` 共通部品・テーマ / `js/pwa.js` SW 登録と更新通知
- 画面: `#/locations/<id>` ロケ地詳細（作品情報／撮影ガイド／レシピのタブ）・`#/works/<workKey>` 作品ページ・`#/search` 検索と年代・`#/names/<名前>` 人物・会社の作品一覧・`#/map/<id>` 地図をそのロケ地に合わせて開く。地図のシートは要約と「詳細」ボタン
- 保存データ v4: `calibration`（較正データ `[{ id, savedAt, model, shotAt, settings, stats }]`。数値のみ・最大 1000 件。同じ機種・撮影日時・フィルムは置き換え。v3 からの移行あり、エクスポート/インポートに含む）
- 保存データ v3: `visited`（行ったロケ地 `{ [locationId]: { date: 'YYYY-MM-DD', memo } }`。写真は持たない）・`palettes`（画像解析の代表色を作品のパレットとして `{ [workKey]: { colors: ['#rrggbb'…], savedAt } }`。数値のみ）。v2 からの移行あり、エクスポート/インポートに含む
- 地図のズーム: 〜 国境 50m / 4〜 県・州の境界（`data/admin1-10m.json`）/ 5〜 国境・海岸線 10m（`data/countries-10m.json`）/ 6〜 都市名（`data/places-10m.json`）/ 通常の最大 8。ダウンロード済みのロケ地付近だけ 10〜 街路（`vendor/protomaps-leaflet` + `vendor/pmtiles`）、最大 18（データは 15 まで、それ以上は拡大表示）。ダウンロード中は地図の右上に進捗（n/N）
- `data/lessons.json` 講座50回 / `data/countries-50m.json` 地図（Natural Earth 由来）
- `data/locations.json` ロケ地（必須: id・`type`（実写の撮影地 `"filming"`／アニメなどのモデル地 `"model"`。モデル地は詳細画面に「撮影地ではなくモデル地」と出し、レシピは「その場所で撮るときの色作り」）・作品情報・place/city/country・region（asia / middle-east / europe / north-america / latin-america / africa / oceania）・lat/lng（小数4桁）・confidence・spotSources・streets（市街地なら true）・scene/look（自分の言葉で）・sources・recipe）。追加は出典で撮影地点を確認できたものだけ
  - `sources` は https の出典 URL。先頭の `spotSources` 件が撮影地点を確認できる出典、その後ろが作品情報の出典。`confidence` は撮影地点の出典の件数で決める（2 件以上で high、1 件で medium。作品情報の出典は数えない）
  - 作品情報（出典で確認できたものだけ。確認できなければ null。推測で埋めない）: `cinematographer`・`cast`（2〜3 人 `{ name, role }`）・`production`（最大 3 社。日本映画の製作委員会方式は制作会社を入れて `committee: true`）・`distributor`（`{ original, japan }`。japan は日本初公開時の配給。リバイバルは使わない。日本未公開なら null）・`genre`・`format`（`{ capture, aspect }`。1997 年以前の劇映画は capture をフィルムとしている）・`links`（`{ eigacom, trailer, wikipedia }`。eigacom は検索でタイトルと年が一致すると確認できた https://eiga.com/movie/<id>/ だけ。同じ作品は同じ URL。trailer は配給会社・公式チャンネルのものだけ。wikipedia は日本語版があれば日本語版）
  - 自分の言葉（ガイド）: `synopsis`（ネタバレなし 100 字以内）・`sceneTime`（朝/昼/夕方/マジックアワー/夜）・`weather`（晴れ/曇り/雨/雪/霧）・`guide`（`{ focal: 35mm 換算と近い XF, angle, bestTime }`）・`visitNotes`（最寄り駅・私有地や撮影の注意。料金・営業時間は書かない）・`lessons`（講座番号 1〜3 件）・`palette`（look に基づく 5 色）
  - `photo`: `{ sourceUrl: Commons のファイルページ, author, license, licenseUrl }` か null。ロケ地そのものを写した写真だけ（映画のスチル・ポスター・人物が主役の写真は不可）。CC0 / Public domain / CC BY / CC BY-SA のみ
  - 同じ場所に複数の作品がある場合は作品ごとに別のエントリにし、座標は同じにする（地図では同じ地点のピンとしてクラスタ・放射状展開される）
  - 画面比が 1.85:1 以上なら `recipe.sizeNote` に「画像サイズ 16:9」を書く（X-T3 は 3:2 / 16:9 / 1:1）
- `scripts/build-natural-earth.sh` Natural Earth データの再生成 / `scripts/extract-streets.sh` 街路データの切り出し（`streets: true` のロケ地だけ、半径約 1km・ズーム 10〜15。合計が 500MB を超えそうなら止まる。ロケ地を増やしたら再実行。要 pmtiles CLI と build.protomaps.com への接続）
- `.github/workflows/extract-streets.yml`（街路データを生成）・`.github/workflows/fetch-photos.yml`（ロケ地写真を取得）: `data/locations.json` を変えた push と手動実行で動き、`github-actions[bot]` が `data/streets/`・`data/photos/` をコミットする（これらだけの変更では動かない）。95MB を超えるファイルがあれば失敗。サイズは Summary に出る
- `scripts/fetch-photos.mjs` 写真の取得: Commons API でライセンスを再確認（許可外が 1 件でもあれば何もせず失敗）、長辺 1000px・WebP 品質 75。429 は再試行し、取得できた分だけでもコミットして次回は続きから。任意でリポジトリ変数 `WIKIMEDIA_CONTACT` を User-Agent に付ける
- 設定 `settings.streetsAuto === false` で街路地図と写真の自動ダウンロードをオフ（未設定 = オン。撮影スポットは precache なら SW が保存するので影響しない）
- 日本の撮影スポット: `js/spots.js`（DOM 非依存の検証・`dedupeSpots`・`filterSpots`・`nearest`・`inBounds`・`completion`、日本の範囲 `inJapan` は多角形 + 離島の矩形）・`js/views/spot.js`（`#/spots/<id>` 詳細）・`js/views/spots.js`（`#/spots` 制覇率）
  - カテゴリ: `data/spot-categories.json`（並び順 = 重複時の優先度。名前・1 文字のアイコン・色・おすすめレシピ（xt3.js の範囲。source `spot`・sourceRef = カテゴリ）・コツ 3〜5 行・講座）。Qメニューは保存しなくても `#/qmenu/spot-<カテゴリ>` で開ける
  - データ: `data/spots/<カテゴリ>.json`（`{ id, category, name, lat, lng, pref, city, source（osm / jyudenken / tanada100 / curated）, osmId, sources, website, note, verified?, alsoIn? }`）・`index.json`（sha256・件数・`precache` = 合計 5MB 以下）・`report.md`・`LICENSE`（ODbL）。Cache Storage `xt3cine-spots`（precache なら SW のインストール時、そうでなければ bgdownload で裏で）
  - 生成: `.github/workflows/fetch-spots.yml`（手動 + 月 1 回）→ `scripts/fetch-spots.mjs`（Overpass で都道府県ごと。タグの判定は `scripts/spots-osm.mjs`）→ `scripts/validate-spots.mjs`。公的リスト・厳選の元は `scripts/spot-lists/`（`match` = OSM と照合する名前、`approx` = 探索の中心）。照合できなかったものは概略座標のまま `verified: false`（詳細画面に注記）。ネットワークなしでは `--offline`
  - 地図: 表示モード `settings.mapMode`（films / spots / all）・カテゴリの選択 `settings.spotCats`（未設定 = 全選択）。スポットのピンとクラスタは Canvas の `L.SpotMarker`（角丸の四角 + 1 文字）。カテゴリごとにクラスタ、ズームごとにキャッシュ、表示範囲の外は描かない。都道府県の絞り込みは撮影スポットだけ（ロケ地は都道府県を持たない）
  - 「行った」はロケ地と同じ `visited`（ID が重ならない形式: osm-n… / shrine-… / jyudenken-… / tanada-…）

## 作品情報の調べ方（追加・更新するとき）
- 1 作品ずつ検索し（例:「映画.com <邦題> <年> 撮影 キャスト 役名 配給」）、出典に書いてあることだけを使う。映画.com の URL は、そのページのタイトルと製作年が一致すると確認できたときだけ（eiga.com の製作年が違う・候補が複数ならnull）
- 写真は Commons のファイルページで撮影者とライセンスを確かめてから。GFDL のみ・NC/ND は不可（GFDL と CC BY-SA の併記は可。ワークフローがカテゴリーから判定する）

## 未確認事項
- 撮影スポットの元リスト（`scripts/spot-lists/`）は外部に接続できない環境で作った。重伝建の一覧（124 件。公式は約 130 件）・棚田百選（35 件のみ。全 134 地区）・神社仏閣の選定理由と出典 URL は公式の一覧で確認して直す。座標はワークフローで OSM と照合するまで概略
- 星空スポットは、使える公的リスト（環境省）を確認できていないのでカテゴリを作っていない
- JPEG の MakerNote の対応で【要確認】のもの（実機のサンプルで確かめたら `js/exif.js` とここを直す。`tests/fixtures/README.md` の表）:
  - WB シフト（WhiteBalanceFineTune 0x100A）の記録値 → 表示値の換算（今は ÷20。`WB_SHIFT.confirmed = false`）と R/B の順番
  - DR（DynamicRangeSetting 0x1402 = 1 + DevelopmentDynamicRange 0x1403 = 100/200/400 で DR100/200/400 になるか。0x100 の扱い）
  - WB の記録値: 0x200 Cloudy → 「日陰」、0x300〜0x302 → 「蛍光灯1〜3」、0x1 / 0x2（オート ホワイト優先 / 雰囲気優先。X-T3 にあるか、xt3.js に無い）
  - モノクロ調整（BWAdjustment 0x1049）が X-T3 の JPEG に記録されるか（下のモノクロ調整の件の手がかり）
  - Dレンジ優先（0x1443〜0x1445）は X-T3 の機能だが xt3.js のレシピ項目に無い（表示だけ。レシピに加えるかは要相談）
- 質感（粒状感・シャープさ）→ グレイン / シャープネス / NR のしきい値、「この写真に近い映画」の重みは未較正の目安値
- モノクロ／ACROS の「モノクロ調整（暖色〜寒色）」は X-T3 に存在しない可能性がある（X-Pro3 / X-T4 以降の機能では？）。実機で確認できるまで触らない。確認が取れたら `xt3.js` から削除するか、この項目を消す。
