/**
 * Builds three realistic PET-THEMED jewelry sample models, plus a studio
 * lighting map, with no downloads, no dependencies and no paid service (zero
 * credits):
 *
 *   anillo.glb   paw-print ring: comfort band, signet-style cushion, raised paw
 *                (pad + four toes) with a brilliant-cut diamond on each toe
 *   collar.glb   cable-chain necklace (interlocking links, alternating 90 deg)
 *                with a gold dog-face pendant: ears, muzzle, enamel nose/eyes
 *   pulsera.glb  charm bracelet: chain loop, spring-ring clasp and three charms
 *                (bone, paw, puffed heart) hung from jump rings
 *
 *   studio-env.hdr  softbox lighting. Polished metal and gems are only as
 *                   convincing as what they reflect; a uniform default
 *                   environment makes gold look flat and a diamond look dead.
 *
 * Every piece names its metal material "Metal" so the page can recolour it to
 * gold / silver / rose gold at runtime (one file per piece instead of nine).
 * These are hand-built examples, NOT generated from a visitor's photo.
 *
 *   node scripts/make-realistic-pieces.mjs ../models/samples ../assets/studio-env.hdr
 *   GEM_MODE=glass node ...   (diamond as transmissive glass instead of mirror)
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const outModels = resolve(process.argv[2] ?? "../models/samples");
const outEnv = resolve(process.argv[3] ?? "../assets/studio-env.hdr");
const GEM_MODE = process.env.GEM_MODE ?? "white";

const TAU = Math.PI * 2;
const D2R = Math.PI / 180;

// ------------------------------------------------------------------ vectors --
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const mul = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const len = (a) => Math.hypot(a[0], a[1], a[2]);
const norm = (a) => {
  const l = len(a) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};
const lerp = (a, b, t) => a + (b - a) * t;
const clamp01 = (x) => Math.min(1, Math.max(0, x));
const smooth = (a, b, x) => {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};
const sgnPow = (x, e) => Math.sign(x) * Math.pow(Math.abs(x), e);

/** Uniform Catmull-Rom through `pts` (arrays of any dimension), t in 0..1 (clamped). */
function catmull(pts, t) {
  const n = pts.length - 1;
  const x = clamp01(t) * n;
  const i = Math.min(Math.floor(x), n - 1);
  const f = x - i;
  const p0 = pts[Math.max(i - 1, 0)];
  const p1 = pts[i];
  const p2 = pts[i + 1];
  const p3 = pts[Math.min(i + 2, n)];
  return p1.map(
    (_, k) =>
      0.5 *
      (2 * p1[k] +
        (-p0[k] + p2[k]) * f +
        (2 * p0[k] - 5 * p1[k] + 4 * p2[k] - p3[k]) * f * f +
        (-p0[k] + 3 * p1[k] - 3 * p2[k] + p3[k]) * f * f * f),
  );
}

/** Any two unit vectors perpendicular to `axis` (and to each other). */
function perpBasis(axis) {
  const a = norm(axis);
  const helper = Math.abs(a[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
  const e1 = norm(cross(a, helper));
  const e2 = cross(a, e1);
  return [e1, e2, a];
}

// ----------------------------------------------------------------- builder --
class Builder {
  prims = new Map();

  prim(name) {
    if (!this.prims.has(name)) this.prims.set(name, { pos: [], nrm: [], idx: [] });
    return this.prims.get(name);
  }

  /**
   * A (cols x rows) grid of vertices over u,v in 0..1. `fn(u, v)` returns
   * { p, c }: the surface point and a point inside the surface nearby (used
   * only to decide which way is "outward"). Normals come from finite
   * differences, so seams and joins are smooth as long as `fn` is periodic.
   */
  grid(name, cols, rows, fn) {
    const P = this.prim(name);
    const base = P.pos.length / 3;
    const eps = 1e-4;
    for (let i = 0; i <= rows; i++) {
      for (let j = 0; j <= cols; j++) {
        const u = j / cols;
        const v = i / rows;
        const { p, c } = fn(u, v);
        const du = sub(fn(u + eps, v).p, fn(u - eps, v).p);
        const dv = sub(fn(u, v + eps).p, fn(u, v - eps).p);
        let n = cross(du, dv);
        const out = sub(p, c);
        if (len(n) < 1e-13) {
          // collapsed point (e.g. the closed tip of a tube): use "away from the
          // centre" if there is one, else the tube's own direction
          if (len(out) > 1e-9) n = out;
          else if (len(du) > 1e-12) n = mul(du, u < 0.5 ? -1 : 1);
          else n = [0, 1, 0];
        } else if (dot(n, out) < 0) n = mul(n, -1);
        n = norm(n);
        P.pos.push(p[0], p[1], p[2]);
        P.nrm.push(n[0], n[1], n[2]);
      }
    }
    const at = (k) => [P.pos[k * 3], P.pos[k * 3 + 1], P.pos[k * 3 + 2]];
    const nat = (k) => [P.nrm[k * 3], P.nrm[k * 3 + 1], P.nrm[k * 3 + 2]];
    const tri = (x, y, z) => {
      const gn = cross(sub(at(y), at(x)), sub(at(z), at(x)));
      if (len(gn) < 1e-20) return; // pole / collapsed cap: nothing to draw
      const ns = add(add(nat(x), nat(y)), nat(z));
      if (dot(gn, ns) < 0) P.idx.push(x, z, y);
      else P.idx.push(x, y, z);
    };
    for (let i = 0; i < rows; i++) {
      for (let j = 0; j < cols; j++) {
        const a = base + i * (cols + 1) + j;
        const b = a + cols + 1;
        tri(a, b, a + 1);
        tri(b, b + 1, a + 1);
      }
    }
  }

  /** Flat-shaded triangles (gem facets). Normals point away from `centre`. */
  flat(name, triangles, centre) {
    const P = this.prim(name);
    for (const [a, b, c] of triangles) {
      let n = norm(cross(sub(b, a), sub(c, a)));
      const mid = mul(add(add(a, b), c), 1 / 3);
      let [v0, v1, v2] = [a, b, c];
      if (dot(n, sub(mid, centre)) < 0) {
        n = mul(n, -1);
        [v1, v2] = [v2, v1];
      }
      const k = P.pos.length / 3;
      for (const v of [v0, v1, v2]) {
        P.pos.push(v[0], v[1], v[2]);
        P.nrm.push(n[0], n[1], n[2]);
      }
      P.idx.push(k, k + 1, k + 2);
    }
  }
}

// ------------------------------------------------------------------ shapes --
const identity = (p) => p;

/** Round tube along a path. frame(u,P,T) -> [e1,e2]; radius(u,a) -> number. */
function tube(B, name, { path, frame, radius, cols, rows, xf = identity }) {
  B.grid(name, cols, rows, (u, v) => {
    const eps = 1e-3;
    const P = path(u);
    const T = norm(sub(path(Math.min(1, u + eps)), path(Math.max(0, u - eps))));
    const [e1, e2] = frame(u, P, T);
    const a = v * TAU;
    const r = radius(u, a);
    const p = add(P, add(mul(e1, r * Math.cos(a)), mul(e2, r * Math.sin(a))));
    return { p: xf(p), c: xf(P) };
  });
}

/** Torus around `axis` through `centre`: major radius R, tube radius r. */
function torus(B, name, centre, axis, R, r, { cols = 64, rows = 20, xf = identity } = {}) {
  const [e1, e2, ax] = perpBasis(axis);
  B.grid(name, cols, rows, (u, v) => {
    const a = u * TAU;
    const b = v * TAU;
    const ring = add(mul(e1, Math.cos(a)), mul(e2, Math.sin(a)));
    const c = add(centre, mul(ring, R));
    const p = add(c, add(mul(ring, r * Math.cos(b)), mul(ax, r * Math.sin(b))));
    return { p: xf(p), c: xf(c) };
  });
}

/** Surface of revolution around Y. profile: [[radius, y], ...] smoothed. */
function lathe(B, name, profile, { cols = 48, rows = 24, xf = identity } = {}) {
  B.grid(name, cols, rows, (u, v) => {
    const [r, y] = catmull(profile, v);
    const a = u * TAU;
    return { p: xf([r * Math.cos(a), y, r * Math.sin(a)]), c: xf([0, y, 0]) };
  });
}

function ellipsoid(B, name, centre, [rx, ry, rz], { cols = 48, rows = 32, xf = identity } = {}) {
  B.grid(name, cols, rows, (u, v) => {
    const a = u * TAU;
    const b = v * Math.PI;
    const s = [Math.sin(b) * Math.cos(a), Math.cos(b), Math.sin(b) * Math.sin(a)];
    return { p: xf(add(centre, [rx * s[0], ry * s[1], rz * s[2]])), c: xf(centre) };
  });
}

// -------------------------------------------------- 1. SOLITAIRE RING --------

/** Round brilliant diamond, built facet by facet. Local origin: girdle bottom. */
function brilliantFacets(R, rotY, origin) {
  const g = 0.034 * R; // girdle thickness
  const Hc = 0.32 * R; // crown height   (about 16% of the diameter)
  const Dp = 0.86 * R; // pavilion depth (about 43% of the diameter)
  const Rt = 0.57 * R; // table radius   (57% table)
  const pol = (r, deg, y) => {
    const a = (deg + rotY) * D2R;
    return add(origin, [r * Math.cos(a), y, r * Math.sin(a)]);
  };
  // Heights chosen so every kite facet is planar (see derivation in CLAUDE.md notes).
  const yS = g + Hc * ((R - 0.8 * R * Math.cos(22.5 * D2R)) / (R - Rt));
  const T = (k) => pol(Rt, 45 * (k % 8) + 22.5, g + Hc); // table corners
  const S = (k) => pol(0.8 * R, 45 * (k % 8), yS); // star points
  const Gt = (j) => pol(R, 22.5 * (j % 16), g); // girdle, top edge
  const Gb = (j) => pol(R, 22.5 * (j % 16), 0); // girdle, bottom edge
  const C = pol(0, 0, -Dp); // culet
  const yL = -Dp + Dp * ((0.65 * R * Math.cos(22.5 * D2R)) / R);
  const L = (k) => pol(0.65 * R, 45 * (k % 8) + 22.5, yL); // lower-girdle break points

  const tris = [];
  // table (octagon fan)
  for (let k = 1; k < 7; k++) tris.push([T(0), T(k), T(k + 1)]);
  for (let k = 0; k < 8; k++) {
    // star facets: triangle on each table edge, apex pointing at the girdle
    tris.push([S(k), T((k + 7) % 8), T(k)]);
    // bezel (kite) facets: table corner -> two stars -> girdle point
    tris.push([T(k), S(k), Gt(2 * k + 1)]);
    tris.push([T(k), Gt(2 * k + 1), S(k + 1)]);
    // upper girdle facets: two triangles under each star point
    tris.push([S(k), Gt((2 * k + 15) % 16), Gt(2 * k)]);
    tris.push([S(k), Gt(2 * k), Gt(2 * k + 1)]);
    // pavilion mains (kites centred on the star angles) and lower girdle facets
    tris.push([C, L((k + 7) % 8), Gb(2 * k)]);
    tris.push([C, Gb(2 * k), L(k)]);
    tris.push([L(k), Gb(2 * k), Gb(2 * k + 1)]);
    tris.push([L(k), Gb(2 * k + 1), Gb(2 * k + 2)]);
  }
  // girdle band
  for (let j = 0; j < 16; j++) {
    tris.push([Gt(j), Gb(j), Gb(j + 1)]);
    tris.push([Gt(j), Gb(j + 1), Gt(j + 1)]);
  }
  return { tris, centre: add(origin, [0, 0.1 * R, 0]), culetY: origin[1] - Dp, tableY: origin[1] + g + Hc };
}

// ---------------------------------------------------------------- transforms --
const rotX = (p, a) => [p[0], p[1] * Math.cos(a) - p[2] * Math.sin(a), p[1] * Math.sin(a) + p[2] * Math.cos(a)];
const rotY = (p, a) => [p[0] * Math.cos(a) + p[2] * Math.sin(a), p[1], -p[0] * Math.sin(a) + p[2] * Math.cos(a)];
const rotZ = (p, a) => [p[0] * Math.cos(a) - p[1] * Math.sin(a), p[0] * Math.sin(a) + p[1] * Math.cos(a), p[2]];
const compose = (...fs) => (p) => fs.reduce((q, f) => f(q), p);

/**
 * A (possibly rotated) ellipsoid in local coordinates, sent through `map` into
 * world space. The workhorse for paw pads, toes, ears, muzzles and bone ends.
 */
function blob(B, name, c, r, { rot = identity, map = identity, cols = 48, rows = 32 } = {}) {
  B.grid(name, cols, rows, (u, v) => {
    const a = u * TAU;
    const b = v * Math.PI;
    const s = [Math.sin(b) * Math.cos(a), Math.sin(b) * Math.sin(a), Math.cos(b)];
    const q = rot([r[0] * s[0], r[1] * s[1], r[2] * s[2]]);
    return { p: map([c[0] + q[0], c[1] + q[1], c[2] + q[2]]), c: map(c) };
  });
}

/** One chain link: an elliptical torus with half-length a, half-width b, wire radius r. */
function chainLink(B, centre, T, O, a, b, r, { xf = identity, cols = 22, rows = 8 } = {}) {
  const P3 = norm(cross(T, O));
  B.grid("Metal", cols, rows, (u, v) => {
    const ang = u * TAU;
    const q = v * TAU;
    const E = add(mul(T, a * Math.cos(ang)), mul(O, b * Math.sin(ang)));
    const out = norm(add(mul(T, b * Math.cos(ang)), mul(O, a * Math.sin(ang))));
    const c = add(centre, E);
    const p = add(c, add(mul(out, r * Math.cos(q)), mul(P3, r * Math.sin(q))));
    return { p: xf(p), c: xf(c) };
  });
}

// ------------------------------------------------------------- paw print ----
// Local coordinates: x across, y toward the toes, z = height of the dome.
const PAW = {
  pad: [
    { c: [0, -0.11], r: [0.215, 0.115, 0.06], ang: 0 },
    { c: [-0.125, -0.015], r: [0.115, 0.11, 0.06], ang: 25 },
    { c: [0.125, -0.015], r: [0.115, 0.11, 0.06], ang: -25 },
    { c: [0, -0.04], r: [0.17, 0.12, 0.06], ang: 0 },
  ],
  toes: [
    { c: [-0.285, 0.145], r: [0.075, 0.1, 0.058], ang: 38 },
    { c: [-0.1, 0.285], r: [0.078, 0.105, 0.058], ang: 12 },
    { c: [0.1, 0.285], r: [0.078, 0.105, 0.058], ang: -12 },
    { c: [0.285, 0.145], r: [0.075, 0.1, 0.058], ang: -38 },
  ],
};

function pawPrint(B, map, { heightScale = 1 } = {}) {
  for (const part of [...PAW.pad, ...PAW.toes]) {
    const ang = part.ang * D2R;
    blob(B, "Metal", [part.c[0], part.c[1], 0], [part.r[0], part.r[1], part.r[2] * heightScale], {
      rot: (p) => rotZ(p, ang),
      map,
      cols: 34,
      rows: 22,
    });
  }
}

// ------------------------------------------------ 1. PAW-PRINT RING ---------

function buildPawRing() {
  const B = new Builder();
  const X = (p) => rotX(p, 36 * D2R); // tilt the whole ring toward the viewer

  // Band: comfort profile, slimming toward the head.
  const Rc = 0.95;
  const T = 0.085;
  const W0 = 0.14;
  B.grid("Metal", 170, 34, (u, v) => {
    const th = u * TAU;
    const a = v * TAU;
    const taper = Math.pow(Math.max(0, Math.sin(th)), 1.4);
    const w = W0 * (1 - 0.35 * taper);
    const t = T * (1 - 0.15 * taper);
    const rr = t * sgnPow(Math.cos(a), 0.8);
    const zz = w * sgnPow(Math.sin(a), 0.8);
    const dir = [Math.cos(th), Math.sin(th), 0];
    return { p: X([(Rc + rr) * dir[0], (Rc + rr) * dir[1], zz]), c: X([Rc * dir[0], Rc * dir[1], 0]) };
  });

  // Cushion under the print, wider than the band like a signet head.
  blob(B, "Metal", [0, 0.985, 0], [0.48, 0.07, 0.53], {
    map: X,
    cols: 56,
    rows: 36,
  });

  // The paw itself: local (x, toes-direction, height) -> world (x, up, forward).
  // Toes point toward -z so that, after the tilt, they point UP on screen.
  const Y0 = 1.03;
  const relief = 1.5;
  const kp = 1.12; // paw scale in the plane
  const midY = 0.0825; // paw's own centre line, so it sits centred on the cushion
  const px = (x) => kp * x;
  const pz = (y) => -kp * (y - midY);
  pawPrint(B, (l) => X([px(l[0]), Y0 + l[2], pz(l[1])]), { heightScale: relief });

  // A small brilliant-cut diamond on each toe, in a thin bezel.
  for (const toe of PAW.toes) {
    const top = Y0 + toe.r[2] * relief;
    const R = 0.05;
    const stone = brilliantFacets(R, 0, [px(toe.c[0]), top - 0.004, pz(toe.c[1])]);
    B.flat("Diamond", stone.tris.map((t) => t.map(X)), X(stone.centre));
    torus(B, "Metal", [px(toe.c[0]), top - 0.005, pz(toe.c[1])], [0, 1, 0], R + 0.007, 0.0098, {
      cols: 40,
      rows: 12,
      xf: X,
    });
  }
  return { B };
}

// -------------------------------------- 2. DOG-FACE PENDANT NECKLACE --------

function dogFace(B, xf) {
  const E = (name, c, r, rot = identity, extra = {}) => blob(B, name, c, r, { rot, map: xf, cols: 44, rows: 30, ...extra });

  E("Metal", [0, 0, 0], [0.6, 0.56, 0.36]); // head
  for (const s of [-1, 1]) {
    // floppy ears
    E("Metal", [s * 0.57, -0.14, 0.03], [0.16, 0.47, 0.11], (p) => rotY(rotZ(p, -s * 0.2), s * 0.34));
    // brows
    E("Metal", [s * 0.24, 0.255, 0.29], [0.09, 0.035, 0.05], (p) => rotZ(p, -s * 0.28), { cols: 32, rows: 20 });
    // eyes
    E("Enamel", [s * 0.23, 0.15, 0.3], [0.066, 0.079, 0.056], identity, { cols: 32, rows: 24 });
  }
  E("Metal", [0, -0.17, 0.3], [0.31, 0.25, 0.22]); // muzzle
  E("Metal", [0, -0.36, 0.27], [0.2, 0.13, 0.16], identity, { cols: 40, rows: 28 }); // chin
  E("Enamel", [0, -0.045, 0.505], [0.125, 0.085, 0.085], identity, { cols: 40, rows: 28 }); // nose

  // mouth: a short vertical line, then a smile to each side
  const mouth = (s) => [
    [0, -0.13, 0.5],
    [0, -0.235, 0.512],
    [s * 0.1, -0.285, 0.487],
    [s * 0.2, -0.268, 0.452],
  ];
  for (const s of [-1, 1]) {
    tube(B, "Enamel", {
      cols: 28,
      rows: 10,
      xf,
      path: (u) => catmull(mouth(s), u),
      frame: (u, P, Tn) => {
        const e1 = norm(cross(Tn, [0, 0, 1]));
        return [e1, cross(Tn, e1)];
      },
      radius: (u) => 0.013 * (u > 0.94 ? Math.sqrt(Math.max(0, 1 - Math.pow((u - 0.94) / 0.06, 2))) : 1),
    });
  }

  // top loop (the bail) and the small cap that joins it to the head
  blob(B, "Metal", [0, 0.575, 0], [0.1, 0.05, 0.075], { map: xf, cols: 32, rows: 20 });
  torus(B, "Metal", [0, 0.66, 0], [1, 0, 0], 0.1, 0.03, { cols: 48, rows: 16, xf });
}

function buildDogNecklace() {
  const B = new Builder();

  // Path: hangs like a necklace on a neck (front low, sides rising and curving back).
  const Rn = 0.95;
  const Yend = 1.35;
  const thMax = 1.45;
  const at = (s) => {
    const th = s * thMax;
    return [Rn * Math.sin(th), Yend * s * s, 0.9 * Rn * (Math.cos(th) - 1)];
  };
  const SAMPLES = 4000;
  const table = [0];
  let prev = at(-1);
  for (let i = 1; i <= SAMPLES; i++) {
    const p = at(-1 + (2 * i) / SAMPLES);
    table.push(table[i - 1] + len(sub(p, prev)));
    prev = p;
  }
  const total = table[SAMPLES];
  const sAtLen = (L) => {
    let lo = 0;
    let hi = SAMPLES;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (table[mid] < L) lo = mid;
      else hi = mid;
    }
    const f = (L - table[lo]) / (table[hi] - table[lo] || 1);
    return -1 + (2 * (lo + f)) / SAMPLES;
  };

  const a = 0.052; // link half-length
  const b = 0.034; // link half-width
  const r = 0.0105; // wire radius
  const dMax = 2 * a - 2.4 * r;
  let N = Math.ceil(total / dMax) + 1;
  if (N % 2 === 0) N += 1;
  const step = total / (N - 1);
  const mid = (N - 1) / 2;

  const ref = [0, 0, 1];
  const frameAt = (s) => {
    const T = norm(sub(at(Math.min(1, s + 1e-3)), at(Math.max(-1, s - 1e-3))));
    const Nn = norm(sub(ref, mul(T, dot(ref, T))));
    return { T, Nn, Bn: cross(T, Nn) };
  };
  for (let i = 0; i < N; i++) {
    const s = sAtLen(i * step);
    const { T, Nn, Bn } = frameAt(s);
    chainLink(B, at(s), T, (i - mid) % 2 === 0 ? Bn : Nn, a, b, r); // middle link faces the viewer
  }
  for (const end of [-1, 1]) {
    const s = sAtLen(end < 0 ? 0 : total);
    const { T, Nn, Bn } = frameAt(s);
    const lastFacesViewer = ((end < 0 ? 0 : N - 1) - mid) % 2 === 0;
    torus(B, "Metal", add(at(s), mul(T, end * (a + 0.016))), lastFacesViewer ? Nn : Bn, 0.04, 0.0095, {
      cols: 40,
      rows: 14,
    });
  }

  // Pendant: scaled so the bail's top sits at the centre link's hole.
  const s = 0.58;
  const y0 = -(0.66 + 0.1) * s;
  dogFace(B, (p) => [p[0] * s, p[1] * s + y0, p[2] * s]);
  return { B };
}

// ------------------------------------------------ 3. CHARM BRACELET ---------

function heart(B, name, k, hh, map) {
  const hx = (t) => 16 * Math.pow(Math.sin(t), 3);
  const hy = (t) => 13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t);
  for (const side of [1, -1]) {
    B.grid(name, 72, 22, (u, v) => {
      const t = u * TAU;
      const w = v; // 0 at the middle, 1 at the rim
      const p = [k * hx(t) * w, k * (-2 + (hy(t) + 2) * w), side * hh * Math.sqrt(Math.max(0, 1 - w * w))];
      return { p: map(p), c: map([0, -2 * k, 0]) };
    });
  }
}

function buildCharmBracelet() {
  const B = new Builder();
  const X = (p) => rotX(p, 24 * D2R);

  const Rb = 0.52;
  const a = 0.05;
  const b = 0.033;
  const r = 0.0105;
  const dMax = 2 * a - 2.2 * r;
  let N = Math.ceil((TAU * Rb) / dMax);
  if (N % 2 === 1) N += 1;

  const frame = (i) => {
    const th = -Math.PI / 2 + (TAU * i) / N; // link 0 sits at the bottom
    const T = [-Math.sin(th), Math.cos(th), 0];
    const Nr = [Math.cos(th), Math.sin(th), 0];
    return { th, T, Nr, centre: mul(Nr, Rb) };
  };
  for (let i = 0; i < N; i++) {
    const { T, Nr, centre } = frame(i);
    chainLink(B, centre, T, i % 2 === 0 ? Nr : [0, 0, 1], a, b, r, { xf: X });
  }

  // Spring-ring clasp at the top.
  {
    const { T, Nr, centre } = frame(N / 2);
    const hook = add(centre, mul(Nr, b));
    torus(B, "Metal", hook, T, 0.04, 0.012, { cols: 40, rows: 14, xf: X });
    blob(B, "Metal", add(hook, mul(Nr, 0.046)), [0.022, 0.022, 0.016], { map: X, cols: 24, rows: 16 });
  }

  // Charms hang from jump rings through every fourth link at the bottom.
  const RJ = 0.026;
  const rj = 0.008;
  const RL = 0.024;
  const rL = 0.008;
  const charms = [
    [-4, "bone"],
    [0, "paw"],
    [4, "heart"],
  ];
  for (const [offset, kind] of charms) {
    const i = (offset + N) % N;
    const { T, Nr, centre } = frame(i);
    const B3 = [0, 0, 1];
    const hook = add(centre, mul(Nr, b)); // outer tube of the link
    torus(B, "Metal", hook, T, RJ, rj, { cols: 36, rows: 12, xf: X });
    const O = add(hook, mul(Nr, RJ + rj + rL)); // top of the charm's own loop
    // design coords: x right, y up (toward the bracelet), z toward the viewer
    const map = (p) => X(add(O, add(mul(T, p[0]), add(mul(Nr, -p[1]), mul(B3, p[2])))));
    torus(B, "Metal", add(O, mul(Nr, RL)), B3, RL, rL, { cols: 32, rows: 12, xf: X });
    const top = -2 * RL - rL; // underside of the loop
    const cs = 1.35; // charm size
    if (kind === "bone") {
      const yb = top - 0.03 * cs - 0.002;
      blob(B, "Metal", [0, yb, 0], [0.13 * cs, 0.03 * cs, 0.022 * cs], { map, cols: 32, rows: 16 });
      for (const sx of [-1, 1]) {
        for (const sy of [-1, 1]) {
          blob(B, "Metal", [sx * 0.118 * cs, yb + sy * 0.03 * cs, 0], [0.043 * cs, 0.043 * cs, 0.03 * cs], {
            map,
            cols: 24,
            rows: 16,
          });
        }
      }
    } else if (kind === "paw") {
      const k = 0.27 * cs;
      const cy = top - 0.39 * k - 0.004; // toe tips touch the loop
      pawPrint(B, (l) => map([k * l[0], cy + k * l[1], 0.6 * l[2]]), { heightScale: 1.0 });
    } else {
      const k = 0.0066 * cs;
      heart(B, "Metal", k, 0.034 * cs, (p) => map([p[0], p[1] + top - 12 * k - 0.002, p[2]]));
    }
  }
  return { B };
}

// ------------------------------------------------------------------- glTF ----

function materialDefs() {
  const diamond =
    GEM_MODE === "glass"
      ? {
          name: "Diamond",
          pbrMetallicRoughness: { baseColorFactor: [1, 1, 1, 1], metallicFactor: 0, roughnessFactor: 0 },
          extensions: {
            KHR_materials_transmission: { transmissionFactor: 1 },
            KHR_materials_ior: { ior: 2.42 },
            KHR_materials_volume: { thicknessFactor: 0.3, attenuationDistance: 3, attenuationColor: [1, 1, 1] },
          },
        }
      : GEM_MODE === "mirror"
        ? {
            name: "Diamond",
            pbrMetallicRoughness: { baseColorFactor: [0.985, 0.99, 1, 1], metallicFactor: 1, roughnessFactor: 0.015 },
          }
        : {
            // bright white stone: diffuse body + strong high-index reflections on every facet
            name: "Diamond",
            pbrMetallicRoughness: { baseColorFactor: [0.97, 0.98, 1, 1], metallicFactor: 0, roughnessFactor: 0.03 },
            extensions: { KHR_materials_ior: { ior: 2.42 } },
          };
  return {
    Metal: {
      name: "Metal",
      pbrMetallicRoughness: { baseColorFactor: [1.0, 0.766, 0.336, 1], metallicFactor: 1, roughnessFactor: 0.2 },
    },
    Diamond: diamond,
    Enamel: {
      name: "Enamel",
      pbrMetallicRoughness: { baseColorFactor: [0.015, 0.015, 0.017, 1], metallicFactor: 0, roughnessFactor: 0.14 },
      extensions: { KHR_materials_clearcoat: { clearcoatFactor: 1, clearcoatRoughnessFactor: 0.05 } },
    },
  };
}

function toGlb(builder, title) {
  const defs = materialDefs();
  const names = [...builder.prims.keys()];
  const pad4 = (n) => (n + 3) & ~3;

  const chunks = [];
  const bufferViews = [];
  const accessors = [];
  const primitives = [];
  const materials = [];
  const used = new Set();
  let offset = 0;
  const push = (typed, target) => {
    const bytes = Buffer.from(typed.buffer, typed.byteOffset, typed.byteLength);
    const padded = Buffer.alloc(pad4(bytes.length));
    bytes.copy(padded);
    chunks.push(padded);
    bufferViews.push({ buffer: 0, byteOffset: offset, byteLength: bytes.length, target });
    offset += padded.length;
    return bufferViews.length - 1;
  };

  for (const name of names) {
    const P = builder.prims.get(name);
    const pos = new Float32Array(P.pos);
    const nrm = new Float32Array(P.nrm);
    const wide = P.pos.length / 3 > 65535;
    const idx = wide ? new Uint32Array(P.idx) : new Uint16Array(P.idx);
    const min = [Infinity, Infinity, Infinity];
    const max = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < pos.length; i += 3) {
      for (let k = 0; k < 3; k++) {
        min[k] = Math.min(min[k], pos[i + k]);
        max[k] = Math.max(max[k], pos[i + k]);
      }
    }
    const bvPos = push(pos, 34962);
    const bvNrm = push(nrm, 34962);
    const bvIdx = push(idx, 34963);
    accessors.push({ bufferView: bvPos, componentType: 5126, count: pos.length / 3, type: "VEC3", min, max });
    accessors.push({ bufferView: bvNrm, componentType: 5126, count: nrm.length / 3, type: "VEC3" });
    accessors.push({ bufferView: bvIdx, componentType: wide ? 5125 : 5123, count: idx.length, type: "SCALAR" });
    const a0 = accessors.length - 3;
    primitives.push({ attributes: { POSITION: a0, NORMAL: a0 + 1 }, indices: a0 + 2, material: materials.length });
    const def = defs[name];
    materials.push(def);
    for (const ext of Object.keys(def.extensions ?? {})) used.add(ext);
  }

  const json = {
    asset: { version: "2.0", generator: "habibi-eisaa realistic-pieces script" },
    ...(used.size ? { extensionsUsed: [...used] } : {}),
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0, name: title }],
    meshes: [{ name: title, primitives }],
    materials,
    accessors,
    bufferViews,
    buffers: [{ byteLength: offset }],
  };
  const jsonBytes = Buffer.from(JSON.stringify(json), "utf8");
  const jsonChunk = Buffer.concat([jsonBytes, Buffer.alloc(pad4(jsonBytes.length) - jsonBytes.length, 0x20)]);
  const bin = Buffer.concat(chunks);
  const total = 12 + 8 + jsonChunk.length + 8 + bin.length;
  const head = Buffer.alloc(12);
  head.write("glTF", 0, "ascii");
  head.writeUInt32LE(2, 4);
  head.writeUInt32LE(total, 8);
  const ch = (length, type) => {
    const h = Buffer.alloc(8);
    h.writeUInt32LE(length, 0);
    h.write(type, 4, "ascii");
    return h;
  };
  return Buffer.concat([head, ch(jsonChunk.length, "JSON"), jsonChunk, ch(bin.length, "BIN\0"), bin]);
}

// --------------------------------------------------- studio lighting map -----

/** Equirectangular studio lighting as a Radiance .hdr (flat RGBE, no compression). */
function studioHdr(W = 256, H = 128) {
  const px = Buffer.alloc(W * H * 4);
  const box = (az, el, dAz, dEl, x, y) => {
    const da = Math.abs(((x - az + Math.PI * 3) % TAU) - Math.PI);
    return smooth(dAz, dAz * 0.7, da) * smooth(dEl, dEl * 0.7, Math.abs(y - el));
  };
  for (let j = 0; j < H; j++) {
    const el = (0.5 - (j + 0.5) / H) * Math.PI; // +90deg = straight up
    for (let i = 0; i < W; i++) {
      const az = ((i + 0.5) / W) * TAU - Math.PI;
      // base: dark warm studio, brighter overhead, warm floor bounce
      const up = clamp01(el / (Math.PI / 2));
      const down = clamp01(-el / (Math.PI / 2));
      let r = 0.1 + 0.16 * up + 0.2 * down;
      let g = 0.095 + 0.15 * up + 0.17 * down;
      let b = 0.09 + 0.14 * up + 0.14 * down;
      const light = (az0, el0, dAz, dEl, power, tint) => {
        const m = box(az0, el0, dAz, dEl, az, el) * power;
        r += m * tint[0];
        g += m * tint[1];
        b += m * tint[2];
      };
      light(0, 1.2, 1.5, 0.45, 9, [1, 0.98, 0.95]); // big overhead softbox
      light(-0.9, 0.2, 0.2, 0.62, 6, [1, 0.97, 0.92]); // tall strip, front-left
      light(0.9, 0.15, 0.2, 0.62, 5, [0.93, 0.96, 1]); // tall strip, front-right (cooler)
      light(Math.PI, 0.35, 0.55, 0.28, 4, [1, 1, 1]); // back rim
      light(0, -0.25, 1.1, 0.16, 1.3, [1, 0.92, 0.8]); // warm low fill
      const m = Math.max(r, g, b);
      const o = (j * W + i) * 4;
      if (m < 1e-32) continue;
      const e = Math.ceil(Math.log2(m));
      const s = 256 / Math.pow(2, e);
      px[o] = Math.min(255, Math.floor(r * s));
      px[o + 1] = Math.min(255, Math.floor(g * s));
      px[o + 2] = Math.min(255, Math.floor(b * s));
      px[o + 3] = e + 128;
    }
  }
  const header = Buffer.from(`#?RADIANCE\nFORMAT=32-bit_rle_rgbe\n\n-Y ${H} +X ${W}\n`, "ascii");
  return Buffer.concat([header, px]);
}

// -------------------------------------------------------------------- main ---

mkdirSync(outModels, { recursive: true });
mkdirSync(dirname(outEnv), { recursive: true });
const pieces = [
  ["anillo", "Anillo de huella", buildPawRing],
  ["collar", "Collar con dije de perro", buildDogNecklace],
  ["pulsera", "Pulsera con dijes", buildCharmBracelet],
];
for (const [file, title, build] of pieces) {
  const { B } = build();
  const glb = toGlb(B, title);
  const out = resolve(outModels, `${file}.glb`);
  writeFileSync(out, glb);
  const verts = [...B.prims.values()].reduce((n, p) => n + p.pos.length / 3, 0);
  console.log(`${out}  ${(glb.length / 1024).toFixed(0)} KB  ${verts} vertices`);
}
const hdr = studioHdr();
writeFileSync(outEnv, hdr);
console.log(`${outEnv}  ${(hdr.length / 1024).toFixed(0)} KB`);
