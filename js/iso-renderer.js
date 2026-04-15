  /**
   * MANTIAS — Isometric Node-Map Renderer
   * ─────────────────────────────────────
   * Draws the supply-chain scene into the #iso-cubes SVG group.
   * No external dependencies. ~80 lines.
   *
   * COORDINATE SYSTEM
   *   iso(c, r) converts grid column/row to SVG screen coords.
   *   Uses TRUE isometric projection (30° axes, √3:1 ratio):
   *     U = 36, V = U/√3 ≈ 20.785
   *     screen x = OX + (c − r) × U
   *     screen y = OY + (c + r) × V
   *   This matches Illustrator's isometric preset exactly.
   *
 * SCENE ARRAY  — edit to change the node layout
 *   { c, r, h }
 *     c, r  — grid column / row (integers)
 *     h     — cube height in pixels
 *              0        → flat tile  (inactive / latent node)
 *              1–25     → short cube (peripheral)
 *              26–45    → medium     (active)
 *              46+      → tall cube  (primary)
 *
 * EDGES ARRAY  — edit to change connections
 *   [from-c, from-r, to-c, to-r]
 *   Drawn as dashed L-shaped polylines on the ground plane,
 *   rendered beneath the cubes.
 *
 * COLOR SYSTEM
 *   mix(ratio) blends brand ink (#04203e) into the warm background
 *   (#f6f5f1) at the given ratio (0 = bg, 1 = ink). Opaque — no
 *   rgba bleed-through on overlapping faces.
 */

(function () {
  var target = document.getElementById('iso-cubes');
  var U = 36;
  var V = U / Math.sqrt(3);  // true isometric: 30° axes → V ≈ 20.785
  var OX = 252, OY = 108;      // grid origin (screen coords)
  var STROKE = 'rgba(4,32,62,.12)';

  /* ── Glow note ───────────────────────────────────────────
     CSS filter: drop-shadow() is GPU-composited by the browser.
     SVG <feGaussianBlur> is CPU-rasterized every frame — avoid.
     Glow is passed as a CSS filter string via opts.cssFilter.
  ──────────────────────────────────────────────────────── */

  /* ── Solid colour mixer ─────────────────────────────────
     Blends brand ink into the warm background at `ratio`.
     Returns '#rrggbb' — opaque, no face bleed-through.
  ──────────────────────────────────────────────────────── */
  var BG_R  = 246, BG_G  = 245, BG_B  = 241;  // #f6f5f1
  var INK_R = 4,   INK_G = 32,  INK_B = 62;   // #04203e
  function mix(ratio) {
    var r = Math.round(BG_R + (INK_R - BG_R) * ratio);
    var g = Math.round(BG_G + (INK_G - BG_G) * ratio);
    var b = Math.round(BG_B + (INK_B - BG_B) * ratio);
    return '#' + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1);
  }
  /* ── Tinted colour mixer ────────────────────────────
     Like mix(), but blends toward a region tint colour
     instead of pure ink. Strength controls how much tint,
     ratio controls lightness.
     tint = { r, g, b } or null (falls back to mix)
  ──────────────────────────────────────────────────── */
  var TINT_STRENGTH = 0.45;  // how much tint vs ink (0 = pure ink, 1 = pure tint)
  function mixTint(ratio, tint) {
    if (!tint) return mix(ratio);
    // Blend ink toward the tint colour, then blend that into the background
    var tr = INK_R + (tint.r - INK_R) * TINT_STRENGTH;
    var tg = INK_G + (tint.g - INK_G) * TINT_STRENGTH;
    var tb = INK_B + (tint.b - INK_B) * TINT_STRENGTH;
    var r = Math.round(BG_R + (tr - BG_R) * ratio);
    var g = Math.round(BG_G + (tg - BG_G) * ratio);
    var b = Math.round(BG_B + (tb - BG_B) * ratio);
    return '#' + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1);
  }

  /* ── Region tint lookup ─────────────────────────────
     a* = blue (the mapped, the known)
     b* = warm grey (broader system)
     c* = cool grey (broader system)
  ──────────────────────────────────────────────────── */
  var REGION_TINTS = {
    a: { r: 30, g: 80,  b: 140 },  // saturated navy — brand-family blue
    b: { r: 90, g: 85,  b: 80  },  // warm grey
    c: { r: 75, g: 85,  b: 95  },  // cool grey
  };
  function tintFor(id) {
    if (!id) return null;
    return REGION_TINTS[id.charAt(0)] || null;
  }
  /* ── Shared animation ticker ─────────────────────────────────
     One RAF loop drives all cube grow/hover animations instead
     of spawning a separate requestAnimationFrame per cube.
  ──────────────────────────────────────────────────────── */
  var activeCubes = [];   // {currentH, targetH, setFaces}
  var rafId       = null;

  function sharedTick() {
    var stillRunning = false;
    for (var i = 0; i < activeCubes.length; i++) {
      var cube = activeCubes[i];
      var diff = cube.targetH - cube.currentH;
      if (Math.abs(diff) >= 1.5) {
        cube.currentH += diff * 0.06;
        cube.setFaces(cube.currentH);
        stillRunning = true;
      } else if (cube.currentH !== cube.targetH) {
        cube.currentH = cube.targetH;
        cube.setFaces(cube.currentH);
      }
    }
    rafId = stillRunning ? requestAnimationFrame(sharedTick) : null;
  }

  function scheduleSharedTick() {
    if (!rafId) rafId = requestAnimationFrame(sharedTick);
  }


  function iso(c, r) {
    return { x: OX + (c - r) * U, y: OY + (c + r) * V };
  }

  /* ── SVG polygon factory ────────────────────────────── */
  function poly(pts, fill) {
    var el = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
    el.setAttribute('points', pts);
    el.setAttribute('fill', fill);
    el.setAttribute('stroke', STROKE);
    el.setAttribute('stroke-width', '.5');
    return el;
  }

  /* ── Draw one cube at grid (c, r) with pixel height h ──────────
     ghost  = true  → very faint, no hover (background atmosphere)
     tint   = { r, g, b } or null  → region colour accent
     nodeId = string id for edge highlight lookup
  ───────────────────────────────────────────────────────────── */
  function drawCube(c, r, h, ghost, tint, nodeId, delay) {
    var p = iso(c, r);
    var x = p.x, y = p.y;

    // Floor-level diamond corners — FIXED, never change on hover
    var R = (x + U) + ',' + (y + V);
    var B = x       + ',' + (y + 2 * V);
    var L = (x - U) + ',' + (y + V);

    if (h === 0) {
      // Flat tile — barely visible, no hover
      target.appendChild(poly(x + ',' + y + ' ' + R + ' ' + B + ' ' + L, mix(ghost ? 0.025 : 0.06)));
      return;
    }

    // Ghost cubes get an automatic ground-plane diamond
    if (ghost) {
      var gd = poly(x + ',' + y + ' ' + R + ' ' + B + ' ' + L, mix(0.04));
      gd.setAttribute('stroke', 'rgba(4,32,62,.06)');
      gd.setAttribute('stroke-width', '0.5');
      target.appendChild(gd);
    }

    // Create group once; polygons are mutated in-place by setFaces()
    var g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    g.setAttribute('class', ghost ? 'iso-cube iso-cube--ghost' : 'iso-cube');

    var pLeft  = poly('', '');
    var pRight = poly('', '');
    var pTop   = poly('', '');
    g.appendChild(pLeft);
    g.appendChild(pRight);
    g.appendChild(pTop);
    target.appendChild(g);

    // Update the three face polygons for a given height hh
    function setFaces(hh) {
      var TT = x       + ',' + (y - hh);
      var TR = (x + U) + ',' + (y + V - hh);
      var TB = x       + ',' + (y + 2 * V - hh);
      var TL = (x - U) + ',' + (y + V - hh);
      var s  = Math.min(0.10 + hh / 300, 0.30);
      if (ghost) s *= 0.45;   // fade ghost cubes to ~45% strength
      pLeft.setAttribute('points',  TL + ' ' + TB + ' ' + B + ' ' + L);
      pLeft.setAttribute('fill',    mixTint(s * 1.70, tint));
      pRight.setAttribute('points', TR + ' ' + TB + ' ' + B + ' ' + R);
      pRight.setAttribute('fill',   mixTint(s * 1.35, tint));
      pTop.setAttribute('points',   TT + ' ' + TR + ' ' + TB + ' ' + TL);
      pTop.setAttribute('fill',     mixTint(s, tint));
    }

    // Initial paint at zero height — cubes grow in on load
    setFaces(0);

    if (ghost) return;   // ghost nodes are purely decorative — no interaction

    // Register this cube in the shared ticker
    var HOVER_H     = h + 30;
    var node        = nodeId ? nodeMap[nodeId] : null;
    var isActivated = node && node.activated;
    var state = { currentH: 0, targetH: isActivated ? HOVER_H : h, setFaces: setFaces };
    activeCubes.push(state);

    // Grow in on load after stagger delay
    setTimeout(function () { scheduleSharedTick(); }, delay || 0);

    g.addEventListener('mouseenter', function () {
      state.targetH = HOVER_H;
      scheduleSharedTick();
      if (nodeId) highlightEdgesFor(nodeId);
    });
    g.addEventListener('mouseleave', function () {
      state.targetH = isActivated ? HOVER_H : h;
      scheduleSharedTick();
      if (nodeId && !isActivated) resetEdgesFor(nodeId);
    });
  }

  /* ── Ghost edge — hairline, solid, very low opacity ────────── */
  function drawGhostEdge(id1, id2) {
    var n1 = nodeMap[id1], n2 = nodeMap[id2];
    if (!n1 || !n2) { console.warn('iso-renderer: unknown node id in ghostEdges:', !n1 ? id1 : id2); return null; }
    var from = iso(n1.c, n1.r); from.y += V;
    var bend = iso(n2.c, n1.r); bend.y += V;
    var to   = iso(n2.c, n2.r); to.y   += V;
    var el = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
    el.setAttribute('points',
      from.x + ',' + from.y + ' ' +
      bend.x + ',' + bend.y + ' ' +
      to.x   + ',' + to.y);
    el.setAttribute('fill', 'none');
    el.setAttribute('stroke', 'rgba(4,32,62,.22)');
    el.setAttribute('stroke-width', '1');
    el.setAttribute('stroke-dasharray', '3 4');
    return el;
  }

  /* ── Cross-region edge — L-shaped, stronger visibility ────── */
  function drawCrossEdge(id1, id2) {
    var n1 = nodeMap[id1], n2 = nodeMap[id2];
    if (!n1 || !n2) { console.warn('iso-renderer: unknown node id in crossEdges:', !n1 ? id1 : id2); return null; }
    var from = iso(n1.c, n1.r); from.y += V;
    var bend = iso(n2.c, n1.r); bend.y += V;
    var to   = iso(n2.c, n2.r); to.y   += V;

    var g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    g.setAttribute('class', 'iso-cross-edge');

    // L-shaped polyline
    var el = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
    el.setAttribute('points',
      from.x + ',' + from.y + ' ' +
      bend.x + ',' + bend.y + ' ' +
      to.x   + ',' + to.y);
    el.setAttribute('fill', 'none');
    el.setAttribute('stroke', 'rgba(4,32,62,.40)');
    el.setAttribute('stroke-width', '1.25');
    el.setAttribute('stroke-dasharray', '6 3');
    g.appendChild(el);

    // Endpoint dots
    var DOT_R = 2.5;
    [from, to].forEach(function (pt) {
      var dot = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      dot.setAttribute('cx', pt.x);
      dot.setAttribute('cy', pt.y);
      dot.setAttribute('r', DOT_R);
      dot.setAttribute('fill', 'rgba(4,32,62,.40)');
      dot.setAttribute('stroke', 'none');
      g.appendChild(dot);
    });

    return g;
  }

  /* ── Draw an isometric L-shaped edge between two nodes ──────── */
  function drawEdge(id1, id2) {
    var n1 = nodeMap[id1], n2 = nodeMap[id2];
    if (!n1 || !n2) { console.warn('iso-renderer: unknown node id in edges:', !n1 ? id1 : id2); return null; }
    var from = iso(n1.c, n1.r); from.y += V;
    var bend = iso(n2.c, n1.r); bend.y += V;
    var to   = iso(n2.c, n2.r); to.y   += V;
    var el = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
    el.setAttribute('points',
      from.x + ',' + from.y + ' ' +
      bend.x + ',' + bend.y + ' ' +
      to.x   + ',' + to.y);
    el.setAttribute('fill', 'none');
    el.setAttribute('stroke', 'rgba(4,32,62,.55)');
    el.setAttribute('stroke-width', '1.5');
    el.setAttribute('stroke-dasharray', '4 3');
    return el;
  }

  /* ── Draw a thin isometric platform (region boundary slab) ── */
  function drawPlatform(p) {
    var PAD = 0.6;   // padding around the cluster (grid units)
    var PH  = 3;     // platform thickness in px
    var tint = p.tint || null;

    // Diamond corners of the platform footprint
    // +1 accounts for cell extent (each cell occupies 1×1)
    var top   = iso(p.c1 - PAD, p.r1 - PAD);
    var right = iso(p.c2 + 1 + PAD, p.r1 - PAD);
    var bot   = iso(p.c2 + 1 + PAD, p.r2 + 1 + PAD);
    var left  = iso(p.c1 - PAD, p.r2 + 1 + PAD);

    var g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    g.setAttribute('class', 'iso-platform');

    // Left side face (thin strip along bottom-left edge)
    var lf = poly(
      left.x  + ',' + (left.y - PH) + ' ' +
      bot.x   + ',' + (bot.y  - PH) + ' ' +
      bot.x   + ',' +  bot.y        + ' ' +
      left.x  + ',' +  left.y,
      mixTint(0.08, tint)
    );
    lf.setAttribute('stroke', 'none');
    g.appendChild(lf);

    // Right side face (thin strip along bottom-right edge)
    var rf = poly(
      right.x + ',' + (right.y - PH) + ' ' +
      bot.x   + ',' + (bot.y   - PH) + ' ' +
      bot.x   + ',' +  bot.y         + ' ' +
      right.x + ',' +  right.y,
      mixTint(0.065, tint)
    );
    rf.setAttribute('stroke', 'none');
    g.appendChild(rf);

    // Top face (diamond) — clearly tinted, solid outline
    var tf = poly(
      top.x   + ',' + (top.y   - PH) + ' ' +
      right.x + ',' + (right.y - PH) + ' ' +
      bot.x   + ',' + (bot.y   - PH) + ' ' +
      left.x  + ',' + (left.y  - PH),
      mixTint(0.05, tint)
    );
    tf.setAttribute('stroke', tint ? mixTint(0.10, tint) : 'rgba(4,32,62,.08)');
    tf.setAttribute('stroke-width', '0.75');
    g.appendChild(tf);

    return g;
  }

  /* ══════════════════════════════════════════════════════
     Scene data is defined in js/scene-data.js which is
     loaded before this file. Edit that file to change
     nodes and connections.
     Globals consumed: scene, edges, crossEdges, platforms,
                       ghostScene, ghostEdges
  ══════════════════════════════════════════════════════ */

  /* ── Build id → {c, r} lookup from all nodes ─────────── */
  var nodeMap = {};
  ghostScene.concat(scene).forEach(function (n) { nodeMap[n.id] = n; });

  /* ── Edge registry: nodeId → [{ el, type }] ─────────── */
  var edgeRegistry = {};   // populated during rendering
  function registerEdge(id1, id2, el, type) {
    if (!edgeRegistry[id1]) edgeRegistry[id1] = [];
    if (!edgeRegistry[id2]) edgeRegistry[id2] = [];
    edgeRegistry[id1].push({ el: el, type: type });
    edgeRegistry[id2].push({ el: el, type: type });
  }

  /* ── Highlight helpers ──────────────────────────────── */
  var EDGE_HIGHLIGHT = {
    intra: { stroke: 'rgba(4,32,62,.85)', width: '2.5' },
    cross: { stroke: 'rgba(4,32,62,.70)', width: '2' },
  };
  var EDGE_DEFAULT = {
    intra: { stroke: 'rgba(4,32,62,.55)', width: '1.5' },
    cross: { stroke: 'rgba(4,32,62,.40)', width: '1.25' },
  };

  function highlightEdgesFor(nodeId) {
    var list = edgeRegistry[nodeId];
    if (!list) return;
    list.forEach(function (rec) {
      var style = EDGE_HIGHLIGHT[rec.type];
      // For cross-edge groups, target the polyline child
      var line = rec.el.tagName === 'g' ? rec.el.querySelector('polyline, line') : rec.el;
      if (line) {
        line.setAttribute('stroke', style.stroke);
        line.setAttribute('stroke-width', style.width);
        line.setAttribute('stroke-dasharray', 'none');
      }
      // Also brighten endpoint dots
      if (rec.el.tagName === 'g') {
        var dots = rec.el.querySelectorAll('circle');
        dots.forEach(function (d) { d.setAttribute('fill', style.stroke); });
      }
    });
  }

  function resetEdgesFor(nodeId) {
    var list = edgeRegistry[nodeId];
    if (!list) return;
    list.forEach(function (rec) {
      var style = EDGE_DEFAULT[rec.type];
      var dash  = rec.type === 'cross' ? '6 3' : '4 3';
      var line = rec.el.tagName === 'g' ? rec.el.querySelector('polyline, line') : rec.el;
      if (line) {
        line.setAttribute('stroke', style.stroke);
        line.setAttribute('stroke-width', style.width);
        line.setAttribute('stroke-dasharray', dash);
      }
      if (rec.el.tagName === 'g') {
        var dots = rec.el.querySelectorAll('circle');
        dots.forEach(function (d) { d.setAttribute('fill', EDGE_DEFAULT.cross.stroke); });
      }
    });
  }

  /* ── Animation duration ─────────────────────────────────────
     Edge pulse animations stop after this many milliseconds.
     Set to 0 to disable pulses entirely.
  ──────────────────────────────────────────────────────── */
  var ANIMATION_DURATION_MS = 20000;

  // Inject shared keyframes once
  (function injectPulseCSS() {
    var style = document.createElement('style');
    style.textContent =
      '@keyframes pulse-travel { from { offset-distance: 0%; } to { offset-distance: 100%; } }' +
      '.iso-pulse-dot { offset-rotate: 0deg; will-change: offset-distance; }';
    document.head.appendChild(style);
  }());

  var pulseIdCounter = 0;
  function addEdgePulse(pulseLayer, id1, id2, opts) {
    var n1 = nodeMap[id1], n2 = nodeMap[id2];
    if (!n1 || !n2) return;
    var from = iso(n1.c, n1.r); from.y += V;
    var bend = iso(n2.c, n1.r); bend.y += V;
    var to   = iso(n2.c, n2.r); to.y   += V;

    if (!isFinite(from.x) || !isFinite(from.y) ||
        !isFinite(bend.x) || !isFinite(bend.y) ||
        !isFinite(to.x)   || !isFinite(to.y)) return;

    var pathD = 'M' + from.x + ',' + from.y +
               'L' + bend.x + ',' + bend.y +
               'L' + to.x   + ',' + to.y;

    var dot = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    dot.setAttribute('r',  opts.r || 2);
    dot.setAttribute('fill', opts.fill || 'rgba(4,32,62,.65)');
    dot.setAttribute('class', 'iso-pulse-dot');
    dot.style.offsetPath      = "path('" + pathD + "')";
    dot.style.animation       = 'pulse-travel ' + (opts.dur || '3s') + ' linear ' + (opts.delay || '0s') + ' infinite';
    if (opts.cssFilter) dot.style.filter = opts.cssFilter;
    pulseLayer.appendChild(dot);
  }

  /* ── Render ───────────────────────────────────────────── */
  // 1. Platforms (deepest — region boundary slabs)
  if (typeof platforms !== 'undefined') {
    platforms.forEach(function (p) {
      target.appendChild(drawPlatform(p));
    });
  }

  // 2. Ghost edges
  ghostEdges.forEach(function (e) {
    var el = drawGhostEdge(e[0], e[1]);
    if (el) target.appendChild(el);
  });

  // 3. Ghost cubes (background atmosphere)
  ghostScene
    .sort(function (a, b) { return (a.c + a.r) - (b.c + b.r) || a.c - b.c; })
    .forEach(function (n) { drawCube(n.c, n.r, n.h, true, null); });

  // 4. Cross-region edges (supply chain flows between clusters)
  if (typeof crossEdges !== 'undefined') {
    crossEdges.forEach(function (e) {
      var el = drawCrossEdge(e[0], e[1]);
      if (el) {
        target.appendChild(el);
        registerEdge(e[0], e[1], el, 'cross');
      }
    });
  }

  // 5. Intra-cluster edges
  edges.forEach(function (e) {
    var el = drawEdge(e[0], e[1]);
    if (el) {
      target.appendChild(el);
      registerEdge(e[0], e[1], el, 'intra');
    }
  });

  // 6. Pulse layer — inserted HERE so cubes render on top of it
  var pulseLayer = document.createElementNS('http://www.w3.org/2000/svg', 'g');
  pulseLayer.setAttribute('class', 'iso-pulse-layer');
  pulseLayer.style.willChange = 'transform';  // promote to compositor layer

  // Seeded PRNG (mulberry32) — same layout on every reload, no jarring changes
  var _seed = 0x9e3779b9;
  function rand() {
    _seed += 0x6d2b79f5;
    var t = _seed;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  // rand() in [lo, hi]
  function rnd(lo, hi) { return lo + rand() * (hi - lo); }
  // random integer in [lo, hi] inclusive
  function rndInt(lo, hi) { return Math.floor(rnd(lo, hi + 1)); }

  // Spawn `count` evenly-phase-distributed pulses on an edge,
  // each with a small random jitter on speed and phase
  function spawnPulses(edgePair, count, baseOpts) {
    for (var k = 0; k < count; k++) {
      var durBase  = parseFloat(baseOpts.dur);
      var dur      = (durBase * rnd(0.75, 1.35)).toFixed(2) + 's';
      // spread phases evenly across the cycle, then add small jitter
      var phase    = (k / count) * durBase + rnd(-0.3, 0.3);
      if (phase < 0) phase = 0;
      addEdgePulse(pulseLayer, edgePair[0], edgePair[1], {
        r:         baseOpts.r * rnd(0.8, 1.2),
        fill:      baseOpts.fill,
        dur:       dur,
        delay:     phase.toFixed(2) + 's',
        cssFilter: baseOpts.cssFilter,
      });
    }
  }

  // Ghost edge pulses — skipped (barely visible)

  if (ANIMATION_DURATION_MS > 0) {

    // Intra-cluster pulses — 1 pulse per edge
    edges.forEach(function (e) {
      spawnPulses(e, 1, {
        r:         2.0,
        fill:      'rgba(4,32,62,.45)',
        dur:       rnd(2.2, 4.0).toFixed(1) + 's',
      });
    });

    // Cross-region pulses — 1–2 pulses, navy accent
    if (typeof crossEdges !== 'undefined') {
      crossEdges.forEach(function (e) {
        var opacity = rnd(0.55, 0.80).toFixed(2);
        spawnPulses(e, rndInt(1, 2), {
          r:         rnd(2.5, 3.5),
          fill:      'rgba(30,80,140,' + opacity + ')',
          dur:       rnd(3.8, 6.5).toFixed(1) + 's',
        });
      });
    }

  }

  target.appendChild(pulseLayer);

  // Stop all pulse animations after ANIMATION_DURATION_MS.
  // Hover interactivity is unaffected (uses a separate RAF loop).
  if (ANIMATION_DURATION_MS > 0) {
    setTimeout(function () {
      var dots = pulseLayer.querySelectorAll('.iso-pulse-dot');
      for (var i = 0; i < dots.length; i++) dots[i].style.animation = 'none';
    }, ANIMATION_DURATION_MS);
  }

  /* ── Pause CSS animations + RAF when invisible ─────────────
     Pauses all CSS offset-path animations and the shared RAF
     when the tab is hidden or the SVG scrolls out of view.
  ──────────────────────────────────────────────────────── */
  var svgEl = target.parentNode;

  function pauseAll() {
    if (rafId) { cancelAnimationFrame(rafId); rafId = null; }
    pulseLayer.style.animationPlayState = 'paused';
    var dots = pulseLayer.querySelectorAll('.iso-pulse-dot');
    for (var i = 0; i < dots.length; i++) dots[i].style.animationPlayState = 'paused';
  }
  function resumeAll() {
    scheduleSharedTick();
    pulseLayer.style.animationPlayState = 'running';
    var dots = pulseLayer.querySelectorAll('.iso-pulse-dot');
    for (var i = 0; i < dots.length; i++) dots[i].style.animationPlayState = 'running';
  }

  document.addEventListener('visibilitychange', function () {
    document.hidden ? pauseAll() : resumeAll();
  });

  if (typeof IntersectionObserver !== 'undefined') {
    new IntersectionObserver(function (entries) {
      entries[0].isIntersecting ? resumeAll() : pauseAll();
    }, { threshold: 0.05 }).observe(svgEl);
  }
  // 7. Main cubes (foreground, interactive, tinted by region)
  //    Stagger the load animation by painter-sort index (80 ms per step)
  scene
    .sort(function (a, b) { return (a.c + a.r) - (b.c + b.r) || a.c - b.c; })
    .forEach(function (n, i) { drawCube(n.c, n.r, n.h, false, tintFor(n.id), n.id, i * 80); });

  // 8. Permanently highlight edges for activated nodes
  scene.forEach(function (n) {
    if (n.activated) highlightEdgesFor(n.id);
  });

}());
