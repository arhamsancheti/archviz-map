/**
 * CLI over the model pipeline in `tools/optimize.mjs`.
 *
 *   node tools/prepare-model.mjs <input.glb> --id lakeside-habitat
 *
 * Produces models/<id>/{high,mid,low}.glb and prints the `asset` block to paste into
 * data/projects.json. The admin UI (`npm start`, then /admin) does the same thing
 * through the same code, and writes the registry for you.
 *
 * Install once:  npm install
 */
import { basename, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildLods, LEVELS } from './optimize.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

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
  console.error(
    'usage: node tools/prepare-model.mjs <input.glb> --id <project-id> [--out models] [--scale 1] [--heading 0]'
  );
  process.exit(1);
}

const id = args.id || basename(input).replace(/\.(glb|gltf)$/i, '');
const outBase = args.out || 'models';
const outDir = join(root, outBase, id);

let result;
try {
  result = await buildLods({
    input,
    outDir,
    urlBase: outBase + '/' + id,
    levels: LEVELS,
    onLog: (line) => console.log('  ' + line),
  });
} catch (err) {
  console.error('\n' + err.message + '\n');
  process.exit(1);
}

const asset = { ...result.asset, scale: Number(args.scale || 1), heading: Number(args.heading || 0) };

console.log(`\nwrote ${outDir}`);
console.log("\nPaste this as the project's plan.asset in data/projects.json:\n");
console.log(JSON.stringify(asset, null, 2));

if (result.warning) {
  console.log(
    `\nThe model measures ${result.bounds.span.toFixed(1)} units across - that ` +
      `${result.warning.why}.\nIf so, set "scale": ${result.warning.scale}.`
  );
}
console.log(
  '\nThen check it on the map. If it faces the wrong way, set `heading` in degrees\n' +
    'clockwise from north. If it is off the plot, nudge `offset` in metres. Or open\n' +
    '/admin and drag it into place, which writes all of that for you.\n'
);
