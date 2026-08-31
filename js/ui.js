/** All DOM rendering. app.js owns state and passes callbacks in. */
import { STATUS_TONE } from './config.js';
import { fmtCr, SORTS, SUGGESTIONS } from './filters.js';

const $ = (sel) => document.querySelector(sel);

const AMENITY_ICON = {
  clubhouse: '\u{1F3DB}', pool: '\u{1F3CA}', sport: '\u{1F3BE}', park: '\u{1F333}',
  kids: '\u{1F6DD}', event: '\u{1F3AD}', run: '\u{1F3C3}', wellness: '\u{1F9D8}',
  gym: '\u{1F3CB}', pet: '\u{1F415}', retail: '\u{1F6CD}',
};

const AMENITY_LABEL = {
  clubhouse: 'Clubhouse', pool: 'Pool', sport: 'Sports', park: 'Park',
  kids: 'Kids zone', event: 'Amphitheatre', run: 'Jogging loop', wellness: 'Wellness',
  gym: 'Gym', pet: 'Pet park', retail: 'Retail',
};

/** Inline glyphs for the location tab. Kept here so the panel needs no icon font. */
const PLACE_ICON = {
  metro: '<path d="M8 3h8a3 3 0 0 1 3 3v7a3 3 0 0 1-3 3H8a3 3 0 0 1-3-3V6a3 3 0 0 1 3-3z"/><path d="M5 9h14"/><path d="M8 20l-2 2M16 20l2 2"/>',
  road: '<path d="M8 3L5 21M16 3l3 18"/><path d="M12 4v3M12 11v3M12 18v3"/>',
  school: '<path d="M3 9l9-5 9 5-9 5z"/><path d="M7 11.5V16c0 1.4 2.2 2.5 5 2.5s5-1.1 5-2.5v-4.5"/>',
  health: '<path d="M12 5v14M5 12h14"/><rect x="3" y="3" width="18" height="18" rx="4"/>',
  retail: '<path d="M4 8h16l-1 12H5z"/><path d="M9 8V6a3 3 0 0 1 6 0v2"/>',
  airport: '<path d="M10 3.5a1.5 1.5 0 0 1 3 0V9l8 4.5v2L13 13v4.5l2.5 1.8v1.7L11.5 20 7.5 21v-1.7L10 17.5V13l-8 2.5v-2L10 9z"/>',
  work: '<rect x="3" y="7" width="18" height="13" rx="2"/><path d="M8 7V5.5A1.5 1.5 0 0 1 9.5 4h5A1.5 1.5 0 0 1 16 5.5V7"/><path d="M3 12h18"/>',
};

const CHECK = '<svg viewBox="0 0 24 24"><path d="M20 6L9 17l-5-5"/></svg>';
const CROSS = '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg>';
const CHEVRON = '<svg class="go" viewBox="0 0 24 24"><path d="M9 6l6 6-6 6"/></svg>';

/* ------------------------------------------------------------------ chips */

/** A skyline that actually reflects the project - the real tower heights, scaled. */
function skyline(plan, max = 7) {
  const towers = plan.towers.slice(0, max);
  const tallest = Math.max(...towers.map((t) => t.height));
  return towers
    .map((t) => {
      const rel = t.height / tallest;
      return `<i style="height:${Math.round(22 + rel * rel * 76)}%"></i>`;
    })
    .join('');
}

/* ------------------------------------------------------------------- list */

export function renderCards(projects, selectedId, handlers) {
  const host = $('#cards');
  host.textContent = '';

  if (!projects.length) {
    host.innerHTML = `
      <div class="empty">
        <svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/><path d="M8.5 11h5"/></svg>
        <h3>No projects match</h3>
        <p>Try a wider budget, or drop one of the filters above.</p>
        <button class="btn ghost wide" id="empty-clear">Clear all filters</button>
      </div>`;
    $('#empty-clear').onclick = handlers.onClearAll;
    return;
  }

  const frag = document.createDocumentFragment();
  for (const p of projects) {
    const card = document.createElement('button');
    card.className = 'card';
    card.dataset.id = p.id;
    card.setAttribute('aria-current', String(p.id === selectedId));
    card.innerHTML = `
      <span class="card-thumb" style="background:linear-gradient(160deg, ${shade(p.accent, 24)}, ${shade(p.accent, -44)})">${skyline(p.plan, 4)}</span>
      <span class="card-body">
        <span class="card-name">${esc(p.name)}</span>
        <span class="card-meta">${esc(p.developer)} &middot; ${esc(p.locality)}, ${esc(p.city)}</span>
        <span class="card-foot">
          <span class="card-price">${fmtCr(p.price.from)}</span>
          <span class="tag ${STATUS_TONE[p.status] || 'ok'}">${esc(p.status)}</span>
        </span>
        <span class="card-config">${esc(p.facts.unitTypes.join(' · '))} &middot; ${esc(p.facts.sizeRange)}</span>
      </span>`;
    card.onclick = () => handlers.onSelect(p.id);
    frag.appendChild(card);
  }
  host.appendChild(frag);
}

/**
 * Selection changes far more often than the list does, and rebuilding ten cards to
 * move one outline is wasted parse + layout. Flip the attribute instead.
 */
export function markSelectedCard(selectedId) {
  for (const card of document.querySelectorAll('#cards .card')) {
    card.setAttribute('aria-current', String(card.dataset.id === selectedId));
  }
}

export function renderCount(shown, total, cities) {
  $('#list-count').textContent = shown + (shown === 1 ? ' project' : ' projects');
  // the collapse handle carries the same count, so hiding the list hides no information
  $('#fab-count').textContent = shown;
  $('#btn-projects').classList.toggle('filtered', shown < total);
  $('#list-sub').textContent = !shown
    ? 'Nothing matches that search'
    : shown < total
      ? `Filtered from ${total} · ${cities} ${cities === 1 ? 'city' : 'cities'}`
      : `Across ${cities} ${cities === 1 ? 'city' : 'cities'}`;
}

export function renderSort(active, onPick) {
  const sel = $('#sort');
  if (!sel.options.length) {
    for (const s of SORTS) sel.add(new Option(s.label, s.id));
    sel.onchange = () => onPick(sel.value);
  }
  sel.value = active;
}

/* --------------------------------------------------- parsed / active chips */

/**
 * One rail for everything narrowing the list, whichever way it got there: phrases
 * the search box understood (accent) and switches set in the panel (neutral).
 * Removing either is the same gesture.
 */
export function renderTerms(terms, panelChips, handlers) {
  const host = $('#terms');
  host.textContent = '';
  const frag = document.createDocumentFragment();

  for (const t of terms) {
    frag.appendChild(chip(t.label, 'term', () => handlers.onRemoveTerm(t)));
  }
  for (const c of panelChips) {
    frag.appendChild(chip(c.label, 'term from-panel', () => handlers.onRemovePanel(c)));
  }
  if (terms.length + panelChips.length > 1) {
    const all = document.createElement('button');
    all.type = 'button';
    all.className = 'term clear-all';
    all.textContent = 'Clear all';
    all.onclick = handlers.onClearAll;
    frag.appendChild(all);
  }
  host.appendChild(frag);
}

function chip(label, className, onRemove) {
  const el = document.createElement('span');
  el.className = className;
  el.innerHTML = `<b>${esc(label)}</b>`;
  const x = document.createElement('button');
  x.type = 'button';
  x.setAttribute('aria-label', 'Remove ' + label);
  x.innerHTML = CROSS;
  x.onclick = onRemove;
  el.appendChild(x);
  return el;
}

/* -------------------------------------------------------------- suggestions */

export function renderSuggestions(query, terms, onPick) {
  const host = $('#suggest');
  if (query.trim()) {
    if (!terms.length) {
      host.hidden = true;
      return;
    }
    host.hidden = false;
    host.innerHTML =
      `<div class="suggest-label">Reading that as</div>` +
      terms
        .map(
          (t) => `<button type="button" disabled style="cursor:default">
            ${CHECK}<span>${esc(t.label)}</span></button>`
        )
        .join('');
    return;
  }
  host.hidden = false;
  host.innerHTML =
    `<div class="suggest-label">Ask for what you want</div>` +
    SUGGESTIONS.map(
      (s) => `<button type="button" data-q="${esc(s)}">
        <svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/></svg>
        <span>${esc(s)}</span></button>`
    ).join('');
  for (const b of host.querySelectorAll('button[data-q]')) {
    b.onmousedown = (e) => {
      e.preventDefault(); // keep focus so the box does not blur-close first
      onPick(b.dataset.q);
    };
  }
}

export const hideSuggestions = () => { $('#suggest').hidden = true; };

/* ------------------------------------------------------------ filter panel */

/** Discrete stops make the slider land on numbers a buyer would actually say. */
export const PRICE_STOPS = [
  0, 5000000, 7500000, 10000000, 12500000, 15000000, 20000000,
  25000000, 30000000, 40000000, 50000000, 65000000, 80000000, Infinity,
];
const SIZE_STOPS = [
  { label: 'Any', value: null }, { label: '1,000+', value: 1000 },
  { label: '1,500+', value: 1500 }, { label: '2,000+', value: 2000 },
  { label: '3,000+', value: 3000 },
];

export function renderFilterPanel(facets, filters, handlers) {
  const body = $('#filter-body');
  const loIdx = filters.priceMin == null ? 0 : nearestStop(filters.priceMin);
  const hiIdx = filters.priceMax == null ? PRICE_STOPS.length - 1 : nearestStop(filters.priceMax);

  const years = facets.possessionYears;
  const possessionOptions = [
    { label: 'Any', value: null },
    { label: 'Ready now', value: 0 },
    ...years.map((y) => ({ label: 'By ' + y, value: y })),
  ];

  body.innerHTML = `
    <div class="fgroup">
      <h3>Budget <span id="price-readout">${priceLabel(loIdx, hiIdx)}</span></h3>
      <div class="range" id="price-range">
        <div class="track"></div><div class="fill"></div>
        <input type="range" id="price-lo" min="0" max="${PRICE_STOPS.length - 1}" step="1" value="${loIdx}" aria-label="Minimum price" />
        <input type="range" id="price-hi" min="0" max="${PRICE_STOPS.length - 1}" step="1" value="${hiIdx}" aria-label="Maximum price" />
      </div>
    </div>

    ${group('Configuration', chipRow('unitTypes', facets.unitTypes, filters.unitTypes))}
    ${group('Status', chipRow('statuses', facets.statuses, filters.statuses))}
    ${group('Possession', radioRow('possessionBy', possessionOptions, filters.possessionBy))}
    ${group('Home size', radioRow('sizeMin', SIZE_STOPS, filters.sizeMin))}
    ${group('Amenities', chipRow('amenities', facets.amenities, filters.amenities, (k) =>
      `<em>${AMENITY_ICON[k] || '✦'}</em>${AMENITY_LABEL[k] || k}`))}
    ${group('City', chipRow('cities', facets.cities, filters.cities))}
    ${group('Developer', chipRow('developers', facets.developers, filters.developers))}
  `;

  for (const b of body.querySelectorAll('.chip[data-facet]')) {
    b.onclick = () => handlers.onToggle(b.dataset.facet, b.dataset.value);
  }
  for (const b of body.querySelectorAll('.chip[data-radio]')) {
    b.onclick = () => handlers.onSet(b.dataset.radio, b.dataset.value === '' ? null : Number(b.dataset.value));
  }

  const lo = $('#price-lo');
  const hi = $('#price-hi');
  const paint = () => {
    const a = Math.min(+lo.value, +hi.value);
    const b = Math.max(+lo.value, +hi.value);
    const max = PRICE_STOPS.length - 1;
    const range = $('#price-range');
    range.style.setProperty('--lo', (a / max) * 100 + '%');
    range.style.setProperty('--hi', (b / max) * 100 + '%');
    $('#price-readout').textContent = priceLabel(a, b);
  };
  const commit = () => {
    const a = Math.min(+lo.value, +hi.value);
    const b = Math.max(+lo.value, +hi.value);
    handlers.onPrice(
      a === 0 ? null : PRICE_STOPS[a],
      b === PRICE_STOPS.length - 1 ? null : PRICE_STOPS[b]
    );
  };
  lo.oninput = hi.oninput = paint;
  lo.onchange = hi.onchange = commit;
  paint();
}

const nearestStop = (value) => {
  let best = 0;
  for (let i = 0; i < PRICE_STOPS.length; i++) {
    if (Math.abs(PRICE_STOPS[i] - value) < Math.abs(PRICE_STOPS[best] - value)) best = i;
  }
  return best;
};

function priceLabel(lo, hi) {
  const max = PRICE_STOPS.length - 1;
  if (lo === 0 && hi === max) return 'Any';
  if (lo === 0) return 'Under ' + fmtCr(PRICE_STOPS[hi]);
  if (hi === max) return fmtCr(PRICE_STOPS[lo]) + ' and up';
  return fmtCr(PRICE_STOPS[lo]) + ' - ' + fmtCr(PRICE_STOPS[hi]);
}

const group = (title, inner) => `<div class="fgroup"><h3>${title}</h3><div class="chips">${inner}</div></div>`;

const chipRow = (facet, values, active, render) =>
  values
    .map(
      (v) => `<button class="chip" data-facet="${facet}" data-value="${esc(v)}"
        aria-pressed="${active.includes(v)}">${render ? render(v) : esc(v)}</button>`
    )
    .join('');

const radioRow = (key, options, active) =>
  options
    .map(
      (o) => `<button class="chip" data-radio="${key}" data-value="${o.value == null ? '' : o.value}"
        aria-pressed="${(o.value ?? null) === (active ?? null)}">${esc(o.label)}</button>`
    )
    .join('');

export function setFilterCount(n, shown) {
  const badge = $('#filter-badge');
  badge.hidden = !n;
  badge.textContent = n;
  $('#filter-apply').textContent = shown === 1 ? 'Show 1 project' : `Show ${shown} projects`;
}

/* ----------------------------------------------------------------- detail */

let activeTab = 'overview';
const TABS = [
  ['overview', 'Overview'],
  ['units', 'Units'],
  ['amenities', 'Amenities'],
  ['location', 'Location'],
];

export function openDetail(project, handlers) {
  activeTab = 'overview';
  const el = $('#detail');
  el.setAttribute('aria-hidden', 'false');
  el.classList.add('open');
  document.body.classList.add('detail-open');
  paintDetail(project, handlers);
}

export function closeDetail() {
  const el = $('#detail');
  el.classList.remove('open');
  el.setAttribute('aria-hidden', 'true');
  document.body.classList.remove('detail-open');
}

function paintDetail(p, handlers) {
  const f = p.facts;
  $('#detail').innerHTML = `
    <div class="hero">
      <div class="hero-sky" style="background:linear-gradient(168deg, ${shade(p.accent, 26)}, ${shade(p.accent, -58)})"></div>
      <div class="hero-city">${skyline(p.plan, 9)}</div>
      <span class="tag ${STATUS_TONE[p.status] || 'ok'} hero-badge">${esc(p.status)}</span>
      <button class="hero-close" id="detail-close" aria-label="Close">${CROSS}</button>
      <div class="hero-meta">
        <h1>${esc(p.name)}</h1>
        <p>${esc(p.developer)} &middot; ${esc(p.locality)}, ${esc(p.city)}</p>
      </div>
    </div>

    <div class="detail-body">
      <div class="pricebar">
        <div>
          <b>${fmtCr(p.price.from)} &ndash; ${fmtCr(p.price.to)}</b>
          <span>${esc(f.unitTypes.join(' · '))}</span>
        </div>
        <div class="rate">
          <b>₹${p.price.perSqft.toLocaleString('en-IN')}</b>
          <span>per sq.ft.</span>
        </div>
      </div>

      <div class="statstrip">
        <div><b>${f.acres}</b><span>acres</span></div>
        <div><b>${f.towers}</b><span>towers</span></div>
        <div><b>${(f.units / 1000 >= 1 ? (f.units / 1000).toFixed(1) + 'k' : f.units)}</b><span>homes</span></div>
        <div><b>${f.openSpacePct}%</b><span>open</span></div>
      </div>

      <div class="tabs" role="tablist">
        ${TABS.map(([id, label]) => `<button data-tab="${id}" role="tab">${label}</button>`).join('')}
      </div>
      <div id="tab-body"></div>
    </div>

    <div class="detail-foot">
      <button class="btn primary" id="btn-immersive">
        <svg viewBox="0 0 24 24"><path d="M4 7l8-4 8 4-8 4z"/><path d="M4 7v10l8 4 8-4V7"/></svg>
        Open immersive tour
      </button>
      <button class="btn ghost" id="btn-orbit-detail" title="Orbit this project" aria-label="Orbit this project">
        <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3.2"/><ellipse cx="12" cy="12" rx="9.5" ry="4.4" transform="rotate(-28 12 12)"/></svg>
      </button>
      <button class="btn ghost" id="btn-share" title="Copy link" aria-label="Copy link">
        <svg viewBox="0 0 24 24"><path d="M10 13a5 5 0 0 0 7 0l2-2a5 5 0 0 0-7-7l-1 1"/><path d="M14 11a5 5 0 0 0-7 0l-2 2a5 5 0 0 0 7 7l1-1"/></svg>
      </button>
    </div>`;

  $('#detail-close').onclick = handlers.onClose;
  $('#btn-immersive').onclick = () => handlers.onImmersive(p);
  $('#btn-share').onclick = () => handlers.onShare(p);
  $('#btn-orbit-detail').onclick = () => handlers.onOrbit(p);
  for (const b of document.querySelectorAll('.tabs button')) {
    b.onclick = () => {
      activeTab = b.dataset.tab;
      paintTabs(p, handlers);
    };
  }
  paintTabs(p, handlers);
}

function paintTabs(p, handlers) {
  for (const b of document.querySelectorAll('.tabs button')) {
    b.setAttribute('aria-selected', String(b.dataset.tab === activeTab));
  }
  const body = $('#tab-body');
  const f = p.facts;

  if (activeTab === 'overview') {
    body.innerHTML = `
      <p class="blurb">${esc(p.tagline)}</p>

      <ul class="highlights">
        ${f.highlights.map((h) => `<li>${CHECK}<span>${esc(h)}</span></li>`).join('')}
      </ul>

      <div class="section-label">Construction</div>
      <div class="progress">
        <div class="progress-head">
          <b>${f.progress}% complete</b>
          <span>${f.progress === 100 ? 'Handed over' : 'Possession ' + esc(f.possession)}</span>
        </div>
        <div class="bar"><i style="width:${f.progress}%;background:${p.accent}"></i></div>
      </div>

      <div class="section-label">The numbers</div>
      <div class="facts">
        ${fact('Land area', f.landArea)}
        ${fact('Configuration', f.towers + ' towers, ' + f.floors)}
        ${fact('Residences', f.units.toLocaleString('en-IN'))}
        ${fact('Open space', f.openSpace)}
        ${fact('Sizes', f.sizeRange)}
        ${fact('Possession', f.possession)}
      </div>

      <p class="rera">RERA ${esc(f.rera)}</p>`;
    return;
  }

  if (activeTab === 'units') {
    body.innerHTML = `
      <div class="units">
        ${f.unitMix
          .map((u) => {
            const soldPct = Math.round(((u.total - u.available) / u.total) * 100);
            return `<div class="unit">
              <div class="unit-top">
                <b>${esc(u.type)}</b>
                <span class="price">${fmtCr(u.priceFrom)} &ndash; ${fmtCr(u.priceTo)}</span>
              </div>
              <div class="unit-sub">
                <span>${u.sizeFrom.toLocaleString('en-IN')} &ndash; ${u.sizeTo.toLocaleString('en-IN')} sq.ft.</span>
                <span>${u.available} of ${u.total} left</span>
              </div>
              <div class="bar"><i style="width:${soldPct}%;background:${p.accent}"></i></div>
            </div>`;
          })
          .join('')}
      </div>
      <p class="rera">Prices are indicative, exclusive of registration and GST. ${f.units.toLocaleString('en-IN')} residences across ${f.towers} towers, ${esc(f.floors)}.</p>`;
    return;
  }

  if (activeTab === 'amenities') {
    body.innerHTML = `
      <p class="blurb">${p.plan.amenities.length} amenity zones across ${f.acres} acres. Pick one to fly the camera to it.</p>
      <div class="amenity-list">${p.plan.amenities
        .map(
          (a, i) => `<button class="amenity" data-i="${i}">
            <span class="ico" style="background:${hexA(p.accent, 0.16)}">${AMENITY_ICON[a.kind] || '✦'}</span>
            <span><b>${esc(a.name)}</b><small>${esc(a.blurb)}</small></span>
            ${CHEVRON}
          </button>`
        )
        .join('')}</div>`;
    for (const b of body.querySelectorAll('.amenity')) {
      b.onclick = () => handlers.onAmenity(p, p.plan.amenities[+b.dataset.i]);
    }
    return;
  }

  body.innerHTML = `
    <div class="section-label">What is around it</div>
    <div class="nearby">
      ${f.nearby
        .map(
          (n) => `<div class="near">
            <span class="ico"><svg viewBox="0 0 24 24">${PLACE_ICON[n.kind] || PLACE_ICON.road}</svg></span>
            <span><b>${esc(n.name)}</b><small>${esc(kindLabel(n.kind))}</small></span>
            <span class="dist">${n.km} km<small>${n.mins} min</small></span>
          </div>`
        )
        .join('')}
    </div>

    <div class="section-label">Specification</div>
    <div class="specs">
      ${f.specs.map((s) => `<div class="spec"><span>${esc(s.label)}</span><b>${esc(s.value)}</b></div>`).join('')}
    </div>`;
}

const kindLabel = (k) =>
  ({ metro: 'Transit', road: 'Arterial road', school: 'School', health: 'Hospital',
     retail: 'Shopping', airport: 'Airport', work: 'Workplace' }[k] || 'Nearby');

const fact = (label, value) => `<div class="fact"><span>${esc(label)}</span><b>${esc(String(value))}</b></div>`;

/* ------------------------------------------------------------------ misc */

let toastTimer = null;
export function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2600);
}

export const amenityIcon = (kind) => AMENITY_ICON[kind] || '✦';
export const amenityLabel = (kind) => AMENITY_LABEL[kind] || kind;

function esc(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

/** Lighten (+) or darken (-) a hex colour by a percentage. */
function shade(hex, pct) {
  const n = parseInt(hex.slice(1), 16);
  const amt = Math.round(2.55 * pct);
  const clamp = (v) => Math.max(0, Math.min(255, v));
  const r = clamp((n >> 16) + amt);
  const g = clamp(((n >> 8) & 0xff) + amt);
  const b = clamp((n & 0xff) + amt);
  return '#' + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1);
}

function hexA(hex, a) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${n >> 16}, ${(n >> 8) & 0xff}, ${n & 0xff}, ${a})`;
}
