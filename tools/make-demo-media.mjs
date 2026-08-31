/**
 * Placeholder photography for the demo registry.
 *
 *   node tools/make-demo-media.mjs            # every project that has none
 *   node tools/make-demo-media.mjs --force    # replace what is there
 *   node tools/make-demo-media.mjs --id lakeside-habitat
 *
 * These are drawn, not photographed: flat-vector architectural scenes rendered from
 * each project's OWN master plan - the real tower positions, heights and footprints,
 * tinted with its accent colour - so the gallery in the detail panel has something
 * honest in it before any real renders exist. The site plan in particular is a true
 * drawing of `plan`, not decoration.
 *
 * They go through the same `storeImage` the admin upload uses, so a generated photo
 * and an uploaded one are the same two files with the same record.
 *
 * Delete them the moment real images arrive: `node tools/make-demo-media.mjs --clear`.
 */
import { readFile, writeFile, rename, rm } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { storeImage } from './media.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const REGISTRY = join(root, 'data', 'projects.json');
const MEDIA_DIR = join(root, 'media');

const W = 1600;
const H = 1000;

/* ------------------------------------------------------------------ helpers */

function rng(seed) {
  let s = seed >>> 0 || 1;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}
const between = (r, a, b) => a + r() * (b - a);

function shade(hex, pct) {
  const n = parseInt(hex.slice(1), 16);
  const amt = Math.round(2.55 * pct);
  const c = (v) => Math.max(0, Math.min(255, v));
  return '#' + ((1 << 24) + (c((n >> 16) + amt) << 16) + (c(((n >> 8) & 0xff) + amt) << 8) + c((n & 0xff) + amt))
    .toString(16).slice(1);
}
const mix = (a, b, t) => {
  const pa = parseInt(a.slice(1), 16);
  const pb = parseInt(b.slice(1), 16);
  const ch = (sh) => Math.round((((pa >> sh) & 0xff) * (1 - t)) + (((pb >> sh) & 0xff) * t));
  return '#' + ((1 << 24) + (ch(16) << 16) + (ch(8) << 8) + ch(0)).toString(16).slice(1);
};

const svg = (body, defs = '') =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <defs>${defs}</defs>${body}</svg>`;

/** A tower elevation: body, glass banding, crown, and a soft ground shadow. */
function towerRect(x, y, w, h, accent, r, lit = 0) {
  const glass = mix(accent, '#e8eef5', 0.55);
  const stone = mix('#cfc9be', accent, 0.12);
  const face = r() > 0.45 ? glass : stone;
  const side = shade(face, -16);
  const floors = Math.max(4, Math.round(h / 26));
  let bands = '';
  for (let i = 1; i < floors; i++) {
    const by = y + (h / floors) * i;
    bands += `<rect x="${x + 3}" y="${by}" width="${w - 6}" height="2" fill="${shade(face, -22)}" opacity="0.5"/>`;
  }
  let windows = '';
  if (lit) {
    for (let i = 0; i < floors; i++) {
      for (let c = 0; c < 3; c++) {
        if (r() > 0.42) continue;
        windows += `<rect x="${x + 6 + c * ((w - 12) / 3)}" y="${y + (h / floors) * i + 4}" width="${(w - 12) / 3 - 4}" height="${h / floors - 8}" fill="#ffd79a" opacity="${(0.45 + r() * 0.5).toFixed(2)}"/>`;
      }
    }
  }
  return `
    <g>
      <rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${face}"/>
      <rect x="${x + w - w * 0.22}" y="${y}" width="${w * 0.22}" height="${h}" fill="${side}"/>
      ${bands}${windows}
      <rect x="${x - 4}" y="${y - 7}" width="${w + 8}" height="7" fill="${shade(face, -8)}"/>
    </g>`;
}

/* ------------------------------------------------------------------- scenes */

/** Daylight hero: the project's real towers, in elevation, over its landscape. */
function exteriorDay(project, r) {
  const accent = project.accent;
  const towers = project.plan.towers;
  const tallest = Math.max(...towers.map((t) => t.height));
  const horizon = 700;

  let city = '';
  for (let i = 0; i < 26; i++) {
    const w = between(r, 26, 74);
    const h = between(r, 40, 190);
    const x = between(r, -40, W);
    city += `<rect x="${x.toFixed(0)}" y="${(horizon - h).toFixed(0)}" width="${w.toFixed(0)}" height="${h.toFixed(0)}" fill="#b9c6d4" opacity="0.4"/>`;
  }

  let blocks = '';
  const n = Math.min(towers.length, 7);
  const slotW = W / (n + 1);
  towers.slice(0, n)
    .map((t, i) => ({ t, i }))
    .sort((a, b) => a.t.x - b.t.x)
    .forEach(({ t }, i) => {
      const h = 120 + (t.height / tallest) * 420;
      const w = 60 + t.w * 1.5;
      const x = slotW * (i + 0.5) + between(r, -18, 18);
      blocks += `<ellipse cx="${x + w / 2}" cy="${horizon + 8}" rx="${w * 0.8}" ry="14" fill="#000" opacity="0.13"/>`;
      blocks += towerRect(x, horizon - h, w, h, accent, r);
    });

  let trees = '';
  for (let i = 0; i < 22; i++) {
    const x = between(r, 0, W);
    const y = between(r, horizon + 20, H - 30);
    const s = between(r, 12, 26) * (1 + (y - horizon) / 400);
    trees += `<ellipse cx="${x.toFixed(0)}" cy="${y.toFixed(0)}" rx="${s.toFixed(0)}" ry="${(s * 0.8).toFixed(0)}" fill="${mix('#4c7a4a', accent, 0.1)}" opacity="0.9"/>`;
  }

  return svg(`
    <rect width="${W}" height="${H}" fill="url(#sky)"/>
    <circle cx="${(W * 0.76).toFixed(0)}" cy="188" r="66" fill="#fff8e2" opacity="0.85"/>
    ${city}
    <rect x="0" y="${horizon}" width="${W}" height="${H - horizon}" fill="url(#ground)"/>
    <path d="M0 ${horizon} Q ${W / 2} ${horizon - 26} ${W} ${horizon} L ${W} ${horizon + 40} L 0 ${horizon + 40} Z" fill="${mix('#6f9160', accent, 0.08)}" opacity="0.7"/>
    ${blocks}
    ${trees}
    <rect x="0" y="${H - 90}" width="${W}" height="90" fill="#3f5f3d" opacity="0.35"/>`,
    `<linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${mix('#9fc4ec', accent, 0.22)}"/>
      <stop offset="0.62" stop-color="#dce9f6"/>
      <stop offset="1" stop-color="#f2ede2"/>
    </linearGradient>
    <linearGradient id="ground" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#88a878"/><stop offset="1" stop-color="#5f8354"/>
    </linearGradient>`);
}

/** The same skyline at dusk, windows lit - the shot every brochure opens with. */
function exteriorDusk(project, r) {
  const accent = project.accent;
  const towers = project.plan.towers;
  const tallest = Math.max(...towers.map((t) => t.height));
  const horizon = 720;

  let blocks = '';
  const n = Math.min(towers.length, 6);
  const slotW = W / (n + 1);
  towers.slice(0, n).forEach((t, i) => {
    const h = 150 + (t.height / tallest) * 440;
    const w = 66 + t.w * 1.4;
    const x = slotW * (i + 0.5) + between(r, -14, 14);
    blocks += towerRect(x, horizon - h, w, h, shade(accent, -30), r, 1);
  });

  return svg(`
    <rect width="${W}" height="${H}" fill="url(#dusk)"/>
    <circle cx="300" cy="240" r="52" fill="#ffd9a0" opacity="0.55"/>
    ${blocks}
    <rect x="0" y="${horizon}" width="${W}" height="${H - horizon}" fill="#2b3446"/>
    <rect x="0" y="${horizon}" width="${W}" height="${H - horizon}" fill="url(#water)" opacity="0.5"/>
    <g opacity="0.22">${blocks}</g>`,
    `<linearGradient id="dusk" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#26324c"/>
      <stop offset="0.55" stop-color="${mix('#7a6a92', accent, 0.3)}"/>
      <stop offset="1" stop-color="#e8a978"/>
    </linearGradient>
    <linearGradient id="water" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${accent}"/><stop offset="1" stop-color="#1b2331"/>
    </linearGradient>`);
}

/**
 * The pool deck, with the clubhouse standing behind it.
 *
 * Composition rule for every scene here: things sit ON a line - the deck, the lawn,
 * the floor - and cast a shadow onto it. The first pass had the clubhouse floating in
 * the sky above a grey band, which reads as a diagram rather than a photograph.
 */
function amenityPool(project, r) {
  const accent = project.accent;
  const water = mix('#2f9fd0', accent, 0.3);
  const stone = mix('#e9e2d4', accent, 0.05);
  const deckY = 500;

  let bays = '';
  for (let i = 0; i < 7; i++) {
    const x = 60 + i * 220;
    bays += `<rect x="${x}" y="230" width="176" height="250" fill="${mix(accent, '#e6eef7', 0.62)}" opacity="0.92"/>
      <rect x="${x}" y="230" width="176" height="34" fill="${shade(stone, -10)}" opacity="0.6"/>
      <rect x="${x + 176}" y="215" width="44" height="265" fill="${stone}"/>`;
  }

  let loungers = '';
  for (let i = 0; i < 5; i++) {
    const x = 170 + i * 275;
    loungers += `<g transform="translate(${x} 560)">
      <ellipse cx="90" cy="66" rx="105" ry="12" fill="#000" opacity="0.09"/>
      <rect x="0" y="18" width="180" height="34" rx="14" fill="#fbf7ee"/>
      <rect x="132" y="-16" width="48" height="42" rx="14" fill="#f1ebdd"/>
      <rect x="26" y="52" width="11" height="22" rx="4" fill="#d3cab7"/>
      <rect x="142" y="52" width="11" height="22" rx="4" fill="#d3cab7"/>
    </g>`;
  }

  let palms = '';
  for (const [x, sc] of [[80, 1.15], [1520, 1.05], [1360, 0.85]]) {
    palms += `<g transform="translate(${x} ${deckY - 20}) scale(${sc})">
      <ellipse cx="0" cy="250" rx="60" ry="12" fill="#000" opacity="0.10"/>
      <path d="M-9 250 Q -2 130 6 -10 L 22 -10 Q 14 130 9 250 Z" fill="#7d6448"/>
      ${[-74, -40, -8, 30, 66].map((a, i) =>
        `<ellipse cx="0" cy="-14" rx="${104 - i * 5}" ry="24" fill="${mix('#38632f', accent, 0.1)}" transform="rotate(${a})"/>`).join('')}
    </g>`;
  }

  return svg(`
    <rect width="${W}" height="${H}" fill="url(#sky2)"/>
    ${bays}
    <rect x="40" y="196" width="${W - 60}" height="26" rx="4" fill="${shade(stone, -6)}"/>
    <rect x="0" y="${deckY}" width="${W}" height="${H - deckY}" fill="${stone}"/>
    <rect x="0" y="${deckY}" width="${W}" height="16" fill="#000" opacity="0.07"/>
    ${loungers}
    <rect x="118" y="694" width="${W - 236}" height="252" rx="30" fill="${shade(stone, -12)}"/>
    <rect x="138" y="712" width="${W - 276}" height="216" rx="24" fill="${water}"/>
    <rect x="138" y="712" width="${W - 276}" height="216" rx="24" fill="url(#shimmer)" opacity="0.4"/>
    ${[0, 1, 2, 3, 4].map((i) =>
      `<rect x="${210 + i * 250}" y="${756 + i * 30}" width="${150 - i * 12}" height="6" rx="3" fill="#fff" opacity="0.4"/>`).join('')}
    ${palms}`,
    `<linearGradient id="sky2" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${mix('#8fc0ea', accent, 0.22)}"/><stop offset="1" stop-color="#eaf2f8"/>
    </linearGradient>
    <linearGradient id="shimmer" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#fff" stop-opacity="0.45"/><stop offset="1" stop-color="#fff" stop-opacity="0"/>
    </linearGradient>`);
}

/** The central green, with the clubhouse podium at the head of it. */
function amenityGreen(project, r) {
  const accent = project.accent;
  const horizon = 430;
  let trees = '';
  for (let i = 0; i < 34; i++) {
    const y = between(r, horizon + 30, H - 20);
    const x = between(r, -20, W + 20);
    const s = between(r, 18, 34) * (0.55 + (y - horizon) / 520);
    trees += `<ellipse cx="${x.toFixed(0)}" cy="${(y + s * 0.7).toFixed(0)}" rx="${(s * 1.1).toFixed(0)}" ry="${(s * 0.22).toFixed(0)}" fill="#000" opacity="0.08"/>
      <ellipse cx="${x.toFixed(0)}" cy="${y.toFixed(0)}" rx="${s.toFixed(0)}" ry="${(s * 0.82).toFixed(0)}" fill="${mix('#3f6b36', accent, 0.08)}"/>
      <ellipse cx="${(x - s * 0.28).toFixed(0)}" cy="${(y - s * 0.3).toFixed(0)}" rx="${(s * 0.62).toFixed(0)}" ry="${(s * 0.48).toFixed(0)}" fill="${mix('#5b8f4b', accent, 0.1)}"/>`;
  }
  return svg(`
    <rect width="${W}" height="${H}" fill="url(#sky3)"/>
    <rect x="180" y="110" width="1240" height="300" rx="8" fill="${mix('#e9e4db', accent, 0.06)}"/>
    ${Array.from({ length: 5 }, (_, i) =>
      `<rect x="${226 + i * 236}" y="152" width="196" height="216" rx="4" fill="${mix(accent, '#e4eef8', 0.58)}" opacity="0.9"/>`).join('')}
    <rect x="160" y="86" width="1280" height="30" rx="5" fill="${shade(mix('#e9e4db', accent, 0.06), -10)}"/>
    <rect x="180" y="410" width="1240" height="22" fill="${shade(mix('#e9e4db', accent, 0.06), -16)}"/>
    <rect x="0" y="${horizon}" width="${W}" height="${H - horizon}" fill="url(#lawn)"/>
    <ellipse cx="${W / 2}" cy="${horizon + 6}" rx="740" ry="26" fill="#000" opacity="0.10"/>
    <path d="M0 640 Q 800 556 1600 640 L 1600 706 Q 800 622 0 706 Z" fill="#ddd5c4"/>
    ${trees}`,
    `<linearGradient id="sky3" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${mix('#9cc3e8', accent, 0.2)}"/><stop offset="1" stop-color="#eef4f9"/>
    </linearGradient>
    <linearGradient id="lawn" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#82a86c"/><stop offset="1" stop-color="#4f7043"/>
    </linearGradient>`);
}

/** A living room with a floor-to-ceiling window onto the project's own skyline. */
function interior(project, r) {
  const accent = project.accent;
  const towers = project.plan.towers.slice(0, 5);
  const tallest = Math.max(...project.plan.towers.map((t) => t.height));
  const floorY = 660;
  const winX = 210;
  const winW = W - winX * 2;

  let view = '';
  towers.forEach((t, i) => {
    const h = 130 + (t.height / tallest) * 300;
    const w = 110 + t.w * 1.4;
    const x = winX + 40 + i * ((winW - 120) / towers.length);
    view += `<rect x="${x.toFixed(0)}" y="${(floorY - h).toFixed(0)}" width="${w.toFixed(0)}" height="${h.toFixed(0)}" fill="#aebdcd" opacity="${(0.42 + i * 0.09).toFixed(2)}"/>`;
  });

  const mullions = Array.from({ length: 3 }, (_, i) =>
    `<rect x="${winX + ((i + 1) * winW) / 4 - 5}" y="120" width="10" height="${floorY - 120}" fill="#59636f"/>`).join('');

  return svg(`
    <rect width="${W}" height="${H}" fill="${mix('#f1ece3', accent, 0.03)}"/>
    <rect x="0" y="0" width="${W}" height="96" fill="${mix('#e4ded4', accent, 0.02)}"/>
    <rect x="0" y="92" width="${W}" height="6" fill="#000" opacity="0.07"/>
    <rect x="${winX}" y="120" width="${winW}" height="${floorY - 120}" fill="url(#outside)"/>
    ${view}
    <rect x="${winX}" y="${floorY - 70}" width="${winW}" height="70" fill="#9db98c" opacity="0.5"/>
    ${mullions}
    <rect x="${winX}" y="120" width="${winW}" height="${floorY - 120}" fill="none" stroke="#59636f" stroke-width="16"/>
    <rect x="0" y="${floorY}" width="${W}" height="${H - floorY}" fill="url(#floor)"/>
    ${Array.from({ length: 9 }, (_, i) =>
      `<rect x="0" y="${floorY + i * 40}" width="${W}" height="2" fill="#000" opacity="0.05"/>`).join('')}
    <path d="M300 ${H} L520 ${floorY + 40} L1120 ${floorY + 40} L1340 ${H} Z" fill="${mix('#cfc3ae', accent, 0.06)}" opacity="0.85"/>
    <g>
      <ellipse cx="820" cy="${floorY + 250}" rx="430" ry="30" fill="#000" opacity="0.10"/>
      <rect x="452" y="${floorY + 60}" width="736" height="150" rx="26" fill="${mix('#7f8b9b', accent, 0.18)}"/>
      <rect x="474" y="${floorY + 16}" width="330" height="72" rx="20" fill="${mix('#98a4b3', accent, 0.18)}"/>
      <rect x="836" y="${floorY + 16}" width="330" height="72" rx="20" fill="${mix('#98a4b3', accent, 0.18)}"/>
      <rect x="492" y="${floorY + 206}" width="30" height="42" rx="8" fill="#6d5c46"/>
      <rect x="1118" y="${floorY + 206}" width="30" height="42" rx="8" fill="#6d5c46"/>
    </g>
    <g transform="translate(1300 ${floorY - 40})">
      <ellipse cx="0" cy="290" rx="88" ry="16" fill="#000" opacity="0.10"/>
      <rect x="-52" y="196" width="104" height="96" rx="14" fill="#c9bda7"/>
      ${[0, 1, 2, 3, 4, 5].map((i) =>
        `<ellipse cx="${-56 + i * 22}" cy="${172 - i * 20}" rx="34" ry="62" fill="${mix('#456f3c', accent, 0.08)}" transform="rotate(${-38 + i * 15} ${-56 + i * 22} ${172 - i * 20})"/>`).join('')}
    </g>
    <rect x="60" y="230" width="96" height="130" rx="4" fill="${mix(accent, '#ffffff', 0.55)}" opacity="0.7"/>
    <rect x="60" y="230" width="96" height="130" rx="4" fill="none" stroke="#b9ac93" stroke-width="6"/>`,
    `<linearGradient id="outside" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${mix('#a8ccf0', accent, 0.22)}"/><stop offset="1" stop-color="#eff4f8"/>
    </linearGradient>
    <linearGradient id="floor" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#c8b193"/><stop offset="1" stop-color="#9c8567"/>
    </linearGradient>`);
}

/**
 * The site plan - a true drawing of `plan`, at the same scale and rotation the map
 * uses. Every footprint here is where the building actually stands.
 */
function sitePlan(project) {
  const plan = project.plan;
  const accent = project.accent;
  const pad = 90;
  const scale = Math.min((W - pad * 2) / plan.site.w, (H - pad * 2) / plan.site.d);
  const cx = W / 2;
  const cy = H / 2;
  const px = (x, z) => [cx + x * scale, cy + z * scale];

  const rot = (deg, x, y) => `rotate(${(deg * 180) / Math.PI} ${x} ${y})`;
  const [sw, sd] = [plan.site.w * scale, plan.site.d * scale];

  let towers = '';
  for (const t of plan.towers) {
    const [x, y] = px(t.x, t.z);
    const w = t.w * scale;
    const d = t.d * scale;
    towers += `<g transform="${rot(t.rot, x, y)}">
      <rect x="${(x - w / 2 + 3).toFixed(1)}" y="${(y - d / 2 + 3).toFixed(1)}" width="${w.toFixed(1)}" height="${d.toFixed(1)}" fill="#000" opacity="0.12"/>
      <rect x="${(x - w / 2).toFixed(1)}" y="${(y - d / 2).toFixed(1)}" width="${w.toFixed(1)}" height="${d.toFixed(1)}" fill="${mix(accent, '#ffffff', 0.35)}" stroke="${shade(accent, -30)}" stroke-width="1.5"/>
      <text x="${x.toFixed(1)}" y="${(y + 4).toFixed(1)}" font-family="Inter, sans-serif" font-size="12" font-weight="600" fill="${shade(accent, -50)}" text-anchor="middle">${t.id}</text>
    </g>`;
  }

  const [wx, wy] = px(plan.water.x, plan.water.z);
  const [pxc, pyc] = px(0, 0);
  let amenities = '';
  for (const a of plan.amenities) {
    const [ax, ay] = px(a.x, a.z);
    amenities += `<circle cx="${ax.toFixed(1)}" cy="${ay.toFixed(1)}" r="9" fill="#fff" stroke="${shade(accent, -20)}" stroke-width="2"/>`;
  }

  return svg(`
    <rect width="${W}" height="${H}" fill="#faf8f3"/>
    <g opacity="0.5">${Array.from({ length: 33 }, (_, i) => `<line x1="${i * 50}" y1="0" x2="${i * 50}" y2="${H}" stroke="#e6e1d6" stroke-width="1"/>`).join('')}
      ${Array.from({ length: 21 }, (_, i) => `<line x1="0" y1="${i * 50}" x2="${W}" y2="${i * 50}" stroke="#e6e1d6" stroke-width="1"/>`).join('')}</g>
    <g transform="${rot(plan.site.rot, cx, cy)}">
      <rect x="${(cx - sw / 2).toFixed(1)}" y="${(cy - sd / 2).toFixed(1)}" width="${sw.toFixed(1)}" height="${sd.toFixed(1)}" rx="${(Math.min(sw, sd) * 0.12).toFixed(1)}" fill="${mix('#dfe9d5', accent, 0.05)}" stroke="${shade(accent, -20)}" stroke-width="2.5" stroke-dasharray="10 6"/>
      <rect x="${(cx - sw * 0.43).toFixed(1)}" y="${(cy - sd * 0.43).toFixed(1)}" width="${(sw * 0.86).toFixed(1)}" height="${(sd * 0.86).toFixed(1)}" rx="${(Math.min(sw, sd) * 0.14).toFixed(1)}" fill="none" stroke="#cdc6b8" stroke-width="7"/>
      <rect x="${(wx - (plan.water.w * scale) / 2).toFixed(1)}" y="${(wy - (plan.water.d * scale) / 2).toFixed(1)}" width="${(plan.water.w * scale).toFixed(1)}" height="${(plan.water.d * scale).toFixed(1)}" rx="${(plan.water.d * scale * 0.45).toFixed(1)}" fill="${mix('#2f7fb5', accent, 0.2)}" opacity="0.75"/>
      <rect x="${(pxc - (plan.podium.w * scale) / 2).toFixed(1)}" y="${(pyc - (plan.podium.d * scale) / 2).toFixed(1)}" width="${(plan.podium.w * scale).toFixed(1)}" height="${(plan.podium.d * scale).toFixed(1)}" rx="6" fill="${mix('#e8e3da', accent, 0.1)}" stroke="${shade(accent, -30)}" stroke-width="1.5"/>
      ${amenities}${towers}
    </g>
    <g font-family="Inter, sans-serif" fill="#667085">
      <text x="60" y="72" font-size="26" font-weight="600" fill="#101828">${escapeXml(project.name)}</text>
      <text x="60" y="98" font-size="15">Master plan &#183; ${escapeXml(project.facts.landArea)} &#183; ${plan.towers.length} towers</text>
      <g transform="translate(${W - 130} 80)">
        <path d="M0 -34 L11 12 L0 3 L-11 12 Z" fill="#101828"/>
        <text x="0" y="34" font-size="13" font-weight="600" text-anchor="middle" fill="#101828">N</text>
      </g>
      <g transform="translate(60 ${H - 60})">
        <line x1="0" y1="0" x2="${(100 * scale).toFixed(0)}" y2="0" stroke="#101828" stroke-width="2.5"/>
        <line x1="0" y1="-6" x2="0" y2="6" stroke="#101828" stroke-width="2.5"/>
        <line x1="${(100 * scale).toFixed(0)}" y1="-6" x2="${(100 * scale).toFixed(0)}" y2="6" stroke="#101828" stroke-width="2.5"/>
        <text x="0" y="24" font-size="13">100 m</text>
      </g>
    </g>`);
}

const escapeXml = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]));

/* -------------------------------------------------------------------- build */

const SCENES = [
  { make: exteriorDay, category: 'exterior', caption: 'Approach from the main gate' },
  { make: exteriorDusk, category: 'towers', caption: 'The towers at dusk' },
  { make: amenityPool, category: 'amenities', caption: 'The pool deck' },
  { make: amenityGreen, category: 'amenities', caption: 'The central green' },
  { make: interior, category: 'interiors', caption: 'A living room, looking out' },
  { make: sitePlan, category: 'plans', caption: 'Master plan' },
];

const args = process.argv.slice(2);
const only = args.includes('--id') ? args[args.indexOf('--id') + 1] : null;
const force = args.includes('--force');
const clear = args.includes('--clear');

let sharp;
try {
  sharp = (await import('sharp')).default;
} catch {
  console.error('\n  This needs sharp to rasterise the scenes. Run `npm install` in archviz-map.\n');
  process.exit(1);
}

const registry = JSON.parse(await readFile(REGISTRY, 'utf8'));
let wrote = 0;

for (const project of registry.projects) {
  if (only && project.id !== only) continue;

  if (clear) {
    if (project.images && project.images.length) {
      await rm(join(MEDIA_DIR, project.id), { recursive: true, force: true });
      project.images = [];
      console.log('cleared ' + project.id);
    }
    continue;
  }

  if (project.images && project.images.length && !force) {
    console.log('skip   ' + project.id + ' (already has ' + project.images.length + ')');
    continue;
  }
  if (force) {
    await rm(join(MEDIA_DIR, project.id), { recursive: true, force: true });
    project.images = [];
  }
  project.images = project.images || [];

  for (const scene of SCENES) {
    const r = rng((project.seed || 1) + scene.category.length * 977 + scene.caption.length);
    const markup = scene.make(project, r);
    const png = await sharp(Buffer.from(markup)).png().toBuffer();
    const record = await storeImage({
      mediaDir: MEDIA_DIR,
      projectId: project.id,
      buffer: png,
      category: scene.category,
      caption: scene.caption,
    });
    project.images.push(record);
    wrote++;
  }
  console.log('wrote  ' + project.id + ' - ' + SCENES.length + ' images');
}

const tmp = REGISTRY + '.tmp';
await writeFile(tmp, JSON.stringify(registry, null, 2));
await rename(tmp, REGISTRY);
console.log(clear ? '\ncleared demo media' : `\n${wrote} images written to media/`);
