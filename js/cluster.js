// 地図のピンのクラスタ計算（DOM 非依存。tests/map.test.mjs でテスト）
// ・ズームごとに「ワールドピクセル座標」でまとめるので、パン（移動）では計算し直さなくてよい
// ・ロケ地とマイピンは呼び出し側で別々にクラスタ化する

export const CLUSTER_RADIUS = 44;           // この距離（px）以内のピンを 1 つにまとめる
export const CLUSTER_TIERS = [10, 50];      // 件数が 10 未満 / 50 未満 / それ以上 で円の大きさを 3 段階に
export const CLUSTER_SIZES = [30, 38, 48];  // 各段階の直径（px）

/** 件数 → 大きさの段階（0〜2） */
export function sizeTier(count) {
  let i = 0;
  while (i < CLUSTER_TIERS.length && count >= CLUSTER_TIERS[i]) i++;
  return i;
}

/**
 * 貪欲法のクラスタリング。先頭のピンから順に、半径 radius 以内の未割り当てのピンを吸収する。
 * 格子（セル = radius）で近傍だけを調べるので、件数が増えてもほぼ線形。
 * @param {Array<{lat:number,lng:number}>} points
 * @param {(lat:number, lng:number) => {x:number, y:number}} project ワールドピクセル座標への変換
 * @returns {Array<{members:object[], count:number, lat:number, lng:number, bounds:[number,number,number,number], x:number, y:number}>}
 *   bounds は [南, 西, 北, 東]
 */
export function clusterPoints(points, project, radius = CLUSTER_RADIUS) {
  const pts = points.map((p) => ({ p, ...project(p.lat, p.lng) }));
  const grid = new Map();
  const key = (cx, cy) => `${cx},${cy}`;
  pts.forEach((q, i) => {
    const k = key(Math.floor(q.x / radius), Math.floor(q.y / radius));
    if (!grid.has(k)) grid.set(k, []);
    grid.get(k).push(i);
  });
  const used = new Uint8Array(pts.length);
  const r2 = radius * radius;
  const out = [];
  for (let i = 0; i < pts.length; i++) {
    if (used[i]) continue;
    const c = pts[i];
    const idx = [i];
    used[i] = 1;
    const cx = Math.floor(c.x / radius), cy = Math.floor(c.y / radius);
    for (let gx = cx - 1; gx <= cx + 1; gx++) {
      for (let gy = cy - 1; gy <= cy + 1; gy++) {
        for (const j of grid.get(key(gx, gy)) || []) {
          if (used[j]) continue;
          const dx = pts[j].x - c.x, dy = pts[j].y - c.y;
          if (dx * dx + dy * dy <= r2) { used[j] = 1; idx.push(j); }
        }
      }
    }
    const members = idx.map((j) => pts[j].p);
    let s = Infinity, w = Infinity, n = -Infinity, e = -Infinity, sx = 0, sy = 0, slat = 0, slng = 0;
    for (const j of idx) {
      const { p, x, y } = pts[j];
      s = Math.min(s, p.lat); n = Math.max(n, p.lat); w = Math.min(w, p.lng); e = Math.max(e, p.lng);
      sx += x; sy += y; slat += p.lat; slng += p.lng;
    }
    out.push({ members, count: members.length, lat: slat / idx.length, lng: slng / idx.length, bounds: [s, w, n, e], x: sx / idx.length, y: sy / idx.length });
  }
  return out;
}

/** クラスタのピン同士の最大距離（px）。最大ズームでもこれが radius 以下なら、ズームでは分けられない */
export function maxSpread(members, project) {
  let d = 0;
  const pts = members.map((m) => project(m.lat, m.lng));
  for (let i = 0; i < pts.length; i++) {
    for (let j = i + 1; j < pts.length; j++) d = Math.max(d, Math.hypot(pts[i].x - pts[j].x, pts[i].y - pts[j].y));
  }
  return d;
}

/**
 * 放射状に展開したときの各ピンの位置（中心からのオフセット px）。
 * 8 件までは円周上に、それより多いときはらせん状に並べる（重ならない）。
 */
export function spiderOffsets(count, spacing = 26) {
  if (count <= 0) return [];
  if (count === 1) return [{ x: 0, y: -spacing * 1.2 }];
  if (count <= 8) {
    const r = Math.max(spacing * 1.2, (spacing * count) / (2 * Math.PI));
    return Array.from({ length: count }, (_, i) => {
      const a = -Math.PI / 2 + (2 * Math.PI * i) / count;
      return { x: r * Math.cos(a), y: r * Math.sin(a) };
    });
  }
  // らせん（アルキメデス）: 隣り合う点の弧長がほぼ spacing になるよう角度を進める
  const out = [];
  let a = 0, r = spacing * 1.2;
  for (let i = 0; i < count; i++) {
    out.push({ x: r * Math.cos(a - Math.PI / 2), y: r * Math.sin(a - Math.PI / 2) });
    a += spacing / r;
    r = spacing * 1.2 + (spacing / (2 * Math.PI)) * a * 1.1;
  }
  return out;
}

/* ---- 地域・国の絞り込み ---- */

export const REGION_LABELS = {
  asia: 'アジア', 'middle-east': '中東', europe: 'ヨーロッパ', 'north-america': '北米',
  'latin-america': '中南米', africa: 'アフリカ', oceania: 'オセアニア',
};

/** 地域ごと・国ごとの件数（件数の多い順）。country の一覧は region で絞った中から数える */
export function facetCounts(locations, region = 'all') {
  const regions = new Map(), countries = new Map();
  for (const l of locations) {
    regions.set(l.region, (regions.get(l.region) || 0) + 1);
    if (region === 'all' || l.region === region) countries.set(l.country, (countries.get(l.country) || 0) + 1);
  }
  const order = Object.keys(REGION_LABELS);
  return {
    total: locations.length,
    regions: [...regions].sort((a, b) => order.indexOf(a[0]) - order.indexOf(b[0])).map(([id, count]) => ({ id, label: REGION_LABELS[id] || id, count })),
    countries: [...countries].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'ja')).map(([id, count]) => ({ id, count })),
  };
}

export function filterLocations(locations, { region = 'all', country = 'all' } = {}) {
  return locations.filter((l) => (region === 'all' || l.region === region) && (country === 'all' || l.country === country));
}
