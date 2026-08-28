/**
 * Builds a throwaway .glb shaped like a small archviz export - a few towers plus a
 * dome, dense enough that simplification has something to chew on. Use it to try the
 * model pipeline before any real client asset arrives:
 *
 *   node tools/make-sample-glb.mjs sample.glb
 *   node tools/prepare-model.mjs sample.glb --id sample
 */
import { Document, NodeIO } from '@gltf-transform/core';
import { writeFileSync } from 'node:fs';

const doc = new Document();
const buffer = doc.createBuffer();
const scene = doc.createScene();
const mat = doc.createMaterial('concrete').setBaseColorFactor([0.8, 0.8, 0.78, 1]).setRoughnessFactor(0.9);

function addMesh(name, positions, normals, indices, tx = [0, 0, 0]) {
  const prim = doc.createPrimitive()
    .setAttribute('POSITION', doc.createAccessor().setType('VEC3').setArray(new Float32Array(positions)).setBuffer(buffer))
    .setAttribute('NORMAL', doc.createAccessor().setType('VEC3').setArray(new Float32Array(normals)).setBuffer(buffer))
    .setIndices(doc.createAccessor().setType('SCALAR').setArray(new Uint32Array(indices)).setBuffer(buffer))
    .setMaterial(mat);
  const mesh = doc.createMesh(name).addPrimitive(prim);
  scene.addChild(doc.createNode(name).setMesh(mesh).setTranslation(tx));
}

// dome: dense, simplifies well
function dome(radius, seg) {
  const pos = [], nor = [], idx = [];
  for (let y = 0; y <= seg; y++) {
    const v = (y / seg) * (Math.PI / 2);
    for (let x = 0; x <= seg; x++) {
      const u = (x / seg) * Math.PI * 2;
      const nx = Math.cos(u) * Math.sin(v), ny = Math.cos(v), nz = Math.sin(u) * Math.sin(v);
      pos.push(nx * radius, ny * radius, nz * radius);
      nor.push(nx, ny, nz);
    }
  }
  for (let y = 0; y < seg; y++) {
    for (let x = 0; x < seg; x++) {
      const a = y * (seg + 1) + x, b = a + seg + 1;
      idx.push(a, b, a + 1, b, b + 1, a + 1);
    }
  }
  return [pos, nor, idx];
}

function box(w, h, d) {
  const hw = w/2, hh = h/2, hd = d/2;
  const faces = [
    [[hw,-hh,-hd],[hw,-hh,hd],[hw,hh,hd],[hw,hh,-hd],[1,0,0]],
    [[-hw,-hh,hd],[-hw,-hh,-hd],[-hw,hh,-hd],[-hw,hh,hd],[-1,0,0]],
    [[-hw,hh,-hd],[hw,hh,-hd],[hw,hh,hd],[-hw,hh,hd],[0,1,0]],
    [[-hw,-hh,hd],[hw,-hh,hd],[hw,-hh,-hd],[-hw,-hh,-hd],[0,-1,0]],
    [[-hw,-hh,hd],[-hw,hh,hd],[hw,hh,hd],[hw,-hh,hd],[0,0,1]],
    [[hw,-hh,-hd],[hw,hh,-hd],[-hw,hh,-hd],[-hw,-hh,-hd],[0,0,-1]],
  ];
  const pos = [], nor = [], idx = [];
  faces.forEach((f, i) => {
    const n = f[4];
    for (let k = 0; k < 4; k++) { pos.push(...f[k]); nor.push(...n); }
    const o = i * 4;
    idx.push(o, o+1, o+2, o, o+2, o+3);
  });
  return [pos, nor, idx];
}

const [dp, dn, di] = dome(28, 96);
addMesh('clubhouse_dome', dp, dn, di, [0, 0, 0]);
for (let i = 0; i < 4; i++) {
  const [bp, bn, bi] = box(30, 90 + i * 12, 24);
  addMesh('tower_' + (i + 1), bp, bn, bi, [-90 + i * 60, (90 + i * 12) / 2, 40]);
}

const io = new NodeIO();
const glb = await io.writeBinary(doc);
writeFileSync(process.argv[2], glb);
const tris = doc.getRoot().listMeshes().reduce((n, m) => n + m.listPrimitives().reduce((k, p) => k + p.getIndices().getCount()/3, 0), 0);
console.log(`wrote ${process.argv[2]} - ${(glb.byteLength/1024).toFixed(0)} KB, ${tris.toLocaleString()} triangles, ${doc.getRoot().listMeshes().length} meshes`);
