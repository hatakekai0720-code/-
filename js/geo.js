// 距離計算などの地理ユーティリティ（DOM 非依存）
const R = 6371.0088; // 地球の平均半径 km
const rad = (d) => d * Math.PI / 180;

/** Haversine 距離（km） */
export function haversine(lat1, lng1, lat2, lng2) {
  const dLat = rad(lat2 - lat1), dLng = rad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}

export function formatKm(km) {
  if (km == null) return '— km';
  if (km < 10) return `${km.toFixed(1)} km`;
  return `${Math.round(km).toLocaleString('en-US')} km`;
}

export function formatLatLng(lat, lng) {
  return `${Math.abs(lat).toFixed(4)}°${lat >= 0 ? 'N' : 'S'} ${Math.abs(lng).toFixed(4)}°${lng >= 0 ? 'E' : 'W'}`;
}

/**
 * 日付変更線をまたぐリング・線の経度を連続させる（例: 179 → -179 を 179 → 181 に）。
 * こうしないと Leaflet が地図の端から端まで横線を引いてしまう。GeoJSON をその場で書き換える。
 */
export function unwrapAntimeridian(geojson) {
  const fixRing = (ring) => {
    let offset = 0;
    for (let i = 1; i < ring.length; i++) {
      const d = ring[i][0] + offset - ring[i - 1][0];
      if (d > 180) offset -= 360; else if (d < -180) offset += 360;
      ring[i][0] += offset;
    }
  };
  for (const f of geojson.features || [geojson]) {
    const g = f.geometry;
    if (!g) continue;
    if (g.type === 'Polygon' || g.type === 'MultiLineString') g.coordinates.forEach(fixRing);
    else if (g.type === 'MultiPolygon') g.coordinates.forEach((poly) => poly.forEach(fixRing));
    else if (g.type === 'LineString') fixRing(g.coordinates);
  }
  return geojson;
}

/** 経度 lng を、center に一番近い 360° の倍数ずらした値にする（worldCopyJump で地図が横にずれていても正しい位置に置く） */
export function wrapLngNear(lng, center) {
  return lng + 360 * Math.round((center - lng) / 360);
}

/** 1 行のラベルのおおよその幅（px）。全角は 1em、半角は 0.6em で見積もる */
export function labelWidth(text, fontSize) {
  let w = 0;
  for (const ch of text) w += ch.charCodeAt(0) > 0xff ? fontSize : fontSize * 0.6;
  return w;
}

/**
 * 都市名ラベルの選択。表示ズーム以下の都市から、重要な順（minZoom → rank）に、
 * 画面内で重ならないものだけを選ぶ（DOM 非依存）。
 * @param {Array} places [lng, lat, name, nameEn, minZoom, rank] の配列（重要な順に並んでいること）
 * @param {(lat:number, lng:number) => {x:number, y:number}} project 画面座標への変換
 * @param {{zoom:number, width:number, height:number, centerLng:number, fontSize?:number, max?:number, pad?:number}} o
 */
export function pickLabels(places, project, o) {
  const fs = o.fontSize || 11, pad = o.pad ?? 4, max = o.max || 150;
  const boxes = [], out = [];
  for (const p of places) {
    if (p[4] > o.zoom) continue;
    const lng = wrapLngNear(p[0], o.centerLng);
    const { x, y } = project(p[1], lng);
    if (x < -50 || y < -20 || x > o.width + 50 || y > o.height + 20) continue;
    // ラベルは点の右側に置く
    const w = labelWidth(p[2], fs) + 8;
    const box = [x - 3 - pad, y - fs / 2 - pad, x + w + pad, y + fs / 2 + pad];
    if (boxes.some((b) => box[0] < b[2] && box[2] > b[0] && box[1] < b[3] && box[3] > b[1])) continue;
    boxes.push(box);
    out.push({ lat: p[1], lng, name: p[2], nameEn: p[3], rank: p[5] });
    if (out.length >= max) break;
  }
  return out;
}
