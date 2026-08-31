/**
 * Generates data/projects.json - the seeded demo registry.
 *
 * In production this file is what your CMS / admin panel would emit, and now
 * literally does: the admin API in `serve.mjs` writes the same file through the same
 * `makeProject` in `tools/registry-lib.mjs`. This script is the seeded ten we ship
 * so the map has something in it out of the box.
 *
 *   node tools/gen-projects.mjs
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeProject } from './registry-lib.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

const PROJECTS = [
  {
    id: 'lakeside-habitat', name: 'Lakeside Habitat', developer: 'Prestige Group',
    city: 'Bengaluru', locality: 'Varthur', lng: 77.7343, lat: 12.9364, seed: 1011,
    status: 'Ready to Move', priceFrom: 21500000, possession: 'Handed over',
    acres: 102, towers: 9, floors: [18, 24], units: 3100, openSpace: '80%',
    unitTypes: ['2 BHK', '3 BHK', '4 BHK'], sizeRange: '1,285 - 3,410 sq.ft.',
    rera: 'PRM/KA/RERA/1251/446/PR/171015/000534', accent: '#4FA3FF',
    tagline: 'A lakefront township wrapped around 27 acres of open water.',
  },
  {
    id: 'cornerstone-utopia', name: 'Cornerstone Utopia', developer: 'Brigade Group',
    city: 'Bengaluru', locality: 'Varthur Road', lng: 77.7212, lat: 12.9448, seed: 2027,
    status: 'Under Construction', priceFrom: 9800000, possession: 'Dec 2027',
    acres: 47, towers: 7, floors: [22, 31], units: 2400, openSpace: '75%',
    unitTypes: ['1 BHK', '2 BHK', '3 BHK'], sizeRange: '705 - 1,960 sq.ft.',
    rera: 'PRM/KA/RERA/1251/446/PR/210330/003926', accent: '#7C5CFF',
    tagline: 'Forty amenity zones stacked across a seven-tower urban campus.',
  },
  {
    id: 'dream-acres', name: 'Dream Acres', developer: 'Sobha Limited',
    city: 'Bengaluru', locality: 'Panathur', lng: 77.6981, lat: 12.9285, seed: 3141,
    status: 'Ready to Move', priceFrom: 8200000, possession: 'Handed over',
    acres: 81, towers: 8, floors: [14, 19], units: 2900, openSpace: '82%',
    unitTypes: ['1 BHK', '2 BHK', '3 BHK'], sizeRange: '645 - 1,510 sq.ft.',
    rera: 'PRM/KA/RERA/1251/446/PR/171014/000321', accent: '#2FBF9A',
    tagline: 'Low-rise living around a five-acre forest court.',
  },
  {
    id: 'amara-heights', name: 'Amara Heights', developer: 'Lodha Group',
    city: 'Mumbai', locality: 'Thane West', lng: 72.9781, lat: 19.2183, seed: 4222,
    status: 'Under Construction', priceFrom: 13400000, possession: 'Jun 2028',
    acres: 38, towers: 6, floors: [32, 44], units: 2100, openSpace: '70%',
    unitTypes: ['2 BHK', '3 BHK'], sizeRange: '890 - 1,740 sq.ft.',
    rera: 'P51700018261', accent: '#FF8A4C',
    tagline: 'Forty-four storeys looking straight down the Yeoor hills.',
  },
  {
    id: 'sunrise-bay', name: 'Sunrise Bay', developer: 'Kalpataru',
    city: 'Navi Mumbai', locality: 'Ulwe', lng: 73.0212, lat: 18.9903, seed: 5309,
    status: 'New Launch', priceFrom: 11200000, possession: 'Mar 2029',
    acres: 24, towers: 5, floors: [28, 36], units: 1450, openSpace: '68%',
    unitTypes: ['2 BHK', '3 BHK', '4 BHK'], sizeRange: '960 - 2,480 sq.ft.',
    rera: 'P52000047812', accent: '#FFC24B',
    tagline: 'Ten minutes from the new airport, facing the creek.',
  },
  {
    id: 'riverine-park', name: 'Riverine Park', developer: 'Godrej Properties',
    city: 'Pune', locality: 'Kharadi', lng: 73.9470, lat: 18.5515, seed: 6180,
    status: 'Under Construction', priceFrom: 10400000, possession: 'Sep 2027',
    acres: 33, towers: 6, floors: [24, 30], units: 1780, openSpace: '73%',
    unitTypes: ['2 BHK', '3 BHK'], sizeRange: '820 - 1,690 sq.ft.',
    rera: 'P52100051204', accent: '#5AD1E8',
    tagline: 'A riverside address with a 1.4 km promenade frontage.',
  },
  {
    id: 'bhooja-one', name: 'Bhooja One', developer: 'My Home Constructions',
    city: 'Hyderabad', locality: 'Gachibowli', lng: 78.3487, lat: 17.4239, seed: 7011,
    status: 'Ready to Move', priceFrom: 18600000, possession: 'Handed over',
    acres: 29, towers: 4, floors: [36, 42], units: 1120, openSpace: '65%',
    unitTypes: ['3 BHK', '4 BHK'], sizeRange: '2,120 - 4,050 sq.ft.',
    rera: 'P02400002381', accent: '#C77DFF',
    tagline: 'Four glass towers over the financial district skyline.',
  },
  {
    id: 'camellia-court', name: 'Camellia Court', developer: 'DLF',
    city: 'Gurugram', locality: 'Golf Course Road', lng: 77.1011, lat: 28.4426, seed: 8123,
    status: 'Ready to Move', priceFrom: 78000000, possession: 'Handed over',
    acres: 20, towers: 5, floors: [30, 38], units: 429, openSpace: '78%',
    unitTypes: ['4 BHK', '5 BHK', 'Penthouse'], sizeRange: '7,300 - 16,300 sq.ft.',
    rera: 'GGM/2018/324', accent: '#E8C97D',
    tagline: 'Four hundred residences on twenty acres of the Aravalli edge.',
  },
  {
    id: 'digi-quarter', name: 'Digi Quarter', developer: 'Emaar India',
    city: 'Gurugram', locality: 'Sector 62', lng: 77.0900, lat: 28.4088, seed: 9317,
    status: 'Under Construction', priceFrom: 24500000, possession: 'Dec 2026',
    acres: 12, towers: 3, floors: [26, 32], units: 460, openSpace: '62%',
    unitTypes: ['Office Suite', 'Retail'], sizeRange: '1,050 - 8,900 sq.ft.',
    rera: 'GGM/385/117/2019/62', accent: '#8FE388',
    tagline: 'A digital-first workplace block with column-free floor plates.',
  },
  {
    id: 'shantigram-vista', name: 'Shantigram Vista', developer: 'Adani Realty',
    city: 'Ahmedabad', locality: 'S.G. Highway', lng: 72.5205, lat: 23.1104, seed: 10441,
    status: 'New Launch', priceFrom: 7600000, possession: 'Jun 2029',
    acres: 64, towers: 8, floors: [12, 17], units: 2200, openSpace: '85%',
    unitTypes: ['2 BHK', '3 BHK', 'Villa'], sizeRange: '1,100 - 3,900 sq.ft.',
    rera: 'PR/GJ/AHMEDABAD/AUDA/RAA08812', accent: '#FF6B8A',
    tagline: 'The newest low-rise precinct of a six-hundred-acre township.',
  },
];

const out = PROJECTS.map(makeProject);

mkdirSync(join(root, 'data'), { recursive: true });
writeFileSync(
  join(root, 'data', 'projects.json'),
  JSON.stringify({ version: 1, generated: new Date().toISOString(), projects: out }, null, 2)
);
console.log(
  'wrote data/projects.json - ' + out.length + ' projects, ' +
  out.reduce((n, p) => n + p.plan.towers.length, 0) + ' towers'
);
