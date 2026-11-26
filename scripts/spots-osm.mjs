// 撮影スポット: OpenStreetMap のタグの判定（scripts/fetch-spots.mjs と tests/spots.test.mjs から使う）
import { coreName } from '../js/spots.js';

/* ---- A. OSM のタグ → カテゴリ ---- */
export const NAMED = (t) => (t['name:ja'] || t.name || '').trim();
const OBSERVATORY_NAME = /展望台|展望塔|展望タワー|タワー|展望デッキ|展望室|展望館/;
const ONSEN_PLACE = /^(village|town|hamlet|suburb|quarter|neighbourhood|locality)$/;
export function classify(t) {
  const name = NAMED(t);
  const out = [];
  if (t.tourism === 'zoo') out.push('zoo');
  if (t.tourism === 'aquarium') out.push('aquarium');
  if ((t.leisure === 'garden' && t['garden:type'] === 'botanical') || (/植物園/.test(name) && (/^(garden|park)$/.test(t.leisure || '') || /^(attraction|museum)$/.test(t.tourism || '')))) out.push('botanical');
  if (t.man_made === 'lighthouse') out.push('lighthouse');
  if (t.historic === 'castle') out.push('castle');
  if (t.waterway === 'waterfall') out.push('waterfall');
  if (t.natural === 'beach') out.push('beach');
  // 温泉街: place=*（集落・地区）で名前が「〜温泉」「〜温泉郷」「〜温泉街」のもの
  if (ONSEN_PLACE.test(t.place || '') && /温泉(郷|街)?$/.test(name)) out.push('onsen');
  const tower = t.man_made === 'tower' && t['tower:type'] === 'observation';
  if (tower || (t.tourism === 'viewpoint' && OBSERVATORY_NAME.test(name))) out.push('observatory');
  else if (t.tourism === 'viewpoint') out.push('viewpoint');
  return out;
}
/** 入れないもの: 名前なし・私有地/立入禁止・廃墟・個人宅 */
export function excluded(t) {
  const name = NAMED(t);
  if (!name) return '名前なし';
  if (/^(private|no)$/.test(t.access || '')) return '立入禁止・私有地';
  if (t.disused === 'yes' || t.abandoned === 'yes' || Object.keys(t).some((k) => /^(abandoned|disused|ruins):/.test(k) && k !== 'ruins:castle')) return '廃止';
  if (/廃墟|廃屋|立入禁止|立ち入り禁止/.test(name + (t.description || ''))) return '廃墟・立入禁止';
  if (/^(house|residential|detached|apartments)$/.test(t.building || '')) return '個人宅';
  return null;
}
/** 候補の点数（高いほどよい）: 名前の一致 > カテゴリに合うタグ > 近さ */
export function scoreCandidate(entry, category, el, km) {
  const t = el.tags || {};
  const name = NAMED(t);
  let s = 0;
  if (entry.match.some((m) => coreName(m) === coreName(name)) || coreName(entry.name) === coreName(name)) s += 100;
  else if (entry.match.some((m) => coreName(name).includes(coreName(m)))) s += 50;
  else return -1;
  if (category === 'shrine' && (t.amenity === 'place_of_worship' || t.religion)) s += 30;
  if (category === 'townscape' && (t.historic || t.place || t.tourism || t.heritage)) s += 20;
  if (category === 'tanada' && (t.landuse === 'farmland' || t.tourism || t.natural)) s += 20;
  if (el.type !== 'node') s += 5; // 面（way/relation）は範囲の中心が取れる
  return s - km * 5;
}
