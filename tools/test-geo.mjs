/**
 * Tiny check for the site/building overlap test. Run: node tools/test-geo.mjs
 *
 * The case that matters is the last one: two rectangles can overlap in a cross with
 * no vertex of either inside the other, which vertex-containment alone misses.
 */
import { hitsAnySite } from '../js/geo.js';

const site = {
  projectId: 'test',
  ring: [[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]],
  bbox: [0, 0, 10, 10],
};
const poly = (ring) => ({ type: 'Polygon', coordinates: [ring] });

const cases = [
  ['building fully inside the site', poly([[2, 2], [4, 2], [4, 4], [2, 4], [2, 2]]), true],
  ['building straddling the boundary', poly([[8, 2], [14, 2], [14, 4], [8, 4], [8, 2]]), true],
  ['building well clear of the site', poly([[40, 40], [42, 40], [42, 42], [40, 42], [40, 40]]), false],
  ['bboxes overlap but shapes do not', poly([[11, 11], [20, 11], [20, 20], [11, 20], [11, 11]]), false],
  // no vertex of either shape lies inside the other - only edges cross
  ['bar crossing the site with no vertex inside', poly([[-5, 4], [15, 4], [15, 6], [-5, 6], [-5, 4]]), true],
];

let failed = 0;
for (const [name, geometry, expected] of cases) {
  const got = hitsAnySite(geometry, [site]);
  const ok = got === expected;
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  (expected ${expected}, got ${got})`);
}
console.log(failed ? `\n${failed} failing` : '\nall passing');
process.exit(failed ? 1 : 0);
