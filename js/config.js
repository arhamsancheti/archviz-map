/** Tunables for the whole prototype. Everything a producer would want to tweak. */

export const BASEMAPS = {
  day: {
    label: 'Day',
    style: 'https://basemaps.cartocdn.com/gl/voyager-gl-style/style.json',
    theme: 'light',
    sky: { top: '#bcd8f5', bottom: '#e8f1fb', sun: 0.9 },
  },
  night: {
    label: 'Night',
    style: 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json',
    theme: 'dark',
    sky: { top: '#0a1020', bottom: '#141c30', sun: 0.25 },
  },
  satellite: {
    label: 'Satellite',
    style: {
      version: 8,
      glyphs: 'https://basemaps.cartocdn.com/gl/positron-gl-style/{fontstack}/{range}.pbf',
      sources: {
        esri: {
          type: 'raster',
          tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'],
          tileSize: 256,
          maxzoom: 19,
          attribution: 'Imagery &copy; Esri, Maxar, Earthstar Geographics',
        },
      },
      layers: [
        { id: 'bg', type: 'background', paint: { 'background-color': '#0b0f14' } },
        { id: 'esri', type: 'raster', source: 'esri' },
      ],
    },
    theme: 'dark',
    sky: { top: '#2a3a4d', bottom: '#5b7b96', sun: 0.7 },
  },
};

/**
 * The LOD ladder. This is the whole answer to "how do we not download
 * every client's building at once":
 *
 *   PIN     - a clustered dot from the registry. Costs bytes, not megabytes.
 *   MASSING - tower footprints extruded by the GPU from the registry numbers.
 *             No asset fetch at all; the shapes are derived from metadata.
 *   MODEL   - the real geometry, built (or downloaded) only for projects that
 *             are actually on screen, and evicted when they are not.
 */
export const LOD = {
  clusterMaxZoom: 11.5,   // below this, pins collapse into cluster bubbles
  massingMinZoom: 12.5,   // extruded footprints appear
  modelMinZoom: 14.6,     // detailed geometry starts streaming
  detailMinZoom: 16.0,    // amenity hotspots + shadows
  viewportPaddingKm: 2.5, // always keep whatever is this close to the camera
  maxVisibleKm: 25,       // never stream something half a state away, however pitched
  screenMargin: 0.4,      // extra screen widths/heights counted as "in view"
  zoomHysteresis: 0.6,    // hold geometry this far below modelMinZoom before evicting
  /**
   * Which build of a model to fetch, by zoom. `tools/prepare-model.mjs` emits one
   * file per level from a single client export; procedural projects mirror the same
   * ladder in geometry detail. Highest matching level wins.
   */
  assetLevels: [
    { level: 'low', minZoom: 14.6 },
    { level: 'mid', minZoom: 15.6 },
    { level: 'high', minZoom: 16.4 },
  ],
  maxConcurrentLoads: 2,  // never block the main thread with a queue burst
  maxResidentModels: 4,   // LRU budget: how many detailed models stay in GPU memory
  memoryBudgetMB: 220,    // soft cap; the HUD turns amber past this
};

/**
 * The 3D world our projects sit in - the Apple/Google-Maps-style context.
 *
 * Terrain comes from the Mapzen/AWS open elevation tiles, which are free and need
 * no key. City buildings come from the OSM building footprints already inside the
 * basemap's vector tiles, extruded by their height tags - so they cost no extra
 * download beyond tiles the map is fetching anyway.
 *
 * The paid-but-prettier options (Google Photorealistic 3D Tiles, Cesium Ion) both
 * need a key and billing; see README.
 */
export const WORLD = {
  dem: {
    id: 'terrain-dem',
    spec: {
      type: 'raster-dem',
      tiles: ['https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png'],
      encoding: 'terrarium',
      tileSize: 256,
      maxzoom: 14,
      attribution: 'Elevation: Mapzen / AWS Open Data',
    },
  },
  exaggeration: 1.0, // real elevation; raise for drama on hill sites
  hillshade: 0.3,
  buildingsMinZoom: 14.4,   // tiles start loading here...
  buildingFadeZoom: 15.4,   // ...and they are fully grown by here
  buildingOpacity: 0.92,
};

/**
 * Phones are the main target, so the expensive things are off there by default.
 *
 * Shadows are the biggest single cost in this scene: every resident model is drawn in
 * its own pass, and each pass re-renders the shadow map. Four models means four shadow
 * passes a frame, which a mid-range phone will not carry.
 */
export const PERF = (() => {
  const coarse = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
  const small = Math.min(window.innerWidth, window.innerHeight) < 820;
  const mobile = coarse || small;
  return {
    mobile,
    shadows: !mobile,
    shadowMapSize: mobile ? 1024 : 2048,
    antialias: !mobile,
    maxResidentModels: mobile ? 2 : 4,
    cityBuildings: true,
  };
})();

LOD.maxResidentModels = PERF.maxResidentModels;

export const CAMERA = {
  overview: { zoom: 2.7, pitch: 0, bearing: 0, center: [78.9, 21.6] },
  project: { zoom: 16.1, pitch: 62, duration: 2600 },
  amenity: { zoom: 17.6, pitch: 70, duration: 1500 },
  orbitSpeed: 0.045, // degrees per frame
  /**
   * Below this zoom the camera levels itself back up. Tilt is meaningful standing in
   * a site and meaningless looking at a continent - left on, it pushes the centre of
   * the globe down the screen and lifts the horizon, which reads as broken. Earth and
   * Apple Maps both level out on the way out; so do we.
   */
  levelOutZoom: 7,
};

export const fmtPrice = (n) => {
  if (n >= 10000000) return '₹ ' + (n / 10000000).toFixed(2).replace(/\.00$/, '') + ' Cr';
  if (n >= 100000) return '₹ ' + (n / 100000).toFixed(2).replace(/\.00$/, '') + ' L';
  return '₹ ' + n.toLocaleString('en-IN');
};

export const fmtMB = (bytes) =>
  bytes < 1048576 ? Math.round(bytes / 1024) + ' KB' : (bytes / 1048576).toFixed(1) + ' MB';

export const STATUS_TONE = {
  'Ready to Move': 'ok',
  'Under Construction': 'warn',
  'New Launch': 'new',
};

/** Highest asset level whose zoom threshold the camera has passed. */
export const levelForZoom = (zoom) => {
  let level = LOD.assetLevels[0].level;
  for (const step of LOD.assetLevels) if (zoom >= step.minZoom) level = step.level;
  return level;
};
