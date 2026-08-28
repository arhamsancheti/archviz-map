/** Wiring: map + scene + streaming + UI. */
import { BASEMAPS, LOD, CAMERA } from './config.js';
import { SceneManager } from './scene.js';
import { StreamingManager } from './streaming.js';
import { MarkerLayer } from './markers.js';
import { setNightLighting } from './buildings.js';
import { offsetLngLat } from './geo.js';
import * as UI from './ui.js';

const state = {
  projects: [],
  filtered: [],
  city: 'All cities',
  query: '',
  selectedId: null,
  basemap: 'day',
  orbiting: false,
  globe: true,
};

const $ = (s) => document.querySelector(s);
let map, scene, streaming, markers;

boot();

async function boot() {
  const res = await fetch('data/projects.json');
  const registry = await res.json();
  state.projects = registry.projects;
  state.filtered = registry.projects;

  map = new maplibregl.Map({
    container: 'map',
    style: BASEMAPS.day.style,
    center: CAMERA.overview.center,
    zoom: CAMERA.overview.zoom,
    pitch: 0,
    antialias: true,
    attributionControl: { compact: true },
    maxPitch: 78,
  });
  map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'bottom-right');
  map.touchZoomRotate.enableRotation();

  scene = new SceneManager();
  streaming = new StreamingManager(map, scene, state.projects);
  markers = new MarkerLayer(map, { onSelect: selectProject, onCluster: zoomToCluster });

  streaming.onChange(UI.updateHud);
  window.__app = { map, scene, streaming, markers, state }; // debug hook

  map.on('style.load', () => {
    applyProjection();
    installLayers();
    scene.setTheme(BASEMAPS[state.basemap]);
    setNightLighting(BASEMAPS[state.basemap].theme === 'dark');
    streaming.update();
  });

  let moveTimer = null;
  map.on('move', () => {
    markers.update(state.filtered, state.selectedId);
    if (moveTimer) return;
    moveTimer = setTimeout(() => {
      moveTimer = null;
      streaming.update();
    }, 160);
  });
  map.on('moveend', () => {
    streaming.update();
    syncAmenities();
  });

  // MapLibre's `load` can sit pending while basemap tiles trickle in, so the app
  // opens on the first style load and keeps a failsafe behind it.
  let opened = false;
  const open = () => {
    if (opened) return;
    opened = true;
    $('#boot').classList.add('gone');
    const deep = new URLSearchParams(location.search).get('p');
    if (deep && state.projects.some((p) => p.id === deep)) selectProject(deep);
    else UI.toast('Zoom into a project to stream its 3D model');
  };
  map.once('style.load', () => setTimeout(open, 300));
  map.once('load', open);
  setTimeout(open, 6000);

  buildChrome();
  applyFilter();
}

/* ------------------------------------------------------------------ layers */

/**
 * A style swap drops every source and layer we own, so this runs again after each
 * one. MapLibre also ignores addLayer (silently, no throw) until the new style
 * reports loaded, which can lag well past `style.load` - so attempt the install,
 * check whether it took, and retry if it did not.
 */
function installLayers() {
  if (map.getLayer('massing') && map.getLayer('archviz-3d')) return;

  try {
    const style = map.getStyle();
    const firstSymbol = (style.layers || []).find((l) => l.type === 'symbol');
    const before = firstSymbol ? firstSymbol.id : undefined;

    if (!map.getSource('sites')) map.addSource('sites', { type: 'geojson', data: empty() });
    if (!map.getSource('massing')) map.addSource('massing', { type: 'geojson', data: empty() });

    if (!map.getLayer('site-fill')) {
      map.addLayer(
        {
          id: 'site-fill',
          type: 'fill',
          source: 'sites',
          paint: { 'fill-color': ['get', 'accent'], 'fill-opacity': 0.12 },
        },
        before
      );
    }
    if (!map.getLayer('site-line')) {
      map.addLayer(
        {
          id: 'site-line',
          type: 'line',
          source: 'sites',
          paint: { 'line-color': ['get', 'accent'], 'line-width': 1.4, 'line-opacity': 0.65 },
        },
        before
      );
    }
    if (!map.getLayer('massing')) {
      map.addLayer({
        id: 'massing',
        type: 'fill-extrusion',
        source: 'massing',
        paint: {
          'fill-extrusion-color': ['get', 'accent'],
          'fill-extrusion-height': ['get', 'height'],
          'fill-extrusion-opacity': 0.62,
          'fill-extrusion-vertical-gradient': true,
        },
      });
    }
    // the 3D layer goes last so it draws over the basemap's own extrusions
    if (!map.getLayer('archviz-3d')) map.addLayer(scene.layer());
  } catch (err) {
    console.warn('[layers] install deferred:', err.message);
  }

  if (!map.getLayer('massing') || !map.getLayer('archviz-3d')) {
    setTimeout(installLayers, 350);
    return;
  }
  streaming.update();
}

const empty = () => ({ type: 'FeatureCollection', features: [] });

/**
 * Globe view. MapLibre eases into flat mercator by itself as you zoom in, which is
 * exactly what we want: a planet at country scale, a site plan at project scale.
 * Projection lives on the style, so it has to be re-applied after every style swap.
 */
function applyProjection() {
  if (typeof map.setProjection !== 'function') {
    state.globe = false;
    return;
  }
  try {
    map.setProjection({ type: state.globe ? 'globe' : 'mercator' });
  } catch (err) {
    console.warn('[projection] falling back to flat:', err.message);
    state.globe = false;
  }
  const btn = $('#btn-globe');
  if (btn) btn.setAttribute('aria-pressed', String(state.globe));
}

function toggleGlobe() {
  state.globe = !state.globe;
  applyProjection();
  UI.toast(state.globe ? 'Globe view' : 'Flat map');
}

/* -------------------------------------------------------------------- UI */

function buildChrome() {
  const host = $('#basemap-switch');
  for (const [key, cfg] of Object.entries(BASEMAPS)) {
    const b = document.createElement('button');
    b.textContent = cfg.label;
    b.setAttribute('aria-pressed', String(key === state.basemap));
    b.onclick = () => setBasemap(key);
    host.appendChild(b);
  }

  $('#search').addEventListener('input', (e) => {
    state.query = e.target.value.trim().toLowerCase();
    applyFilter();
  });
  $('#search').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && state.filtered.length) selectProject(state.filtered[0].id);
  });

  $('#sidebar-toggle').onclick = () => $('#sidebar').classList.toggle('collapsed');
  $('#hud-toggle').onclick = () => $('#hud').classList.toggle('closed');
  $('#btn-orbit').onclick = toggleOrbit;
  $('#btn-globe').onclick = toggleGlobe;
  $('#btn-reset').onclick = resetView;

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeProject();
    if (e.key === '/' && document.activeElement !== $('#search')) {
      e.preventDefault();
      $('#search').focus();
    }
  });
}

function applyFilter() {
  const q = state.query;
  state.filtered = state.projects.filter((p) => {
    const cityOk = state.city === 'All cities' || p.city === state.city;
    const text = (p.name + ' ' + p.developer + ' ' + p.city + ' ' + p.locality + ' ' + p.status).toLowerCase();
    return cityOk && (!q || text.includes(q));
  });
  const cities = [...new Set(state.projects.map((p) => p.city))].sort();
  UI.renderFilters(cities, state.city, (city) => {
    state.city = city;
    applyFilter();
  });
  UI.renderCards(state.filtered, state.selectedId, selectProject);
  markers.update(state.filtered, state.selectedId);
}

/* --------------------------------------------------------------- actions */

function selectProject(id) {
  const p = state.projects.find((x) => x.id === id);
  if (!p) return;
  state.selectedId = id;
  streaming.select(id);

  const wide = window.innerWidth > 860;
  map.flyTo({
    center: [p.location.lng, p.location.lat],
    zoom: CAMERA.project.zoom,
    pitch: CAMERA.project.pitch,
    bearing: (p.plan.site.rot * 180) / Math.PI + 28,
    duration: CAMERA.project.duration,
    essential: true,
    padding: wide ? { right: 400, left: 350, top: 0, bottom: 0 } : { top: 0, bottom: 0, left: 0, right: 0 },
  });

  UI.openDetail(p, {
    onClose: closeProject,
    onAmenity: flyToAmenity,
    onImmersive: openImmersive,
    onShare: share,
  });
  UI.renderCards(state.filtered, id, selectProject);
  markers.update(state.filtered, id);
}

function closeProject() {
  if (!state.selectedId) return;
  state.selectedId = null;
  streaming.select(null);
  stopOrbit();
  UI.closeDetail();
  markers.clearAmenities();
  UI.renderCards(state.filtered, null, selectProject);
}

function syncAmenities() {
  const p = state.projects.find((x) => x.id === state.selectedId);
  if (p && map.getZoom() >= LOD.detailMinZoom) markers.showAmenities(p, flyToAmenity);
  else markers.clearAmenities();
}

function flyToAmenity(project, amenity) {
  const rot = project.plan.site.rot;
  const x = amenity.x * Math.cos(rot) - amenity.z * Math.sin(rot);
  const z = amenity.x * Math.sin(rot) + amenity.z * Math.cos(rot);
  stopOrbit();
  map.flyTo({
    center: offsetLngLat(project.location, x, z),
    zoom: CAMERA.amenity.zoom,
    pitch: CAMERA.amenity.pitch,
    duration: CAMERA.amenity.duration,
    essential: true,
  });
  UI.toast(amenity.name + ' - ' + amenity.blurb);
}

function zoomToCluster(center, members) {
  map.flyTo({ center, zoom: Math.min(map.getZoom() + 2.6, 15), duration: 900, essential: true });
}

function openImmersive(p) {
  UI.toast('Deep-link ready: ' + p.immersive.url + ' - hands off to the Unreal build or a pixel-stream session.');
}

async function share(p) {
  const url = location.origin + location.pathname + '?p=' + p.id;
  try {
    await navigator.clipboard.writeText(url);
    UI.toast('Link copied - ' + url);
  } catch {
    UI.toast(url);
  }
}

function resetView() {
  closeProject();
  map.flyTo({ ...CAMERA.overview, duration: 2000, essential: true, padding: { top: 0, bottom: 0, left: 0, right: 0 } });
}

/* ----------------------------------------------------------------- orbit */

let orbitRaf = null;
function toggleOrbit() {
  state.orbiting ? stopOrbit() : startOrbit();
}
function startOrbit() {
  if (!state.selectedId) return UI.toast('Pick a project first, then orbit it');
  state.orbiting = true;
  $('#btn-orbit').setAttribute('aria-pressed', 'true');
  const step = () => {
    if (!state.orbiting) return;
    map.setBearing(map.getBearing() + CAMERA.orbitSpeed);
    orbitRaf = requestAnimationFrame(step);
  };
  step();
}
function stopOrbit() {
  state.orbiting = false;
  $('#btn-orbit').setAttribute('aria-pressed', 'false');
  if (orbitRaf) cancelAnimationFrame(orbitRaf);
  orbitRaf = null;
}

/* --------------------------------------------------------------- basemap */

function setBasemap(key) {
  if (key === state.basemap) return;
  state.basemap = key;
  for (const b of $('#basemap-switch').children) {
    b.setAttribute('aria-pressed', String(b.textContent === BASEMAPS[key].label));
  }
  UI.setTheme(BASEMAPS[key].theme);
  map.setStyle(BASEMAPS[key].style);
}
