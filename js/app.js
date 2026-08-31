/** Wiring: map + scene + streaming + search/filters + UI. */
import { BASEMAP, LOD, CAMERA, WORLD, PERF } from './config.js';
import { SceneManager } from './scene.js';
import { StreamingManager } from './streaming.js';
import { MarkerLayer } from './markers.js';
import { offsetLngLat, siteBoxes, hitsAnySite } from './geo.js';
import * as F from './filters.js';
import * as UI from './ui.js';

const state = {
  projects: [],
  facets: null,
  filtered: [],
  /** Switches set in the filter panel. */
  panel: F.blankFilters(),
  /** What the search box was understood to mean; overrides `panel` facet by facet. */
  parsed: { filters: F.blankFilters(), terms: [], sort: null },
  query: '',
  sort: 'featured',
  selectedId: null,
  orbiting: false,
  globe: true,
  world3d: true,
};

const $ = (s) => document.querySelector(s);
let map, scene, streaming, markers;

const effectiveFilters = () => F.mergeFilters(state.panel, state.parsed.filters);
const effectiveSort = () => state.parsed.sort || state.sort;

boot();

async function boot() {
  const res = await fetch('data/projects.json');
  const registry = await res.json();
  state.projects = registry.projects;
  state.filtered = registry.projects;
  state.facets = F.buildFacets(registry.projects);

  map = new maplibregl.Map({
    container: 'map',
    style: BASEMAP.style,
    center: CAMERA.overview.center,
    zoom: CAMERA.overview.zoom,
    pitch: 0,
    antialias: PERF.antialias,
    attributionControl: { compact: true },
    maxPitch: 78,
  });
  map.touchZoomRotate.enableRotation();

  scene = new SceneManager();
  streaming = new StreamingManager(map, scene, state.projects);
  markers = new MarkerLayer(map, { onSelect: selectProject, onCluster: zoomToCluster });

  window.__app = { map, scene, streaming, markers, state }; // debug hook

  map.on('style.load', () => {
    applyProjection();
    installLayers();
    applyWorld();
    streaming.update();
  });

  map.on('move', onCameraFrame);
  map.on('rotate', onCameraFrame);
  map.on('moveend', () => {
    // the rAF pass is the smooth one, but a throttled or backgrounded tab can skip it
    syncCompass();
    syncTerrain();
    scene.updateAltitudes();
    streaming.update();
    markers.update(state.filtered, state.selectedId);
    syncAmenities();
    levelOutWhenZoomedOut();
  });
  // terrain arrives asynchronously; re-seat the models on it once it has
  map.on('idle', () => {
    scene.updateAltitudes();
    refreshBuildingCutout();
  });

  /**
   * One listener for both async sources we care about.
   *
   *  - DEM tiles: `idle` is not guaranteed - an orbiting camera or a busy render
   *    loop can starve it indefinitely - so tile arrivals seat the models directly.
   *    Cheap: updateAltitudes no-ops unless an elevation moved more than 25 cm.
   *  - Basemap tiles: each arrival is a chance to find more OSM buildings sitting
   *    under a site. Skipped mid-gesture; moveend and idle both catch up.
   */
  let altTimer = null;
  let cutoutTimer = null;
  map.on('sourcedata', (e) => {
    if (e.sourceId === WORLD.dem.id) {
      if (altTimer) return;
      altTimer = setTimeout(() => {
        altTimer = null;
        scene.updateAltitudes();
      }, 300);
    } else if (e.isSourceLoaded && e.sourceId === buildingSourceId()) {
      if (cutoutTimer) return;
      cutoutTimer = setTimeout(() => {
        cutoutTimer = null;
        refreshBuildingCutout();
      }, 300);
    }
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

/* ------------------------------------------------------------ camera frame */

/**
 * Everything that has to keep up with a moving camera, coalesced into one animation
 * frame and rate-limited per job. Marker clustering has to look continuous, so it
 * runs often; the streaming decision is comparatively expensive and does not, so it
 * runs at about 7 Hz. Both used to share one 160 ms timer, which made clustering
 * visibly lag the map.
 */
let framePending = false;
let lastMarkerPass = 0;
let lastStreamPass = 0;

function onCameraFrame() {
  if (framePending) return;
  framePending = true;
  requestAnimationFrame((t) => {
    framePending = false;
    syncCompass();
    // removal only - see syncTerrain. This is what catches a zoom-out mid-gesture.
    syncTerrain({ allowEnable: false });
    if (t - lastMarkerPass > 60) {
      lastMarkerPass = t;
      markers.update(state.filtered, state.selectedId);
    }
    if (t - lastStreamPass > 150) {
      lastStreamPass = t;
      streaming.update();
    }
  });
}

function syncCompass() {
  const needle = $('#btn-compass .needle');
  if (needle) needle.style.transform = `rotate(${-map.getBearing()}deg)`;
}

/* ------------------------------------------------------------------ layers */

/**
 * MapLibre ignores addLayer (silently, no throw) until the style reports loaded,
 * which can lag well past `style.load` - so attempt the install, check whether it
 * took, and retry if it did not.
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

/** The basemap layer that carries OSM building footprints. */
function cityBuildingSource() {
  for (const l of map.getStyle().layers || []) {
    if (l['source-layer'] === 'building' && l.source) return l.source;
  }
  return null;
}

let buildingSourceIdCache = null;
function buildingSourceId() {
  if (!buildingSourceIdCache) buildingSourceIdCache = cityBuildingSource();
  return buildingSourceIdCache;
}

/** Whether the DEM mesh is currently applied. Owned by syncTerrain. */
let terrainMeshOn = false;

/**
 * Terrain, sky and extruded city buildings - the context a project sits in, the way
 * Apple and Google Maps show it.
 */
function applyWorld() {
  terrainMeshOn = false;
  try {
    map.setSky({
      'sky-color': BASEMAP.sky.top,
      'horizon-color': BASEMAP.sky.bottom,
      'fog-color': BASEMAP.sky.bottom,
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

    if (state.world3d && !map.getLayer('hillshade')) {
      map.addLayer(
        {
          id: 'hillshade',
          type: 'hillshade',
          source: WORLD.dem.id,
          paint: { 'hillshade-exaggeration': WORLD.hillshade },
        },
        map.getLayer('site-fill') ? 'site-fill' : undefined
      );
    } else if (!state.world3d && map.getLayer('hillshade')) {
      map.removeLayer('hillshade');
    }
  } catch (err) {
    console.warn('[world] terrain unavailable:', err.message);
  }

  syncTerrain();
  applyCityBuildings();
  scene.updateAltitudes();
}

/**
 * The DEM terrain mesh is expensive on a globe and only partially supported there
 * (MapLibre says so out loud: "terrain is not fully supported on vertical
 * perspective projection"), so it is zoom-gated - off at planet scale, where it
 * displaces nothing you can see and the hillshade carries the relief, on from
 * `WORLD.terrainMinZoom` up, where the projection has eased flat and the mesh is
 * what makes a site sit in its landscape.
 *
 * The two directions are not symmetric, and that is the whole point:
 *
 *   Turning the mesh OFF may happen at any moment, including mid-gesture. This used
 *   to run on `moveend` only - but a wheel or pinch zoom-out is ONE gesture whose
 *   moveend fires when it finally settles, so zooming out from a project kept the
 *   mesh alive for the entire globe transition. That is exactly the combination the
 *   zoom gate exists to avoid, and it is what made the map stick on the way out.
 *
 *   Turning it ON waits for moveend. Adding a terrain mesh mid-animation is the
 *   direction upstream handles badly, and there is no hurry: the ground is flat
 *   until you arrive.
 *
 * The dead band between the two thresholds stops a wheel hovering near the boundary
 * from flapping the mesh on and off, without ever letting it live below the gate.
 */
function syncTerrain({ allowEnable = true } = {}) {
  if (!state.world3d) {
    if (terrainMeshOn) setTerrainMesh(false);
    return;
  }
  const z = map.getZoom();
  if (terrainMeshOn && z < WORLD.terrainMinZoom) setTerrainMesh(false);
  else if (!terrainMeshOn && allowEnable && z >= WORLD.terrainMinZoom + WORLD.terrainHysteresis) {
    setTerrainMesh(true);
  }
}

function setTerrainMesh(on) {
  try {
    map.setTerrain(on ? { source: WORLD.dem.id, exaggeration: WORLD.exaggeration } : null);
    terrainMeshOn = on;
  } catch (err) {
    console.warn('[world] terrain unavailable:', err.message);
    terrainMeshOn = false;
  }
}

/**
 * Extrude the basemap's own building footprints. They are already inside the vector
 * tiles the map is downloading, so this costs no extra request - and it is what makes
 * a project read as part of a city instead of floating on a diagram.
 */
function applyCityBuildings() {
  if (map.getLayer('city-buildings')) map.removeLayer('city-buildings');
  buildingSourceIdCache = null;

  // the flat 2D footprints would z-fight with the extrusions
  for (const id of ['building', 'building-top']) {
    if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', state.world3d ? 'none' : 'visible');
  }
  if (!state.world3d) return;

  const source = cityBuildingSource();
  if (!source) return;

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

  map.addLayer(
    {
      id: 'city-buildings',
      type: 'fill-extrusion',
      source,
      'source-layer': 'building',
      minzoom: z0,
      paint: {
        'fill-extrusion-color': '#dedbd4',
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
    },
    map.getLayer('site-fill') ? 'site-fill' : undefined
  );
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

/** Sites never move, so the padded outlines are built once. */
let siteBoxCache = null;
const getSiteBoxes = () => (siteBoxCache ||= siteBoxes(state.projects, 12));

function refreshBuildingCutout() {
  if (!map || !map.getLayer('city-buildings')) return;
  if (map.getZoom() < WORLD.buildingsMinZoom - 0.6) return;
  // Mid-gesture this would run against tiles that are still arriving, once per
  // batch; moveend and idle both re-run it, so nothing is lost by waiting.
  if (map.isMoving()) return;
  // Nothing can need cutting unless a project is actually in view. Without this the
  // scan walks every building in every loaded tile - thousands of feature objects,
  // repeatedly, while tiles stream - during any pan at street zoom with no project
  // near. Reuses the streaming manager's screen-space test, which already handles
  // pitch and globe occlusion.
  if (streaming && streaming.visibleIds.length === 0) return;
  const source = buildingSourceId();
  if (!source) return;

  let features;
  try {
    features = map.querySourceFeatures(source, { sourceLayer: 'building' });
  } catch {
    return;
  }
  const boxes = getSiteBoxes();
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
  $('#btn-3d').setAttribute('aria-pressed', String(state.world3d));
  applyWorld();
  // the retaining skirt only exists when there is terrain, so rebuild what is resident
  scene.clear();
  streaming.update();
  UI.toast(state.world3d ? 'Terrain and city buildings on' : 'Flat basemap');
}

/* ---------------------------------------------------------------- chrome */

function buildChrome() {
  wireSearch();
  wireFilterPanel();

  UI.renderSort(state.sort, (id) => {
    state.sort = id;
    applyFilter();
  });

  $('#sidebar-toggle').onclick = () => {
    $('#sidebar').classList.add('collapsed');
    syncSheetClass();
  };
  $('#btn-projects').onclick = () => {
    $('#sidebar').classList.remove('collapsed');
    syncSheetClass();
  };

  $('#btn-zoom-in').onclick = () => map.zoomIn({ duration: 260 });
  $('#btn-zoom-out').onclick = () => map.zoomOut({ duration: 260 });
  $('#btn-compass').onclick = () => {
    stopOrbit();
    beginFlight();
    map.easeTo({ bearing: 0, duration: 420, essential: true, freezeElevation: true });
  };
  $('#btn-orbit').onclick = toggleOrbit;
  $('#btn-globe').onclick = toggleGlobe;
  $('#btn-3d').onclick = toggleWorld3d;
  $('#btn-reset').onclick = resetView;

  // Phones open on the map, not on a sheet covering half of it; the list is one tap
  // away on the handle.
  if (PERF.mobile) $('#sidebar').classList.add('collapsed');
  syncSheetClass();

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (!$('#suggest').hidden) return UI.hideSuggestions();
      if ($('#filter-panel').classList.contains('open')) return toggleFilterPanel(false);
      closeProject();
    }
    if (e.key === '/' && document.activeElement !== $('#search')) {
      e.preventDefault();
      $('#search').focus();
    }
  });
}

/** Let the CSS know when the project sheet covers the bottom of a phone. */
function syncSheetClass() {
  document.body.classList.toggle('sidebar-open', !$('#sidebar').classList.contains('collapsed'));
}

/* ---------------------------------------------------------------- search */

function wireSearch() {
  const input = $('#search');
  let debounce = null;

  const run = () => {
    state.query = input.value;
    state.parsed = F.parseQuery(state.query, state.facets);
    $('#search-clear').hidden = !state.query;
    UI.renderSuggestions(state.query, state.parsed.terms, setQuery);
    applyFilter();
  };

  input.addEventListener('input', () => {
    clearTimeout(debounce);
    debounce = setTimeout(run, 90);
  });
  input.addEventListener('focus', () =>
    UI.renderSuggestions(state.query, state.parsed.terms, setQuery)
  );
  // Blur alone is not enough: the panel can be showing without the box ever having
  // been focused (a chip removal re-parses and re-renders it), and a click that lands
  // on the map should close it either way.
  document.addEventListener('pointerdown', (e) => {
    if (!e.target.closest('.searchwrap')) UI.hideSuggestions();
  });
  input.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    clearTimeout(debounce);
    run();
    UI.hideSuggestions();
    if (state.filtered.length) {
      selectProject(state.filtered[0].id);
      input.blur();
    }
  });

  $('#search-clear').onclick = () => {
    input.value = '';
    run();
    input.focus();
  };
}

function setQuery(text) {
  const input = $('#search');
  input.value = text;
  state.query = text;
  state.parsed = F.parseQuery(text, state.facets);
  $('#search-clear').hidden = !text;
  UI.renderSuggestions(text, state.parsed.terms, setQuery);
  applyFilter();
}

/* ---------------------------------------------------------- filter panel */

function wireFilterPanel() {
  $('#btn-filter').onclick = () => toggleFilterPanel();
  $('#filter-close').onclick = () => toggleFilterPanel(false);
  $('#filter-apply').onclick = () => toggleFilterPanel(false);
  $('#filter-reset').onclick = () => {
    state.panel = F.blankFilters();
    applyFilter();
  };
}

function toggleFilterPanel(force) {
  const panel = $('#filter-panel');
  const open = force === undefined ? !panel.classList.contains('open') : force;
  if (open) {
    $('#sidebar').classList.remove('collapsed');
    syncSheetClass();
    renderPanel();
  }
  panel.classList.toggle('open', open);
  panel.setAttribute('aria-hidden', String(!open));
  $('#btn-filter').setAttribute('aria-expanded', String(open));
}

/**
 * A phrase the search box understood outranks the panel for that facet - otherwise
 * "in pune" would silently lose to a stale chip. So touching a control the query is
 * currently driving has to hand that facet back: the phrase is spliced out of the
 * search text first, then the panel edit lands. Nothing is ever set and ignored.
 */
const TERM_FACET = {
  unit: 'unitTypes', city: 'cities', developer: 'developers', status: 'statuses',
  amenity: 'amenities', price: 'price', size: 'sizeMin', possession: 'possessionBy',
};

function yieldFacet(facet) {
  const owned = state.parsed.terms.filter((t) => TERM_FACET[t.kind] === facet);
  if (!owned.length) return;
  let text = state.query;
  // right to left, so an earlier span stays valid after a later one is removed
  for (const term of owned.slice().reverse()) text = F.removeTerm(text, term);
  const input = $('#search');
  input.value = text;
  state.query = text;
  state.parsed = F.parseQuery(text, state.facets);
  $('#search-clear').hidden = !text;
}

function renderPanel() {
  UI.renderFilterPanel(state.facets, effectiveFilters(), {
    onToggle(facet, value) {
      yieldFacet(facet);
      const list = state.panel[facet];
      const i = list.indexOf(value);
      if (i >= 0) list.splice(i, 1);
      else list.push(value);
      applyFilter();
    },
    onSet(key, value) {
      yieldFacet(key);
      state.panel[key] = state.panel[key] === value ? null : value;
      applyFilter();
    },
    onPrice(min, max) {
      yieldFacet('price');
      state.panel.priceMin = min;
      state.panel.priceMax = max;
      applyFilter();
    },
  });
}

/**
 * The chips under the search box, for switches set in the panel. Facets the search
 * box has taken over are left out - their chip is already there, in accent, and two
 * chips claiming the same facet would be a lie about which one is deciding.
 */
function panelChips() {
  const parsed = state.parsed.filters;
  const p = state.panel;
  const out = [];
  const list = (facet, label) => {
    if (parsed[facet].length) return;
    for (const v of p[facet]) out.push({ facet, value: v, label: label ? label(v) : v });
  };
  list('cities');
  list('developers');
  list('statuses');
  list('unitTypes');
  list('amenities', UI.amenityLabel);

  if (parsed.priceMin == null && parsed.priceMax == null && (p.priceMin != null || p.priceMax != null)) {
    const label =
      p.priceMin != null && p.priceMax != null ? F.fmtCr(p.priceMin) + ' - ' + F.fmtCr(p.priceMax)
      : p.priceMax != null ? 'Under ' + F.fmtCr(p.priceMax)
      : F.fmtCr(p.priceMin) + ' and up';
    out.push({ facet: 'price', label });
  }
  if (parsed.sizeMin == null && p.sizeMin != null) {
    out.push({ facet: 'sizeMin', label: p.sizeMin.toLocaleString('en-IN') + '+ sq.ft.' });
  }
  if (parsed.possessionBy == null && p.possessionBy != null) {
    out.push({ facet: 'possessionBy', label: p.possessionBy ? 'By ' + p.possessionBy : 'Ready now' });
  }
  return out;
}

function removePanelChip(chip) {
  if (chip.facet === 'price') {
    state.panel.priceMin = null;
    state.panel.priceMax = null;
  } else if (chip.value === undefined) {
    state.panel[chip.facet] = null;
  } else {
    state.panel[chip.facet] = state.panel[chip.facet].filter((v) => v !== chip.value);
  }
  applyFilter();
}

function clearAll() {
  state.panel = F.blankFilters();
  setQuery('');
}

/* ---------------------------------------------------------------- listing */

function applyFilter() {
  const filters = effectiveFilters();
  const sort = effectiveSort();
  state.filtered = F.apply(state.projects, filters, sort);

  UI.renderCards(state.filtered, state.selectedId, {
    onSelect: selectProject,
    onClearAll: clearAll,
  });
  UI.renderCount(state.filtered.length, state.projects.length, new Set(state.filtered.map((p) => p.city)).size);
  UI.renderTerms(state.parsed.terms, panelChips(), {
    onRemoveTerm: (term) => setQuery(F.removeTerm(state.query, term)),
    onRemovePanel: removePanelChip,
    onClearAll: clearAll,
  });
  UI.setFilterCount(F.activeCount(filters), state.filtered.length);
  UI.renderSort(sort, (id) => {
    state.sort = id;
    applyFilter();
  });
  if ($('#filter-panel').classList.contains('open')) renderPanel();

  markers.update(state.filtered, state.selectedId);
  if (streaming) streaming.setCandidates(state.filtered);
}

/* ---------------------------------------------------------------- camera */

const NO_PADDING = { top: 0, right: 0, bottom: 0, left: 0 };
/**
 * Camera flight bookkeeping.
 *
 * Two pieces of state that must always move together, which is why nothing outside
 * these three helpers touches them:
 *
 *  - `cameraFlight` marks the next `moveend` as ours, so `levelOutWhenZoomedOut` does
 *    not fight an animation we started. The first moveend that sees it consumes it.
 *  - `flightSeq` is the current camera intent. Anything that runs *after* an
 *    animation captures the sequence first and stands down if it changed - that is
 *    what stops a superseded second-phase flight from yanking the user back.
 *
 * Invariants: every programmatic camera move goes through `beginFlight()`; anything
 * that invalidates a pending one calls `cancelPendingFlight()`; deferred work checks
 * `flightSuperseded(seq)` before acting.
 */
let cameraFlight = false;
let flightSeq = 0;

/** Start a programmatic camera move. Returns the sequence to check later. */
function beginFlight() {
  cameraFlight = true;
  return ++flightSeq;
}

/** Invalidate any pending deferred flight work without starting a move. */
function cancelPendingFlight() {
  flightSeq++;
}

/** Has a newer camera intent replaced the one that captured `seq`? */
function flightSuperseded(seq) {
  return seq !== flightSeq;
}

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

/** First user gesture cancels the armed second phase - nobody wants a yank back. */
function onUserGesture(fn) {
  const events = ['mousedown', 'wheel', 'touchstart'];
  const off = () => events.forEach((e) => map.off(e, fn));
  events.forEach((e) => map.once(e, fn));
  return off;
}

/**
 * On a phone the detail sheet covers the lower half, so the subject has to land in
 * the strip of map left visible above it - without padding it would sit dead centre,
 * behind the sheet. The top padding keeps it clear of the top bar.
 */
const phonePad = () => ({ top: 80, bottom: Math.round(innerHeight * 0.5), left: 0, right: 0 });

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
function flyToProject(p, wide) {
  const seq = beginFlight();
  const target = {
    center: [p.location.lng, p.location.lat],
    zoom: CAMERA.project.zoom,
    pitch: CAMERA.project.pitch,
    bearing: (p.plan.site.rot * 180) / Math.PI + 28,
  };
  const pad = wide ? { right: 410, left: 360, top: 0, bottom: 0 } : phonePad();

  let demKnown = false;
  try {
    demKnown = Number.isFinite(map.queryTerrainElevation(target.center));
  } catch { /* projection can't answer yet */ }
  // world3d implies the mesh is on by the time we arrive, so its ground elevation
  // is what the landing has to respect. The mesh is zoom-gated (syncTerrain), so
  // asking getTerrain() here would read false on the globe even though the target
  // stands on terrain.
  if (state.world3d && !demKnown) {
    const disarm = onUserGesture(cancelPendingFlight);
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
      if (flightSuperseded(seq) || state.selectedId !== p.id) return;
      beginFlight();
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
  scene.setShadowFocus(id);

  // on a phone the list is a sheet over the map - selecting from it must get it
  // out of the way so the flight and the detail sheet have the screen
  if (PERF.mobile && !$('#sidebar').classList.contains('collapsed')) {
    $('#sidebar').classList.add('collapsed');
    syncSheetClass();
  }
  toggleFilterPanel(false);

  flyToProject(p, window.innerWidth > 900);

  UI.openDetail(p, {
    onClose: closeProject,
    onAmenity: flyToAmenity,
    onImmersive: openImmersive,
    onShare: share,
    onOrbit: () => toggleOrbit(),
  });
  UI.markSelectedCard(id);
  markers.update(state.filtered, id);
}

function closeProject() {
  if (!state.selectedId) return;
  state.selectedId = null;
  cancelPendingFlight();
  streaming.select(null);
  scene.setShadowFocus(null);
  stopOrbit();
  UI.closeDetail();
  markers.clearAmenities();
  const pad = map.getPadding();
  if (pad.left || pad.right || pad.top || pad.bottom) {
    beginFlight();
    map.easeTo({ padding: NO_PADDING, duration: 500, essential: true, freezeElevation: true });
  }
  UI.markSelectedCard(null);
  markers.update(state.filtered, null);
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
  beginFlight();
  const opts = {
    center: offsetLngLat(project.location, x, z),
    zoom: CAMERA.amenity.zoom,
    pitch: CAMERA.amenity.pitch,
    duration: CAMERA.amenity.duration,
    essential: true,
    freezeElevation: true,
  };
  if (window.innerWidth <= 900) opts.padding = phonePad();
  map.flyTo(opts);
  UI.toast(amenity.name + ' - ' + amenity.blurb);
}

function zoomToCluster(center) {
  beginFlight();
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
  beginFlight();
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
