/* ================================================================
   Shared Circuit Rendering Engine — /lib/circuit.js
   Used by /circuitgen/ and /kmap/
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
.cg-wire{fill:none;stroke:#666666;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}
body.dark .cg-wire{stroke:#999999}
.cg-wire-hl{stroke:#0066cc !important;stroke-width:3 !important}
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
  const COL_GAP = 120;    // horizontal gap between columns
  const ROW_GAP = 30;     // vertical gap between gates
  const MARGIN_X = 70;    // left/right margin
  const MARGIN_Y = 30;    // top/bottom margin
  const PIN_LEN = 20;     // input/output stub length

  /* ═══════════════════════════════════════════════════════
     Gate Shape Generators
     All coordinates relative to gate center (0,0).
     Returns { paths, w, h, inputPins, outputPin, bubble }
     ═══════════════════════════════════════════════════════ */

  function gateH(n) { return Math.max(GH_MIN, n * PIN_SP + 4); }

  function andShape(n) {
    const h = gateH(n), hh = h / 2;
    // Flat left, elliptical arc right
    // Arc from (5,-hh) to (5,hh) with rx=20, ry=hh → rightmost at x=25
    const path = `M -25,${-hh} L 5,${-hh} A 20,${hh} 0 0,1 5,${hh} L -25,${hh} Z`;
    const pins = [];
    for (let i = 0; i < n; i++) pins.push({ x: -25, y: -hh + h * (i + 0.5) / n });
    return { paths: [path], w: GW, h, inputPins: pins, outputPin: { x: 25, y: 0 }, bubble: null };
  }

  function orShape(n) {
    const h = gateH(n), hh = h / 2;
    // Right side: two cubic curves meeting at tip (25,0)
    // Left side: concave quadratic curve
    const path = `M -20,${-hh} `
      + `C 5,${-hh} 18,${-hh * 0.3} 25,0 `
      + `C 18,${hh * 0.3} 5,${hh} -20,${hh} `
      + `Q -5,0 -20,${-hh}`;
    // Input pins on the concave curve: Q from (-20,hh) ctrl (-5,0) to (-20,-hh)
    // Parametric: x(t) = -20+30t-30t², y(t) = hh(2t-1) ... but for this specific curve:
    // P0=(-20,-hh), P1=(-5,0), P2=(-20,hh)
    // x(t) = (1-t)²(-20) + 2(1-t)t(-5) + t²(-20) = -20 + 30t - 30t²
    // y(t) = (1-t)²(-hh) + t²(hh) = hh(2t-1)  ... simplified from the quad
    // Actually y(t) = (1-t)²(-hh) + 2(1-t)t*0 + t²(hh) = hh(-1+2t)
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
    // Extra curve 8px to the left of the input curve
    base.paths.push(`M -28,${-hh} Q -13,0 -28,${hh}`);
    // Shift input pins left slightly to align with outer curve
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
    else shape = andShape(n); // fallback
    if (hasNeg) {
      shape.bubble = { x: shape.outputPin.x + BUBBLE_R, y: 0 };
      shape.outputPin = { x: shape.outputPin.x + BUBBLE_R * 2, y: 0 };
    }
    return shape;
  }

  /* ═══════════════════════════════════════════════════════
     AST → Circuit Graph
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
          // Cascade into tree of max-5-input gates
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
     Layout Engine
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

    const totalH = Math.max(maxColH + MARGIN_Y * 2, 200);

    // Assign positions (center of each node)
    const positions = {};
    for (const d in columns) {
      const depth = parseInt(d);
      const x = MARGIN_X + depth * COL_GAP;
      const colH = colHeights[d];
      let y = (totalH - colH) / 2;

      columns[d].forEach(n => {
        const size = nodeSizes[n.id];
        y += size.h / 2;
        positions[n.id] = { x: x, y: y };
        y += size.h / 2 + ROW_GAP;
      });
    }

    const totalW = MARGIN_X * 2 + (maxDepth + 1) * COL_GAP;

    return { positions: positions, width: totalW, height: totalH, nodeMap: nodeMap, maxDepth: maxDepth };
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

    // Pin world positions: nodeId -> { inputPins: [{x,y}], outputPin: {x,y} }
    const pins = {};

    // ── Draw input nodes ──
    nodes.filter(n => n.type === 'INPUT').forEach(n => {
      const pos = positions[n.id];
      const outX = pos.x + PIN_LEN;

      // Label
      labelLayer.appendChild(s('text', {
        x: pos.x - 8, y: pos.y + 5,
        'class': 'cg-label cg-input-label',
        'text-anchor': 'end',
      }, n.name));

      // Stub wire
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

      // Gate body path(s)
      shape.paths.forEach(p => {
        group.appendChild(s('path', { d: p, 'class': 'cg-gate-body' }));
      });

      // NOT bubble
      if (shape.bubble) {
        group.appendChild(s('circle', {
          cx: shape.bubble.x, cy: shape.bubble.y, r: BUBBLE_R,
          'class': 'cg-bubble',
        }));
      }

      // Gate label (inside body)
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

      // World-space pins
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
        x: outP.x + PIN_LEN + 5, y: outP.y + 5,
        'class': 'cg-label cg-output-label',
      }, 'Out'));
    }

    // ── Draw wires ──
    var fanOut = {};
    edges.forEach(function(e) { fanOut[e.from] = (fanOut[e.from] || 0) + 1; });
    var junctionsDone = {};

    // Allocate wire tracks between columns to avoid overlap
    // Group edges by the column gap they cross
    var gapWires = {};  // 'fromDepth' -> [{ edge, fromY, toY }]
    edges.forEach(function(e) {
      var fromNode = nodeMap[e.from];
      var toNode = nodeMap[e.to];
      if (!fromNode || !toNode) return;
      var fromPins = pins[e.from];
      var toPins = pins[e.to];
      if (!fromPins || !toPins) return;
      var pinIdx = toNode.inputs.indexOf(e.from);
      if (pinIdx < 0 || pinIdx >= toPins.inputPins.length) return;

      var fromP = fromPins.outputPin;
      var toP = toPins.inputPins[pinIdx];
      var key = fromNode.depth;
      if (!gapWires[key]) gapWires[key] = [];
      gapWires[key].push({ edge: e, fromP: fromP, toP: toP });
    });

    // For each gap, assign unique track x-offsets
    for (var gapKey in gapWires) {
      var wires = gapWires[gapKey];
      var baseX; // midpoint between columns
      if (wires.length > 0) {
        baseX = (wires[0].fromP.x + wires[0].toP.x) / 2;
      }
      // Sort wires by fromY for consistent ordering
      wires.sort(function(a, b) { return a.fromP.y - b.fromP.y; });
      var trackSpacing = 6;
      var totalTracks = wires.length;
      var startOffset = -(totalTracks - 1) * trackSpacing / 2;

      wires.forEach(function(w, idx) {
        var fromP = w.fromP;
        var toP = w.toP;
        var pathD;

        if (Math.abs(fromP.y - toP.y) < 1) {
          // Straight horizontal
          pathD = 'M ' + fromP.x + ',' + fromP.y + ' L ' + toP.x + ',' + toP.y;
        } else {
          // Z-shaped routing with unique track offset
          var midX = baseX + startOffset + idx * trackSpacing;
          pathD = 'M ' + fromP.x + ',' + fromP.y
            + ' L ' + midX + ',' + fromP.y
            + ' L ' + midX + ',' + toP.y
            + ' L ' + toP.x + ',' + toP.y;
        }

        var wire = s('path', {
          d: pathD, 'class': 'cg-wire',
          'data-from': w.edge.from, 'data-to': w.edge.to,
        });
        wireLayer.appendChild(wire);

        // Fan-out junction dot
        if (fanOut[w.edge.from] > 1) {
          var jKey = fromP.x + ',' + fromP.y;
          if (!junctionsDone[jKey]) {
            junctionsDone[jKey] = true;
            juncLayer.appendChild(s('circle', {
              cx: fromP.x, cy: fromP.y, r: 3, 'class': 'cg-junction',
            }));
          }
        }
      });
    }

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
