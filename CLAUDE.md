# CLAUDE.md — X-T3 Cinematic Lab

このリポジトリで作業する前に必ず読むこと。詳しい元仕様は `SPEC.md`、公開・運用手順は `README.md`。

## プロジェクト
- FUJIFILM X-T3 向けのシネマティック撮影支援 PWA。公開先: https://hatakekai0720-code.github.io/-/
- フェーズ1〜5（基盤・解析・地図・講座50回・PWA）は完成済みで `main` にマージ済み。今後は改良フェーズ。

## 絶対に守るルール
1. **ビルド不要**：Vanilla JS（ES Modules）＋素の CSS。npm ビルド・バンドラー・Tailwind・フレームワークは入れない。
2. **完全オフライン**：CDN・Web フォント・地図タイル・外部 API など外部ドメインへの通信は禁止。ライブラリは `vendor/`、データは `data/` に同梱する。
3. **画像は保存しない**：解析画像はメモリ上（Canvas）だけで扱う。localStorage / IndexedDB / Cache に画像を書かない。
4. **保存は localStorage のみ**：キーは `xt3cine:` 接頭辞（本体は `xt3cine:db`）。スキーマを変えるときは `js/store.js` に移行処理を書き、バージョンを上げる。エクスポート/インポートとの互換性を保つ。
5. **X-T3 の実機仕様だけ**：パラメータは `js/xt3.js` が唯一の真実。X-T3 に無い機能（カラークローム・ブルー、クラリティ、トーン0.5刻み、グレインサイズ、Classic Neg、Nostalgic Neg など）は追加しない。実機仕様に自信が無い項目は実装前に確認を求める。
6. **相対パスのみ**（GitHub Pages のサブパス `/-/` で動かすため）。
7. **スマホ縦画面優先**（375px 幅で崩れないこと）。デザインはダーク基調（#0a0a0a / #1a1a1a / 境界線 #2a2a2a / 文字 #f3f4f6・#9ca3af / アクセント #f59e0b）、数値はすべて等幅フォント（`.num`）。ライトテーマも維持する。

## 変更したら毎回やること
- アプリのファイルを変えたら `sw.js` の `CACHE_VERSION` を上げる。ファイルを追加・削除したら `sw.js` の `ASSETS` も更新する。
- テストを全部通す：
  ```sh
  node tests/analyzer.test.mjs && node tests/map.test.mjs && node tests/lessons.test.mjs && node tests/sw.test.mjs
  ```
- ロジックを足したら対応するテストも足す。
- 作業はブランチで行い、終わったら変更内容を日本語で報告して止まる（main へのマージは私が確認してから）。

## 構成メモ
- `js/app.js` ルーティング（ハッシュ）と下部ナビ / `js/store.js` 保存・移行・エクスポート / `js/xt3.js` パラメータ定義
- `js/analyzer.js` 画像解析 / `js/translator.js` 推定レシピ（ルール表は冒頭）
- `js/views/*` 各画面 / `js/ui/*` 共通部品・テーマ / `js/pwa.js` SW 登録と更新通知
- `data/lessons.json` 講座50回 / `data/locations.json` ロケ地18件 / `data/countries-50m.json` 地図（Natural Earth 由来）

## 未確認事項
- モノクロ／ACROS の「モノクロ調整（暖色〜寒色）」は X-T3 に存在しない可能性がある（X-Pro3 / X-T4 以降の機能では？）。実機で確認できるまで触らない。確認が取れたら `xt3.js` から削除するか、この項目を消す。
