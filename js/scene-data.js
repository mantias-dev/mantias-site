/**
 * MANTIAS — Isometric Scene Data
 * ───────────────────────────────
 * Edit this file to change the node layout and connections.
 * The renderer (iso-renderer.js) reads these six globals.
 *
 * NODE FORMAT
 *   { id: 'uniqueId', c: column, r: row, h: height }
 *   c, r  — grid position (integers)
 *   h     — height in px  (0 = flat tile, 1–25 = short,
 *                          26–45 = medium, 46+ = tall)
 *
 * EDGE FORMAT
 *   ['from-id', 'to-id']
 *   Reference the id strings defined in the scene arrays.
 *   Missing ids are skipped with a console.warn — safe to leave
 *   stale edges when removing a node.
 *
 * PLATFORM FORMAT
 *   { c1, r1, c2, r2 }  — bounding grid cells (inclusive)
 *   Drawn as a thin isometric slab beneath each region.
 *
 * LAYOUT CONCEPT
 *   Three clustered regions representing supply-chain geography:
 *     Region A (top)        — API sources / raw-material origins
 *     Region B (mid-right)  — Manufacturing / formulation
 *     Region C (lower-left) — Distribution / end markets
 *   Within each region: dense internal links (edges).
 *   Across regions: sparser long-haul supply links (crossEdges).
 *   Each region sits on a thin platform to reinforce grouping.
 */

/* ══════════════════════════════════════════════════════════
   GHOST LAYER — peripheral atmosphere
   Low-height nodes scattered far from the main clusters,
   suggesting the network continues beyond the frame.
══════════════════════════════════════════════════════════ */
var ghostScene = [
  { id:'g1',  c:-1,  r:-1, h:  8 },   // above Region A
  { id:'g2',  c: 6,  r:-1, h:  5 },   // top gap between A & B
  { id:'g3',  c:-2,  r: 3, h:  6 },   // far left
  { id:'g4',  c:12,  r: 5, h:  4 },   // far right of Region B
  { id:'g5',  c:10,  r: 8, h:  3 },   // below-right, between B & C
  { id:'g6',  c: 2,  r: 8, h:  5 },   // left of Region C
  { id:'g7',  c: 6,  r:13, h:  3 },   // below Region C
];

var ghostEdges = [
  // Tendrils reaching toward the main clusters
  ['g1','a1'], ['g2','a2'], ['g3','a4'],
  ['g4','b2'], ['g5','c4'], ['g6','c1'],
  // Peripheral arcs
  ['g1','g3'], ['g3','g6'],            // left side
  ['g2','g4'], ['g4','g5'], ['g5','g7'],// right side
];

/* ══════════════════════════════════════════════════════════
   PLATFORMS — thin isometric slabs indicating region grouping
   Each covers the bounding cells of a cluster + auto-padding.
   Ghost nodes get tiny single-cell platforms.
══════════════════════════════════════════════════════════ */
var platforms = [
  // Main region platforms
  { c1: 0, r1: 0, c2: 4, r2: 2, tint: { r: 30,  g: 80,  b: 140 } },   // Region A — saturated navy
  { c1: 7, r1: 4, c2:10, r2: 6, tint: { r: 90,  g: 85,  b: 80  } },   // Region B — warm grey
  { c1: 4, r1: 9, c2: 8, r2:11, tint: { r: 75,  g: 85,  b: 95  } },   // Region C — cool grey
];

/* ══════════════════════════════════════════════════════════
   MAIN SCENE — three clustered regions
══════════════════════════════════════════════════════════ */
var scene = [
  // ─── Region A: API Sources (top) ─────────────────────
  { id:'a1', c: 1, r: 0, h: 120 },   // primary — dominant tall
  { id:'a2', c: 4, r: 0, h:  85 },   // secondary tall
  { id:'a3', c: 3, r: 2, h:  40 },   // regional hub
  { id:'a4', c: 0, r: 2, h:  25 },   // small supplier

  // ─── Region B: Manufacturing (mid-right) ─────────────
  { id:'b1', c: 8, r: 4, h: 110 },   // primary plant — tall anchor
  { id:'b2', c:10, r: 4, h:  50 },   // secondary plant
  { id:'b3', c: 9, r: 6, h:  25 },   // formulation site
  { id:'b4', c: 7, r: 5, h:  15 },   // warehouse / staging

  // ─── Region C: Markets (lower) ───────────────────
  { id:'c1', c: 4, r: 9, h:  48, activated: true },   // distribution hub — activated
  { id:'c2', c: 7, r: 9, h:  30 },   // secondary hub
  { id:'c3', c: 5, r:11, h:  16 },   // local market
  { id:'c4', c: 8, r:11, h:  10 },   // endpoint
];

/* ── Intra-cluster edges (dense, strong lines) ────────── */
var edges = [
  // Region A internal
  ['a1','a3'], ['a1','a4'], ['a2','a3'], ['a3','a4'],
  // Region B internal
  ['b1','b2'], ['b1','b3'], ['b1','b4'], ['b2','b3'],
  // Region C internal
  ['c1','c2'], ['c1','c3'], ['c2','c4'], ['c3','c4'],
];

/* ── Cross-region edges (supply chain flows, lighter) ─── */
var crossEdges = [
  // A → B
  ['a2','b1'],    // primary supply route
  ['a3','b4'],    // secondary
  // B → C
  ['b3','c2'],    // primary distribution
  ['b4','c1'],    // secondary
  // A → C  (direct bypass)
  ['a4','c1'],    // origin to market, bypassing manufacturing
];
