/**
 * Everything that turns a handful of typed-in facts into a registry entry.
 *
 * Shared on purpose: `tools/gen-projects.mjs` builds the seeded demo registry with
 * it, and the admin API (`serve.mjs`) builds a real one with it when someone adds a
 * project through the browser. One code path, so a project created either way is
 * the same shape, and the master plan for a given seed is reproducible.
 */

/* deterministic PRNG so regenerating never reshuffles a client's master plan */
export function rng(seed) {
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

/**
 * Landmarks a buyer actually asks about, per city. Distances are generated from the
 * seed rather than measured - this is registry copy, not a routing engine.
 */
const NEARBY = {
  Bengaluru: [
    ['Whitefield Tech Park', 'work'], ['Outer Ring Road', 'road'],
    ['Greenwood High School', 'school'], ['Manipal Hospital', 'health'],
    ['Phoenix Marketcity', 'retail'], ['Kempegowda Airport', 'airport'],
    ['Whitefield Metro', 'metro'],
  ],
  Mumbai: [
    ['Thane Station', 'metro'], ['Eastern Express Highway', 'road'],
    ['Hiranandani Hospital', 'health'], ['Viviana Mall', 'retail'],
    ['Singhania School', 'school'], ['Airoli Knowledge Park', 'work'],
  ],
  'Navi Mumbai': [
    ['Navi Mumbai Airport', 'airport'], ['Ulwe Coastal Road', 'road'],
    ['Belapur CBD', 'work'], ['Apollo Hospital', 'health'],
    ['Ryan International', 'school'], ['Seawoods Grand Central', 'retail'],
  ],
  Pune: [
    ['EON IT Park', 'work'], ['Pune Airport', 'airport'],
    ['Columbia Asia Hospital', 'health'], ['Phoenix Mall of the Millennium', 'retail'],
    ['Kharadi Metro', 'metro'], ['The Orchid School', 'school'],
  ],
  Hyderabad: [
    ['HITEC City', 'work'], ['Outer Ring Road', 'road'],
    ['Continental Hospital', 'health'], ['Inorbit Mall', 'retail'],
    ['Oakridge International', 'school'], ['Rajiv Gandhi Airport', 'airport'],
  ],
  Gurugram: [
    ['Cyber City', 'work'], ['Golf Course Road', 'road'],
    ['Medanta Medicity', 'health'], ['DLF Cyber Hub', 'retail'],
    ['Sector 55-56 Metro', 'metro'], ['The Shri Ram School', 'school'],
    ['IGI Airport', 'airport'],
  ],
  Ahmedabad: [
    ['S.G. Highway', 'road'], ['Zydus Hospital', 'health'],
    ['Ahmedabad Airport', 'airport'], ['Palladium Mall', 'retail'],
    ['Udgam School', 'school'], ['GIFT City', 'work'],
  ],
};

const SPEC_POOL = [
  ['Structure', [
    'RCC framed, seismic zone III compliant',
    'Post-tensioned slabs on an RCC frame',
    'Shear-wall RCC structure, wind-tunnel tested',
  ]],
  ['Flooring', [
    'Imported marble in living, engineered wood in bedrooms',
    'Large-format vitrified tile throughout',
    'Italian marble in living, laminate wood in bedrooms',
  ]],
  ['Kitchen', [
    'Modular units, quartz counter, hob and chimney',
    'Granite counter with a designer backsplash',
    'Modular island kitchen with built-in appliances',
  ]],
  ['Security', [
    'Three-tier access control with video door phone',
    'Boom barriers, CCTV and a 24x7 command centre',
    'Face-recognition lobby entry and perimeter CCTV',
  ]],
  ['Parking', [
    'Two basement levels, one bay per residence',
    'Stacked mechanical parking, two bays per residence',
    'Podium parking with EV charging on every level',
  ]],
  ['Power and water', [
    '100% DG backup, STP and rainwater harvesting',
    'Full DG backup with a solar-assisted common area',
    'DG backup for common areas, dual-plumbed recycled water',
  ]],
  ['Lifts', [
    'High-speed passenger lifts with auto rescue',
    'Four lifts per core including a service lift',
    'Destination-control lifts, two service cars per tower',
  ]],
];

const HIGHLIGHT_POOL = [
  'Vaastu-compliant layouts in every configuration',
  'Corner residences with three-side ventilation',
  'Double-height lobbies in every tower',
  'Full-height glazing in the living rooms',
  'Landscaped by an international design studio',
  'Zero-waste-to-landfill operations',
  'IGBC Gold pre-certified',
  'A deck or balcony with every bedroom',
];

const parseSizes = (text) => {
  const m = text.replace(/,/g, '').match(/(\d+)\s*-\s*(\d+)/);
  return m ? [Number(m[1]), Number(m[2])] : [800, 1600];
};

const MONTHS = { Jan: 1, Feb: 2, Mar: 3, Apr: 4, May: 5, Jun: 6, Jul: 7, Aug: 8, Sep: 9, Oct: 10, Nov: 11, Dec: 12 };

/** Sortable possession key. Handed over sorts first. */
function possessionKey(text) {
  const m = text.match(/([A-Z][a-z]{2})\s+(\d{4})/);
  if (!m) return { key: '0000-00', year: 0 };
  return { key: m[2] + '-' + String(MONTHS[m[1]] || 12).padStart(2, '0'), year: Number(m[2]) };
}

const lakhRound = (n) => Math.round(n / 100000) * 100000;

/**
 * Everything the detail panel and the filters read that is not master-plan geometry.
 * Runs on its own PRNG stream so `buildPlan` below stays byte-identical.
 */
export function buildFacts(p) {
  const r = rng(p.seed + 7717);
  const [sizeFrom, sizeTo] = parseSizes(p.sizeRange);
  const perSqft = Math.round(p.priceFrom / sizeFrom / 50) * 50;

  const types = p.unitTypes;
  const unitMix = types.map((type, i) => {
    const a = Math.round(sizeFrom + ((sizeTo - sizeFrom) * i) / types.length);
    const b = Math.round(sizeFrom + ((sizeTo - sizeFrom) * (i + 1)) / types.length);
    const total = Math.max(12, Math.round((p.units / types.length) * between(r, 0.78, 1.22)));
    const sold = p.status === 'Ready to Move' ? between(r, 0.86, 0.98) : between(r, 0.3, 0.8);
    return {
      type,
      sizeFrom: a,
      sizeTo: b,
      priceFrom: lakhRound(a * perSqft),
      priceTo: lakhRound(b * perSqft),
      total,
      available: Math.max(1, Math.round(total * (1 - sold))),
    };
  });

  const nearby = [...(NEARBY[p.city] || [])]
    .sort(() => r() - 0.5)
    .slice(0, 5)
    .map(([name, kind]) => {
      const far = kind === 'airport';
      const km = round(between(r, far ? 14 : 0.6, far ? 46 : 9), 1);
      return { name, kind, km, mins: Math.max(2, Math.round(km * between(r, 1.8, 3.1))) };
    })
    .sort((a, b) => a.km - b.km);

  const specs = SPEC_POOL.map(([label, options]) => ({ label, value: pick(r, options) }));
  const highlights = [...HIGHLIGHT_POOL].sort(() => r() - 0.5).slice(0, 3);

  const progress =
    p.status === 'Ready to Move' ? 100
    : p.status === 'New Launch' ? Math.round(between(r, 4, 18))
    : Math.round(between(r, 34, 86));

  const { key, year } = possessionKey(p.possession);

  return {
    possession: p.possession,
    possessionKey: key,
    possessionYear: year,
    landArea: p.acres + ' acres',
    acres: p.acres,
    towers: p.towers,
    units: p.units,
    floors: 'G+' + p.floors[1],
    floorsMax: p.floors[1],
    openSpace: p.openSpace,
    openSpacePct: Number(String(p.openSpace).replace('%', '')),
    unitTypes: p.unitTypes,
    sizeRange: p.sizeRange,
    sizeFrom,
    sizeTo,
    rera: p.rera,
    progress,
    unitMix,
    nearby,
    specs,
    highlights,
  };
}

/** Lays out towers on a jittered grid, keeping the middle band free for the podium. */
export function buildPlan(p) {
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

/**
 * One registry entry from the fields an admin actually types.
 *
 * `seed` is what makes the generated master plan stable: pass the same seed and you
 * get the same towers back, so re-saving a project never reshuffles its site.
 */
export function makeProject(input) {
  const p = {
    seed: Number(input.seed) || hashSeed(input.id || input.name || 'project'),
    ...input,
    floors: Array.isArray(input.floors) ? input.floors.map(Number) : [Number(input.floorsMin) || 8, Number(input.floorsMax) || 20],
    acres: Number(input.acres) || 10,
    towers: Number(input.towers) || 4,
    units: Number(input.units) || 200,
    priceFrom: Number(input.priceFrom) || 5000000,
    unitTypes: input.unitTypes && input.unitTypes.length ? input.unitTypes : ['2 BHK', '3 BHK'],
    openSpace: String(input.openSpace || '70%').replace(/[^0-9]/g, '') + '%',
    sizeRange: input.sizeRange || '800 - 1,600 sq.ft.',
    possession: input.possession || 'Dec 2027',
    status: input.status || 'Under Construction',
    accent: input.accent || '#4FA3FF',
    tagline: input.tagline || '',
    rera: input.rera || 'Not registered',
  };

  const facts = buildFacts(p);
  const plan = buildPlan(p);
  const last = facts.unitMix[facts.unitMix.length - 1];
  return {
    id: p.id,
    name: p.name,
    developer: p.developer,
    city: p.city,
    locality: p.locality,
    location: { lng: Number(p.lng), lat: Number(p.lat) },
    status: p.status,
    tagline: p.tagline,
    accent: p.accent,
    price: {
      from: p.priceFrom,
      to: last.priceTo,
      perSqft: Math.round(p.priceFrom / facts.sizeFrom / 50) * 50,
      currency: 'INR',
    },
    facts,
    immersive: { available: true, url: input.immersiveUrl || 'unreal://launch/' + p.id, pixelStream: null },
    // buildPlan invents a plausible asset size for the streaming demo; a real upload
    // replaces the whole block.
    plan: { ...plan, asset: input.asset || plan.asset },
    images: input.images || [],
    seed: p.seed,
  };
}

/** A stable 32-bit seed from a project id, so the same id always plans the same. */
export function hashSeed(text) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) % 100000;
}

/** "Lakeside Habitat" -> "lakeside-habitat", unique against `taken`. */
export function slugify(name, taken = []) {
  const base = String(name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'project';
  let id = base;
  let n = 2;
  while (taken.includes(id)) id = base + '-' + n++;
  return id;
}
