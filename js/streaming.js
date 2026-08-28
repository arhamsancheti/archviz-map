/**
 * Decides, on every camera change, which tier each project should be at and moves
 * it there. Nothing else in the app fetches or frees geometry.
 *
 * Rules, in order:
 *   - a project outside the padded viewport is not a candidate for anything
 *   - above `modelMinZoom`, the nearest N visible projects get real geometry
 *   - the selected project keeps its geometry even if it drifts off screen
 *   - everything else falls back to GPU massing, which costs no fetch
 *   - residents beyond the LRU / memory budget are disposed
 */
import { LOD, levelForZoom } from './config.js';
import { distanceKm, massingFeatures, siteFeature } from './geo.js';
import { loadProject, assetUrlFor } from './buildings.js';

/**
 * Procedural builds finish in a few milliseconds, which makes the streaming
 * invisible in a demo. This adds a latency that stands in for the real CDN fetch
 * of a client's .glb, sized from the asset bytes in the registry.
 * Set enabled:false to see raw speed.
 */
const SIMULATE_NETWORK = { enabled: true, msPerMB: 45, floorMs: 180 };

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** A low build is a fraction of the download a high build is. */
const LEVEL_WEIGHT = { low: 0.12, mid: 0.4, high: 1 };

/**
 * How far the retaining skirt drops below a site pad. Covers the fall across any
 * plausible urban site; buried and invisible on level ground.
 */
const SKIRT_DEPTH = 45;

export class StreamingManager {
  constructor(map, sceneManager, projects) {
    this.map = map;
    this.scene = sceneManager;
    this.projects = projects;
    this.byId = new Map(projects.map((p) => [p.id, p]));

    this.queue = [];
    this.inFlight = new Set();
    this.lastUsed = new Map(); // id -> timestamp, for LRU
    this.selectedId = null;
    this.listeners = new Set();
    this.visibleIds = [];
    this.tier = 'pin';
    this.level = 'low'; // which build of each model the current zoom calls for
  }

  onChange(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  emit() {
    const s = this.stats();
    for (const fn of this.listeners) fn(s);
  }

  stats() {
    const { resident, bytes } = this.scene.stats();
    return {
      tier: this.tier,
      visible: this.visibleIds.length,
      resident,
      queued: this.queue.length + this.inFlight.size,
      level: this.level,
      bytes,
      total: this.projects.length,
    };
  }

  select(id) {
    this.selectedId = id;
    this.update();
  }

  /**
   * Is this project on screen? Tested in screen space rather than against
   * `map.getBounds()`: at high pitch the bounding box stops describing what you can
   * actually see, and a project you are staring at can fall outside it - which used
   * to evict its geometry mid-look. Anything very close to the camera is kept
   * regardless, and anything absurdly far is dropped without projecting it.
   */
  isOnScreen(project, centre, zoom) {
    const d = distanceKm(project.location, centre);
    if (d < LOD.viewportPaddingKm) return true;
    // The distance cap is about not streaming geometry from the next state over, so
    // it only applies once we are close enough to stream anything. Zoomed out to the
    // globe, half a continent is legitimately on screen.
    if (zoom >= LOD.massingMinZoom && d > LOD.maxVisibleKm) return false;

    const canvas = this.map.getCanvas();
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    const tr = this.map.transform;
    // on a globe, the far side of the planet still projects to a screen point
    if (tr && typeof tr.isLocationOccluded === 'function') {
      try {
        if (tr.isLocationOccluded(project.location)) return false;
      } catch { /* projection without occlusion support */ }
    }
    const pt = this.map.project([project.location.lng, project.location.lat]);
    if (!Number.isFinite(pt.x) || !Number.isFinite(pt.y)) return false;
    const mx = w * LOD.screenMargin;
    const my = h * LOD.screenMargin;
    return pt.x > -mx && pt.x < w + mx && pt.y > -my && pt.y < h + my;
  }

  /** Called on every map move / zoom. Cheap: no allocation-heavy work. */
  update() {
    const zoom = this.map.getZoom();
    const centre = this.map.getCenter();

    const visible = this.projects.filter((p) => this.isOnScreen(p, centre, zoom));
    visible.sort((a, b) => distanceKm(a.location, centre) - distanceKm(b.location, centre));
    this.visibleIds = visible.map((p) => p.id);
    this.tier = zoom < LOD.clusterMaxZoom ? 'pin' : zoom < LOD.modelMinZoom ? 'massing' : 'model';
    this.level = levelForZoom(zoom);

    // --- who deserves real geometry
    // Hysteresis: once geometry is up, hold it a little below the promotion zoom so
    // nudging the wheel does not throw away work you are about to want back.
    const holdZoom = this.scene.entries.size
      ? LOD.modelMinZoom - LOD.zoomHysteresis
      : LOD.modelMinZoom;
    const wanted = new Set();
    if (zoom >= holdZoom) {
      for (const p of visible.slice(0, LOD.maxResidentModels)) wanted.add(p.id);
      if (this.selectedId) wanted.add(this.selectedId);
    }

    const now = performance.now();
    for (const id of wanted) this.lastUsed.set(id, now);

    // --- evict what is no longer wanted, then trim to budget
    for (const id of [...this.scene.entries.keys()]) {
      if (!wanted.has(id)) this.scene.remove(id);
    }
    this.trimToBudget(wanted);

    // --- queue anything missing, or resident at the wrong level of detail
    for (const id of wanted) {
      if (this.scene.levelOf(id) === this.level) continue;
      if (this.inFlight.has(id) || this.queue.includes(id)) continue;
      this.queue.push(id);
    }
    this.queue = this.queue.filter((id) => wanted.has(id));
    this.pump();

    this.refreshMassing(zoom, visible);
    this.emit();
  }

  trimToBudget(wanted) {
    const budget = LOD.memoryBudgetMB * 1048576;
    let guard = 0;
    while (guard++ < 32) {
      const { resident, bytes } = this.scene.stats();
      if (resident <= LOD.maxResidentModels && bytes <= budget) break;
      const victim = [...this.scene.entries.keys()]
        .filter((id) => id !== this.selectedId)
        .sort((a, b) => (this.lastUsed.get(a) || 0) - (this.lastUsed.get(b) || 0))[0];
      if (!victim) break;
      this.scene.remove(victim);
      wanted.delete(victim);
    }
  }

  async pump() {
    while (this.inFlight.size < LOD.maxConcurrentLoads && this.queue.length) {
      const id = this.queue.shift();
      if (this.scene.levelOf(id) === this.level) continue;
      this.inFlight.add(id);
      this.emit();
      this.loadOne(id).finally(() => {
        this.inFlight.delete(id);
        this.emit();
        if (this.queue.length) this.pump();
      });
    }
  }

  async loadOne(id) {
    const project = this.byId.get(id);
    const level = this.level;
    try {
      // Real assets are a real download; only the procedural stand-ins need a
      // pretend one to make streaming visible.
      const asset = project.plan.asset || {};
      if (SIMULATE_NETWORK.enabled && !assetUrlFor(asset, level)) {
        const mb = (asset.bytes || 4e6) / 1048576 * LEVEL_WEIGHT[level];
        await sleep(SIMULATE_NETWORK.floorMs + mb * SIMULATE_NETWORK.msPerMB);
      }
      // the camera may have moved on while we waited
      if (!this.visibleIds.includes(id) && id !== this.selectedId) return;
      const site = project.plan.site;
      const radiusM = Math.hypot(site.w, site.d) / 2;
      // Only worth a skirt when there is terrain for the pad to stand proud of.
      const skirt = this.map.getTerrain && this.map.getTerrain() ? SKIRT_DEPTH : 0;
      const model = await loadProject(project, level, { skirt });
      if (!this.visibleIds.includes(id) && id !== this.selectedId) {
        model.dispose();
        return;
      }
      // swap only once the new build is ready, so there is no empty frame
      if (this.scene.has(id)) this.scene.remove(id);
      this.scene.add(id, model, project.location, radiusM);
      this.refreshMassing(this.map.getZoom(), this.visibleIds.map((v) => this.byId.get(v)));
    } catch (err) {
      console.error('[stream] failed to load', id, err);
    }
  }

  /**
   * The cheap tier. Footprints are derived from registry numbers, so this costs one
   * GeoJSON update and zero downloads. Projects with real geometry drop out of it.
   */
  refreshMassing(zoom, visible) {
    const massing = this.map.getSource('massing');
    const sites = this.map.getSource('sites');
    if (!massing || !sites) return;

    const show = zoom >= LOD.massingMinZoom;
    const feats = [];
    const siteFeats = [];
    if (show) {
      for (const p of visible) {
        if (!p) continue;
        siteFeats.push(siteFeature(p));
        if (this.scene.has(p.id)) continue; // real geometry is already drawn
        feats.push(...massingFeatures(p));
      }
    }
    massing.setData({ type: 'FeatureCollection', features: feats });
    sites.setData({ type: 'FeatureCollection', features: siteFeats });
  }
}
