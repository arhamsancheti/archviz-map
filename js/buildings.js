/**
 * Turns a project's compact `plan` spec into three.js geometry.
 *
 * Two things matter here beyond looks:
 *  1. Textures and materials are built once and shared across every project, so a
 *     ninth tower costs geometry only.
 *  2. Everything a project owns is tracked so `dispose()` really frees it when the
 *     streaming manager evicts the project.
 *
 * When real client assets exist, `loadProject` branches to GLTFLoader instead and
 * the rest of the app does not change.
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

/* ------------------------------------------------------------------ textures */

const textureCache = new Map();
let textureBytes = 0;

function canvasTexture(key, size, draw) {
  if (textureCache.has(key)) return textureCache.get(key);
  const c = document.createElement('canvas');
  c.width = c.height = size;
  draw(c.getContext('2d'), size);
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  textureCache.set(key, tex);
  textureBytes += size * size * 4 * 1.33; // + mipmaps
  return tex;
}

const PALETTE = {
  glass: { spandrel: '#46586a', glass: '#a3c4dc', mullion: '#2b3743', tint: 0.16 },
  stone: { spandrel: '#cfc3b2', glass: '#8fa6b4', mullion: '#8d8375', tint: 0.1 },
  mixed: { spandrel: '#6d7684', glass: '#b0cadb', mullion: '#454d58', tint: 0.12 },
};

/** 4 windows x 4 floors per tile, so the repeat is not obvious at street level. */
function facadeTexture(style) {
  const p = PALETTE[style] || PALETTE.glass;
  return canvasTexture('facade:' + style, 512, (ctx, S) => {
    const cell = S / 4;
    ctx.fillStyle = p.spandrel;
    ctx.fillRect(0, 0, S, S);
    let seed = style.length * 977;
    const rand = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);

    for (let fy = 0; fy < 4; fy++) {
      for (let fx = 0; fx < 4; fx++) {
        const x = fx * cell;
        const y = fy * cell;
        // glass panel sits in the upper 62% of each floor, spandrel below
        const gh = cell * 0.62;
        const g = ctx.createLinearGradient(x, y, x, y + gh);
        const v = 0.82 + rand() * 0.3;
        const col = new THREE.Color(p.glass).multiplyScalar(v);
        g.addColorStop(0, '#' + col.getHexString());
        g.addColorStop(1, '#' + col.clone().multiplyScalar(0.72).getHexString());
        ctx.fillStyle = g;
        ctx.fillRect(x + cell * 0.06, y + cell * 0.05, cell * 0.88, gh);
        // reflection streak
        ctx.fillStyle = 'rgba(255,255,255,' + (0.05 + rand() * 0.08).toFixed(3) + ')';
        ctx.fillRect(x + cell * 0.06, y + cell * 0.05, cell * 0.3, gh);
      }
    }
    // mullions
    ctx.strokeStyle = p.mullion;
    ctx.lineWidth = Math.max(1, S / 220);
    for (let i = 0; i <= 4; i++) {
      ctx.beginPath();
      ctx.moveTo(i * cell, 0); ctx.lineTo(i * cell, S);
      ctx.moveTo(0, i * cell); ctx.lineTo(S, i * cell);
      ctx.stroke();
    }
  });
}

/** Same grid, but only the lit windows - used as an emissive map after dark. */
function litTexture(style) {
  return canvasTexture('lit:' + style, 512, (ctx, S) => {
    const cell = S / 4;
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, S, S);
    let seed = 4919 + style.length * 31;
    const rand = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
    for (let fy = 0; fy < 4; fy++) {
      for (let fx = 0; fx < 4; fx++) {
        if (rand() > 0.42) continue;
        const warm = 0.7 + rand() * 0.3;
        ctx.fillStyle = 'rgba(' + Math.round(255 * warm) + ',' + Math.round(198 * warm) + ',' + Math.round(130 * warm) + ',1)';
        ctx.fillRect(fx * cell + cell * 0.06, fy * cell + cell * 0.05, cell * 0.88, cell * 0.62);
      }
    }
  });
}

/* ----------------------------------------------------------------- materials */

const materialCache = new Map();
const shared = (key, make) => {
  if (!materialCache.has(key)) materialCache.set(key, make());
  return materialCache.get(key);
};

function facadeMaterial(style) {
  return shared('facade:' + style, () =>
    new THREE.MeshStandardMaterial({
      map: facadeTexture(style),
      emissiveMap: litTexture(style),
      emissive: new THREE.Color(0xffffff),
      emissiveIntensity: 0,
      roughness: style === 'stone' ? 0.75 : 0.28,
      metalness: style === 'stone' ? 0.05 : 0.45,
    })
  );
}

const roofMaterial = () => shared('roof', () => new THREE.MeshStandardMaterial({ color: 0x9aa3ad, roughness: 0.9 }));
const plinthMaterial = () => shared('plinth', () => new THREE.MeshStandardMaterial({ color: 0xd8d2c8, roughness: 0.85 }));
const podiumMaterial = () => shared('podium', () => new THREE.MeshStandardMaterial({ color: 0xe8e3da, roughness: 0.7, metalness: 0.08 }));
const groundMaterial = () => shared('ground', () => new THREE.MeshStandardMaterial({ color: 0x6f9160, roughness: 1 }));
const pathMaterial = () => shared('path', () => new THREE.MeshStandardMaterial({ color: 0xcdc6b8, roughness: 0.95 }));
const waterMaterial = () => shared('water', () => new THREE.MeshStandardMaterial({ color: 0x2f7fb5, roughness: 0.08, metalness: 0.6 }));
const trunkMaterial = () => shared('trunk', () => new THREE.MeshStandardMaterial({ color: 0x5a4632, roughness: 1 }));
const leafMaterial = () => shared('leaf', () => new THREE.MeshStandardMaterial({ color: 0x3f6b3a, roughness: 1, flatShading: true }));

/** Set once when the basemap theme changes; every tower picks it up for free. */
export function setNightLighting(on) {
  for (const [key, mat] of materialCache) {
    if (key.startsWith('facade:')) mat.emissiveIntensity = on ? 1.15 : 0;
  }
}

/* ------------------------------------------------------------------ geometry */

function scaleBoxUVs(geo, repW, repD, repH) {
  const uv = geo.attributes.uv;
  const set = (from, to, ru, rv) => {
    for (let i = from; i <= to; i++) {
      uv.setXY(i, uv.getX(i) * ru, uv.getY(i) * rv);
    }
  };
  set(0, 3, repD, repH);   // +x
  set(4, 7, repD, repH);   // -x
  set(16, 19, repW, repH); // +z
  set(20, 23, repW, repH); // -z
  uv.needsUpdate = true;
}

function roundedRectShape(w, d, r) {
  const hw = w / 2;
  const hd = d / 2;
  const s = new THREE.Shape();
  s.moveTo(-hw + r, -hd);
  s.lineTo(hw - r, -hd);
  s.quadraticCurveTo(hw, -hd, hw, -hd + r);
  s.lineTo(hw, hd - r);
  s.quadraticCurveTo(hw, hd, hw - r, hd);
  s.lineTo(-hw + r, hd);
  s.quadraticCurveTo(-hw, hd, -hw, hd - r);
  s.lineTo(-hw, -hd + r);
  s.quadraticCurveTo(-hw, -hd, -hw + r, -hd);
  return s;
}

function flatShape(shape, y, material, bytes) {
  const geo = new THREE.ShapeGeometry(shape, 12);
  geo.rotateX(-Math.PI / 2);
  const mesh = new THREE.Mesh(geo, material);
  mesh.receiveShadow = true;
  mesh.position.y = y;
  bytes.push(geo);
  return mesh;
}

/**
 * What each LOD level draws. Real client assets get their detail from the three
 * files `tools/prepare-model.mjs` emits; procedural projects get it from here, so
 * the ladder is demonstrable before any real geometry exists.
 */
const DETAIL = {
  low: { trees: false, pads: false, water: false, path: false, plinth: false, crown: false },
  mid: { trees: false, pads: true, water: true, path: true, plinth: true, crown: false },
  high: { trees: true, pads: true, water: true, path: true, plinth: true, crown: true },
};

function tower(t, bytes, d = DETAIL.high) {
  const g = new THREE.Group();
  const WINDOW = 3.2;
  const FLOOR = t.height / t.floors;

  const body = new THREE.BoxGeometry(t.w, t.height, t.d);
  scaleBoxUVs(body, t.w / (WINDOW * 4), t.d / (WINDOW * 4), t.height / (FLOOR * 4));
  const facade = facadeMaterial(t.style);
  const mesh = new THREE.Mesh(body, [facade, facade, roofMaterial(), roofMaterial(), facade, facade]);
  mesh.position.y = t.height / 2 + 4;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  g.add(mesh);
  bytes.push(body);

  if (d.plinth) {
    // plinth / lobby level
    const plinth = new THREE.BoxGeometry(t.w + 7, 4.4, t.d + 7);
    const pm = new THREE.Mesh(plinth, plinthMaterial());
    pm.position.y = 2.2;
    pm.castShadow = true;
    pm.receiveShadow = true;
    g.add(pm);
    bytes.push(plinth);

    // parapet
    const par = new THREE.BoxGeometry(t.w + 1.2, 1.6, t.d + 1.2);
    const parm = new THREE.Mesh(par, roofMaterial());
    parm.position.y = t.height + 4.6;
    g.add(parm);
    bytes.push(par);
  }

  if (t.crown && d.crown) {
    const crown = new THREE.BoxGeometry(t.w * 0.42, 7, t.d * 0.42);
    const cm = new THREE.Mesh(crown, plinthMaterial());
    cm.position.y = t.height + 8.5;
    cm.castShadow = true;
    g.add(cm);
    bytes.push(crown);
  }

  g.position.set(t.x, 0, t.z);
  g.rotation.y = -t.rot;
  return g;
}

function trees(plan, bytes) {
  const area = plan.site.w * plan.site.d;
  const count = Math.min(260, Math.round(area / 1400));
  if (count < 4) return null;

  const trunkGeo = new THREE.CylinderGeometry(0.35, 0.5, 4, 5);
  const leafGeo = new THREE.IcosahedronGeometry(3.1, 0);
  bytes.push(trunkGeo, leafGeo);

  const trunks = new THREE.InstancedMesh(trunkGeo, trunkMaterial(), count);
  const leaves = new THREE.InstancedMesh(leafGeo, leafMaterial(), count);
  leaves.castShadow = true;

  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const scale = new THREE.Vector3();
  const pos = new THREE.Vector3();
  let seed = Math.round(plan.site.w * 13 + plan.site.d);
  const rand = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);

  let placed = 0;
  let guard = 0;
  while (placed < count && guard++ < count * 12) {
    const x = (rand() - 0.5) * plan.site.w * 0.94;
    const z = (rand() - 0.5) * plan.site.d * 0.94;
    const clash = plan.towers.some(
      (t) => Math.abs(x - t.x) < t.w / 2 + 8 && Math.abs(z - t.z) < t.d / 2 + 8
    );
    if (clash) continue;
    if (Math.abs(x) < plan.podium.w / 2 + 5 && Math.abs(z) < plan.podium.d / 2 + 5) continue;

    const s = 0.75 + rand() * 0.7;
    q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rand() * Math.PI);

    pos.set(x, 2, z);
    scale.set(1, s, 1);
    trunks.setMatrixAt(placed, m.compose(pos, q, scale));

    pos.set(x, 4 + 2.6 * s, z);
    scale.set(s, s * 1.15, s);
    leaves.setMatrixAt(placed, m.compose(pos, q, scale));
    placed++;
  }
  trunks.count = placed;
  leaves.count = placed;
  trunks.instanceMatrix.needsUpdate = true;
  leaves.instanceMatrix.needsUpdate = true;

  const g = new THREE.Group();
  g.add(trunks, leaves);
  return g;
}

/* -------------------------------------------------------------------- public */

function geometryBytes(list) {
  let n = 0;
  for (const g of list) {
    for (const key in g.attributes) n += g.attributes[key].array.byteLength;
    if (g.index) n += g.index.array.byteLength;
  }
  return n;
}

/** Build the whole master plan. Returns a group placed at the project's pin. */
export function buildProceduralProject(project, level = 'high') {
  const plan = project.plan;
  const d = DETAIL[level] || DETAIL.high;
  const bytes = [];
  const root = new THREE.Group();
  root.name = 'project:' + project.id;

  const site = new THREE.Group();
  site.rotation.y = -plan.site.rot;
  root.add(site);

  // ground plate + jogging loop + water
  site.add(flatShape(roundedRectShape(plan.site.w, plan.site.d, Math.min(plan.site.w, plan.site.d) * 0.14), 0.15, groundMaterial(), bytes));

  if (d.path) {
    const loopOuter = roundedRectShape(plan.site.w * 0.86, plan.site.d * 0.86, Math.min(plan.site.w, plan.site.d) * 0.16);
    loopOuter.holes.push(roundedRectShape(plan.site.w * 0.86 - 7, plan.site.d * 0.86 - 7, Math.min(plan.site.w, plan.site.d) * 0.14));
    site.add(flatShape(loopOuter, 0.3, pathMaterial(), bytes));
  }

  if (d.water) {
    const water = flatShape(roundedRectShape(plan.water.w, plan.water.d, plan.water.d * 0.45), 0.35, waterMaterial(), bytes);
    water.position.x = plan.water.x;
    water.position.z = plan.water.z;
    site.add(water);
  }

  // amenity pads, tinted with the project's accent
  const padMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(project.accent),
    roughness: 0.6,
    transparent: true,
    opacity: 0.55,
  });
  if (d.pads) {
    for (const a of plan.amenities) {
      const geo = new THREE.CircleGeometry(9, 24);
      geo.rotateX(-Math.PI / 2);
      const pad = new THREE.Mesh(geo, padMat);
      pad.position.set(a.x, 0.45, a.z);
      site.add(pad);
      bytes.push(geo);
    }
  }

  // clubhouse podium
  const podGeo = new THREE.BoxGeometry(plan.podium.w, plan.podium.height, plan.podium.d);
  const pod = new THREE.Mesh(podGeo, podiumMaterial());
  pod.position.y = plan.podium.height / 2;
  pod.castShadow = true;
  pod.receiveShadow = true;
  site.add(pod);
  bytes.push(podGeo);

  if (d.plinth) {
    const capGeo = new THREE.BoxGeometry(plan.podium.w * 0.72, 2.4, plan.podium.d * 0.72);
    const cap = new THREE.Mesh(capGeo, plinthMaterial());
    cap.position.y = plan.podium.height + 1.2;
    site.add(cap);
    bytes.push(capGeo);
  }

  for (const t of plan.towers) site.add(tower(t, bytes, d));

  if (d.trees) {
    const grove = trees(plan, bytes);
    if (grove) site.add(grove);
  }

  const owned = [padMat];
  return {
    group: root,
    level,
    bytes: geometryBytes(bytes),
    dispose() {
      root.traverse((o) => {
        if (o.geometry) o.geometry.dispose();
      });
      owned.forEach((m) => m.dispose());
    },
  };
}

/* ------------------------------------------------------- real client assets */

let gltfLoader = null;

/** Draco and Meshopt cover what `tools/prepare-model.mjs` emits. */
async function getLoader() {
  if (gltfLoader) return gltfLoader;
  const loader = new GLTFLoader();
  try {
    const [{ DRACOLoader }, { MeshoptDecoder }] = await Promise.all([
      import('three/addons/loaders/DRACOLoader.js'),
      import('three/addons/libs/meshopt_decoder.module.js'),
    ]);
    const draco = new DRACOLoader();
    draco.setDecoderPath('https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/libs/draco/');
    loader.setDRACOLoader(draco);
    loader.setMeshoptDecoder(MeshoptDecoder);
  } catch (err) {
    console.warn('[assets] compressed-mesh decoders unavailable:', err.message);
  }
  gltfLoader = loader;
  return loader;
}

/** Which file to fetch for a given LOD level, falling back down then to `url`. */
export function assetUrlFor(asset, level) {
  if (!asset) return null;
  const lods = asset.lods || {};
  const order = ['high', 'mid', 'low'];
  const from = order.indexOf(level);
  if (from >= 0) {
    for (let i = from; i < order.length; i++) {
      if (lods[order[i]] && lods[order[i]].url) return lods[order[i]].url;
    }
    for (let i = from - 1; i >= 0; i--) {
      if (lods[order[i]] && lods[order[i]].url) return lods[order[i]].url;
    }
  }
  return asset.url || null;
}

/**
 * Places a supplied model in our frame: metres, X east, Y up, Z south.
 * `scale` converts the file's units to metres (Unreal centimetres -> 0.01),
 * `heading` is degrees clockwise from north, `offset` nudges it off the pin, and
 * `autoGround` drops it so its lowest point rests on the ground.
 */
function placeAsset(inner, asset) {
  const scale = asset.scale || 1;
  inner.scale.setScalar(scale);
  inner.rotation.y = -((asset.heading || 0) * Math.PI) / 180;
  const off = asset.offset || {};
  inner.position.set(off.east || 0, off.up || 0, off.south || 0);
  inner.updateMatrixWorld(true);

  const box = new THREE.Box3().setFromObject(inner);
  if (!box.isEmpty()) {
    if (asset.autoGround !== false) {
      inner.position.y -= box.min.y;
      inner.updateMatrixWorld(true);
    }
    // The commonest asset mistake is units. Say so loudly instead of drawing a
    // building the size of a district (or a speck).
    const size = box.getSize(new THREE.Vector3());
    const span = Math.max(size.x, size.z);
    if (span > 4000 || span < 4) {
      const suggestion = span > 4000 ? 0.01 : 100;
      console.warn(
        `[assets] model footprint is ${span.toFixed(1)} m across - that looks like a unit ` +
        `mismatch. If the file is in ${span > 4000 ? 'centimetres' : 'metres-as-units'}, ` +
        `set plan.asset.scale to ${suggestion}.`
      );
    }
  }
  return box;
}

/** Entry point the streaming manager calls. Real .glb wins if the registry has one. */
export async function loadProject(project, level = 'high') {
  const asset = project.plan.asset || {};
  const url = assetUrlFor(asset, level);
  if (!url) return buildProceduralProject(project, level);

  const loader = await getLoader();
  const gltf = await loader.loadAsync(url);
  const inner = gltf.scene;
  placeAsset(inner, asset);

  const root = new THREE.Group();
  root.name = 'project:' + project.id;
  root.add(inner);

  const geos = [];
  root.traverse((o) => {
    if (o.isMesh) {
      o.castShadow = true;
      o.receiveShadow = true;
      geos.push(o.geometry);
    }
  });
  return {
    group: root,
    level,
    bytes: geometryBytes(geos),
    dispose() {
      root.traverse((o) => {
        if (o.geometry) o.geometry.dispose();
        if (o.material) {
          const mats = Array.isArray(o.material) ? o.material : [o.material];
          mats.forEach((m) => {
            Object.values(m).forEach((v) => v && v.isTexture && v.dispose());
            m.dispose();
          });
        }
      });
    },
  };
}

export const sharedTextureBytes = () => textureBytes;
