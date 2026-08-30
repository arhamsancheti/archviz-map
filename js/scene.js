/**
 * The three.js side of the map.
 *
 * A MapLibre "custom layer" hands us the map's own WebGL context and its camera
 * matrix every frame, so our buildings share the map's depth buffer and
 * perspective instead of floating on a second canvas.
 *
 * Placement: every project is drawn in its OWN local frame, metres from its own
 * pin, using the matrix MapLibre computes for that location
 * (`transform.getMatrixForModel`). That is what makes models sit correctly on the
 * globe as well as on the flat map, and it sidesteps the float32 precision problems
 * you get from placing objects directly in mercator units.
 *
 * With at most a handful of resident models, one render pass each is cheap, and it
 * means the sun and shadow camera are fixed relative to whichever project is being
 * drawn - no per-project light bookkeeping.
 */
import * as THREE from 'three';
import { offsetLngLat, sampleGround } from './geo.js';
import { PERF } from './config.js';

/**
 * Only for the mercator fallback below, which lands in MapLibre's Z-up world space.
 * The v5 model frame is already Y-up and needs no flip.
 */
const FLIP = new THREE.Matrix4().makeRotationAxis(new THREE.Vector3(1, 0, 0), Math.PI / 2);

/** Scratch matrices - the render loop runs every frame, so it allocates nothing. */
const SCRATCH_MAIN = new THREE.Matrix4();
const SCRATCH_WORLD = new THREE.Matrix4();

export class SceneManager {
  constructor() {
    this.scene = new THREE.Scene();
    this.camera = new THREE.Camera();
    this.entries = new Map(); // id -> { group, lngLat, dispose, bytes }
    this.renderer = null;
    this.map = null;

    this.hemi = new THREE.HemisphereLight(0xdfefff, 0x35402f, 1.35);
    this.scene.add(this.hemi);

    // Fixed in the local frame of whichever project is rendering: late-morning sun.
    this.sun = new THREE.DirectionalLight(0xfff2e0, 2.1);
    this.sun.position.set(300, 640, -420);
    this.sun.castShadow = PERF.shadows;
    this.sun.shadow.mapSize.set(PERF.shadowMapSize, PERF.shadowMapSize);
    const sc = this.sun.shadow.camera;
    sc.near = 80;
    sc.far = 2400;
    sc.left = -450;
    sc.right = 450;
    sc.top = 450;
    sc.bottom = -450;
    this.sun.shadow.bias = -0.0009;
    this.scene.add(this.sun);
    this.scene.add(this.sun.target); // stays at the origin of the local frame

    this.ambient = new THREE.AmbientLight(0xffffff, 0.22);
    this.scene.add(this.ambient);
  }

  /** MapLibre custom layer adapter. A fresh one is made after every style switch. */
  layer() {
    const self = this;
    let owned = null; // this adapter's renderer, so a late onRemove cannot kill a newer one

    return {
      id: 'archviz-3d',
      type: 'custom',
      renderingMode: '3d',

      onAdd(map, gl) {
        self.map = map;
        owned = new THREE.WebGLRenderer({ canvas: map.getCanvas(), context: gl, antialias: PERF.antialias });
        owned.autoClear = false;
        owned.outputColorSpace = THREE.SRGBColorSpace;
        owned.toneMapping = THREE.ACESFilmicToneMapping;
        owned.toneMappingExposure = 1.0;
        owned.shadowMap.enabled = PERF.shadows;
        owned.shadowMap.type = PERF.shadows ? THREE.PCFSoftShadowMap : THREE.BasicShadowMap;
        self.renderer = owned;
      },

      onRemove() {
        // Only tear down if we are still the active renderer. During a style swap the
        // new layer can be added before the old one is removed, and disposing then
        // would leave the map with nothing drawing.
        if (self.renderer === owned) self.renderer = null;
        if (owned) owned.dispose();
        owned = null;
      },

      render(gl, args) {
        if (!owned || self.renderer !== owned || self.entries.size === 0) return;

        const main =
          Array.isArray(args) || ArrayBuffer.isView(args)
            ? args
            : args && args.defaultProjectionData && args.defaultProjectionData.mainMatrix;
        if (!main) return;

        // Draw one project at a time, each in its own local frame.
        for (const entry of self.entries.values()) {
          // A model whose whole site is a few pixels across still costs a full draw
          // plus its shadow pass - the exact situation during a zoomed-out approach,
          // and the reason phones drop frames mid-flight. Below ~24 px, skip.
          if (entry.radiusM > 0) {
            const a = self.map.project([entry.lngLat.lng, entry.lngLat.lat]);
            const b = self.map.project(offsetLngLat(entry.lngLat, entry.radiusM, 0));
            if (Math.hypot(b.x - a.x, b.y - a.y) < 24) continue;
          }
          const world = self.modelMatrix(entry.lngLat, entry.altitude || 0);
          if (!world) continue;
          self.camera.projectionMatrix = SCRATCH_MAIN.fromArray(main).multiply(world);

          for (const other of self.entries.values()) other.group.visible = other === entry;
          owned.resetState();
          owned.render(self.scene, self.camera);
        }

        for (const entry of self.entries.values()) entry.group.visible = true;
        owned.resetState();
      },
    };
  }

  /** Metres-from-the-pin frame for one location, in whatever projection is active. */
  modelMatrix(lngLat, altitude = 0) {
    const tr = this.map && this.map.transform;
    if (tr && typeof tr.getMatrixForModel === 'function') {
      // MapLibre v5, correct under globe and mercator alike. Its model frame is
      // metres in the glTF convention - X east, Y up, Z south - which is already
      // how our geometry is built, so no axis flip here. (Measured, not assumed:
      // see PROGRESS.md. Adding a flip here tips every building on its side.)
      return SCRATCH_WORLD.fromArray(tr.getMatrixForModel([lngLat.lng, lngLat.lat], altitude));
    }
    // Fallback for mercator-only builds.
    const mc = maplibregl.MercatorCoordinate.fromLngLat(lngLat, altitude);
    const s = mc.meterInMercatorCoordinateUnits();
    return new THREE.Matrix4()
      .makeTranslation(mc.x, mc.y, mc.z)
      .scale(new THREE.Vector3(s, -s, s))
      .multiply(FLIP);
  }

  add(id, model, lngLat, radiusM = 0) {
    if (this.entries.has(id)) return;
    model.group.position.set(0, 0, 0); // the model matrix does the placing
    this.scene.add(model.group);
    this.entries.set(id, {
      id, group: model.group, dispose: model.dispose,
      bytes: model.bytes, level: model.level || 'high', lngLat, radiusM,
    });
    this.updateAltitudes();
    if (this.map) this.map.triggerRepaint();
  }

  remove(id) {
    const entry = this.entries.get(id);
    if (!entry) return 0;
    this.scene.remove(entry.group);
    entry.dispose();
    this.entries.delete(id);
    if (this.map) this.map.triggerRepaint();
    return entry.bytes;
  }

  has(id) {
    return this.entries.has(id);
  }

  /**
   * Sit every model on the terrain. Elevation tiles arrive asynchronously, so this is
   * re-run whenever the map goes idle; with terrain off it resolves to 0.
   */
  updateAltitudes() {
    if (!this.map || typeof this.map.queryTerrainElevation !== 'function') return;
    let changed = false;
    for (const e of this.entries.values()) {
      let alt = 0;
      // Sit the pad on the HIGHEST ground under the site, not the ground at its pin -
      // a flat pad seated on the pin's elevation cuts into the hill uphill of it.
      const ground = sampleGround(this.map, e.lngLat, e.radiusM || 0);
      if (ground) {
        alt = ground.max;
        e.relief = ground.relief;
      } else {
        try {
          const v = this.map.queryTerrainElevation(e.lngLat);
          if (Number.isFinite(v)) alt = v;
        } catch (err) { /* terrain not ready */ }
      }
      // Only react to a real change. Elevation wobbles by centimetres as DEM tiles
      // refine, and repainting on that would drive an idle -> repaint -> idle loop.
      if (e.altitude === undefined || Math.abs(e.altitude - alt) > 0.25) {
        e.altitude = alt;
        changed = true;
      }
    }
    if (changed) this.map.triggerRepaint();
  }

  /** Which build of this model is resident, or null. */
  levelOf(id) {
    const e = this.entries.get(id);
    return e ? e.level : null;
  }

  clear() {
    for (const id of [...this.entries.keys()]) this.remove(id);
  }

  /** Match the lighting to the basemap so models never look pasted on. */
  setTheme(basemap) {
    const night = basemap.theme === 'dark';
    this.hemi.intensity = night ? 0.5 : 1.35;
    this.hemi.color.set(night ? 0x24304a : 0xdfefff);
    this.sun.intensity = night ? 0.5 : 2.1 * basemap.sky.sun;
    this.sun.color.set(night ? 0x9fb6ff : 0xfff2e0);
    this.ambient.intensity = night ? 0.15 : 0.22;
    if (this.map) this.map.triggerRepaint();
  }

  stats() {
    let bytes = 0;
    for (const e of this.entries.values()) bytes += e.bytes;
    return { resident: this.entries.size, bytes };
  }
}
