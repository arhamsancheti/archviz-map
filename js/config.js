/** Tunables for the whole prototype. Everything a producer would want to tweak. */

/**
 * One basemap. Carto's Voyager reads closest to Apple Maps, needs no key, and its
 * vector tiles carry the OSM building footprints we extrude for city context - a
 * raster imagery layer carries none, which is why the satellite option went.
 */
export const BASEMAP = {
  style: 'https://basemaps.cartocdn.com/gl/voyager-gl-style/style.json',
  sky: { top: '#bcd8f5', bottom: '#e8f1fb', sun: 0.9 },
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
  /**
   * The terrain MESH only runs from this zoom up. Rotating the globe with the mesh
   * active freezes real GPUs: globe+terrain is only partially supported upstream
   * (maplibre warns "terrain is not fully supported on vertical perspective
   * projection", and the globe-with-terrain issues read as our freeze - see
   * PROGRESS.md round 5). At planet scale the mesh displaces nothing visible
   * anyway; the hillshade layer keeps the relief look there. 12 is also where the
   * globe projection has eased into flat mercator, so the mesh never runs on a
   * curved earth.
   */
  terrainMinZoom: 12,
  /**
   * How far above `terrainMinZoom` the camera has to climb before the mesh comes
   * back. A dead band, not a symmetric hysteresis: the mesh is never allowed to live
   * below the gate, because below the gate is where the globe is.
   */
  terrainHysteresis: 0.4,
  hillshade: 0.3,
  buildingsMinZoom: 14.4,   // tiles start loading here...
  buildingFadeZoom: 15.4,   // ...and they are fully grown by here
  buildingOpacity: 0.92,
  /**
   * OSM height tags are user-entered and a few are junk - Thane alone serves two
   * buildings tagged 1000 m, which render as needles through the sky next to a
   * median of about 41 m. Nothing real near our clients comes close to this cap
   * (India's tallest is around 320 m), so anything above it is data, not architecture.
   *
   * The trade: a genuine supertall elsewhere (Burj Khalifa, 828 m) is clipped to this.
   * Worth it - we sell Indian residential, and a wrong 1000 m tower is far more
   * damaging in a client demo than a shortened Dubai landmark.
   */
  maxBuildingHeight: 400,
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
  };
})();

LOD.maxResidentModels = PERF.maxResidentModels;

export const CAMERA = {
  overview: { zoom: 2.7, pitch: 0, bearing: 0, center: [78.9, 21.6] },
  /**
   * Selection flies in two phases when the target's terrain is not loaded yet
   * (see flyToProject in app.js): coast to the neighbourhood flat, then tilt down.
   * The phase durations sum to what the single flight used to be.
   */
  approach: { zoom: 14, duration: 1200 },
  project: { zoom: 16.1, pitch: 62, duration: 1400 },
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
