/** All DOM rendering. app.js owns state and passes callbacks in. */
import { fmtPrice, fmtMB, STATUS_TONE } from './config.js';

const $ = (sel) => document.querySelector(sel);

const AMENITY_ICON = {
  clubhouse: '\u{1F3DB}', pool: '\u{1F3CA}', sport: '\u{1F3BE}', park: '\u{1F333}',
  kids: '\u{1F6DD}', event: '\u{1F3AD}', run: '\u{1F3C3}', wellness: '\u{1F9D8}',
  gym: '\u{1F3CB}', pet: '\u{1F415}', retail: '\u{1F6CD}',
};

/* ------------------------------------------------------------------- list */

export function renderFilters(cities, active, onPick) {
  const host = $('#filters');
  host.innerHTML = '';
  for (const city of ['All cities', ...cities]) {
    const b = document.createElement('button');
    b.className = 'chip';
    b.textContent = city;
    b.setAttribute('aria-pressed', String(city === active));
    b.onclick = () => onPick(city);
    host.appendChild(b);
  }
  wireHorizontalScroll(host);
  const selected = host.querySelector('[aria-pressed="true"]');
  if (selected) selected.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' });
}

/**
 * A one-line chip rail only scrolls horizontally, and a mouse wheel only reports
 * vertical delta - so without this the row looks stuck. Also supports drag, and
 * fades whichever edge has more content behind it.
 */
function wireHorizontalScroll(el) {
  const edges = () => {
    const max = el.scrollWidth - el.clientWidth;
    el.classList.toggle('more-left', el.scrollLeft > 2);
    el.classList.toggle('more-right', max > 2 && el.scrollLeft < max - 2);
  };
  requestAnimationFrame(edges);

  if (el.dataset.scrollWired) return;
  el.dataset.scrollWired = '1';

  el.addEventListener('scroll', edges, { passive: true });
  window.addEventListener('resize', edges);

  el.addEventListener(
    'wheel',
    (e) => {
      const max = el.scrollWidth - el.clientWidth;
      if (max <= 0 || Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return;
      el.scrollLeft += e.deltaY;
      e.preventDefault();
    },
    { passive: false }
  );

  let dragging = false;
  let startX = 0;
  let startLeft = 0;
  let travelled = 0;

  el.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'touch') return; // native touch scrolling is better
    dragging = true;
    startX = e.clientX;
    startLeft = el.scrollLeft;
    travelled = 0;
  });
  el.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    const dx = e.clientX - startX;
    travelled = Math.max(travelled, Math.abs(dx));
    if (travelled > 4) {
      el.scrollLeft = startLeft - dx;
      el.classList.add('dragging');
    }
  });
  const stop = () => {
    dragging = false;
    el.classList.remove('dragging');
  };
  el.addEventListener('pointerup', stop);
  el.addEventListener('pointercancel', stop);
  el.addEventListener('pointerleave', stop);
  // a drag that ends on a chip must not also select that city
  el.addEventListener(
    'click',
    (e) => {
      if (travelled > 6) {
        e.preventDefault();
        e.stopPropagation();
        travelled = 0;
      }
    },
    true
  );
}

export function renderCards(projects, selectedId, onSelect, onHover) {
  const host = $('#cards');
  host.innerHTML = '';
  for (const p of projects) {
    const card = document.createElement('button');
    card.className = 'card';
    card.setAttribute('aria-current', String(p.id === selectedId));
    card.innerHTML = `
      <span class="card-thumb" style="background:linear-gradient(150deg, ${p.accent}, ${shade(p.accent, -40)})"></span>
      <span>
        <span class="card-name">${esc(p.name)}</span>
        <span class="card-meta">${esc(p.developer)} &middot; ${esc(p.locality)}, ${esc(p.city)}</span>
        <span class="card-foot">
          <span class="price">${fmtPrice(p.price.from)}</span>
          <span class="tag ${STATUS_TONE[p.status] || 'ok'}">${esc(p.status)}</span>
        </span>
      </span>`;
    card.onclick = () => onSelect(p.id);
    card.onmouseenter = () => onHover && onHover(p.id);
    host.appendChild(card);
  }
  $('#list-count').textContent = projects.length + (projects.length === 1 ? ' project' : ' projects');
  const cities = new Set(projects.map((p) => p.city));
  $('#list-count').nextElementSibling.textContent =
    projects.length ? `Across ${cities.size} ${cities.size === 1 ? 'city' : 'cities'}` : 'Nothing matches that search';
}

/* ----------------------------------------------------------------- detail */

let activeTab = 'overview';

export function openDetail(project, handlers) {
  activeTab = 'overview';
  const el = $('#detail');
  el.setAttribute('aria-hidden', 'false');
  el.classList.add('open');
  paintDetail(project, handlers);
}

export function closeDetail() {
  const el = $('#detail');
  el.classList.remove('open');
  el.setAttribute('aria-hidden', 'true');
}

function paintDetail(p, handlers) {
  const f = p.facts;
  const skyline = p.plan.towers
    .map((t) => `<i style="height:${Math.min(96, 26 + t.height * 0.9)}%"></i>`)
    .join('');

  $('#detail').innerHTML = `
    <div class="hero">
      <div class="hero-sky" style="background:linear-gradient(165deg, ${shade(p.accent, 18)}, ${shade(p.accent, -55)})"></div>
      <div class="hero-city">${skyline}</div>
      <button class="hero-close" id="detail-close" aria-label="Close"><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg></button>
    </div>
    <div class="detail-body">
      <h1>${esc(p.name)}</h1>
      <p class="dev">${esc(p.developer)} &middot; ${esc(p.locality)}, ${esc(p.city)}</p>
      <div class="headline">
        <b>${fmtPrice(p.price.from)}</b><span>onwards</span>
        <span class="tag ${STATUS_TONE[p.status] || 'ok'}" style="margin-left:auto">${esc(p.status)}</span>
      </div>
      <div class="tabs" role="tablist">
        <button data-tab="overview" role="tab">Overview</button>
        <button data-tab="amenities" role="tab">Amenities</button>
        <button data-tab="units" role="tab">Units</button>
      </div>
      <div id="tab-body"></div>
    </div>
    <div class="detail-foot">
      <button class="btn primary" id="btn-immersive">
        <svg viewBox="0 0 24 24"><path d="M4 7l8-4 8 4-8 4z"/><path d="M4 7v10l8 4 8-4V7"/></svg>
        Open immersive tour
      </button>
      <button class="btn ghost" id="btn-share" title="Copy link"><svg viewBox="0 0 24 24"><path d="M10 13a5 5 0 0 0 7 0l2-2a5 5 0 0 0-7-7l-1 1"/><path d="M14 11a5 5 0 0 0-7 0l-2 2a5 5 0 0 0 7 7l1-1"/></svg></button>
    </div>`;

  $('#detail-close').onclick = handlers.onClose;
  $('#btn-immersive').onclick = () => handlers.onImmersive(p);
  $('#btn-share').onclick = () => handlers.onShare(p);
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
      <div class="facts">
        ${fact('Land area', f.landArea)}
        ${fact('Towers', f.towers + ' towers, ' + f.floors)}
        ${fact('Residences', f.units.toLocaleString('en-IN'))}
        ${fact('Open space', f.openSpace)}
        ${fact('Sizes', f.sizeRange)}
        ${fact('Possession', f.possession)}
      </div>
      <p class="rera">RERA ${esc(f.rera)}</p>`;
    return;
  }

  if (activeTab === 'amenities') {
    body.innerHTML = `<div class="amenity-list">${p.plan.amenities
      .map(
        (a, i) => `<button class="amenity" data-i="${i}">
          <span class="ico" style="background:${hexA(p.accent, 0.16)}">${AMENITY_ICON[a.kind] || '✦'}</span>
          <span><b>${esc(a.name)}</b><small>${esc(a.blurb)}</small></span>
        </button>`
      )
      .join('')}</div>`;
    for (const b of body.querySelectorAll('.amenity')) {
      b.onclick = () => handlers.onAmenity(p, p.plan.amenities[+b.dataset.i]);
    }
    return;
  }

  body.innerHTML = `<div class="units">${f.unitTypes
    .map(
      (t) => `<div class="unit-row"><b>${esc(t)}</b><span>${esc(f.sizeRange)}</span></div>`
    )
    .join('')}
    <div class="unit-row"><b>Total residences</b><span>${f.units.toLocaleString('en-IN')}</span></div>
    <div class="unit-row"><b>Configuration</b><span>${f.towers} towers &middot; ${esc(f.floors)}</span></div>
  </div>`;
}

const fact = (label, value) => `<div class="fact"><span>${esc(label)}</span><b>${esc(String(value))}</b></div>`;

/* -------------------------------------------------------------------- hud */

export function updateHud(s) {
  $('#hud-visible').textContent = `${s.visible} / ${s.total}`;
  $('#hud-resident').textContent = s.resident;
  $('#hud-queued').textContent = s.queued;
  $('#hud-bytes').textContent = fmtMB(s.bytes);
  $('#hud-tier').textContent = s.tier === 'model' && s.level ? s.tier + ' / ' + s.level : s.tier;
  $('#hud .dot').classList.toggle('busy', s.queued > 0);
  for (const rung of document.querySelectorAll('.rung')) {
    rung.classList.toggle('active', rung.dataset.tier === s.tier);
  }
}

/* ------------------------------------------------------------------ misc */

let toastTimer = null;
export function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2600);
}

export function setTheme(theme) {
  document.documentElement.dataset.theme = theme;
}

export const amenityIcon = (kind) => AMENITY_ICON[kind] || '✦';

function esc(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

/** Lighten (+) or darken (-) a hex colour by a percentage. */
export function shade(hex, pct) {
  const n = parseInt(hex.slice(1), 16);
  const amt = Math.round(2.55 * pct);
  const clamp = (v) => Math.max(0, Math.min(255, v));
  const r = clamp((n >> 16) + amt);
  const g = clamp(((n >> 8) & 0xff) + amt);
  const b = clamp((n & 0xff) + amt);
  return '#' + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1);
}

export function hexA(hex, a) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${n >> 16}, ${(n >> 8) & 0xff}, ${n & 0xff}, ${a})`;
}
