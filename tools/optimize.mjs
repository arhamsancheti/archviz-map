/**
 * The model pipeline, as a library.
 *
 * One client export in, the three builds the map streams out, plus the numbers that
 * say where the weight was. `tools/prepare-model.mjs` is a CLI over this; the admin
 * API in `serve.mjs` calls the same function when someone drops a .glb in the
 * browser, so a model uploaded through the UI and a model prepared on the command
 * line go through identical code.
 *
 * What each level is for:
 *   high  full detail, cleaned and compressed - standing in the site
 *   mid   ~35% of the triangles, smaller textures - the approach view
 *   low   ~8% of the triangles, tiny textures - "there is a building there"
 *
 * Every level gets the same safe cleanup first, in this order and for these reasons:
 *   dedup     byte-identical meshes, materials and textures collapse to one
 *   instance  repeated parts (windows, balconies, railings) become GPU instances -
 *             an archviz export is usually mostly repeats, so this is the cheapest
 *             big win there is
 *   flatten   drops the deep empty-node hierarchies exporters leave behind
 *   join      merges what shares a material; draw calls, not triangles, are usually
 *             what actually costs you in an archviz scene
 *   weld      merges coincident vertices, and is required before simplification
 *   resample  thins animation keyframes
 * then per level: simplify (mid/low only), texture resize + WebP, prune, and Draco.
 *
 * Nothing above changes what the model looks like except `simplify`, which is off
 * for `high`.
 */
import { mkdirSync, writeFileSync, statSync } from 'node:fs';
import { basename, join } from 'node:path';

export const LEVELS = [
  { name: 'high', ratio: 1, error: 0, texture: 2048 },
  { name: 'mid', ratio: 0.35, error: 0.005, texture: 1024 },
  { name: 'low', ratio: 0.08, error: 0.02, texture: 256 },
];

let cached = null;

/** Loads the gltf-transform stack once per process. Throws with a usable message. */
export async function loadTooling() {
  if (cached) return cached;
  let mods;
  try {
    mods = await Promise.all([
      import('@gltf-transform/core'),
      import('@gltf-transform/extensions'),
      import('@gltf-transform/functions'),
      import('meshoptimizer'),
      import('draco3dgltf'),
    ]);
  } catch (err) {
    throw new Error(
      'Model tooling is not installed. Run `npm install` in archviz-map.\n' + err.message
    );
  }
  const [core, extensions, functions, meshopt, draco3d] = mods;

  const io = new core.NodeIO()
    .registerExtensions(extensions.ALL_EXTENSIONS)
    .registerDependencies({
      'draco3d.decoder': await draco3d.createDecoderModule(),
      'draco3d.encoder': await draco3d.createEncoderModule(),
    });

  // Textures are usually the single biggest thing in a real export, and resizing
  // them needs sharp. It is an optional dependency because it ships prebuilt
  // binaries that do not install everywhere; without it the geometry work still
  // runs and the textures pass through untouched.
  let sharp = null;
  try {
    sharp = (await import('sharp')).default;
  } catch { /* geometry-only mode */ }

  await meshopt.MeshoptSimplifier.ready;
  cached = { io, functions, extensions, MeshoptSimplifier: meshopt.MeshoptSimplifier, sharp };
  return cached;
}

/** Triangles, meshes, materials and texture weight of a document. */
export function measure(doc) {
  const root = doc.getRoot();
  let tris = 0;
  for (const mesh of root.listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      const pos = prim.getAttribute('POSITION');
      const idx = prim.getIndices();
      tris += idx ? idx.getCount() / 3 : pos ? pos.getCount() / 3 : 0;
    }
  }
  const textures = root.listTextures();
  let textureBytes = 0;
  const sizes = [];
  for (const t of textures) {
    const img = t.getImage();
    if (img) textureBytes += img.byteLength;
    const size = t.getSize();
    if (size) sizes.push(size.join('x'));
  }
  return {
    triangles: Math.round(tris),
    meshes: root.listMeshes().length,
    materials: root.listMaterials().length,
    textures: textures.length,
    textureSizes: sizes,
    textureBytes,
  };
}

/**
 * World-space bounding box of the default scene, in the file's own units.
 *
 * This is what tells the admin UI how big the model thinks it is, which is the only
 * way to catch the commonest upload mistake: a file exported in centimetres, which
 * lands as a building the size of a district.
 */
export function boundsOf(doc) {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];

  const visit = (node, matrix) => {
    const local = mul(matrix, node.getWorldMatrix ? node.getMatrix() : node.getMatrix());
    const mesh = node.getMesh && node.getMesh();
    if (mesh) {
      for (const prim of mesh.listPrimitives()) {
        const pos = prim.getAttribute('POSITION');
        if (!pos) continue;
        const pmin = pos.getMin([0, 0, 0]);
        const pmax = pos.getMax([0, 0, 0]);
        // every corner of the primitive's own box, through the node transform
        for (let i = 0; i < 8; i++) {
          const p = [
            i & 1 ? pmax[0] : pmin[0],
            i & 2 ? pmax[1] : pmin[1],
            i & 4 ? pmax[2] : pmin[2],
          ];
          const w = apply(local, p);
          for (let k = 0; k < 3; k++) {
            if (w[k] < min[k]) min[k] = w[k];
            if (w[k] > max[k]) max[k] = w[k];
          }
        }
      }
    }
    for (const child of node.listChildren()) visit(child, local);
  };

  const scene = doc.getRoot().getDefaultScene() || doc.getRoot().listScenes()[0];
  if (scene) for (const node of scene.listChildren()) visit(node, IDENTITY);
  if (!Number.isFinite(min[0])) return null;

  return {
    min,
    max,
    size: [max[0] - min[0], max[1] - min[1], max[2] - min[2]],
    /** Largest horizontal dimension - the number a unit mismatch shows up in. */
    span: Math.max(max[0] - min[0], max[2] - min[2]),
    height: max[1] - min[1],
    /** Where the model sits relative to its own origin, in the ground plane. */
    centre: [(min[0] + max[0]) / 2, (min[2] + max[2]) / 2],
  };
}

const IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

/** Column-major 4x4 multiply, matching the glTF matrix layout. */
function mul(a, b) {
  const out = new Array(16).fill(0);
  for (let c = 0; c < 4; c++) {
    for (let r = 0; r < 4; r++) {
      let sum = 0;
      for (let k = 0; k < 4; k++) sum += a[k * 4 + r] * b[c * 4 + k];
      out[c * 4 + r] = sum;
    }
  }
  return out;
}

function apply(m, p) {
  return [
    m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12],
    m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13],
    m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14],
  ];
}

/**
 * A scale that would make this model read as a building, if the numbers say it does
 * not already. Only the obvious cases - a factor of 100 either way, or feet - get a
 * suggestion; anything ambiguous returns null rather than guessing at someone's site.
 */
export function suggestScale(span) {
  if (!span || !Number.isFinite(span)) return null;
  if (span > 4000) return { scale: 0.01, why: 'looks like centimetres (an Unreal or 3ds Max export)' };
  if (span < 4) return { scale: 100, why: 'looks like the model is in hundreds of metres per unit' };
  if (span > 1200) return { scale: 0.3048, why: 'could be feet' };
  return null;
}

const kb = (n) => (n / 1024).toFixed(0) + ' KB';
export const mb = (n) => (n / 1048576).toFixed(2) + ' MB';

/**
 * Build every level from one source file.
 *
 * @param {object}   opts
 * @param {string}   opts.input     path to the source .glb / .gltf
 * @param {string}   opts.outDir    directory to write <level>.glb into
 * @param {string}   opts.urlBase   what to put in the registry, e.g. "models/my-id"
 * @param {number[]} [opts.levels]  subset of LEVELS to build, by name
 * @param {function} [opts.onLog]   called with each progress line
 * @returns {Promise<{asset: object, source: object, levels: object[], bounds: object, warning: object|null}>}
 */
export async function buildLods({ input, outDir, urlBase, levels = LEVELS, onLog = () => {} }) {
  const { io, functions, extensions, MeshoptSimplifier, sharp } = await loadTooling();
  const { dedup, instance, flatten, join: joinMeshes, weld, simplify, prune, resample, sparse, textureCompress } =
    functions;
  const { KHRDracoMeshCompression } = extensions;

  mkdirSync(outDir, { recursive: true });
  const sourceBytes = statSync(input).size;
  onLog(`reading ${basename(input)} (${mb(sourceBytes)})`);

  const original = await io.read(input);
  const before = measure(original);
  const bounds = boundsOf(original);
  onLog(
    `source: ${before.triangles.toLocaleString()} triangles, ${before.meshes} meshes, ` +
      `${before.materials} materials, ${before.textures} textures (${mb(before.textureBytes)})`
  );
  if (bounds) {
    onLog(
      `footprint: ${bounds.span.toFixed(1)} x ${bounds.height.toFixed(1)} units ` +
        `(width x height, in the file's own units)`
    );
  }
  if (!sharp) onLog('note: sharp is not installed, so textures pass through at their original size');

  const warning = bounds ? suggestScale(bounds.span) : null;
  if (warning) onLog(`warning: ${warning.why} - suggested scale ${warning.scale}`);

  const written = [];
  for (const level of levels) {
    onLog(`building ${level.name}...`);
    const doc = await io.read(input); // a fresh document per level

    const steps = [
      dedup(),
      instance({ min: 2 }),
      flatten(),
      joinMeshes(),
      weld({ tolerance: level.name === 'low' ? 0.001 : 0.0001 }),
      resample(),
    ];
    if (level.ratio < 1) {
      steps.push(simplify({ simplifier: MeshoptSimplifier, ratio: level.ratio, error: level.error }));
    }
    if (sharp) {
      steps.push(
        textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [level.texture, level.texture] })
      );
    }
    steps.push(prune(), sparse());

    await doc.transform(...steps);
    doc.createExtension(KHRDracoMeshCompression).setRequired(true);

    const glb = await io.writeBinary(doc);
    const file = join(outDir, level.name + '.glb');
    writeFileSync(file, glb);

    const after = measure(doc);
    written.push({
      level: level.name,
      url: urlBase + '/' + level.name + '.glb',
      bytes: glb.byteLength,
      triangles: after.triangles,
      meshes: after.meshes,
      textures: after.textures,
    });
    onLog(
      `  ${level.name}: ${kb(glb.byteLength)}, ${after.triangles.toLocaleString()} triangles, ` +
        `${after.meshes} meshes - ${(100 - (glb.byteLength / sourceBytes) * 100).toFixed(0)}% smaller than source`
    );
  }

  const asset = {
    format: 'glb',
    lods: Object.fromEntries(written.map((w) => [w.level, { url: w.url, bytes: w.bytes }])),
    bytes: written.find((w) => w.level === 'high')?.bytes || written[0].bytes,
    scale: 1,
    heading: 0,
    offset: { east: 0, up: 0, south: 0 },
    autoGround: true,
  };

  return {
    asset,
    source: { bytes: sourceBytes, ...before },
    levels: written,
    bounds,
    warning,
  };
}
