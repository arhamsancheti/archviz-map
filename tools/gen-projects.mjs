/**
 * Generates data/projects.json - the "client registry" the web app streams from.
 *
 * In production this file is what your CMS / admin panel would emit: a tiny
 * metadata document per client project (a few KB), plus a pointer to the heavy
 * geometry (.glb / 3D Tiles) that only gets fetched when the camera is close.
 *
 * Here we also emit a compact `plan` spec so the prototype can build a
 * believable master plan procedurally instead of shipping real client assets.
 *
 *   node tools/gen-projects.mjs
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

/* deterministic PRNG so regenerating never reshuffles a client's master plan */
function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}
const pick = (r, arr) => arr[Math.floor(r() * arr.length)];
const between = (r, a, b) => a + r() * (b - a);
const round = (n, p = 2) => Number(n.toFixed(p));

const AMENITY_POOL = [
  ['Grand Clubhouse', 'clubhouse', 'A 40,000 sq.ft. clubhouse with lounge, banquet and co-working floors.'],
  ['Olympic Pool', 'pool', 'Temperature-controlled 25m lap pool with a separate toddler pool and deck.'],
  ['Tennis Court', 'sport', 'Championship-surface court, floodlit for night play.'],
  ['Cricket Nets', 'sport', 'Two turf practice nets with a bowling machine bay.'],
  ['Central Green', 'park', 'A three-acre landscaped spine connecting every tower lobby.'],
  ['Kids Play Zone', 'kids', 'Soft-fall play equipment, splash pad and a shaded parents deck.'],
  ['Amphitheatre', 'event', 'Tiered seating for 300 with a stage for festivals and screenings.'],
  ['Jogging Loop', 'run', 'A 1.2 km rubberised loop with distance markers and hydration points.'],
  ['Yoga Deck', 'wellness', 'An elevated timber deck oriented east for sunrise sessions.'],
  ['Fitness Centre', 'gym', 'Fully equipped gym with a spinning studio and physio room.'],
  ['Pet Park', 'pet', 'Fenced off-leash run with agility features and a wash bay.'],
  ['Retail Boulevard', 'retail', 'Ground-level convenience retail, cafe and pharmacy.'],
];

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

/** Lays out towers on a jittered grid, keeping the middle band free for the podium. */
function buildPlan(p) {
  const r = rng(p.seed);
  const siteW = Math.round(Math.sqrt(p.acres * 4047) * between(r, 1.05, 1.35));
  const siteD = Math.round((p.acres * 4047) / siteW);
  const cols = Math.ceil(Math.sqrt(p.towers * 1.4));
  const rows = Math.ceil(p.towers / cols);
  const cellW = siteW / (cols + 0.6);
  const cellD = siteD / (rows + 0.6);

  const towers = [];
  for (let i = 0; i < p.towers; i++) {
    const c = i % cols;
    const rowIdx = Math.floor(i / cols);
    const floors = Math.round(between(r, p.floors[0], p.floors[1]));
    const slab = between(r, 3.1, 3.5);
    const w = round(between(r, 24, 38), 1);
    const d = round(between(r, 20, 30), 1);
    towers.push({
      id: 'T' + (i + 1),
      // metres, relative to the project's map pin; +x east, +z south
      x: round((c - (cols - 1) / 2) * cellW + between(r, -8, 8), 1),
      z: round((rowIdx - (rows - 1) / 2) * cellD + between(r, -8, 8), 1),
      w, d, floors,
      height: round(floors * slab + between(r, 4, 9), 1),
      rot: round(between(r, -0.22, 0.22), 3),
      style: pick(r, ['glass', 'glass', 'stone', 'mixed']),
      crown: r() > 0.45,
    });
  }

  const shuffled = [...AMENITY_POOL].sort(() => r() - 0.5).slice(0, 6 + Math.floor(r() * 3));
  const amenities = shuffled.map(([name, kind, blurb], i) => {
    const a = (i / shuffled.length) * Math.PI * 2 + r() * 0.4;
    const rad = between(r, 0.22, 0.42);
    return {
      name, kind, blurb,
      x: round(Math.cos(a) * siteW * rad, 1),
      z: round(Math.sin(a) * siteD * rad, 1),
    };
  });

  return {
    site: { w: siteW, d: siteD, rot: round(between(r, -0.4, 0.4), 3) },
    podium: {
      w: round(between(r, 60, 105), 1), d: round(between(r, 45, 80), 1),
      height: round(between(r, 9, 16), 1),
    },
    water: {
      w: round(between(r, 45, 80), 1), d: round(between(r, 16, 26), 1),
      x: round(between(r, -30, 30), 1), z: round(between(r, 25, 65), 1),
    },
    towers,
    amenities,
    // what the real pipeline would ship instead of `plan`
    asset: { format: 'glb', url: null, bytes: Math.round(between(r, 3.4, 11.8) * 1024 * 1024) },
  };
}

const out = PROJECTS.map((p) => ({
  id: p.id,
  name: p.name,
  developer: p.developer,
  city: p.city,
  locality: p.locality,
  location: { lng: p.lng, lat: p.lat },
  status: p.status,
  tagline: p.tagline,
  accent: p.accent,
  price: { from: p.priceFrom, currency: 'INR' },
  facts: {
    possession: p.possession,
    landArea: p.acres + ' acres',
    towers: p.towers,
    units: p.units,
    floors: 'G+' + p.floors[1],
    openSpace: p.openSpace,
    unitTypes: p.unitTypes,
    sizeRange: p.sizeRange,
    rera: p.rera,
  },
  // deep-link to the full Unreal experience we already sell
  immersive: { available: true, url: 'unreal://launch/' + p.id, pixelStream: null },
  plan: buildPlan(p),
}));

mkdirSync(join(root, 'data'), { recursive: true });
writeFileSync(
  join(root, 'data', 'projects.json'),
  JSON.stringify({ version: 1, generated: new Date().toISOString(), projects: out }, null, 2)
);
console.log(
  'wrote data/projects.json - ' + out.length + ' projects, ' +
  out.reduce((n, p) => n + p.plan.towers.length, 0) + ' towers'
);
