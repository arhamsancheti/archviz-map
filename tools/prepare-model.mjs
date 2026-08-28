/**
 * Turns one client export into the three builds the map streams.
 *
 *   node tools/prepare-model.mjs <input.glb> --id lakeside-habitat
 *
 * Produces models/<id>/{high,mid,low}.glb and prints the `asset` block to paste
 * into data/projects.json.
 *
 *   high  full detail, cleaned and compressed - what you see standing in the site
 *   mid   ~35% of the triangles, smaller textures - the approach view
 *   low   ~8% of the triangles, tiny textures - the "there is a building there" view
 *
 * Every level gets the same cleanup first: dedupe repeated meshes and materials,
 * flatten the scene graph, join what can be joined (draw calls are usually the real
 * cost in an archviz export, not triangles), weld vertices, drop unused data, then
 * Draco-compress the geometry.
 *
 * Install once:  npm install
 */
import { readFileSync, mkdirSync, writeFileSync, statSync } from 'node:fs';
import { basename, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

const LEVELS = [
  { name: 'high', ratio: 1, error: 0, texture: 2048 },
  { name: 'mid', ratio: 0.35, error: 0.005, texture: 1024 },
  { name: 'low', ratio: 0.08, error: 0.02, texture: 256 },
];

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) args[a.slice(2)] = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true;
    else args._.push(a);
  }
  return args;
}

const args = parseArgs(process.argv.slice(2));
const input = args._[0];
if (!input) {
  console.error('usage: node tools/prepare-model.mjs <input.glb> --id <project-id> [--out models] [--scale 1] [--heading 0]');
  process.exit(1);
}
const id = args.id || basename(input).replace(/\.(glb|gltf)$/i, '');
const outDir = join(root, args.out || 'models', id);

let deps;
try {
  const [core, extensions, functions, meshopt, draco3d] = await Promise.all([
    import('@gltf-transform/core'),
    import('@gltf-transform/extensions'),
    import('@gltf-transform/functions'),
    import('meshoptimizer'),
    import('draco3dgltf'),
  ]);
  deps = { core, extensions, functions, meshopt, draco3d };
} catch (err) {
  console.error(
    'Missing tooling. Run `npm install` in archviz-map first.\n' +
      '(needs @gltf-transform/core, @gltf-transform/extensions, @gltf-transform/functions, ' +
      'meshoptimizer, draco3dgltf)\n\n' +
      err.message
  );
  process.exit(1);
}

const { NodeIO } = deps.core;
const { ALL_EXTENSIONS, KHRDracoMeshCompression } = deps.extensions;
const { dedup, flatten, join: joinMeshes, weld, simplify, prune, resample, sparse, textureCompress } = deps.functions;
const { MeshoptSimplifier } = deps.meshopt;

const io = new NodeIO()
  .registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({
    'draco3d.decoder': await deps.draco3d.createDecoderModule(),
    'draco3d.encoder': await deps.draco3d.createEncoderModule(),
  });

let sharp = null;
try {
  sharp = (await import('sharp')).default;
} catch {
  console.warn('note: sharp not installed - textures will be kept as-is (still compressed geometry).');
}

const stats = (doc) => {
  let tris = 0;
  let verts = 0;
  for (const mesh of doc.getRoot().listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      const pos = prim.getAttribute('POSITION');
      const idx = prim.getIndices();
      verts += pos ? pos.getCount() : 0;
      tris += idx ? idx.getCount() / 3 : (pos ? pos.getCount() / 3 : 0);
    }
  }
  return {
    tris: Math.round(tris),
    verts,
    meshes: doc.getRoot().listMeshes().length,
    textures: doc.getRoot().listTextures().length,
  };
};

const kb = (n) => (n / 1024).toFixed(0) + ' KB';

mkdirSync(outDir, { recursive: true });
const sourceBytes = statSync(input).size;
console.log(`\nsource: ${input}  (${kb(sourceBytes)})`);

const original = await io.read(input);
const before = stats(original);
console.log(`        ${before.tris.toLocaleString()} triangles, ${before.meshes} meshes, ${before.textures} textures\n`);

const written = {};
for (const level of LEVELS) {
  const doc = await io.read(input); // fresh document per level
  const transforms = [
    dedup(),
    flatten(),
    joinMeshes(),
    weld({ tolerance: level.name === 'low' ? 0.001 : 0.0001 }),
    resample(),
  ];

  if (level.ratio < 1) {
    transforms.push(simplify({ simplifier: MeshoptSimplifier, ratio: level.ratio, error: level.error }));
  }
  if (sharp) {
    transforms.push(
      textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [level.texture, level.texture] })
    );
  }
  transforms.push(prune(), sparse());

  await doc.transform(...transforms);
  doc.createExtension(KHRDracoMeshCompression).setRequired(true);

  const file = join(outDir, level.name + '.glb');
  const glb = await io.writeBinary(doc);
  writeFileSync(file, glb);

  const after = stats(doc);
  written[level.name] = { file, bytes: glb.byteLength, tris: after.tris };
  const saved = (100 - (glb.byteLength / sourceBytes) * 100).toFixed(0);
  console.log(
    `${level.name.padEnd(5)} ${kb(glb.byteLength).padStart(9)}  ` +
      `${after.tris.toLocaleString().padStart(9)} tris  ` +
      `${after.meshes} meshes  (${saved}% smaller than source)`
  );
}

const rel = (p) => 'models/' + id + '/' + basename(p);
const assetBlock = {
  format: 'glb',
  lods: Object.fromEntries(
    Object.entries(written).map(([name, w]) => [name, { url: rel(w.file), bytes: w.bytes }])
  ),
  scale: Number(args.scale || 1),
  heading: Number(args.heading || 0),
  offset: { east: 0, up: 0, south: 0 },
  autoGround: true,
};

console.log(`\nwrote ${outDir}`);
console.log('\nPaste this as the project\'s plan.asset in data/projects.json:\n');
console.log(JSON.stringify(assetBlock, null, 2));
console.log(
  '\nThen check it on the map. If the building is the wrong size, fix `scale`\n' +
    '(Unreal centimetres -> 0.01). If it faces the wrong way, set `heading` in\n' +
    'degrees clockwise from north. If it is off the plot, nudge `offset` in metres.\n'
);
