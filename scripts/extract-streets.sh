#!/usr/bin/env bash
# ロケ地周辺の街路地図（OpenStreetMap / Protomaps basemap）を PMTiles で切り出し、data/streets/ に保存する。
# アプリの実行には不要（開発用）。ロケ地を増やしたら、このスクリプトを再実行するだけでよい。
#
#   data/locations.json の streets: true のロケ地（市街地）について、半径 RADIUS_KM（既定 1km）・
#   ズーム MINZOOM〜MAXZOOM（既定 10〜15。アプリは街路をズーム 10 以上でだけ表示する）の範囲を
#   Protomaps の daily build（https://build.protomaps.com/）から `pmtiles extract --bbox` で切り出し、
#   data/streets/<locationId>.pmtiles に保存する。最後に data/streets/index.json（ハッシュ・サイズ・範囲）を作り直す。
#   アプリはこの index.json の sha256 を見て、更新されたファイルだけを差し替える。
#   streets: false（自然の景勝地など）のロケ地は切り出さず、既存のファイルがあれば削除する。
#   合計サイズが LIMIT_MB（既定 500MB）を超えそうになったら、その時点で止まる（終了コード 2）。
#
# 必要なもの:
#   - pmtiles CLI（go-pmtiles）: https://github.com/protomaps/go-pmtiles/releases
#       または `go install github.com/protomaps/go-pmtiles@latest`（コマンド名は go-pmtiles）
#   - Node.js（JSON の読み書きとハッシュ計算に使う）
#   - curl
#
# 使い方:
#   bash scripts/extract-streets.sh            # まだ無いロケ地だけ切り出す（既存のファイルはそのまま）
#   bash scripts/extract-streets.sh --refresh  # すべて最新の build から切り出し直す
#   BUILD=20261115 bash scripts/extract-streets.sh   # build の日付を指定する
#   PMTILES=/path/to/pmtiles RADIUS_KM=1.5 LIMIT_MB=800 bash scripts/extract-streets.sh
set -euo pipefail
cd "$(dirname "$0")/.."

RADIUS_KM=${RADIUS_KM:-1}
MINZOOM=${MINZOOM:-10}
MAXZOOM=${MAXZOOM:-15}
LIMIT_MB=${LIMIT_MB:-500}
BASE_URL=${BASE_URL:-https://build.protomaps.com}
OUT=${OUT:-data/streets}
REFRESH=0
[[ "${1:-}" == "--refresh" ]] && REFRESH=1

# pmtiles CLI を探す
if [[ -z "${PMTILES:-}" ]]; then
  if command -v pmtiles >/dev/null; then PMTILES=pmtiles
  elif command -v go-pmtiles >/dev/null; then PMTILES=go-pmtiles
  elif [[ -x "$(go env GOPATH 2>/dev/null)/bin/go-pmtiles" ]]; then PMTILES="$(go env GOPATH)/bin/go-pmtiles"
  else echo "pmtiles CLI が見つかりません（go-pmtiles をインストールするか PMTILES=... で指定してください）" >&2; exit 1; fi
fi

# 使う daily build を決める（指定が無ければ、今日から 14 日前までで最初に見つかったもの）
if [[ -z "${BUILD:-}" ]]; then
  for i in $(seq 0 14); do
    d=$(date -u -d "-$i day" +%Y%m%d 2>/dev/null || date -u -v-"$i"d +%Y%m%d)
    if curl -fsSI "$BASE_URL/$d.pmtiles" >/dev/null 2>&1; then BUILD=$d; break; fi
  done
  [[ -n "${BUILD:-}" ]] || { echo "$BASE_URL に接続できないか、最近の build が見つかりません" >&2; exit 1; }
fi
SRC="$BASE_URL/$BUILD.pmtiles"
echo "build: $SRC（半径 ${RADIUS_KM}km、ズーム ${MINZOOM}〜${MAXZOOM}、上限 ${LIMIT_MB}MB）"
mkdir -p "$OUT"

# ロケ地ごとの bbox（min_lon,min_lat,max_lon,max_lat）を計算する
PLAN=$(node -e '
const { locations } = JSON.parse(require("fs").readFileSync("data/locations.json", "utf8"));
const r = Number(process.argv[1]);
for (const l of locations.filter((x) => x.streets === true)) {
  const dLat = r / 110.574, dLng = r / (111.320 * Math.cos(l.lat * Math.PI / 180));
  const f = (v) => v.toFixed(5);
  console.log(`${l.id} ${f(l.lng - dLng)},${f(l.lat - dLat)},${f(l.lng + dLng)},${f(l.lat + dLat)}`);
}' "$RADIUS_KM")

# 合計サイズ（バイト）
total_bytes() { local t=0 f; for f in "$OUT"/*.pmtiles; do [[ -e "$f" ]] && t=$((t + $(wc -c < "$f"))); done; echo "$t"; }
LIMIT_BYTES=$((LIMIT_MB * 1024 * 1024))
PLANNED=$(grep -c . <<< "$PLAN" || true)

# 切り出し（この実行で切り出したロケ地は EXTRACTED に記録し、index.json の build 日付を更新する）
EXTRACTED=""
STOPPED=""
N=0
while read -r id bbox; do
  [[ -n "$id" ]] || continue
  N=$((N + 1))
  file="$OUT/$id.pmtiles"
  if [[ $REFRESH -eq 0 && -s "$file" ]]; then echo "skip  $id（既存）"; continue; fi
  echo "extract $id  bbox=$bbox"
  tmp="$file.part"
  rm -f "$tmp"
  "$PMTILES" extract "$SRC" "$tmp" --bbox="$bbox" --minzoom="$MINZOOM" --maxzoom="$MAXZOOM" --quiet
  mv "$tmp" "$file"
  EXTRACTED="$EXTRACTED $id"
  # ここまでの平均サイズから、残りを全部切り出したときの合計を見積もる
  t=$(total_bytes); count=$(ls "$OUT"/*.pmtiles 2>/dev/null | wc -l)
  projected=$((t + t / (count > 0 ? count : 1) * (PLANNED - N)))
  if (( t > LIMIT_BYTES || projected > LIMIT_BYTES )); then
    STOPPED="現在 $((t / 1048576))MB、見込み $((projected / 1048576))MB（上限 ${LIMIT_MB}MB）"
    echo "上限を超えそうなので止めます: $STOPPED" >&2
    break
  fi
done <<< "$PLAN"

# locations.json から消えたロケ地のファイルを削除する
for f in "$OUT"/*.pmtiles; do
  [[ -e "$f" ]] || continue
  id=$(basename "$f" .pmtiles)
  grep -q "^$id " <<< "$PLAN" || { echo "remove $id（locations.json にない、または streets: false）"; rm -f "$f"; }
done

# index.json（アプリが差し替えの判定に使う）とサイズの報告
node -e '
const fs = require("fs"), crypto = require("crypto");
const [out, radius, maxzoom, plan, build, extracted] = process.argv.slice(1);
const builds = {};
try { for (const f of JSON.parse(fs.readFileSync(`${out}/index.json`, "utf8")).files) builds[f.id] = f.build; } catch {}
for (const id of extracted.split(" ").filter(Boolean)) builds[id] = build;
const files = [];
for (const line of plan.trim().split("\n")) {
  const [id, bbox] = line.split(" ");
  const p = `${out}/${id}.pmtiles`;
  if (!fs.existsSync(p)) continue;
  const buf = fs.readFileSync(p);
  files.push({ id, file: `${id}.pmtiles`, bytes: buf.length, sha256: crypto.createHash("sha256").update(buf).digest("hex"),
    bbox: bbox.split(",").map(Number), build: builds[id] || null });
}
const index = { version: 1, source: "Protomaps basemap (OpenStreetMap, ODbL)", radiusKm: Number(radius), maxzoom: Number(maxzoom), files };
fs.writeFileSync(`${out}/index.json`, JSON.stringify(index, null, 1) + "\n");
const mb = (b) => (b / 1048576).toFixed(2).padStart(7) + " MB";
let total = 0;
console.log("\nファイル                                         サイズ");
for (const f of files) { total += f.bytes; console.log(`${f.file.padEnd(48)} ${mb(f.bytes)}`); }
console.log(`合計 ${files.length} 件: ${(total / 1048576).toFixed(2)} MB`);
' "$OUT" "$RADIUS_KM" "$MAXZOOM" "$PLAN" "$BUILD" "$EXTRACTED"

if [[ -n "$STOPPED" ]]; then
  echo "合計サイズが上限を超えそうなため途中で止めました（$STOPPED）。半径（RADIUS_KM）や対象を見直してください。" >&2
  exit 2
fi
