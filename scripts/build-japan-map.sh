#!/usr/bin/env bash
# 国土数値情報「行政区域データ（N03）」（国土交通省）から、撮影スポットモードの日本の詳細地図を作って data/japan/ に置く。
# アプリの実行には不要（開発用。GitHub Actions の「日本の詳細地図を作成」から実行する）。
#   data/japan/japan-low.json   都道府県（海岸線・都道府県境）。800m に簡略化。ズーム 8 未満で表示 … objects.prefs
#   data/japan/japan-high.json  市区町村（海岸線・都道府県境・市区町村境）。ズーム 8 以上で表示し、撮影スポットの市区町村の判定にも使う … objects.cities
#   各地物の属性: pref（都道府県名）・city（市区町村名。政令指定都市は「市名 + 区名」、所属未定地は ''）・code（行政区域コード 5 桁）・
#                 lx / ly（名前を置く地点。ポリゴンの内側）
#   data/japan/LICENSE          出典・加工内容
# 合計が 5MB（js/japan.js の JAPAN_SIZE_LIMIT）を超えないように、市区町村の簡略化を強めながら作り直す。超えたら失敗する。
#
# 必要なもの: Node.js（npx で mapshaper 0.6 を使う）、curl、unzip
# 使い方:
#   bash scripts/build-japan-map.sh                     # 国土交通省の N03（既定は 2024 年 1 月 1 日時点）
#   N03_YEAR=2025 N03_DATE=20250101 bash scripts/build-japan-map.sh
#   N03_SOURCE=smri bash scripts/build-japan-map.sh     # 国土交通省のサイトに接続できない環境用: スマートニュース メディア研究所が
#                                                       # N03（2021 年 1 月 1 日時点）を 1% に簡略化して GitHub で公開している GeoJSON を使う
set -euo pipefail
cd "$(dirname "$0")/.."
ROOT=$(pwd)
SOURCE=${N03_SOURCE:-mlit}
YEAR=${N03_YEAR:-2024}
DATE=${N03_DATE:-${YEAR}0101}
MS="npx --yes mapshaper@0.6"
OUT=data/japan
LIMIT=$(node -e "import('$ROOT/js/japan.js').then((m) => console.log(m.JAPAN_SIZE_LIMIT))")
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT
mkdir -p "$OUT"

echo "== ダウンロード（$SOURCE）"
case "$SOURCE" in
  mlit)
    URL="https://nlftp.mlit.go.jp/ksj/gml/data/N03/N03-${YEAR}/N03-${DATE}_GML.zip"
    DATASET="N03-${YEAR}（${DATE:0:4}年${DATE:4:2}月${DATE:6:2}日時点）"
    curl -fsSL --retry 3 -o "$WORK/n03.zip" "$URL"
    unzip -q -o "$WORK/n03.zip" -d "$WORK/n03"
    RAW=$(find "$WORK/n03" -iname '*.geojson' | head -1)
    if [ -z "$RAW" ]; then # GeoJSON が入っていない年度は Shapefile から変換
      SHP=$(find "$WORK/n03" -iname '*.shp' | head -1)
      [ -n "$SHP" ] || { echo "N03 の GeoJSON / Shapefile が見つかりません" >&2; exit 1; }
      $MS -i "$SHP" encoding=utf8 -o format=geojson "$WORK/raw.geojson"
      RAW="$WORK/raw.geojson"
    fi
    HIGH_INTERVALS="25 40 60 90 140 200" # 市区町村の簡略化（m）。小さい順に試し、合計が上限に収まった最初のもの
    ;;
  smri)
    URL="https://raw.githubusercontent.com/smartnews-smri/japan-topography/main/data/municipality/geojson/s0010/N03-21_210101.json"
    DATASET="N03-2021（2021年1月1日時点。スマートニュース メディア研究所 japan-topography が 1% に簡略化したもの）"
    curl -fsSL --retry 3 -o "$WORK/raw.geojson" "$URL"
    RAW="$WORK/raw.geojson"
    HIGH_INTERVALS="0 200 400" # 0 = 追加の簡略化なし
    ;;
  *) echo "N03_SOURCE は mlit か smri" >&2; exit 1 ;;
esac

echo "== 属性（都道府県・市区町村名・行政区域コード）"
node scripts/japan-props.mjs "$RAW" "$WORK/props.geojson"

# 同じ市区町村の飛び地・島を 1 つにまとめ、境界を共有したトポロジーにする
$MS -i "$WORK/props.geojson" -dissolve2 key copy-fields=pref,city,code -o "$WORK/cities.json" format=geojson

LABEL="-each 'lx=Math.round(this.innerX*1e4)/1e4, ly=Math.round(this.innerY*1e4)/1e4'"
for I in $HIGH_INTERVALS; do
  echo "== 市区町村（簡略化 ${I}m）"
  SIMP=""; [ "$I" != "0" ] && SIMP="-simplify interval=$I keep-shapes"
  eval $MS -i "$WORK/cities.json" $SIMP -clean -filter-fields pref,city,code $LABEL -rename-layers cities \
    -o format=topojson quantization=1000000 "$OUT/japan-high.json"
  echo "== 都道府県（簡略化 800m）"
  eval $MS -i "$WORK/cities.json" -dissolve2 pref $SIMP -simplify interval=800 keep-shapes -clean $LABEL -rename-layers prefs \
    -o format=topojson quantization=200000 "$OUT/japan-low.json"
  TOTAL=$(( $(stat -c %s "$OUT/japan-high.json") + $(stat -c %s "$OUT/japan-low.json") ))
  echo "合計 $TOTAL バイト（上限 $LIMIT）"
  if [ "$TOTAL" -le "$LIMIT" ]; then HIGH_INTERVAL=$I; break; fi
  HIGH_INTERVAL=""
done
[ -n "${HIGH_INTERVAL:-}" ] || { echo "簡略化しても ${LIMIT} バイトに収まりません" >&2; exit 1; }

echo "== 出典を書き込む"
node - "$OUT" "$DATASET" "$HIGH_INTERVAL" "$SOURCE" "$URL" <<'JS'
const fs = require('fs');
const [dir, dataset, interval, source, url] = process.argv.slice(2);
const attribution = '国土数値情報（行政区域データ）（国土交通省）を加工して作成';
for (const f of ['japan-low.json', 'japan-high.json']) {
  const p = `${dir}/${f}`;
  const t = JSON.parse(fs.readFileSync(p, 'utf8'));
  const o = Object.values(t.objects)[0];
  t.meta = { attribution, dataset, simplify: f === 'japan-low.json' ? '800m' : (interval === '0' ? 'なし（元の 1%）' : `${interval}m`), features: o.geometries.length };
  fs.writeFileSync(p, JSON.stringify(t));
}
fs.writeFileSync(`${dir}/LICENSE`, `日本の詳細地図（data/japan/）

${attribution}

出典: 国土交通省 国土数値情報ダウンロードサイト「行政区域データ（N03）」 https://nlftp.mlit.go.jp/ksj/
国土数値情報の利用約款に従い、出典を明記して加工・利用している。
使ったデータ: ${dataset}
${source === 'smri' ? `（国土交通省のサイトに接続できない環境で作成したため、スマートニュース メディア研究所「japan-topography」が N03 を加工して公開しているもの（${url}）を使った。GitHub Actions の「日本の詳細地図を作成」で国土交通省の最新の N03 から作り直せる）\n` : `取得元: ${url}\n`}
加工内容（scripts/build-japan-map.sh）:
- 属性を 都道府県名・市区町村名（政令指定都市は「市名 + 区名」）・行政区域コードに整理し、同じ市区町村の飛び地・島を 1 つにまとめた
- 境界を mapshaper で簡略化した（市区町村 ${interval === '0' ? '追加の簡略化なし' : `${interval}m`}・都道府県 800m）。境界・海岸線の位置は元のデータより粗い
- 名前を置く地点（ポリゴンの内側の点）を追加した
- TopoJSON に変換した（japan-low.json = 都道府県、japan-high.json = 市区町村）

この地図は行政区域の目安であり、境界の正確な位置を示すものではない。
`);
JS
ls -l "$OUT"
