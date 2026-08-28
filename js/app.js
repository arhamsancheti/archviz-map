/** Wiring: map + scene + streaming + UI. */
import { BASEMAPS, LOD, CAMERA, WORLD, PERF } from './config.js';
import { SceneManager } from './scene.js';
import { StreamingManager } from './streaming.js';
import { MarkerLayer } from './markers.js';
import { setNightLighting } from './buildings.js';
import { offsetLngLat, siteBoxes, hitsAnySite } from './geo.js';
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
  world3d: true,
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
    antialias: PERF.antialias,
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
    applyWorld();
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
    levelOutWhenZoomedOut();
  });
  // terrain arrives asynchronously; re-seat the models on it once it has
  map.on('idle', () => {
    scene.updateAltitudes();
    refreshBuildingCutout();
  });
  // tiles stream in for a while after a flight; each arrival is a chance to find
  // more OSM buildings that sit under a site. Throttled - sourcedata is noisy.
  let cutoutTimer = null;
  map.on('sourcedata', (e) => {
    if (!e.isSourceLoaded || e.sourceId !== buildingSourceId()) return;
    if (cutoutTimer) return;
    cutoutTimer = setTimeout(() => {
      cutoutTimer = null;
      refreshBuildingCutout();
    }, 300);
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


/* ------------------------------------------------------------------- world */

/** The basemap layer that carries OSM building footprints, if this style has one. */
function cityBuildingSource() {
  for (const l of map.getStyle().layers || []) {
    if (l['source-layer'] === 'building' && l.source) return l.source;
  }
  return null;
}

// Set once per call so the sourcedata hook can match without re-parsing the style.
let buildingSourceIdCache = null;
function buildingSourceId() {
  if (!buildingSourceIdCache) buildingSourceIdCache = cityBuildingSource();
  return buildingSourceIdCache;
}

/**
 * Terrain, sky and extruded city buildings - the context a project sits in, the way
 * Apple and Google Maps show it. Re-applied after every style swap, like everything
 * else we own.
 */
function applyWorld() {
  const cfg = BASEMAPS[state.basemap];
  try {
    map.setSky({
      'sky-color': cfg.sky.top,
      'horizon-color': cfg.sky.bottom,
      'fog-color': cfg.sky.bottom,
      'sky-horizon-blend': 0.6,
      'horizon-fog-blend': 0.6,
      'fog-ground-blend': 0.08,
      'atmosphere-blend': ['interpolate', ['linear'], ['zoom'], 0, 0.9, 9, 0.6, 13, 0.15],
    });
  } catch (err) {
    console.warn('[world] sky unavailable:', err.message);
  }

  try {
    if (!map.getSource(WORLD.dem.id)) map.addSource(WORLD.dem.id, WORLD.dem.spec);

    if (state.world3d) {
      map.setTerrain({ source: WORLD.dem.id, exaggeration: WORLD.exaggeration });
      if (!map.getLayer('hillshade')) {
        map.addLayer(
          {
            id: 'hillshade',
            type: 'hillshade',
            source: WORLD.dem.id,
            paint: { 'hillshade-exaggeration': WORLD.hillshade },
          },
          map.getLayer('site-fill') ? 'site-fill' : undefined
        );
      }
    } else {
      map.setTerrain(null);
      if (map.getLayer('hillshade')) map.removeLayer('hillshade');
    }
  } catch (err) {
    console.warn('[world] terrain unavailable:', err.message);
  }

  applyCityBuildings();
  scene.updateAltitudes();
}

/**
 * Extrude the basemap's own building footprints. They are already inside the vector
 * tiles the map is downloading, so this costs no extra request - and it is what makes
 * a project read as part of a city instead of floating on a diagram.
 */
function applyCityBuildings() {
  if (map.getLayer('city-buildings')) map.removeLayer('city-buildings');
  buildingSourceIdCache = null; // a style swap can rename the source

  // the flat 2D footprints would z-fight with the extrusions
  for (const id of ['building', 'building-top']) {
    if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', state.world3d ? 'none' : 'visible');
  }
  if (!state.world3d) return;

  const source = cityBuildingSource();
  if (!source) return; // a raster basemap (satellite) carries no footprints

  const dark = BASEMAPS[state.basemap].theme === 'dark';
  const z0 = WORLD.buildingsMinZoom;
  const z1 = WORLD.buildingFadeZoom;

  // Schemas differ on the attribute name; fall back to storeys, then a guess. The
  // outer `min` throws away junk OSM tags - see WORLD.maxBuildingHeight.
  const height = [
    'min',
    [
      'coalesce',
      ['get', 'render_height'],
      ['get', 'height'],
      ['*', ['coalesce', ['get', 'levels'], ['get', 'building:levels'], 3], 3.2],
    ],
    WORLD.maxBuildingHeight,
  ];

  const layer = {
    id: 'city-buildings',
    type: 'fill-extrusion',
    source,
    'source-layer': 'building',
    minzoom: z0,
    paint: {
      'fill-extrusion-color': dark ? '#28303f' : '#dedbd4',
      // Grow and fade in over a zoom rather than appearing at full height in one
      // frame, which reads as the city snapping into place.
      'fill-extrusion-height': ['interpolate', ['linear'], ['zoom'], z0, 0, z1, height],
      'fill-extrusion-base': [
        'min',
        ['coalesce', ['get', 'render_min_height'], ['get', 'min_height'], 0],
        WORLD.maxBuildingHeight,
      ],
      'fill-extrusion-opacity': [
        'interpolate', ['linear'], ['zoom'],
        z0, 0,
        z0 + (z1 - z0) * 0.5, WORLD.buildingOpacity,
      ],
      'fill-extrusion-vertical-gradient': true,
    },
  };

  map.addLayer(layer, map.getLayer('site-fill') ? 'site-fill' : undefined);
  // re-apply whatever exclusions previous tiles earned (a style swap resets filters)
  applyBuildingCutout();
}

/* OSM buildings that sit under a client's site, by tile feature id. MapLibre's
 * `within` operator cannot do this job: it silently returns false for Polygon
 * inputs (only Point/LineString are supported - measured: 0 of 167 buildings
 * matched), so the cutout is computed here instead. Features are found with
 * querySourceFeatures as tiles arrive, tested against the padded site outlines,
 * and excluded with an id filter. Ids accumulate: the same building keeps its OSM
 * id across zooms, and sites are small, so the set stays tiny. */
const cutoutIds = new Set();
let cutoutApplied = false;

function refreshBuildingCutout() {
  if (!map || !map.getLayer('city-buildings')) return;
  if (map.getZoom() < WORLD.buildingsMinZoom - 0.6) return;
  const source = buildingSourceId();
  if (!source) return;

  let features;
  try {
    features = map.querySourceFeatures(source, { sourceLayer: 'building' });
  } catch {
    return;
  }
  const boxes = siteBoxes(state.projects, 12);
  let grew = false;
  for (const f of features) {
    if (f.id === undefined || f.id === null || cutoutIds.has(f.id)) continue;
    if (hitsAnySite(f.geometry, boxes)) {
      cutoutIds.add(f.id);
      grew = true;
    }
  }
  if (grew || !cutoutApplied) applyBuildingCutout();
}

function applyBuildingCutout() {
  if (!map || !map.getLayer('city-buildings')) return;
  const ids = [...cutoutIds];
  // `['id']` is the feature's own id; a missing id fails the `in` and stays visible
  map.setFilter('city-buildings', ids.length ? ['!', ['in', ['id'], ['literal', ids]]] : null);
  cutoutApplied = true;
}

function toggleWorld3d() {
  state.world3d = !state.world3d;
  const btn = $('#btn-3d');
  if (btn) btn.setAttribute('aria-pressed', String(state.world3d));
  applyWorld();
  // the retaining skirt only exists when there is terrain, so rebuild what is resident
  scene.clear();
  streaming.update();
  UI.toast(state.world3d ? 'Terrain and city buildings on' : 'Flat basemap');
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
  $('#btn-3d').onclick = toggleWorld3d;
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

/* ---------------------------------------------------------------- camera */

const NO_PADDING = { top: 0, right: 0, bottom: 0, left: 0 };
let cameraFlight = false; // a programmatic flight is in progress; leave it alone
let flightSeq = 0; // bumped on every new camera intent, so superseded flights stand down

/**
 * Zooming out from a project leaves the camera tilted and still padded for the
 * detail panel, which puts the globe low and off to one side. Level it back up.
 */
function levelOutWhenZoomedOut() {
  if (cameraFlight) {
    cameraFlight = false;
    return;
  }
  if (map.getZoom() >= CAMERA.levelOutZoom) return;

  const pad = map.getPadding();
  const tilted = map.getPitch() > 1;
  const padded = pad.top || pad.right || pad.bottom || pad.left;
  if (!tilted && !padded) return;

  map.easeTo({ pitch: 0, padding: NO_PADDING, duration: 700, essential: true, freezeElevation: true });
}

/**
 * Fly to a project. With terrain on, a single flight straight into a pitched target
 * re-steers elevation every frame while the DEM tiles are still arriving, and lands
 * roughly 500px off - the site sweeps past and sticks near the top of the screen,
 * and the first drag then triggers MapLibre's below-terrain correction, which zooms
 * instead of panning (maplibre #4688 family; measured - see PROGRESS.md).
 *
 * When the target's ground elevation is not known yet, fly in two phases: coast to
 * the neighbourhood flat, which loads its DEM, then tilt down onto the site. Both
 * phases land exactly. `freezeElevation` on every flight keeps the animation from
 * being steered mid-air; it is what makes the landing deterministic.
 */
/** First user gesture cancels the armed second phase - nobody wants a yank back. */
function onUserGesture(fn) {
  const events = ['mousedown', 'wheel', 'touchstart'];
  const off = () => events.forEach((e) => map.off(e, fn));
  events.forEach((e) => map.once(e, fn));
  return off;
}

function flyToProject(p, wide) {
  const seq = ++flightSeq;
  cameraFlight = true;
  const target = {
    center: [p.location.lng, p.location.lat],
    zoom: CAMERA.project.zoom,
    pitch: CAMERA.project.pitch,
    bearing: (p.plan.site.rot * 180) / Math.PI + 28,
  };
  const pad = wide ? { right: 400, left: 350, top: 0, bottom: 0 } : NO_PADDING;

  let demKnown = false;
  try {
    demKnown = Number.isFinite(map.queryTerrainElevation(target.center));
  } catch { /* terrain off or unsupported */ }
  if (map.getTerrain() && !demKnown) {
    const disarm = onUserGesture(() => { flightSeq++; });
    map.flyTo({
      ...target,
      zoom: CAMERA.approach.zoom,
      pitch: 0,
      padding: NO_PADDING,
      duration: CAMERA.approach.duration,
      essential: true,
      freezeElevation: true,
    });
    map.once('moveend', () => {
      disarm();
      if (seq !== flightSeq || state.selectedId !== p.id) return;
      cameraFlight = true;
      map.flyTo({ ...target, duration: CAMERA.project.duration, essential: true, freezeElevation: true, padding: pad });
    });
  } else {
    map.flyTo({ ...target, duration: CAMERA.project.duration, essential: true, freezeElevation: true, padding: pad });
  }
}

/* --------------------------------------------------------------- actions */

function selectProject(id) {
  const p = state.projects.find((x) => x.id === id);
  if (!p) return;
  state.selectedId = id;
  streaming.select(id);

  flyToProject(p, window.innerWidth > 860);

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
  flightSeq++;
  streaming.select(null);
  stopOrbit();
  UI.closeDetail();
  markers.clearAmenities();
  const pad = map.getPadding();
  if (pad.left || pad.right || pad.top || pad.bottom) {
    cameraFlight = true;
    map.easeTo({ padding: NO_PADDING, duration: 500, essential: true, freezeElevation: true });
  }
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
  flightSeq++;
  cameraFlight = true;
  map.flyTo({
    center: offsetLngLat(project.location, x, z),
    zoom: CAMERA.amenity.zoom,
    pitch: CAMERA.amenity.pitch,
    duration: CAMERA.amenity.duration,
    essential: true,
    freezeElevation: true,
  });
  UI.toast(amenity.name + ' - ' + amenity.blurb);
}

function zoomToCluster(center, members) {
  flightSeq++;
  cameraFlight = true;
  map.flyTo({ center, zoom: Math.min(map.getZoom() + 2.6, 15), duration: 900, essential: true, freezeElevation: true });
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
  flightSeq++;
  cameraFlight = true;
  map.flyTo({ ...CAMERA.overview, duration: 2000, essential: true, padding: NO_PADDING, freezeElevation: true });
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
