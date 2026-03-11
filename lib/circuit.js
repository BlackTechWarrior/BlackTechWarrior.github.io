/* ================================================================
   Shared Circuit Rendering Engine — /lib/circuit.js
   Used by /circuitgen/ and /kmap/
   
   v2 — Improved layout & wire routing
   - Multi-column wire routing with per-gap track allocation
   - Increased spacing to reduce visual clutter
   - Smarter barycenter + overlap resolution
   - Wire crossing minimization via track sorting
   ================================================================ */
(function() {
  'use strict';

  /* ── Inject CSS ── */
  const css = `
.cg-gate-body{fill:none;stroke-width:2;stroke-linejoin:round}
.cg-gate-and .cg-gate-body,.cg-gate-and .cg-bubble{stroke:#2d6abf}
.cg-gate-nand .cg-gate-body,.cg-gate-nand .cg-bubble{stroke:#7b4fbf}
.cg-gate-or .cg-gate-body,.cg-gate-or .cg-bubble{stroke:#2d8f4e}
.cg-gate-nor .cg-gate-body,.cg-gate-nor .cg-bubble{stroke:#bf4f6e}
.cg-gate-not .cg-gate-body,.cg-gate-not .cg-bubble{stroke:#b85c2f}
.cg-gate-xor .cg-gate-body,.cg-gate-xor .cg-bubble{stroke:#2fa5a5}
.cg-gate-xnor .cg-gate-body,.cg-gate-xnor .cg-bubble{stroke:#6b4fbf}
body.dark .cg-gate-and .cg-gate-body,body.dark .cg-gate-and .cg-bubble{stroke:#6ba3e8}
body.dark .cg-gate-nand .cg-gate-body,body.dark .cg-gate-nand .cg-bubble{stroke:#a87ee0}
body.dark .cg-gate-or .cg-gate-body,body.dark .cg-gate-or .cg-bubble{stroke:#5fc47e}
body.dark .cg-gate-nor .cg-gate-body,body.dark .cg-gate-nor .cg-bubble{stroke:#e07090}
body.dark .cg-gate-not .cg-gate-body,body.dark .cg-gate-not .cg-bubble{stroke:#e08050}
body.dark .cg-gate-xor .cg-gate-body,body.dark .cg-gate-xor .cg-bubble{stroke:#50d0d0}
body.dark .cg-gate-xnor .cg-gate-body,body.dark .cg-gate-xnor .cg-bubble{stroke:#9070e0}
.cg-bubble{fill:#ffffff;stroke-width:2}
body.dark .cg-bubble{fill:#1e1e1e}
.cg-wire{fill:none;stroke:#666666;stroke-width:1.5;stroke-linecap:round;stroke-linejoin:round}
body.dark .cg-wire{stroke:#999999}
.cg-wire-hl{stroke:#0066cc !important;stroke-width:2.5 !important}
body.dark .cg-wire-hl{stroke:#87ceeb !important}
.cg-highlight .cg-gate-body{stroke-width:3 !important}
.cg-label{font-family:system-ui,-apple-system,sans-serif;fill:#333333;pointer-events:none}
body.dark .cg-label{fill:#cccccc}
.cg-input-label{font-size:14px;font-weight:600;font-family:'SFMono-Regular',Consolas,monospace}
.cg-output-label{font-size:14px;font-weight:600}
.cg-gate-text{font-size:10px;font-weight:600;pointer-events:none}
.cg-junction{fill:#666666}
body.dark .cg-junction{fill:#999999}
.cg-tooltip{position:absolute;background:#ffffff;border:1px solid #cccccc;border-radius:6px;padding:8px 12px;font-size:12px;line-height:1.5;box-shadow:0 2px 8px rgba(0,0,0,0.1);pointer-events:none;z-index:10;max-width:280px}
body.dark .cg-tooltip{background:#2a2a2a;border-color:#555555;color:#e0e0e0}
.cg-tooltip strong{display:block;margin-bottom:2px}
`;
  const styleEl = document.createElement('style');
  styleEl.textContent = css;
  document.head.appendChild(styleEl);

  /* ── SVG helper ── */
  const NS = 'http://www.w3.org/2000/svg';
  function s(tag, attrs, children) {
    const el = document.createElementNS(NS, tag);
    if (attrs) for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
    if (typeof children === 'string') el.textContent = children;
    else if (children) children.forEach(c => { if (c) el.appendChild(c); });
    return el;
  }

  /* ── Constants ── */
  const GW = 50;          // gate body width
  const PIN_SP = 18;      // vertical spacing per pin
  const GH_MIN = 40;      // minimum gate height
  const BUBBLE_R = 5;     // NOT bubble radius
  const COL_GAP = 180;    // horizontal gap between columns
  const ROW_GAP = 55;     // vertical gap between gates
  const MARGIN_X = 80;    // left/right margin (was 70)
  const MARGIN_Y = 40;    // top/bottom margin (was 30)
  const PIN_LEN = 25;     // input/output stub length (was 20)
  const TRACK_SP = 16;    // spacing between wire tracks in routing channel
  const ROUTE_MARGIN = 20; // min distance from gate edge to first track

  /* ═══════════════════════════════════════════════════════
     Gate Shape Generators
     ═══════════════════════════════════════════════════════ */

  function gateH(n) { return Math.max(GH_MIN, n * PIN_SP + 4); }

  function andShape(n) {
    const h = gateH(n), hh = h / 2;
    const path = `M -25,${-hh} L 5,${-hh} A 20,${hh} 0 0,1 5,${hh} L -25,${hh} Z`;
    const pins = [];
    for (let i = 0; i < n; i++) pins.push({ x: -25, y: -hh + h * (i + 0.5) / n });
    return { paths: [path], w: GW, h, inputPins: pins, outputPin: { x: 25, y: 0 }, bubble: null };
  }

  function orShape(n) {
    const h = gateH(n), hh = h / 2;
    const path = `M -20,${-hh} `
      + `C 5,${-hh} 18,${-hh * 0.3} 25,0 `
      + `C 18,${hh * 0.3} 5,${hh} -20,${hh} `
      + `Q -5,0 -20,${-hh}`;
    const pins = [];
    for (let i = 0; i < n; i++) {
      const t = (i + 0.5) / n;
      const px = -20 + 30 * t - 30 * t * t;
      const py = hh * (2 * t - 1);
      pins.push({ x: px, y: py });
    }
    return { paths: [path], w: GW, h, inputPins: pins, outputPin: { x: 25, y: 0 }, bubble: null };
  }

  function xorShape(n) {
    const base = orShape(n);
    const hh = base.h / 2;
    base.paths.push(`M -28,${-hh} Q -13,0 -28,${hh}`);
    base.inputPins = base.inputPins.map(p => ({ x: p.x - 4, y: p.y }));
    return base;
  }

  function notShape() {
    const path = `M -15,-15 L 15,0 L -15,15 Z`;
    return {
      paths: [path], w: 30, h: 30,
      inputPins: [{ x: -15, y: 0 }],
      outputPin: { x: 15 + BUBBLE_R * 2, y: 0 },
      bubble: { x: 15 + BUBBLE_R, y: 0 },
    };
  }

  function getShape(type, n) {
    if (type === 'NOT') return notShape();
    const hasNeg = type === 'NAND' || type === 'NOR' || type === 'XNOR';
    const base = { NAND: 'AND', NOR: 'OR', XNOR: 'XOR' }[type] || type;
    let shape;
    if (base === 'AND') shape = andShape(n);
    else if (base === 'OR') shape = orShape(n);
    else if (base === 'XOR') shape = xorShape(n);
    else shape = andShape(n);
    if (hasNeg) {
      shape.bubble = { x: shape.outputPin.x + BUBBLE_R, y: 0 };
      shape.outputPin = { x: shape.outputPin.x + BUBBLE_R * 2, y: 0 };
    }
    return shape;
  }

  /* ═══════════════════════════════════════════════════════
     AST → Circuit Graph  (unchanged from v1)
     ═══════════════════════════════════════════════════════ */

  const BINARY_OPS = new Set(['AND', 'OR', 'NAND', 'NOR', 'XOR', 'XNOR']);
  const ASSOC_OPS = new Set(['AND', 'OR', 'XOR', 'XNOR']);

  function flattenAssoc(node, op) {
    const items = [];
    (function walk(n) {
      if (n.op === op) { walk(n.left); walk(n.right); }
      else items.push(n);
    })(node);
    return items;
  }

  function astToExpr(node) {
    if (node.op === 'VAR') return node.name;
    if (node.op === 'LITERAL') return String(node.value);
    if (node.op === 'NOT') {
      const inner = astToExpr(node.operand);
      return (node.operand.op === 'VAR' || node.operand.op === 'LITERAL') ? inner + "'" : '(' + inner + ")'";
    }
    const sym = { AND: '\u00B7', OR: '+', NAND: '\u22BC', NOR: '\u22BD', XOR: '\u2295', XNOR: '\u2299' };
    return '(' + astToExpr(node.left) + ' ' + (sym[node.op] || node.op) + ' ' + astToExpr(node.right) + ')';
  }

  function build(ast, mode) {
    let nextId = 0;
    const nodes = [];
    const edges = [];
    const inputMap = {};
    const invertMap = {};

    function getInput(name) {
      if (!inputMap[name]) {
        inputMap[name] = { id: nextId++, type: 'INPUT', name: name, inputs: [], depth: 0 };
        nodes.push(inputMap[name]);
      }
      return inputMap[name];
    }

    function makeGate(type, inputNodes, expr) {
      const depth = Math.max(0, ...inputNodes.map(n => n.depth)) + 1;
      const node = { id: nextId++, type: type, inputs: inputNodes.map(n => n.id), depth: depth, expr: expr };
      nodes.push(node);
      inputNodes.forEach(n => edges.push({ from: n.id, to: node.id }));
      return node;
    }

    function buildTree2(type, items) {
      if (items.length === 1) return items[0];
      if (items.length === 2) return makeGate(type, items, null);
      const mid = Math.ceil(items.length / 2);
      return makeGate(type, [buildTree2(type, items.slice(0, mid)), buildTree2(type, items.slice(mid))], null);
    }

    function process(node) {
      if (node.op === 'VAR') return getInput(node.name);
      if (node.op === 'LITERAL') {
        const key = '_lit_' + node.value;
        if (!inputMap[key]) {
          inputMap[key] = { id: nextId++, type: 'INPUT', name: String(node.value), inputs: [], depth: 0 };
          nodes.push(inputMap[key]);
        }
        return inputMap[key];
      }
      if (node.op === 'NOT') {
        const child = process(node.operand);
        // Deduplicate: if inverting a simple variable, reuse the same NOT gate
        if (node.operand.op === 'VAR') {
          const key = node.operand.name;
          if (invertMap[key]) return invertMap[key];
          const gate = makeGate('NOT', [child], astToExpr(node));
          invertMap[key] = gate;
          return gate;
        }
        return makeGate('NOT', [child], astToExpr(node));
      }

      if (BINARY_OPS.has(node.op)) {
        if (mode === 'natural' && ASSOC_OPS.has(node.op)) {
          const items = flattenAssoc(node, node.op).map(process);
          if (items.length <= 5) return makeGate(node.op, items, astToExpr(node));
          function cascade(list) {
            if (list.length <= 5) return makeGate(node.op, list, null);
            const chunks = [];
            for (let i = 0; i < list.length; i += 5) chunks.push(list.slice(i, i + 5));
            return cascade(chunks.map(ch => ch.length === 1 ? ch[0] : makeGate(node.op, ch, null)));
          }
          const g = cascade(items);
          g.expr = astToExpr(node);
          return g;
        }
        if (mode !== 'natural' && ASSOC_OPS.has(node.op)) {
          const items = flattenAssoc(node, node.op).map(process);
          const g = buildTree2(node.op, items);
          g.expr = astToExpr(node);
          return g;
        }
        return makeGate(node.op, [process(node.left), process(node.right)], astToExpr(node));
      }
      throw new Error('Unknown op: ' + node.op);
    }

    const outNode = process(ast);
    outNode.isOutput = true;

    return {
      nodes: nodes,
      edges: edges,
      inputIds: nodes.filter(n => n.type === 'INPUT').map(n => n.id),
      outputId: outNode.id,
      gateCount: nodes.filter(n => n.type !== 'INPUT').length,
      varCount: nodes.filter(n => n.type === 'INPUT').length,
    };
  }

  /* ═══════════════════════════════════════════════════════
     Layout Engine  (v2 — improved spacing & positioning)
     ═══════════════════════════════════════════════════════ */

  function layout(circuit) {
    const { nodes, edges } = circuit;
    const nodeMap = {};
    nodes.forEach(n => nodeMap[n.id] = n);
    const maxDepth = Math.max(0, ...nodes.map(n => n.depth));

    // ── Dynamic column spacing ──
    // Count unique SOURCES per gap (trunk routing shares one track
    // per source, so we size gaps by source count, not edge count).
    const gapSourceSets = {};
    edges.forEach(e => {
      const dS = nodeMap[e.from].depth, dT = nodeMap[e.to].depth;
      for (let g = dS + 1; g <= dT; g++) {
        if (!gapSourceSets[g]) gapSourceSets[g] = new Set();
        gapSourceSets[g].add(e.from);
      }
    });
    const colX = [MARGIN_X];
    for (let d = 1; d <= maxDepth; d++) {
      const count = gapSourceSets[d] ? gapSourceSets[d].size : 0;
      // 80 accounts for gate-body dead-zones on both sides of the gap
      const needed = count * TRACK_SP + 80;
      colX[d] = colX[d - 1] + Math.max(COL_GAP, needed);
    }

    // Group by depth
    const columns = {};
    nodes.forEach(n => {
      const d = n.depth;
      if (!columns[d]) columns[d] = [];
      columns[d].push(n);
    });

    // Sort inputs alphabetically
    if (columns[0]) columns[0].sort((a, b) => (a.name || '').localeCompare(b.name || ''));

    // Barycenter ordering for non-input columns
    for (let d = 1; d <= maxDepth; d++) {
      if (!columns[d]) continue;
      columns[d].forEach(n => {
        const inputIdxs = n.inputs.map(id => {
          const inputNode = nodeMap[id];
          const col = columns[inputNode.depth];
          return col ? col.indexOf(inputNode) : 0;
        });
        n._bary = inputIdxs.length ? inputIdxs.reduce((a, b) => a + b, 0) / inputIdxs.length : 0;
      });
      columns[d].sort((a, b) => a._bary - b._bary);
    }

    // Compute per-node sizes
    const nodeSizes = {};
    nodes.forEach(n => {
      if (n.type === 'INPUT') {
        nodeSizes[n.id] = { w: 0, h: 20 };
      } else {
        const shape = getShape(n.type, n.inputs.length);
        nodeSizes[n.id] = { w: shape.w, h: shape.h };
      }
    });

    // Compute column heights
    const colHeights = {};
    let maxColH = 0;
    for (const d in columns) {
      let h = 0;
      columns[d].forEach((n, i) => {
        h += nodeSizes[n.id].h;
        if (i > 0) h += ROW_GAP;
      });
      colHeights[d] = h;
      if (h > maxColH) maxColH = h;
    }

    let totalH = Math.max(maxColH + MARGIN_Y * 2, 200);

    const positions = {};

    // Position input nodes (depth 0) evenly spaced, centered
    if (columns[0]) {
      const colH = colHeights[0];
      let y = (totalH - colH) / 2;
      columns[0].forEach(n => {
        const size = nodeSizes[n.id];
        y += size.h / 2;
        positions[n.id] = { x: MARGIN_X, y: y };
        y += size.h / 2 + ROW_GAP;
      });
    }

    // Position gate columns — use median of input positions for better centering
    for (let d = 1; d <= maxDepth; d++) {
      if (!columns[d]) continue;
      const x = colX[d];
      const col = columns[d];

      // Compute ideal Y: median of input positions (more robust than mean)
      col.forEach(n => {
        const inputYs = n.inputs
          .map(id => positions[id] ? positions[id].y : null)
          .filter(y => y !== null);
        if (inputYs.length === 0) {
          n._idealY = totalH / 2;
        } else if (inputYs.length <= 2) {
          // For 1-2 inputs, use the mean (puts gate between its inputs)
          n._idealY = inputYs.reduce((a, b) => a + b, 0) / inputYs.length;
        } else {
          // For 3+ inputs, use median to resist outlier pull
          inputYs.sort((a, b) => a - b);
          const mid = Math.floor(inputYs.length / 2);
          n._idealY = inputYs.length % 2 !== 0
            ? inputYs[mid]
            : (inputYs[mid - 1] + inputYs[mid]) / 2;
        }
      });

      // Initial placement at ideal Y
      col.forEach(n => {
        positions[n.id] = { x: x, y: n._idealY };
      });

      // Resolve overlaps top-to-bottom
      for (let i = 1; i < col.length; i++) {
        const prev = col[i - 1], curr = col[i];
        const minY = positions[prev.id].y + nodeSizes[prev.id].h / 2
          + ROW_GAP + nodeSizes[curr.id].h / 2;
        if (positions[curr.id].y < minY) {
          positions[curr.id].y = minY;
        }
      }

      // Ensure top margin
      const firstNode = col[0];
      const minFirstY = MARGIN_Y + nodeSizes[firstNode.id].h / 2;
      if (positions[firstNode.id].y < minFirstY) {
        const shift = minFirstY - positions[firstNode.id].y;
        col.forEach(n => { positions[n.id].y += shift; });
      }

      // Settle passes: pull each node toward its ideal Y without violating spacing
      for (let pass = 0; pass < 4; pass++) {
        // Alternate top-down and bottom-up passes
        const order = pass % 2 === 0
          ? col.slice().reverse() // bottom-up
          : col.slice();          // top-down
        order.forEach((n, _) => {
          const i = col.indexOf(n);
          const target = n._idealY;
          let lo = MARGIN_Y + nodeSizes[n.id].h / 2;
          let hi = totalH * 2; // generous upper bound, will be clamped later

          if (i > 0) {
            const prev = col[i - 1];
            lo = Math.max(lo, positions[prev.id].y + nodeSizes[prev.id].h / 2
              + ROW_GAP + nodeSizes[n.id].h / 2);
          }
          if (i < col.length - 1) {
            const next = col[i + 1];
            hi = Math.min(hi, positions[next.id].y - nodeSizes[next.id].h / 2
              - ROW_GAP - nodeSizes[n.id].h / 2);
          }
          if (lo <= hi) {
            positions[n.id].y = Math.max(lo, Math.min(hi, target));
          }
        });
      }
    }

    // Recompute totalH
    let maxBottomY = 0;
    for (const d in columns) {
      const col = columns[d];
      const last = col[col.length - 1];
      const bottomY = positions[last.id].y + nodeSizes[last.id].h / 2 + MARGIN_Y;
      if (bottomY > maxBottomY) maxBottomY = bottomY;
    }
    if (maxBottomY > totalH) totalH = maxBottomY;

    const totalW = colX[maxDepth] + COL_GAP + MARGIN_X;

    return { positions, width: totalW, height: totalH, nodeMap, maxDepth, columns, nodeSizes, colX };
  }

  /* ═══════════════════════════════════════════════════════
     Wire Router (v2)
     
     Key improvements:
     1. Wires spanning multiple columns route through
        intermediate gaps rather than one long diagonal.
     2. Each gap (between adjacent columns) has independent
        track allocation — wires in the same gap get
        distinct x-offsets to avoid overlap.
     3. Tracks are sorted by destination-Y to minimise
        visual crossings.
     4. Fan-out taps happen on the source's horizontal
        trunk, not at the gate output pin, so multiple
        wires from the same source don't stack on one point.
     ═══════════════════════════════════════════════════════ */

  function routeWires(circuit, lay, pins) {
    const { edges, nodes } = circuit;
    const { positions, nodeMap, maxDepth, colX, columns, nodeSizes } = lay;

    // ── 1. Gate obstacle map ──
    const gateObstacles = {};
    for (let d = 0; d <= maxDepth; d++) {
      if (!columns[d]) continue;
      gateObstacles[d] = [];
      columns[d].forEach(n => {
        if (n.type === 'INPUT') return;
        const pos = positions[n.id];
        const sz = nodeSizes[n.id];
        gateObstacles[d].push({
          y: pos.y, hh: sz.h / 2 + 5,
          x: pos.x, hw: sz.w / 2 + 5,
        });
      });
    }

    function isBlockedAt(y, col) {
      const obs = gateObstacles[col];
      if (!obs) return false;
      return obs.some(g => y > g.y - g.hh && y < g.y + g.hh);
    }

    function findClearY(targetY, intermediateCols) {
      let ok = true;
      for (const d of intermediateCols)
        if (isBlockedAt(targetY, d)) { ok = false; break; }
      if (ok) return targetY;
      for (let off = 6; off < 500; off += 4) {
        let upOK = true, downOK = true;
        for (const d of intermediateCols) {
          if (isBlockedAt(targetY - off, d)) upOK = false;
          if (isBlockedAt(targetY + off, d)) downOK = false;
        }
        if (upOK) return targetY - off;
        if (downOK) return targetY + off;
      }
      return targetY;
    }

    // ── 2. Per-gap routing bounds ──
    const gapBounds = {};
    for (let g = 1; g <= maxDepth; g++) {
      let left = colX[g - 1] + ROUTE_MARGIN;
      let right = colX[g] - ROUTE_MARGIN;
      if (columns[g - 1]) {
        columns[g - 1].forEach(n => {
          const p = pins[n.id];
          if (p && p.outputPin)
            left = Math.max(left, p.outputPin.x + 8);
        });
      }
      if (columns[g]) {
        columns[g].forEach(n => {
          const p = pins[n.id];
          if (p && p.inputPins)
            p.inputPins.forEach(ip => {
              right = Math.min(right, ip.x - 8);
            });
        });
      }
      if (left >= right) {
        const c = (colX[g - 1] + colX[g]) / 2;
        left = c - 10; right = c + 10;
      }
      gapBounds[g] = { left, right };
    }

    // ── 3. Classify edges: fan-out vs single ──
    const edgeInfo = [];
    const fanOutCount = {};
    edges.forEach(e => {
      fanOutCount[e.from] = (fanOutCount[e.from] || 0) + 1;
    });

    const done = new Set();
    edges.forEach(e => {
      const key = `${e.from}-${e.to}`;
      if (done.has(key)) return;
      done.add(key);
      const fromNode = nodeMap[e.from], toNode = nodeMap[e.to];
      if (!fromNode || !toNode) return;
      const fp = pins[e.from], tp = pins[e.to];
      if (!fp || !tp) return;
      const pinIdx = toNode.inputs.indexOf(e.from);
      if (pinIdx < 0 || pinIdx >= tp.inputPins.length) return;
      const fromP = fp.outputPin, toP = tp.inputPins[pinIdx];
      edgeInfo.push({
        edge: e, fromP, toP,
        dS: fromNode.depth, dT: toNode.depth,
        isFanOut: fanOutCount[e.from] > 1,
      });
    });

    // ── 4. Trunk-and-tap: assign ONE trunk X per source per gap ──
    // Collect unique sources that need a trunk in each gap
    const gapSources = {};  // gap → [{ sourceId, sourceY }]
    edgeInfo.forEach(ei => {
      if (!ei.isFanOut) return;
      // The trunk lives in the first gap after the source column
      const g = ei.dS + 1;
      if (!gapSources[g]) gapSources[g] = {};
      if (!gapSources[g][ei.edge.from]) {
        gapSources[g][ei.edge.from] = { sourceId: ei.edge.from, sourceY: ei.fromP.y };
      }
    });

    // Also collect single-fan edges for track assignment,
    // plus long-span fan-out edges in their non-trunk gaps
    const gapSingles = {};
    edgeInfo.forEach(ei => {
      if (ei.isFanOut) {
        // Long-span fan-out: needs track in last gap (dT) for final vertical
        if (ei.dT - ei.dS > 1) {
          const g = ei.dT;
          if (!gapSingles[g]) gapSingles[g] = [];
          gapSingles[g].push(ei);
        }
        return;
      }
      for (let g = ei.dS + 1; g <= ei.dT; g++) {
        if (!gapSingles[g]) gapSingles[g] = [];
        gapSingles[g].push(ei);
      }
    });

    // ── Vertical segment obstacle check ──
    // Check if a vertical segment at x sweeping from y0 to y1 would
    // clip any gate body in the given column.
    function isVertBlocked(x, y0, y1, col) {
      const obs = gateObstacles[col];
      if (!obs) return false;
      const lo = Math.min(y0, y1), hi = Math.max(y0, y1);
      return obs.some(g =>
        x > g.x - g.hw && x < g.x + g.hw &&
        hi > g.y - g.hh && lo < g.y + g.hh
      );
    }

    // Assign trunk X positions with crossing-minimized ordering
    const trunkX = {};  // `sourceId-gap` → X
    for (let g = 1; g <= maxDepth; g++) {
      const { left: lb, right: rb } = gapBounds[g];
      const trunks = gapSources[g] ? Object.values(gapSources[g]) : [];
      const singles = gapSingles[g] || [];

      // Combine: trunks + singles all need track space in this gap
      // For crossing minimization, compute a destY for sorting:
      // - trunks: median of all destination Ys
      // - singles: the destination Y
      const allTracks = [];
      trunks.forEach(t => {
        const fanEdges = edgeInfo.filter(ei => ei.edge.from === t.sourceId && ei.isFanOut);
        const destYs = fanEdges.map(ei => ei.toP.y).sort((a, b) => a - b);
        const medianY = destYs.length ? destYs[Math.floor(destYs.length / 2)] : t.sourceY;
        allTracks.push({ type: 'trunk', id: t.sourceId, srcY: t.sourceY, destY: medianY });
      });
      singles.forEach(si => {
        allTracks.push({ type: 'single', ei: si, srcY: si.fromP.y, destY: si.toP.y });
      });

      // Sort by destination Y to minimize crossings on the output side,
      // then by source Y as tiebreaker for the input side
      allTracks.sort((a, b) => {
        const dDest = a.destY - b.destY;
        if (Math.abs(dDest) > 1) return dDest;
        return a.srcY - b.srcY;
      });

      const n = allTracks.length;
      if (n === 0) continue;
      const availW = rb - lb;
      const totalW = (n - 1) * TRACK_SP;
      let sx, sp;
      if (n <= 1) {
        sx = (lb + rb) / 2; sp = 0;
      } else if (totalW <= availW) {
        sx = (lb + rb) / 2 - totalW / 2; sp = TRACK_SP;
      } else {
        sx = lb; sp = availW / (n - 1);
      }

      allTracks.forEach((t, i) => {
        let x = n <= 1 ? sx : sx + i * sp;

        // Check if vertical segment at x clips gate bodies in
        // adjacent columns; nudge if needed
        const minY = Math.min(t.srcY, t.destY);
        const maxY = Math.max(t.srcY, t.destY);
        if (isVertBlocked(x, minY, maxY, g) || isVertBlocked(x, minY, maxY, g - 1)) {
          // Try nudging left or right by small increments
          for (let nudge = 4; nudge <= 20; nudge += 4) {
            if (x - nudge >= lb &&
                !isVertBlocked(x - nudge, minY, maxY, g) &&
                !isVertBlocked(x - nudge, minY, maxY, g - 1)) {
              x = x - nudge; break;
            }
            if (x + nudge <= rb &&
                !isVertBlocked(x + nudge, minY, maxY, g) &&
                !isVertBlocked(x + nudge, minY, maxY, g - 1)) {
              x = x + nudge; break;
            }
          }
        }

        if (t.type === 'trunk') {
          trunkX[`${t.id}-${g}`] = x;
        } else {
          const ei = t.ei;
          trunkX[`${ei.edge.from}-${ei.edge.to}-${g}`] = x;
        }
      });
    }

    // ── 5. Generate wire paths ──
    const wirePaths = [];
    const junctions = [];  // { x, y } for tap points on trunks

    // Group fan-out edges by source
    const fanOutEdges = {};
    edgeInfo.forEach(ei => {
      if (!ei.isFanOut) return;
      if (!fanOutEdges[ei.edge.from]) fanOutEdges[ei.edge.from] = [];
      fanOutEdges[ei.edge.from].push(ei);
    });

    // ── 5a. Fan-out sources: trunk + taps ──
    for (const srcId in fanOutEdges) {
      const group = fanOutEdges[srcId];
      if (group.length === 0) continue;

      const fromP = group[0].fromP;
      const dS = group[0].dS;
      const g = dS + 1;
      const tx = trunkX[`${srcId}-${g}`];
      if (tx === undefined) continue;

      // Sort taps by destination Y
      group.sort((a, b) => a.toP.y - b.toP.y);

      // Compute trunk vertical extent: from source Y to farthest tap Y
      // Include all destinations in this gap or further
      let trunkMinY = fromP.y;
      let trunkMaxY = fromP.y;
      group.forEach(ei => {
        // For single-gap edges, the tap Y is the destination pin Y
        // For long-span edges, the tap leaves at the clearY
        if (ei.dT - ei.dS === 1) {
          trunkMinY = Math.min(trunkMinY, ei.toP.y);
          trunkMaxY = Math.max(trunkMaxY, ei.toP.y);
        } else {
          // Long-span: tap leaves trunk at whatever Y the horizontal will run
          const interCols = [];
          for (let d = dS + 1; d < ei.dT; d++) interCols.push(d);
          const clearY = findClearY(ei.toP.y, interCols);
          trunkMinY = Math.min(trunkMinY, clearY);
          trunkMaxY = Math.max(trunkMaxY, clearY);
        }
      });

      // Draw the trunk: H from output pin → trunk X, then V spanning all taps
      // Split into up-trunk and down-trunk from the source arrival point
      let trunkD = `M ${fromP.x},${fromP.y} L ${tx},${fromP.y}`;
      if (trunkMinY < fromP.y)
        trunkD += ` M ${tx},${fromP.y} L ${tx},${trunkMinY}`;
      if (trunkMaxY > fromP.y)
        trunkD += ` M ${tx},${fromP.y} L ${tx},${trunkMaxY}`;
      if (Math.abs(trunkMinY - fromP.y) < 0.5 && Math.abs(trunkMaxY - fromP.y) < 0.5)
        trunkD += ` L ${tx},${fromP.y}`; // degenerate: single tap at same Y
      wirePaths.push({ d: trunkD, edge: group[0].edge, isTrunk: true });

      // Draw tap for each destination
      group.forEach(ei => {
        const toP = ei.toP;

        if (ei.dT - ei.dS === 1) {
          // Single-gap: horizontal tap from trunk to destination pin
          const tapY = toP.y;
          junctions.push({ x: tx, y: tapY });
          wirePaths.push({
            d: `M ${tx},${tapY} L ${toP.x},${toP.y}`,
            edge: ei.edge,
          });
        } else {
          // Long-span: tap from trunk, route through intermediate gaps
          const interCols = [];
          for (let d = dS + 1; d < ei.dT; d++) interCols.push(d);
          const clearY = findClearY(toP.y, interCols);

          junctions.push({ x: tx, y: clearY });

          // Need a track X in the last gap for the final vertical
          const lastGap = ei.dT;
          const lastKey = `${ei.edge.from}-${ei.edge.to}-${lastGap}`;
          const lastX = trunkX[lastKey]
            ?? ((colX[ei.dT - 1] + colX[ei.dT]) / 2);

          const pts = [{ x: tx, y: clearY }];
          pts.push({ x: lastX, y: clearY });
          if (Math.abs(clearY - toP.y) > 0.5)
            pts.push({ x: lastX, y: toP.y });
          pts.push({ x: toP.x, y: toP.y });

          let d = `M ${pts[0].x},${pts[0].y}`;
          for (let i = 1; i < pts.length; i++)
            d += ` L ${pts[i].x},${pts[i].y}`;
          wirePaths.push({ d, edge: ei.edge });
        }
      });
    }

    // ── Path cleanup: remove duplicates and collinear points ──
    function cleanPath(pts) {
      // Remove duplicate consecutive points
      const clean = [pts[0]];
      for (let i = 1; i < pts.length; i++) {
        const p = clean[clean.length - 1], c = pts[i];
        if (Math.abs(p.x - c.x) < 0.5 && Math.abs(p.y - c.y) < 0.5) continue;
        clean.push(c);
      }
      // Remove collinear middle points (same X or same Y as neighbours)
      const final = [clean[0]];
      for (let i = 1; i < clean.length - 1; i++) {
        const prev = final[final.length - 1], curr = clean[i], next = clean[i + 1];
        if ((Math.abs(prev.x - curr.x) < 0.5 && Math.abs(curr.x - next.x) < 0.5) ||
            (Math.abs(prev.y - curr.y) < 0.5 && Math.abs(curr.y - next.y) < 0.5)) continue;
        final.push(curr);
      }
      if (clean.length > 1) final.push(clean[clean.length - 1]);
      return final;
    }

    function ptsToD(pts) {
      let d = `M ${pts[0].x},${pts[0].y}`;
      for (let i = 1; i < pts.length; i++)
        d += ` L ${pts[i].x},${pts[i].y}`;
      return d;
    }

    // ── 5b. Single-fan-out edges: normal routing ──
    edgeInfo.forEach(ei => {
      if (ei.isFanOut) return;
      const { edge: e, fromP, toP, dS, dT } = ei;

      // Straight horizontal — no routing needed
      if (Math.abs(fromP.y - toP.y) < 1 && dT - dS === 1) {
        wirePaths.push({
          d: `M ${fromP.x},${fromP.y} L ${toP.x},${toP.y}`,
          edge: e,
        });
        return;
      }

      const pts = [{ x: fromP.x, y: fromP.y }];

      if (dT - dS > 1) {
        // Long-span: multi-gap routing
        const firstKey = `${e.from}-${e.to}-${dS + 1}`;
        const lastKey  = `${e.from}-${e.to}-${dT}`;
        const firstTrackX = trunkX[firstKey]
          ?? ((colX[dS] + colX[dS + 1]) / 2);
        const lastTrackX  = trunkX[lastKey]
          ?? ((colX[dT - 1] + colX[dT]) / 2);

        const interCols = [];
        for (let d = dS + 1; d < dT; d++) interCols.push(d);
        const clearY = findClearY(toP.y, interCols);

        pts.push({ x: firstTrackX, y: fromP.y });
        pts.push({ x: firstTrackX, y: clearY });
        pts.push({ x: lastTrackX,  y: clearY });
        if (Math.abs(clearY - toP.y) > 0.5)
          pts.push({ x: lastTrackX, y: toP.y });
        pts.push({ x: toP.x, y: toP.y });
      } else if (Math.abs(fromP.y - toP.y) < 20) {
        // Adjacent columns, small Y difference — L-bend
        // Single right-angle: horizontal then vertical jog near destination
        const bendX = toP.x - 8;
        pts.push({ x: bendX, y: fromP.y });
        pts.push({ x: bendX, y: toP.y });
        pts.push({ x: toP.x, y: toP.y });
      } else {
        // Single-span Z-bend
        const bendKey = `${e.from}-${e.to}-${dT}`;
        const bendX = trunkX[bendKey];
        if (bendX !== undefined) {
          pts.push({ x: bendX, y: fromP.y });
          pts.push({ x: bendX, y: toP.y });
          pts.push({ x: toP.x, y: toP.y });
        } else {
          const midX = (fromP.x + toP.x) / 2;
          pts.push({ x: midX, y: fromP.y });
          pts.push({ x: midX, y: toP.y });
          pts.push({ x: toP.x, y: toP.y });
        }
      }

      const final = cleanPath(pts);
      wirePaths.push({ d: ptsToD(final), edge: e });
    });

    return { wirePaths, junctions };
  }

  /* ═══════════════════════════════════════════════════════
     SVG Renderer
     ═══════════════════════════════════════════════════════ */

  function render(circuit, options) {
    if (isSOP(circuit)) return renderSOP(circuit, options);

    options = options || {};
    const { nodes, edges, outputId } = circuit;
    const lay = layout(circuit);
    const { positions, width, height, nodeMap } = lay;

    const root = s('svg', {
      viewBox: '0 0 ' + width + ' ' + height,
      width: width, height: height,
      xmlns: NS,
    });

    const wireLayer = s('g', { 'class': 'cg-wires' });
    const gateLayer = s('g', { 'class': 'cg-gates' });
    const labelLayer = s('g', { 'class': 'cg-labels' });
    const juncLayer = s('g', { 'class': 'cg-junctions' });
    root.appendChild(wireLayer);
    root.appendChild(gateLayer);
    root.appendChild(labelLayer);
    root.appendChild(juncLayer);

    // Pin world positions
    const pins = {};

    // ── Draw input nodes ──
    nodes.filter(n => n.type === 'INPUT').forEach(n => {
      const pos = positions[n.id];
      const outX = pos.x + PIN_LEN;

      labelLayer.appendChild(s('text', {
        x: pos.x - 10, y: pos.y + 5,
        'class': 'cg-label cg-input-label',
        'text-anchor': 'end',
      }, n.name));

      wireLayer.appendChild(s('line', {
        x1: pos.x, y1: pos.y, x2: outX, y2: pos.y,
        'class': 'cg-wire', 'data-node': n.id,
      }));

      pins[n.id] = { inputPins: [], outputPin: { x: outX, y: pos.y } };
    });

    // ── Draw gate nodes ──
    nodes.filter(n => n.type !== 'INPUT').forEach(n => {
      const pos = positions[n.id];
      const shape = getShape(n.type, n.inputs.length);
      const cls = 'cg-gate cg-gate-' + n.type.toLowerCase();

      const group = s('g', {
        'class': cls,
        transform: 'translate(' + pos.x + ',' + pos.y + ')',
        'data-node': n.id,
        style: 'cursor:pointer',
      });

      shape.paths.forEach(p => {
        group.appendChild(s('path', { d: p, 'class': 'cg-gate-body' }));
      });

      if (shape.bubble) {
        group.appendChild(s('circle', {
          cx: shape.bubble.x, cy: shape.bubble.y, r: BUBBLE_R,
          'class': 'cg-bubble',
        }));
      }

      var labelMap = { AND: 'AND', OR: 'OR', NAND: 'NAND', NOR: 'NOR', XOR: 'XOR', XNOR: 'XNOR' };
      if (labelMap[n.type]) {
        var fontSize = n.type.length > 3 ? '9' : '10';
        group.appendChild(s('text', {
          x: n.type === 'NOT' ? 0 : -5, y: 4,
          'class': 'cg-label cg-gate-text',
          'text-anchor': 'middle',
          'font-size': fontSize,
        }, labelMap[n.type]));
      }

      gateLayer.appendChild(group);

      var wIn = shape.inputPins.map(p => ({ x: pos.x + p.x, y: pos.y + p.y }));
      var wOut = { x: pos.x + shape.outputPin.x, y: pos.y + shape.outputPin.y };
      pins[n.id] = { inputPins: wIn, outputPin: wOut };
    });

    // ── Output label ──
    var outPins = pins[outputId];
    if (outPins) {
      var outP = outPins.outputPin;
      wireLayer.appendChild(s('line', {
        x1: outP.x, y1: outP.y, x2: outP.x + PIN_LEN, y2: outP.y,
        'class': 'cg-wire',
      }));
      labelLayer.appendChild(s('text', {
        x: outP.x + PIN_LEN + 8, y: outP.y + 5,
        'class': 'cg-label cg-output-label',
      }, 'Out'));
    }

    // ── Route and draw wires ──
    const routed = routeWires(circuit, lay, pins);
    const { wirePaths, junctions } = routed;

    wirePaths.forEach(wp => {
      const wire = s('path', {
        d: wp.d, 'class': 'cg-wire',
        'data-from': wp.edge.from, 'data-to': wp.edge.to,
      });
      wireLayer.appendChild(wire);
    });

    // Junction dots at trunk tap points
    const junctionsDone = {};
    junctions.forEach(j => {
      const jKey = j.x.toFixed(1) + ',' + j.y.toFixed(1);
      if (!junctionsDone[jKey]) {
        junctionsDone[jKey] = true;
        juncLayer.appendChild(s('circle', {
          cx: j.x, cy: j.y, r: 3, 'class': 'cg-junction',
        }));
      }
    });

    root._circuit = circuit;
    root._pins = pins;
    return root;
  }

  /* ═══════════════════════════════════════════════════════
     Interaction (hover highlight, click tooltip)
     ═══════════════════════════════════════════════════════ */

  function interact(svgEl, circuit, container) {
    svgEl.addEventListener('mouseover', function(e) {
      var gate = e.target.closest('[data-node]');
      var wire = e.target.closest('.cg-wire[data-from]');
      if (gate) {
        var id = gate.dataset.node;
        gate.classList.add('cg-highlight');
        svgEl.querySelectorAll('.cg-wire[data-from="' + id + '"], .cg-wire[data-to="' + id + '"]').forEach(function(w) {
          w.classList.add('cg-wire-hl');
        });
      }
      if (wire) wire.classList.add('cg-wire-hl');
    });

    svgEl.addEventListener('mouseout', function(e) {
      var gate = e.target.closest('[data-node]');
      var wire = e.target.closest('.cg-wire[data-from]');
      if (gate) {
        gate.classList.remove('cg-highlight');
        svgEl.querySelectorAll('.cg-wire-hl').forEach(function(w) { w.classList.remove('cg-wire-hl'); });
      }
      if (wire) wire.classList.remove('cg-wire-hl');
    });

    svgEl.addEventListener('click', function(e) {
      _hideTooltip(container);
      var gate = e.target.closest('[data-node]');
      if (!gate) return;
      var id = parseInt(gate.dataset.node);
      var node = circuit.nodes.find(function(n) { return n.id === id; });
      if (!node || node.type === 'INPUT') return;
      var names = { AND: 'AND Gate', OR: 'OR Gate', NOT: 'Inverter', NAND: 'NAND Gate', NOR: 'NOR Gate', XOR: 'XOR Gate', XNOR: 'XNOR Gate' };
      var inputLabels = node.inputs.map(function(iid) {
        var n = circuit.nodes.find(function(nd) { return nd.id === iid; });
        return n ? (n.name || n.expr || 'node ' + n.id) : '?';
      });
      _showTooltip(container, e, names[node.type] || node.type, inputLabels, node.expr);
    });
  }

  function _showTooltip(container, event, title, inputs, expr) {
    var tip = container.querySelector('.cg-tooltip');
    if (!tip) {
      tip = document.createElement('div');
      tip.className = 'cg-tooltip';
      container.style.position = 'relative';
      container.appendChild(tip);
    }
    tip.innerHTML = '<strong>' + title + '</strong>'
      + 'Inputs: ' + inputs.join(', ')
      + (expr ? '<br>Output: <code>' + expr + '</code>' : '');
    tip.style.display = '';
    var rect = container.getBoundingClientRect();
    tip.style.left = (event.clientX - rect.left + 10) + 'px';
    tip.style.top = (event.clientY - rect.top - 40) + 'px';
  }

  function _hideTooltip(container) {
    var tip = container.querySelector('.cg-tooltip');
    if (tip) tip.style.display = 'none';
  }

  /* ═══════════════════════════════════════════════════════
     SOP-Aware Layout & Rendering

     Detects sum-of-products circuits and renders them in
     textbook style: horizontal signal buses, vertical taps,
     zero crossings.
     ═══════════════════════════════════════════════════════ */

  function isSOP(circuit) {
    const nodeMap = {};
    circuit.nodes.forEach(n => nodeMap[n.id] = n);
    const outNode = circuit.nodes.find(n => n.isOutput);
    if (!outNode) return false;

    function isSimpleProduct(gate) {
      return gate.inputs.every(id => {
        const n = nodeMap[id];
        if (!n) return false;
        if (n.type === 'INPUT') return true;
        if (n.type === 'NOT') {
          const ni = nodeMap[n.inputs[0]];
          return ni && ni.type === 'INPUT';
        }
        return false;
      });
    }

    // Standard SOP: OR of ANDs
    if (outNode.type === 'OR') {
      return outNode.inputs.every(id => {
        const n = nodeMap[id];
        return n && n.type === 'AND' && isSimpleProduct(n);
      });
    }

    // Degenerate SOP: single AND/NAND with simple inputs
    if (outNode.type === 'AND' || outNode.type === 'NAND') {
      return isSimpleProduct(outNode);
    }

    return false;
  }

  function renderSOP(circuit, options) {
    options = options || {};
    const { nodes, edges, outputId } = circuit;
    const nodeMap = {};
    nodes.forEach(n => nodeMap[n.id] = n);

    const outNode = nodes.find(n => n.isOutput);
    // Standard SOP: OR collector with AND product gates
    // Degenerate SOP: single AND/NAND gate is both the product and the output
    const isStandard = outNode.type === 'OR';
    const productGates = isStandard
      ? outNode.inputs.map(id => nodeMap[id])
      : [outNode];
    const inputs = nodes.filter(n => n.type === 'INPUT')
      .sort((a, b) => a.name.localeCompare(b.name));
    const inverters = nodes.filter(n => n.type === 'NOT');

    // ── Collect signal info per variable ──
    const variables = [];
    inputs.forEach(inp => {
      const inv = inverters.find(n => n.inputs[0] === inp.id);
      variables.push({
        name: inp.name,
        inputId: inp.id,
        inverterId: inv ? inv.id : null,
        needsDirect: productGates.some(g => g.inputs.includes(inp.id)),
        needsInverted: inv ? productGates.some(g => g.inputs.includes(inv.id)) : false,
      });
    });

    // ── Sizing constants ──
    const TRACK_H = 30;
    const GROUP_GAP = 14;
    const LABEL_X = MARGIN_X;
    const INV_X = LABEL_X + PIN_LEN + 50;
    const BUS_START_X = INV_X + 40;
    const numProd = productGates.length;
    const MIN_STAGGER = 22;
    const TAP_ZONE = Math.max(numProd * MIN_STAGGER + 44, 110);
    const PROD_COL_X = BUS_START_X + TAP_ZONE + 40;
    const COLL_COL_X = PROD_COL_X + 100;
    // Compute actual stagger: evenly distribute tap columns across the zone
    const TAP_LEFT = BUS_START_X + 10;
    const TAP_RIGHT = BUS_START_X + TAP_ZONE - 10;
    const STAGGER = numProd > 1
      ? Math.max(MIN_STAGGER, (TAP_RIGHT - TAP_LEFT) / (numProd - 1))
      : 0;

    // ── Assign Y tracks to signals ──
    const signalY = {};
    let y = MARGIN_Y + 20;

    variables.forEach(v => {
      if (v.needsDirect) {
        signalY[v.inputId] = y;
        y += TRACK_H;
      }
      if (v.needsInverted && v.inverterId) {
        signalY[v.inverterId] = y;
        y += TRACK_H;
      }
      if (!v.needsDirect && !v.needsInverted) {
        signalY[v.inputId] = y;
        y += TRACK_H;
      }
      y += GROUP_GAP;
    });
    y -= GROUP_GAP;

    // ── Crossing-minimized product gate ordering ──
    // For ≤8 gates try all permutations (8!=40320, instant).
    // Cost = tap crossings + output-wire crossings.
    function crossingCost(ordering) {
      let cost = 0;
      for (let i = 0; i < ordering.length; i++) {
        for (let j = i + 1; j < ordering.length; j++) {
          const gA = ordering[i], gB = ordering[j];
          // Tap crossings: upper gate taps lower bus than lower gate
          for (const sA of gA.inputs) {
            for (const sB of gB.inputs) {
              if (sA === sB) continue;
              if ((signalY[sA] || 0) > (signalY[sB] || 0)) cost++;
            }
          }
        }
      }
      return cost;
    }

    if (numProd <= 8 && numProd > 1) {
      let bestOrder = productGates.slice();
      let bestCost = crossingCost(bestOrder);
      (function permute(arr, l) {
        if (l >= arr.length - 1) {
          const c = crossingCost(arr);
          if (c < bestCost) { bestCost = c; bestOrder = arr.slice(); }
          return;
        }
        for (let i = l; i < arr.length; i++) {
          const t = arr[l]; arr[l] = arr[i]; arr[i] = t;
          permute(arr, l + 1);
          arr[i] = arr[l]; arr[l] = t;
        }
      })(productGates.slice(), 0);
      productGates.length = 0;
      bestOrder.forEach(g => productGates.push(g));
    } else {
      productGates.forEach(g => {
        const ys = g.inputs.map(id => signalY[id] || 0);
        g._comY = ys.reduce((a, b) => a + b, 0) / ys.length;
      });
      productGates.sort((a, b) => a._comY - b._comY);
    }

    // ── Place product gates ──
    const AND_ROW_GAP = 12;
    const positions = {};
    const gateType = productGates[0].type; // AND or NAND

    productGates.forEach((g, i) => {
      const shape = getShape(g.type, g.inputs.length);
      const ys = g.inputs.map(id => signalY[id] || 0);
      const idealY = ys.reduce((a, b) => a + b, 0) / ys.length;
      const minY = i === 0
        ? MARGIN_Y + shape.h / 2
        : positions[productGates[i - 1].id].y
          + getShape(productGates[i - 1].type, productGates[i - 1].inputs.length).h / 2
          + AND_ROW_GAP
          + shape.h / 2;
      positions[g.id] = { x: PROD_COL_X, y: Math.max(idealY, minY) };
    });

    // ── Place collector gate (OR) if standard SOP ──
    if (isStandard) {
      const prodYs = productGates.map(g => positions[g.id].y);
      const collY = (Math.min(...prodYs) + Math.max(...prodYs)) / 2;
      positions[outNode.id] = { x: COLL_COL_X, y: collY };
    }

    // ── Place inputs & inverters ──
    inputs.forEach(n => {
      const sy = signalY[n.id];
      if (sy !== undefined) {
        positions[n.id] = { x: LABEL_X, y: sy };
      } else {
        const v = variables.find(vv => vv.inputId === n.id);
        positions[n.id] = { x: LABEL_X, y: signalY[v.inverterId] };
      }
    });
    inverters.forEach(n => {
      const sy = signalY[n.id];
      if (sy !== undefined) {
        positions[n.id] = { x: INV_X, y: sy };
      }
    });

    // ── Compute dimensions ──
    const lastProd = productGates[productGates.length - 1];
    const lastProdShape = getShape(lastProd.type, lastProd.inputs.length);
    let rightEdge = PROD_COL_X + 100;
    let bottomY = Math.max(
      y + MARGIN_Y,
      positions[lastProd.id].y + lastProdShape.h / 2 + MARGIN_Y
    );
    if (isStandard) {
      const collShape = getShape('OR', productGates.length);
      bottomY = Math.max(bottomY, positions[outNode.id].y + collShape.h / 2 + MARGIN_Y);
      rightEdge = COLL_COL_X + 100;
    }
    const totalW = rightEdge;
    const totalH = Math.max(bottomY, 200);

    // ── Create SVG ──
    const root = s('svg', {
      viewBox: '0 0 ' + totalW + ' ' + totalH,
      width: totalW, height: totalH, xmlns: NS,
    });
    const wireLayer = s('g', { 'class': 'cg-wires' });
    const gateLayer = s('g', { 'class': 'cg-gates' });
    const labelLayer = s('g', { 'class': 'cg-labels' });
    const juncLayer = s('g', { 'class': 'cg-junctions' });
    root.appendChild(wireLayer);
    root.appendChild(gateLayer);
    root.appendChild(labelLayer);
    root.appendChild(juncLayer);

    const pins = {};

    // ── Draw input labels & stubs ──
    inputs.forEach(n => {
      const pos = positions[n.id];
      labelLayer.appendChild(s('text', {
        x: pos.x - 10, y: pos.y + 5,
        'class': 'cg-label cg-input-label',
        'text-anchor': 'end',
      }, n.name));
      const outX = pos.x + PIN_LEN;
      wireLayer.appendChild(s('line', {
        x1: pos.x, y1: pos.y, x2: outX, y2: pos.y,
        'class': 'cg-wire', 'data-node': n.id,
      }));
      pins[n.id] = { inputPins: [], outputPin: { x: outX, y: pos.y } };
    });

    // ── Draw gates ──
    nodes.filter(n => n.type !== 'INPUT').forEach(n => {
      const pos = positions[n.id];
      if (!pos) return;
      const shape = getShape(n.type, n.inputs.length);
      const cls = 'cg-gate cg-gate-' + n.type.toLowerCase();
      const group = s('g', {
        'class': cls,
        transform: 'translate(' + pos.x + ',' + pos.y + ')',
        'data-node': n.id, style: 'cursor:pointer',
      });
      shape.paths.forEach(p => {
        group.appendChild(s('path', { d: p, 'class': 'cg-gate-body' }));
      });
      if (shape.bubble) {
        group.appendChild(s('circle', {
          cx: shape.bubble.x, cy: shape.bubble.y, r: BUBBLE_R,
          'class': 'cg-bubble',
        }));
      }
      var labelMap = { AND: 'AND', OR: 'OR', NAND: 'NAND', NOR: 'NOR', XOR: 'XOR', XNOR: 'XNOR' };
      if (labelMap[n.type]) {
        var fontSize = n.type.length > 3 ? '9' : '10';
        group.appendChild(s('text', {
          x: n.type === 'NOT' ? 0 : -5, y: 4,
          'class': 'cg-label cg-gate-text',
          'text-anchor': 'middle', 'font-size': fontSize,
        }, labelMap[n.type]));
      }
      gateLayer.appendChild(group);
      var wIn = shape.inputPins.map(p => ({ x: pos.x + p.x, y: pos.y + p.y }));
      var wOut = { x: pos.x + shape.outputPin.x, y: pos.y + shape.outputPin.y };
      pins[n.id] = { inputPins: wIn, outputPin: wOut };
    });

    // ── Output label ──
    const outPins = pins[outputId];
    if (outPins) {
      const outP = outPins.outputPin;
      wireLayer.appendChild(s('line', {
        x1: outP.x, y1: outP.y, x2: outP.x + PIN_LEN, y2: outP.y,
        'class': 'cg-wire',
      }));
      labelLayer.appendChild(s('text', {
        x: outP.x + PIN_LEN + 8, y: outP.y + 5,
        'class': 'cg-label cg-output-label',
      }, 'Out'));
    }

    // ═══ SOP WIRING ═══

    // ── Compute per-signal fan-out (how many product gates tap each signal) ──
    const signalFanOut = {};
    productGates.forEach(g => {
      g.inputs.forEach(id => {
        signalFanOut[id] = (signalFanOut[id] || 0) + 1;
      });
    });

    const jDone = {};
    function addJunction(x, yy) {
      const k = x.toFixed(1) + ',' + yy.toFixed(1);
      if (!jDone[k]) {
        jDone[k] = true;
        juncLayer.appendChild(s('circle', {
          cx: x, cy: yy, r: 3, 'class': 'cg-junction',
        }));
      }
    }

    // ── Wire: input → inverter ──
    inverters.forEach(inv => {
      const invPins = pins[inv.id];
      const srcNode = nodeMap[inv.inputs[0]];
      const srcPins = pins[srcNode.id];
      if (!invPins || !srcPins) return;
      const srcOut = srcPins.outputPin;
      const invIn = invPins.inputPins[0];
      // Check if the direct signal also has a bus (real fan-out at this point)
      const v = variables.find(vv => vv.inputId === srcNode.id);
      const hasFanOut = v && v.needsDirect;
      if (Math.abs(srcOut.y - invIn.y) < 1) {
        wireLayer.appendChild(s('path', {
          d: `M ${srcOut.x},${srcOut.y} L ${invIn.x},${invIn.y}`,
          'class': 'cg-wire',
          'data-from': srcNode.id, 'data-to': inv.id,
        }));
      } else {
        const dropX = invIn.x - 10;
        wireLayer.appendChild(s('path', {
          d: `M ${dropX},${srcOut.y} L ${dropX},${invIn.y} L ${invIn.x},${invIn.y}`,
          'class': 'cg-wire',
          'data-from': srcNode.id, 'data-to': inv.id,
        }));
        if (hasFanOut) {
          addJunction(dropX, srcOut.y);
        }
      }
    });

    // ── Sort each gate's inputs by bus Y so top pin → topmost bus ──
    // This prevents tap crossings WITHIN a single gate's column.
    productGates.forEach(g => {
      g.inputs.sort((a, b) => (signalY[a] || 0) - (signalY[b] || 0));
    });

    // ── Compute tap X positions and rightmost tap per signal ──
    // Each product gate gi gets tap column at TAP_LEFT + gi * STAGGER.
    // For each signal, find the rightmost tap X to set bus end point.
    const signalMaxTapX = {};  // signalId → max tap X
    productGates.forEach((gate, gi) => {
      const tapX = numProd <= 1 ? (TAP_LEFT + TAP_RIGHT) / 2 : TAP_LEFT + gi * STAGGER;
      gate.inputs.forEach(inputId => {
        const prev = signalMaxTapX[inputId] || 0;
        if (tapX > prev) signalMaxTapX[inputId] = tapX;
      });
    });

    // ── Horizontal signal buses (end at rightmost tap, not fixed width) ──
    const busLines = {};

    variables.forEach(v => {
      if (v.needsDirect) {
        const srcPins = pins[v.inputId];
        const busY = signalY[v.inputId];
        const startX = srcPins.outputPin.x;
        const endX = signalMaxTapX[v.inputId] || startX;
        wireLayer.appendChild(s('line', {
          x1: startX, y1: busY, x2: endX, y2: busY,
          'class': 'cg-wire', 'data-node': v.inputId,
        }));
        busLines[v.inputId] = { y: busY, startX, endX };
      }
      if (v.needsInverted && v.inverterId) {
        const invPins = pins[v.inverterId];
        if (!invPins) return;
        const busY = signalY[v.inverterId];
        const startX = invPins.outputPin.x;
        const endX = signalMaxTapX[v.inverterId] || startX;
        wireLayer.appendChild(s('line', {
          x1: startX, y1: busY, x2: endX, y2: busY,
          'class': 'cg-wire', 'data-node': v.inverterId,
        }));
        busLines[v.inverterId] = { y: busY, startX, endX };
      }
    });

    // ── Vertical taps: bus → product gate input pins ──
    productGates.forEach((gate, gi) => {
      const gPins = pins[gate.id];
      if (!gPins) return;

      const tapX = numProd <= 1
        ? (TAP_LEFT + TAP_RIGHT) / 2
        : TAP_LEFT + gi * STAGGER;

      gate.inputs.forEach((inputId, pi) => {
        const bus = busLines[inputId];
        if (!bus) return;
        const inputPin = gPins.inputPins[pi];
        if (!inputPin) return;

        const busY = bus.y;

        let d = `M ${tapX},${busY} L ${tapX},${inputPin.y} L ${inputPin.x},${inputPin.y}`;
        wireLayer.appendChild(s('path', {
          d, 'class': 'cg-wire',
          'data-from': inputId, 'data-to': gate.id,
        }));

        if (signalFanOut[inputId] >= 2) {
          addJunction(tapX, busY);
        }
      });
    });

    // ── Product → collector connections (standard SOP only) ──
    // Assign OR pins by vertical position: topmost AND → top OR pin.
    // This eliminates output wire crossings.
    if (isStandard) {
      const collPins = pins[outNode.id];
      if (collPins) {
        productGates.forEach((gate, gi) => {
          const gPins = pins[gate.id];
          if (!gPins) return;
          const fromP = gPins.outputPin;
          // gi-th product gate (sorted top-to-bottom) → gi-th OR pin (top-to-bottom)
          const toP = collPins.inputPins[gi];
          if (!toP) return;

          if (Math.abs(fromP.y - toP.y) < 1) {
            wireLayer.appendChild(s('path', {
              d: `M ${fromP.x},${fromP.y} L ${toP.x},${toP.y}`,
              'class': 'cg-wire',
              'data-from': gate.id, 'data-to': outNode.id,
            }));
          } else {
            const midX = (fromP.x + toP.x) / 2;
            wireLayer.appendChild(s('path', {
              d: `M ${fromP.x},${fromP.y} L ${midX},${fromP.y} L ${midX},${toP.y} L ${toP.x},${toP.y}`,
              'class': 'cg-wire',
              'data-from': gate.id, 'data-to': outNode.id,
            }));
          }
        });
      }
    }

    root._circuit = circuit;
    root._pins = pins;
    return root;
  }

  /* ── Public API ── */
  window.Circuit = {
    build: build,
    render: render,
    interact: interact,
    astToExpr: astToExpr,
    hideTooltip: _hideTooltip,
  };
})();