# テスト用フィクスチャ

## 実機の JPEG（`tests/fixtures/jpeg/`）

`tests/exif.test.mjs` は、このフォルダの `*.jpg` を読み、同じ名前の `*.expected.json` に書いた「撮影したときの設定」と一致するかを確かめます。
**画像データは入れません。** EXIF（APP1）だけを残した小さなファイルにしてから置いてください（GPS・サムネイル・シリアル番号も消します）。

### 作り方

1. X-T3 で、下の表の設定にして JPEG で撮る（被写体は何でもよい。画像データは捨てます）
2. EXIF だけを抜き出す:

   ```sh
   node scripts/strip-jpeg-exif.mjs DSCF1234.JPG tests/fixtures/jpeg/01-classic-chrome.jpg
   ```

3. 同じ名前で `.expected.json` を作る（`settings` のキーと値は `js/exif.js` の `decodeFuji` の `key` / `value`、つまり `js/xt3.js` の id と数値）:

   ```json
   {
     "model": "X-T3",
     "settings": {
       "filmSim": "classic-chrome", "dr": "dr200", "grain": "weak", "colorChrome": "strong",
       "wb": { "mode": "kelvin", "kelvin": 5000 }, "wbShift": { "r": 2, "b": -3 },
       "highlight": -1, "shadow": 2, "color": -2, "sharpness": -1, "nr": -4
     },
     "wbShiftRaw": [40, -60]
   }
   ```

   `wbShiftRaw` は WB シフトの記録値（`node -e` で `readExif` を呼ぶと `fuji.wbFineTune` に出ます）。
   WB シフトの換算（記録値 ÷ 20）が正しいと確認できたら、`js/exif.js` の `WB_SHIFT.confirmed` を `true` にします。

4. `node tests/exif.test.mjs` を実行する

### どの設定で撮ったか（サンプルを足したらここに書く）

【要確認】の項目を確かめるためのサンプルです。1 枚ごとに設定を変えて撮ってください。

| ファイル | フィルム | フィルター | DR | グレイン | カラークローム | WB（K） | WB シフト R / B | ハイライト | シャドウ | カラー | シャープネス | NR | Dレンジ優先 | 確かめたいこと |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| （例）01-classic-chrome.jpg | クラシッククローム | — | DR200 | 弱 | 強 | 色温度 5000K | +2 / -3 | -1 | +2 | -2 | -1 | -4 | OFF | WB シフトの換算・DR の記録値 |
| 02-wbshift-max.jpg | PROVIA | — | DR100 | OFF | OFF | 日光 | +9 / -9 | 0 | 0 | 0 | 0 | 0 | OFF | WB シフトの最大値の記録値 |
| 03-shade-fluo.jpg | PROVIA | — | AUTO | OFF | OFF | 日陰 | 0 / 0 | 0 | 0 | 0 | 0 | 0 | OFF | 「日陰」の記録値（0x200 か） |
| 04-fluorescent.jpg | PROVIA | — | AUTO | OFF | OFF | 蛍光灯1（と 2・3 も 1 枚ずつ） | 0 / 0 | 0 | 0 | 0 | 0 | 0 | OFF | 蛍光灯1〜3 の記録値 |
| 05-acros-ye.jpg | ACROS | +Ye | DR400 | 強 | — | AUTO | 0 / 0 | +2 | +3 | — | +2 | -2 | OFF | モノクロ調整（WC）のタグが記録されるか |
| 06-drp.jpg | ETERNA | — | — | OFF | OFF | AUTO | 0 / 0 | — | — | 0 | 0 | 0 | 強 | Dレンジ優先の記録値 |

## 合成画像

`tests/fixtures.mjs`（解析用の合成画像）と `tests/jpeg-builder.mjs`（EXIF だけの JPEG を組み立てる）で、数式から作ります。ユーザーの写真はリポジトリに入れません。
