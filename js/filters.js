/**
 * Search, filtering and sorting for the project registry.
 *
 * Two ways in, and they compose:
 *
 *  - The **filter panel** writes a plain object (`blankFilters()`): arrays of chosen
 *    cities, configurations, statuses, amenity kinds, plus a price band.
 *  - The **search box** is parsed into the same shape by `parseQuery`, so
 *    "3 bhk under 1.5 cr in pune with a pool" is exactly equivalent to ticking four
 *    boxes. Every phrase it recognises comes back with the span it matched, which is
 *    what lets the UI show it as a chip you can remove.
 *
 * Where both name the same facet the parsed value wins - typing "in pune" is a
 * deliberate act and should override a stale chip.
 */

/* ------------------------------------------------------------------- shape */

export const blankFilters = () => ({
  cities: [],
  developers: [],
  statuses: [],
  unitTypes: [],
  amenities: [],
  priceMin: null,
  priceMax: null,
  sizeMin: null,
  possessionBy: null,
  text: '',
});

/** Everything the panel needs to draw itself, derived from the registry. */
export function buildFacets(projects) {
  const uniq = (list) => [...new Set(list)].sort();
  const prices = projects.map((p) => p.price.from);
  return {
    cities: uniq(projects.map((p) => p.city)),
    developers: uniq(projects.map((p) => p.developer)),
    statuses: ['Ready to Move', 'Under Construction', 'New Launch'].filter((s) =>
      projects.some((p) => p.status === s)
    ),
    unitTypes: uniq(projects.flatMap((p) => p.facts.unitTypes)).sort(unitTypeOrder),
    amenities: uniq(projects.flatMap((p) => p.plan.amenities.map((a) => a.kind))),
    priceFloor: Math.min(...prices),
    priceCeil: Math.max(...prices),
    possessionYears: uniq(projects.map((p) => p.facts.possessionYear).filter(Boolean)),
    names: projects.map((p) => (p.name + ' ' + p.locality).toLowerCase()),
  };
}

/** 1 BHK ... 5 BHK first, then the named types. */
function unitTypeOrder(a, b) {
  const n = (t) => (/^(\d)\s*BHK$/i.test(t) ? Number(t[0]) : 90 + t.charCodeAt(0) / 255);
  return n(a) - n(b);
}

export const activeCount = (f) =>
  f.cities.length + f.developers.length + f.statuses.length + f.unitTypes.length +
  f.amenities.length +
  (f.priceMin != null ? 1 : 0) + (f.priceMax != null ? 1 : 0) +
  (f.sizeMin != null ? 1 : 0) + (f.possessionBy != null ? 1 : 0);

/** Panel filters underneath, parsed ones on top, facet by facet. */
export function mergeFilters(panel, parsed) {
  const out = { ...panel };
  for (const key of ['cities', 'developers', 'statuses', 'unitTypes', 'amenities']) {
    if (parsed[key].length) out[key] = parsed[key];
  }
  for (const key of ['priceMin', 'priceMax', 'sizeMin', 'possessionBy']) {
    if (parsed[key] != null) out[key] = parsed[key];
  }
  out.text = parsed.text;
  return out;
}

/* ---------------------------------------------------------------- matching */

const has = (list, value) => !list.length || list.includes(value);

export function matches(p, f) {
  if (!has(f.cities, p.city)) return false;
  if (!has(f.developers, p.developer)) return false;
  if (!has(f.statuses, p.status)) return false;
  if (f.unitTypes.length && !f.unitTypes.some((t) => p.facts.unitTypes.includes(t))) return false;
  if (f.amenities.length) {
    const kinds = new Set(p.plan.amenities.map((a) => a.kind));
    if (!f.amenities.every((k) => kinds.has(k))) return false;
  }
  // A project qualifies on price if any configuration lands inside the band.
  if (f.priceMin != null && p.price.to < f.priceMin) return false;
  if (f.priceMax != null && p.price.from > f.priceMax) return false;
  if (f.sizeMin != null && p.facts.sizeTo < f.sizeMin) return false;
  if (f.possessionBy != null && p.facts.possessionYear > f.possessionBy) return false;
  if (f.text) {
    const hay = (
      p.name + ' ' + p.developer + ' ' + p.city + ' ' + p.locality + ' ' +
      p.status + ' ' + p.tagline
    ).toLowerCase();
    if (!f.text.split(/\s+/).every((w) => hay.includes(w))) return false;
  }
  return true;
}

/* ----------------------------------------------------------------- sorting */

export const SORTS = [
  { id: 'featured', label: 'Featured' },
  { id: 'price-asc', label: 'Price: low to high' },
  { id: 'price-desc', label: 'Price: high to low' },
  { id: 'possession', label: 'Possession: soonest' },
  { id: 'size-desc', label: 'Largest homes' },
  { id: 'acres-desc', label: 'Largest site' },
  { id: 'name', label: 'Name A-Z' },
];

const SORT_FN = {
  featured: null,
  'price-asc': (a, b) => a.price.from - b.price.from,
  'price-desc': (a, b) => b.price.from - a.price.from,
  possession: (a, b) => a.facts.possessionKey.localeCompare(b.facts.possessionKey),
  'size-desc': (a, b) => b.facts.sizeTo - a.facts.sizeTo,
  'acres-desc': (a, b) => b.facts.acres - a.facts.acres,
  name: (a, b) => a.name.localeCompare(b.name),
};

export function apply(projects, f, sort) {
  const out = projects.filter((p) => matches(p, f));
  const fn = SORT_FN[sort];
  if (fn) out.sort(fn);
  return out;
}

/* ------------------------------------------------------- the search parser */

const CITY_ALIAS = {
  bangalore: 'Bengaluru', bengaluru: 'Bengaluru', blr: 'Bengaluru',
  bombay: 'Mumbai', mumbai: 'Mumbai',
  'navi mumbai': 'Navi Mumbai',
  gurgaon: 'Gurugram', gurugram: 'Gurugram', ggn: 'Gurugram',
  hyderabad: 'Hyderabad', hyd: 'Hyderabad',
  pune: 'Pune', puna: 'Pune',
  ahmedabad: 'Ahmedabad', amdavad: 'Ahmedabad',
};

const DEV_ALIAS = {
  prestige: 'Prestige Group', brigade: 'Brigade Group', sobha: 'Sobha Limited',
  lodha: 'Lodha Group', kalpataru: 'Kalpataru', godrej: 'Godrej Properties',
  'my home': 'My Home Constructions', dlf: 'DLF', emaar: 'Emaar India',
  adani: 'Adani Realty',
};

const STATUS_ALIAS = [
  [/\bready[\s-]?to[\s-]?move(?:[\s-]?in)?\b/, 'Ready to Move'],
  [/\bmove[\s-]?in ready\b/, 'Ready to Move'],
  [/\bready\b/, 'Ready to Move'],
  [/\bpossession ready\b/, 'Ready to Move'],
  [/\bunder[\s-]?construction\b/, 'Under Construction'],
  [/\bongoing\b/, 'Under Construction'],
  [/\bnew[\s-]?launch(?:es)?\b/, 'New Launch'],
  [/\bpre[\s-]?launch\b/, 'New Launch'],
  [/\bnewly launched\b/, 'New Launch'],
];

const AMENITY_ALIAS = [
  [/\b(swimming\s+)?pools?\b/, 'pool', 'Pool'],
  [/\b(gym|gymnasium|fitness)\b/, 'gym', 'Gym'],
  [/\bclub\s?house\b|\bclub\b/, 'clubhouse', 'Clubhouse'],
  [/\b(tennis|cricket|badminton|squash|sports?|court)\b/, 'sport', 'Sports'],
  [/\b(park|garden|green|lawn)s?\b/, 'park', 'Park'],
  [/\b(kids?|children'?s?|play\s?area|playground)\b/, 'kids', 'Kids zone'],
  [/\b(jog(ging)?|running|run|track)\b/, 'run', 'Jogging loop'],
  [/\b(yoga|wellness|spa|meditation)\b/, 'wellness', 'Wellness'],
  [/\b(pet|dog)s?\s?(park|friendly|run)?\b/, 'pet', 'Pet park'],
  [/\b(retail|shops?|shopping|store)\b/, 'retail', 'Retail'],
  [/\b(amphitheatre|amphitheater|events?)\b/, 'event', 'Amphitheatre'],
];

const SORT_ALIAS = [
  [/\b(cheapest|most affordable|affordable|budget|lowest price)\b/, 'price-asc', 'Cheapest first'],
  [/\b(luxury|luxurious|premium|most expensive|priciest)\b/, 'price-desc', 'Premium first'],
  [/\b(biggest|largest homes?|spacious)\b/, 'size-desc', 'Largest homes'],
  [/\b(soonest|earliest possession|quickest possession)\b/, 'possession', 'Possession soonest'],
];

const UNIT_ALIAS = [
  [/\bpent\s?house(s)?\b/, 'Penthouse'],
  [/\bvillas?\b/, 'Villa'],
  [/\b(office|office suite|workspace|commercial)s?\b/, 'Office Suite'],
  [/\bstudios?\b/, '1 BHK'],
];

/** "1.5 cr" / "90 lakh" / "75 l" / "8500000" -> rupees. */
function toRupees(numText, unit) {
  const n = Number(String(numText).replace(/,/g, ''));
  if (!Number.isFinite(n)) return null;
  const u = (unit || '').toLowerCase();
  if (/^(cr|crore|crores)$/.test(u)) return Math.round(n * 10000000);
  if (/^(l|lac|lakh|lakhs|lacs)$/.test(u)) return Math.round(n * 100000);
  if (/^k$/.test(u)) return Math.round(n * 1000);
  // No unit: a bare number small enough to be a price in crores usually is one.
  if (n <= 100) return Math.round(n * 10000000);
  if (n <= 10000) return Math.round(n * 100000);
  return Math.round(n);
}

const NUM = String.raw`(\d+(?:[.,]\d+)?)\s*(cr|crores?|l|lacs?|lakhs?|k)?`;
const UNDER = new RegExp(String.raw`\b(?:under|below|less than|cheaper than|up ?to|upto|max(?:imum)?|within|budget of)\s*(?:₹|rs\.?|inr)?\s*` + NUM, 'i');
const OVER = new RegExp(String.raw`\b(?:above|over|more than|at least|min(?:imum)?|starting (?:at|from)|from)\s*(?:₹|rs\.?|inr)?\s*` + NUM, 'i');
const BAND = new RegExp(String.raw`\b(?:between\s*)?(?:₹|rs\.?|inr)?\s*` + NUM + String.raw`\s*(?:-|–|to|and)\s*(?:₹|rs\.?|inr)?\s*` + NUM, 'i');
const BARE = new RegExp(String.raw`(?:₹|rs\.?|inr)\s*` + NUM, 'i');
const SIZE = /\b(?:above|over|at least|min(?:imum)?)?\s*(\d{3,5})\s*(?:\+\s*)?(?:sq\.?\s?ft|sqft|sft|square feet)\b/i;
const BHK = /\b([1-5])\s*(?:bhk|bed|bedrooms?|br)\b/gi;
const YEAR = /\b(?:by|before|possession(?:\s+(?:in|by))?|handover(?:\s+by)?)\s*(20\d{2})\b/i;

/**
 * Turn a sentence into filters. Every recognised phrase is returned with the span
 * it consumed, so the UI can render it as a removable chip and splice it back out
 * of the raw text. Anything left over becomes free text.
 */
export function parseQuery(raw, facets) {
  const filters = blankFilters();
  const terms = [];
  let sort = null;
  const text = raw || '';
  const lower = text.toLowerCase();
  const taken = new Array(text.length).fill(false);

  const claim = (start, end) => {
    for (let i = start; i < end; i++) taken[i] = true;
  };
  const free = (start, end) => {
    for (let i = start; i < end; i++) if (taken[i]) return false;
    return true;
  };
  const add = (start, end, label, kind) => {
    if (start < 0 || !free(start, end)) return false;
    claim(start, end);
    terms.push({ label, kind, span: [start, end] });
    return true;
  };
  const findAt = (re) => {
    const m = lower.match(re);
    return m ? { m, start: m.index, end: m.index + m[0].length } : null;
  };

  // Someone typing a project's own name means that project, not the words in it -
  // "Riverine Park" is not a request for projects with a park. Whole-query only, so
  // "Riverine Park 3 bhk" still parses normally.
  const needle = lower.trim();
  if (needle.length > 2 && facets && facets.names.some((n) => n.includes(needle))) {
    filters.text = needle;
    return { filters, terms, sort };
  }

  // --- configuration
  for (const m of text.matchAll(BHK)) {
    const type = m[1] + ' BHK';
    if (!add(m.index, m.index + m[0].length, type, 'unit')) continue;
    if (!filters.unitTypes.includes(type)) filters.unitTypes.push(type);
  }
  for (const [re, type] of UNIT_ALIAS) {
    const hit = findAt(re);
    if (hit && add(hit.start, hit.end, type, 'unit') && !filters.unitTypes.includes(type)) {
      filters.unitTypes.push(type);
    }
  }

  // --- size floor
  const size = findAt(SIZE);
  if (size) {
    const sqft = Number(size.m[1]);
    if (sqft >= 200 && add(size.start, size.end, sqft.toLocaleString('en-IN') + '+ sq.ft.', 'size')) {
      filters.sizeMin = sqft;
    }
  }

  // --- possession
  const year = findAt(YEAR);
  if (year && add(year.start, year.end, 'By ' + year.m[1], 'possession')) {
    filters.possessionBy = Number(year.m[1]);
  }

  // --- price. Bands first: "1 - 2 cr" must not be eaten by a bare number.
  const band = findAt(BAND);
  if (band && free(band.start, band.end)) {
    const unitless = !band.m[2] && !band.m[4] && !/₹|rs|inr/i.test(band.m[0]);
    const lo = unitless ? null : toRupees(band.m[1], band.m[2] || band.m[4]);
    const hi = toRupees(band.m[3], band.m[4]);
    if (lo != null && hi != null && hi > lo) {
      filters.priceMin = lo;
      filters.priceMax = hi;
      add(band.start, band.end, fmtCr(lo) + ' - ' + fmtCr(hi), 'price');
    }
  }
  for (const [re, key, verb] of [[UNDER, 'priceMax', 'Under '], [OVER, 'priceMin', 'Over ']]) {
    const hit = findAt(re);
    if (!hit) continue;
    const value = toRupees(hit.m[1], hit.m[2]);
    if (value == null) continue;
    if (add(hit.start, hit.end, verb + fmtCr(value), 'price')) filters[key] = value;
  }
  if (filters.priceMax == null && filters.priceMin == null) {
    const hit = findAt(BARE);
    if (hit) {
      const value = toRupees(hit.m[1], hit.m[2]);
      if (value != null && add(hit.start, hit.end, 'Under ' + fmtCr(value), 'price')) {
        filters.priceMax = value;
      }
    }
  }

  // --- status, city, developer, amenities, sort intent
  for (const [re, status] of STATUS_ALIAS) {
    const hit = findAt(re);
    if (hit && add(hit.start, hit.end, status, 'status') && !filters.statuses.includes(status)) {
      filters.statuses.push(status);
    }
  }
  for (const [alias, city] of Object.entries(CITY_ALIAS)) {
    if (facets && !facets.cities.includes(city)) continue;
    const hit = findAt(new RegExp('\\b' + alias + '\\b', 'i'));
    if (hit && add(hit.start, hit.end, city, 'city') && !filters.cities.includes(city)) {
      filters.cities.push(city);
    }
  }
  for (const [alias, dev] of Object.entries(DEV_ALIAS)) {
    if (facets && !facets.developers.includes(dev)) continue;
    const hit = findAt(new RegExp('\\b' + alias + '\\b', 'i'));
    if (hit && add(hit.start, hit.end, dev, 'developer') && !filters.developers.includes(dev)) {
      filters.developers.push(dev);
    }
  }
  for (const [re, kind, label] of AMENITY_ALIAS) {
    const hit = findAt(re);
    if (hit && add(hit.start, hit.end, label, 'amenity') && !filters.amenities.includes(kind)) {
      filters.amenities.push(kind);
    }
  }
  for (const [re, id, label] of SORT_ALIAS) {
    const hit = findAt(re);
    if (hit && add(hit.start, hit.end, label, 'sort')) sort = sort || id;
  }

  // --- whatever is left is a plain text match, minus the connecting words
  const STOP = new Set(['in', 'with', 'a', 'an', 'the', 'and', 'or', 'of', 'for', 'near', 'at', 'to', 'me', 'show', 'find', 'homes', 'home', 'flats', 'flat', 'apartments', 'apartment', 'projects', 'project', 'property', 'properties', 'that', 'has', 'have', 'want', 'looking', 'i', 'my']);
  let leftover = '';
  for (let i = 0; i < text.length; i++) leftover += taken[i] ? ' ' : text[i];
  filters.text = leftover
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 1 && !STOP.has(w))
    .join(' ');

  terms.sort((a, b) => a.span[0] - b.span[0]);
  return { filters, terms, sort };
}

/**
 * Drop one parsed phrase back out of the raw search string. The connector that
 * introduced it goes too, so removing "Pune" from "3 bhk in pune" does not leave a
 * dangling "in".
 */
export function removeTerm(raw, term) {
  const [s, e] = term.span;
  const head = raw.slice(0, s).replace(/\b(?:in|with|at|near|and|of|for|a|an|the)\s*$/i, '');
  return (head + ' ' + raw.slice(e)).replace(/\s{2,}/g, ' ').trim();
}

/* -------------------------------------------------------------- formatting */

export function fmtCr(n) {
  if (n >= 10000000) return '₹' + trim(n / 10000000) + ' Cr';
  if (n >= 100000) return '₹' + trim(n / 100000) + ' L';
  return '₹' + Math.round(n).toLocaleString('en-IN');
}
const trim = (n) => String(Number(n.toFixed(2)));

/** A handful of ready-made questions, shown when the search box is empty. */
export const SUGGESTIONS = [
  '3 BHK under 1.5 Cr',
  'ready to move in Bengaluru',
  'new launch with a pool',
  'Gurugram above 2 Cr',
  'possession by 2027',
  'cheapest 2 BHK with a gym',
];
