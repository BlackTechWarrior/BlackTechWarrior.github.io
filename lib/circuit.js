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
  const COL_GAP = 140;    // horizontal gap between columns (was 120)
  const ROW_GAP = 40;     // vertical gap between gates (was 30)
  const MARGIN_X = 80;    // left/right margin (was 70)
  const MARGIN_Y = 40;    // top/bottom margin (was 30)
  const PIN_LEN = 25;     // input/output stub length (was 20)
  const TRACK_SP = 10;    // spacing between wire tracks in routing channel
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
      if (node.op === 'NOT') return makeGate('NOT', [process(node.operand)], astToExpr(node));

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
      const x = MARGIN_X + d * COL_GAP;
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

    const totalW = MARGIN_X * 2 + (maxDepth + 1) * COL_GAP;

    return { positions, width: totalW, height: totalH, nodeMap, maxDepth, columns, nodeSizes };
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
    const { positions, nodeMap, maxDepth } = lay;

    // ── 1. Build fan-out groups ──
    // For each source node, collect all edges leaving it.
    const fanOutEdges = {};
    edges.forEach(e => {
      if (!fanOutEdges[e.from]) fanOutEdges[e.from] = [];
      fanOutEdges[e.from].push(e);
    });

    // ── 2. For each edge, determine routing segments ──
    // An edge from depth dS to depth dT needs a horizontal
    // trunk from dS to some gap, then a vertical in that gap,
    // then horizontal into dT.
    //
    // Strategy: route the vertical segment in the gap
    // immediately before the destination column (gap = dT).
    // For long-span wires (dT - dS > 1), the horizontal
    // trunk extends across intermediate gaps. We allocate
    // a track in *every* gap the wire passes through so it
    // doesn't collide with other wires in those gaps.

    // Collect wire segments per gap
    // gapTracks[gapIdx] = [ { edge, fromP, toP, fromY, toY, isPassThrough } ]
    const gapTracks = {};

    const wireSegments = []; // final drawing instructions

    edges.forEach(e => {
      const fromNode = nodeMap[e.from];
      const toNode = nodeMap[e.to];
      if (!fromNode || !toNode) return;
      const fromPins = pins[e.from];
      const toPins = pins[e.to];
      if (!fromPins || !toPins) return;

      const pinIdx = toNode.inputs.indexOf(e.from);
      if (pinIdx < 0 || pinIdx >= toPins.inputPins.length) return;

      const fromP = fromPins.outputPin;
      const toP = toPins.inputPins[pinIdx];
      const dS = fromNode.depth;
      const dT = toNode.depth;

      // Register in every gap this wire passes through
      for (let g = dS + 1; g <= dT; g++) {
        if (!gapTracks[g]) gapTracks[g] = [];
        gapTracks[g].push({
          edge: e,
          fromP,
          toP,
          fromY: fromP.y,
          toY: toP.y,
          srcDepth: dS,
          dstDepth: dT,
          gapIdx: g,
          // Is this the final gap (where the vertical bend happens)?
          isBendGap: g === dT,
          // Is this a pass-through gap (wire is just horizontal)?
          isPassThrough: g < dT,
        });
      }
    });

    // ── 3. Assign track x-positions per gap ──
    // Sort wires in each gap by their vertical midpoint to
    // minimise crossings, then assign evenly-spaced x tracks.
    const trackAssignments = {}; // key: `${edge.from}-${edge.to}-${gapIdx}` → trackX

    for (const gapIdxStr in gapTracks) {
      const gapIdx = parseInt(gapIdxStr);
      const wires = gapTracks[gapIdx];

      // Gap center x: midpoint between column (gapIdx-1) and column gapIdx
      const leftColX = MARGIN_X + (gapIdx - 1) * COL_GAP;
      const rightColX = MARGIN_X + gapIdx * COL_GAP;
      const gapCenterX = (leftColX + rightColX) / 2;

      // Sort by vertical position to minimize crossings.
      // For bend-gap wires, use destination Y; for pass-through, use source Y.
      wires.sort((a, b) => {
        const aY = a.isBendGap ? (a.fromY + a.toY) / 2 : a.fromY;
        const bY = b.isBendGap ? (b.fromY + b.toY) / 2 : b.fromY;
        return aY - bY;
      });

      const n = wires.length;
      const totalWidth = (n - 1) * TRACK_SP;
      const startX = gapCenterX - totalWidth / 2;

      wires.forEach((w, idx) => {
        const trackX = n === 1 ? gapCenterX : startX + idx * TRACK_SP;
        const key = `${w.edge.from}-${w.edge.to}-${gapIdx}`;
        trackAssignments[key] = trackX;
      });
    }

    // ── 4. Generate wire paths ──
    const wirePaths = [];
    const processedEdges = new Set();

    edges.forEach(e => {
      const edgeKey = `${e.from}-${e.to}`;
      if (processedEdges.has(edgeKey)) return;
      processedEdges.add(edgeKey);

      const fromNode = nodeMap[e.from];
      const toNode = nodeMap[e.to];
      if (!fromNode || !toNode) return;
      const fromPins_ = pins[e.from];
      const toPins_ = pins[e.to];
      if (!fromPins_ || !toPins_) return;

      const pinIdx = toNode.inputs.indexOf(e.from);
      if (pinIdx < 0 || pinIdx >= toPins_.inputPins.length) return;

      const fromP = fromPins_.outputPin;
      const toP = toPins_.inputPins[pinIdx];
      const dS = fromNode.depth;
      const dT = toNode.depth;

      if (Math.abs(fromP.y - toP.y) < 1 && dT - dS === 1) {
        // Straight horizontal — no routing needed
        wirePaths.push({
          d: `M ${fromP.x},${fromP.y} L ${toP.x},${toP.y}`,
          edge: e,
        });
        return;
      }

      // Build the path through allocated tracks
      const points = [{ x: fromP.x, y: fromP.y }];

      // The vertical segment happens in the bend gap (= dT)
      const bendTrackKey = `${e.from}-${e.to}-${dT}`;
      const bendX = trackAssignments[bendTrackKey];

      if (bendX !== undefined) {
        // Horizontal from source to the bend track
        points.push({ x: bendX, y: fromP.y });
        // Vertical to destination Y
        points.push({ x: bendX, y: toP.y });
        // Horizontal into destination pin
        points.push({ x: toP.x, y: toP.y });
      } else {
        // Fallback: direct L-shape
        const midX = (fromP.x + toP.x) / 2;
        points.push({ x: midX, y: fromP.y });
        points.push({ x: midX, y: toP.y });
        points.push({ x: toP.x, y: toP.y });
      }

      // Build SVG path, removing redundant collinear points
      const cleaned = [points[0]];
      for (let i = 1; i < points.length; i++) {
        const prev = cleaned[cleaned.length - 1];
        const curr = points[i];
        // Skip if same point
        if (Math.abs(prev.x - curr.x) < 0.5 && Math.abs(prev.y - curr.y) < 0.5) continue;
        cleaned.push(curr);
      }

      let d = `M ${cleaned[0].x},${cleaned[0].y}`;
      for (let i = 1; i < cleaned.length; i++) {
        d += ` L ${cleaned[i].x},${cleaned[i].y}`;
      }

      wirePaths.push({ d, edge: e });
    });

    return wirePaths;
  }

  /* ═══════════════════════════════════════════════════════
     SVG Renderer
     ═══════════════════════════════════════════════════════ */

  function render(circuit, options) {
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
    const wirePaths = routeWires(circuit, lay, pins);
    const fanOut = {};
    edges.forEach(e => { fanOut[e.from] = (fanOut[e.from] || 0) + 1; });
    const junctionsDone = {};

    wirePaths.forEach(wp => {
      const wire = s('path', {
        d: wp.d, 'class': 'cg-wire',
        'data-from': wp.edge.from, 'data-to': wp.edge.to,
      });
      wireLayer.appendChild(wire);

      // Fan-out junction dot
      if (fanOut[wp.edge.from] > 1) {
        const fromPins_ = pins[wp.edge.from];
        if (fromPins_) {
          const fp = fromPins_.outputPin;
          const jKey = fp.x + ',' + fp.y;
          if (!junctionsDone[jKey]) {
            junctionsDone[jKey] = true;
            juncLayer.appendChild(s('circle', {
              cx: fp.x, cy: fp.y, r: 3, 'class': 'cg-junction',
            }));
          }
        }
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

  /* ── Public API ── */
  window.Circuit = {
    build: build,
    render: render,
    interact: interact,
    astToExpr: astToExpr,
    hideTooltip: _hideTooltip,
  };
})();