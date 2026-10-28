/**
 * Builds the three sample 3D models used by the demo (paw-print medallion
 * pendant in gold, silver and rose gold) as .glb files, with no downloads and
 * no dependencies. They are what the page shows before anything is generated,
 * what the simulation and the mock provider return, and the safety net if the
 * real service is slow during a client meeting.
 *
 *   node scripts/make-sample-models.mjs ../models/samples
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const outDir = resolve(process.argv[2] ?? "../models/samples");

// ---------------------------------------------------------------- geometry --

class Mesh {
  positions = [];
  normals = [];
  indices = [];

  /** Adds a grid of vertices; `point(u, v)` returns { p: [x,y,z], n: [x,y,z] } for u,v in 0..1. */
  grid(cols, rows, point, flip = false) {
    const base = this.positions.length / 3;
    for (let i = 0; i <= rows; i++) {
      for (let j = 0; j <= cols; j++) {
        const { p, n } = point(j / cols, i / rows);
        const len = Math.hypot(...n) || 1;
        this.positions.push(...p);
        this.normals.push(n[0] / len, n[1] / len, n[2] / len);
      }
    }
    for (let i = 0; i < rows; i++) {
      for (let j = 0; j < cols; j++) {
        const a = base + i * (cols + 1) + j;
        const b = a + cols + 1;
        if (flip) this.indices.push(a, b, a + 1, b, b + 1, a + 1);
        else this.indices.push(a, a + 1, b, b, a + 1, b + 1);
      }
    }
  }
}

const rotZ = ([x, y, z], a) => [x * Math.cos(a) - y * Math.sin(a), x * Math.sin(a) + y * Math.cos(a), z];

/** Ellipsoid with radii (rx, ry, rz), rotated about Z, centred at (cx, cy, cz). */
function addEllipsoid(mesh, { rx, ry, rz, cx, cy, cz, angle = 0 }) {
  mesh.grid(36, 24, (u, v) => {
    const theta = u * Math.PI * 2;
    const phi = v * Math.PI;
    const s = [Math.sin(phi) * Math.cos(theta), Math.cos(phi), Math.sin(phi) * Math.sin(theta)];
    const p = rotZ([rx * s[0], ry * s[1], rz * s[2]], angle);
    const n = rotZ([s[0] / rx, s[1] / ry, s[2] / rz], angle);
    return { p: [p[0] + cx, p[1] + cy, p[2] + cz], n };
  });
}

/** Torus. `axis` "z": ring lies flat in XY (faces the viewer). `axis` "x": ring lies in YZ (a bail seen edge-on). */
function addTorus(mesh, { R, r, cx, cy, cz, axis }) {
  mesh.grid(
    48,
    16,
    (u, v) => {
      const a = u * Math.PI * 2;
      const b = v * Math.PI * 2;
      let p = [(R + r * Math.cos(b)) * Math.cos(a), (R + r * Math.cos(b)) * Math.sin(a), r * Math.sin(b)];
      let n = [Math.cos(b) * Math.cos(a), Math.cos(b) * Math.sin(a), Math.sin(b)];
      if (axis === "x") {
        // cyclic axis swap keeps the triangle winding intact
        p = [p[2], p[0], p[1]];
        n = [n[2], n[0], n[1]];
      }
      return { p: [p[0] + cx, p[1] + cy, p[2] + cz], n };
    },
    false,
  );
}

function buildPendant() {
  const mesh = new Mesh();
  // medallion disc + raised bezel
  addEllipsoid(mesh, { rx: 0.84, ry: 0.84, rz: 0.06, cx: 0, cy: 0, cz: -0.05 });
  addTorus(mesh, { R: 0.8, r: 0.05, cx: 0, cy: 0, cz: -0.02, axis: "z" });
  // paw print, embossed on the face
  addEllipsoid(mesh, { rx: 0.31, ry: 0.27, rz: 0.1, cx: 0, cy: -0.15, cz: 0.04 });
  const toes = [
    { cx: -0.45, cy: 0.2, angle: 0.4 },
    { cx: -0.17, cy: 0.43, angle: 0.13 },
    { cx: 0.17, cy: 0.43, angle: -0.13 },
    { cx: 0.45, cy: 0.2, angle: -0.4 },
  ];
  for (const toe of toes) addEllipsoid(mesh, { rx: 0.12, ry: 0.17, rz: 0.085, cz: 0.04, ...toe });
  // bail (the loop a chain passes through)
  addTorus(mesh, { R: 0.085, r: 0.03, cx: 0, cy: 0.9, cz: -0.04, axis: "x" });
  return mesh;
}

// ------------------------------------------------------------------- glTF --

function toGlb(mesh, name, baseColor) {
  const positions = new Float32Array(mesh.positions);
  const normals = new Float32Array(mesh.normals);
  const indices = new Uint16Array(mesh.indices);
  if (positions.length / 3 > 65535) throw new Error("too many vertices for 16-bit indices");

  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < positions.length; i += 3) {
    for (let k = 0; k < 3; k++) {
      min[k] = Math.min(min[k], positions[i + k]);
      max[k] = Math.max(max[k], positions[i + k]);
    }
  }

  const pad4 = (n) => (n + 3) & ~3;
  const posBytes = positions.byteLength;
  const nrmBytes = normals.byteLength;
  const idxBytes = indices.byteLength;
  const binLength = pad4(posBytes + nrmBytes + idxBytes);

  const json = {
    asset: { version: "2.0", generator: "habibi-eisaa sample-model script" },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0, name }],
    meshes: [{ name, primitives: [{ attributes: { POSITION: 0, NORMAL: 1 }, indices: 2, material: 0 }] }],
    materials: [
      {
        name: `${name} metal`,
        pbrMetallicRoughness: { baseColorFactor: [...baseColor, 1], metallicFactor: 1, roughnessFactor: 0.22 },
      },
    ],
    accessors: [
      { bufferView: 0, componentType: 5126, count: positions.length / 3, type: "VEC3", min, max },
      { bufferView: 1, componentType: 5126, count: normals.length / 3, type: "VEC3" },
      { bufferView: 2, componentType: 5123, count: indices.length, type: "SCALAR" },
    ],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: posBytes, target: 34962 },
      { buffer: 0, byteOffset: posBytes, byteLength: nrmBytes, target: 34962 },
      { buffer: 0, byteOffset: posBytes + nrmBytes, byteLength: idxBytes, target: 34963 },
    ],
    buffers: [{ byteLength: binLength }],
  };

  const jsonBytes = Buffer.from(JSON.stringify(json), "utf8");
  const jsonChunk = Buffer.concat([jsonBytes, Buffer.alloc(pad4(jsonBytes.length) - jsonBytes.length, 0x20)]);
  const binChunk = Buffer.alloc(binLength);
  Buffer.from(positions.buffer).copy(binChunk, 0);
  Buffer.from(normals.buffer).copy(binChunk, posBytes);
  Buffer.from(indices.buffer).copy(binChunk, posBytes + nrmBytes);

  const total = 12 + 8 + jsonChunk.length + 8 + binChunk.length;
  const header = Buffer.alloc(12);
  header.write("glTF", 0, "ascii");
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(total, 8);
  const chunkHeader = (length, type) => {
    const h = Buffer.alloc(8);
    h.writeUInt32LE(length, 0);
    h.write(type, 4, "ascii");
    return h;
  };
  return Buffer.concat([
    header,
    chunkHeader(jsonChunk.length, "JSON"),
    jsonChunk,
    chunkHeader(binChunk.length, "BIN\0"),
    binChunk,
  ]);
}

// Standard PBR base colours for these metals (reflectance at normal incidence).
const METALS = {
  oro: [1.0, 0.766, 0.336],
  plata: [0.972, 0.96, 0.915],
  "oro-rosa": [0.957, 0.68, 0.6],
};

mkdirSync(outDir, { recursive: true });
const pendant = buildPendant();
for (const [slug, color] of Object.entries(METALS)) {
  const file = resolve(outDir, `dije-huella-${slug}.glb`);
  const glb = toGlb(pendant, `Dije huella (${slug})`, color);
  writeFileSync(file, glb);
  console.log(`${file}  ${(glb.length / 1024).toFixed(0)} KB`);
}
