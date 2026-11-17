#!/usr/bin/env bash
# Natural Earth（パブリックドメイン）から地図データを作り、data/ に同梱する。アプリの実行には不要（開発用）。
#   data/countries-10m.json  国境・海岸線 10m 版（world-atlas@2 の TopoJSON をそのまま）… ズーム 5 以上
#   data/admin1-10m.json     県・州の境界線（ne_10m_admin_1_states_provinces_lines を mapshaper で簡略化）… ズーム 4 以上
#   data/places-10m.json     主要都市名（ne_10m_populated_places から必要な列だけ）… ズーム 6 以上
# 必要なもの: Node.js（npx）、curl
# 使い方: bash scripts/build-natural-earth.sh
set -euo pipefail
cd "$(dirname "$0")/.."
ROOT=$(pwd)
NE=https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT

echo "== ダウンロード"
curl -fsSL -o "$WORK/admin1-lines.geojson" "$NE/ne_10m_admin_1_states_provinces_lines.geojson"
curl -fsSL -o "$WORK/places.geojson" "$NE/ne_10m_populated_places.geojson"
(cd "$WORK" && npm pack --silent world-atlas@2.0.2 >/dev/null && tar xzf world-atlas-2.0.2.tgz)

echo "== 国境・海岸線 10m"
cp "$WORK/package/countries-10m.json" data/countries-10m.json

echo "== 県・州の境界線（25% に簡略化して 1 本にまとめる）"
npx --yes mapshaper@0.6 -i "$WORK/admin1-lines.geojson" -filter-fields -simplify weighted 25% keep-shapes -dissolve \
  -rename-layers admin1 -o format=topojson quantization=200000 data/admin1-10m.json

echo "== 主要都市名"
node - "$WORK/places.geojson" "$ROOT/data/places-10m.json" <<'JS'
const fs = require('fs');
const [src, dst] = process.argv.slice(2);
const r6 = (v) => Math.round(v * 1e4) / 1e4;
const rows = JSON.parse(fs.readFileSync(src, 'utf8')).features.map((f) => {
  const p = f.properties, [lng, lat] = f.geometry.coordinates;
  // [経度, 緯度, 表示名（日本語があれば日本語）, 英語名, 表示し始めるズーム, 人口順位（0 が最大）]
  return [r6(lng), r6(lat), p.NAME_JA || p.NAME, p.NAME_EN || p.NAME, p.MIN_ZOOM, p.SCALERANK];
}).sort((a, b) => a[4] - b[4] || a[5] - b[5]);
fs.writeFileSync(dst, JSON.stringify({
  source: 'Natural Earth ne_10m_populated_places (public domain)',
  fields: ['lng', 'lat', 'name', 'nameEn', 'minZoom', 'rank'],
  places: rows,
}));
console.log(`${rows.length} 件`);
JS
ls -l data/countries-10m.json data/admin1-10m.json data/places-10m.json
