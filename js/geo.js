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
 * 日付変更線をまたぐリングの経度を連続させる（例: 179 → -179 を 179 → 181 に）。
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
    if (g.type === 'Polygon') g.coordinates.forEach(fixRing);
    else if (g.type === 'MultiPolygon') g.coordinates.forEach((poly) => poly.forEach(fixRing));
  }
  return geojson;
}
