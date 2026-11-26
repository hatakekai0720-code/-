// scripts/build-japan-map.sh から使う: N03 の GeoJSON の属性を、アプリで使う属性（key・pref・city・code）に置き換える。
// 使い方: node scripts/japan-props.mjs <入力.geojson> <出力.geojson>
import { readFileSync, writeFileSync } from 'node:fs';
import { n03Props } from '../js/japan.js';

const [src, dst] = process.argv.slice(2);
const gj = JSON.parse(readFileSync(src, 'utf8'));
let n = 0;
gj.features = gj.features.filter((f) => f.geometry).map((f) => { n++; return { type: 'Feature', properties: n03Props(f.properties), geometry: f.geometry }; });
const prefs = new Set(gj.features.map((f) => f.properties.pref));
if (prefs.size !== 47) throw new Error(`都道府県が ${prefs.size} 件です（47 件のはず）`);
writeFileSync(dst, JSON.stringify(gj));
console.log(`${n} 地物・${new Set(gj.features.map((f) => f.properties.key)).size} 市区町村（所属未定地を含む）`);
