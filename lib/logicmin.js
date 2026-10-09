/* Exact two-level logic minimization for up to 6 variables.
   Used by the K-map generator and the state machine designer.

   Minterm m has variable i (0 = first declared) at bit (n - 1 - i).
   A cube fixes the bits in `mask` to the bits in `value`; the rest are free.

   LogicMin.minimize(n, ones, dcs) -> {
     primes:    [cube]   every prime implicant that covers a one
     essential: [cube]   primes that are the only cover of some one
     cover:     [cube]   a minimum cover: fewest cubes, then fewest literals
   }
   cube = { mask, value, minterms: [m], covered: [ones it covers] }

   LogicMin.qmColumns(n, ones, dcs) -> the Quine-McCluskey combining columns:
   [[{ mask, value, minterms, used }]], column k holding cubes of 2^k minterms. */
(function (global) {
  'use strict';

  function popcount(x) { let c = 0; while (x) { c += x & 1; x >>= 1; } return c; }

  function mintermsOf(n, mask, value) {
    const out = [];
    for (let m = 0; m < (1 << n); m++) if ((m & mask) === value) out.push(m);
    return out;
  }

  function minimize(n, ones, dcs) {
    const size = 1 << n, full = size - 1;
    const onSet = new Set(ones);
    const allowed = new Array(size).fill(false);
    ones.forEach(m => { allowed[m] = true; });
    (dcs || []).forEach(m => { allowed[m] = true; });
    if (ones.length === 0) return { primes: [], essential: [], cover: [] };

    // Every cube made only of ones and don't-cares
    const valid = [];
    for (let mask = 0; mask <= full; mask++) {
      for (let value = mask; ; value = (value - 1) & mask) {
        const ms = mintermsOf(n, mask, value);
        if (ms.every(m => allowed[m])) valid.push({ mask, value, minterms: ms });
        if (value === 0) break;
      }
    }

    // Primes: inside no larger valid cube, covering at least one 1
    const primes = valid.filter(p =>
      p.minterms.some(m => onSet.has(m)) &&
      !valid.some(q => q.mask !== p.mask && (q.mask & p.mask) === q.mask && (p.value & q.mask) === q.value)
    );
    primes.forEach(p => { p.covered = p.minterms.filter(m => onSet.has(m)); });
    // Larger cubes first, then by first minterm, so ties resolve the same way every time
    const order = (a, b) => popcount(a.mask) - popcount(b.mask) || a.minterms[0] - b.minterms[0];
    primes.sort(order);

    const coverers = {};
    ones.forEach(m => { coverers[m] = primes.filter(p => (m & p.mask) === p.value); });
    const essential = primes.filter(p => p.covered.some(m => coverers[m].length === 1));

    // Exact minimum cover by branch and bound: fewest cubes, then fewest literals
    let best = null, bestCost = [Infinity, Infinity], budget = 200000;
    const better = (a, b) => a[0] < b[0] || (a[0] === b[0] && a[1] < b[1]);
    function search(chosen, uncovered, lits) {
      if (--budget < 0 && best) return;
      if (uncovered.size === 0) {
        const cost = [chosen.length, lits];
        if (better(cost, bestCost)) { best = chosen.slice(); bestCost = cost; }
        return;
      }
      if (chosen.length + 1 > bestCost[0]) return;
      let pick = null;
      for (const m of uncovered) if (pick === null || coverers[m].length < coverers[pick].length) pick = m;
      for (const p of coverers[pick]) {
        const next = new Set(uncovered);
        p.covered.forEach(m => next.delete(m));
        chosen.push(p);
        search(chosen, next, lits + popcount(p.mask));
        chosen.pop();
      }
    }
    search([], new Set(ones), 0);

    return { primes, essential, cover: best.slice().sort(order) };
  }

  function qmColumns(n, ones, dcs) {
    const start = [...new Set([...ones, ...(dcs || [])])].sort((a, b) => a - b);
    const full = (1 << n) - 1;
    let column = start.map(m => ({ mask: full, value: m, minterms: [m], used: false }));
    const columns = [column];
    while (column.length) {
      const next = [], seen = new Set();
      for (let i = 0; i < column.length; i++) {
        for (let j = i + 1; j < column.length; j++) {
          const a = column[i], b = column[j];
          if (a.mask !== b.mask) continue;
          const diff = a.value ^ b.value;
          if (popcount(diff) !== 1) continue;
          a.used = b.used = true;
          const mask = a.mask & ~diff, value = a.value & mask;
          const key = mask + ':' + value;
          if (seen.has(key)) continue;
          seen.add(key);
          next.push({ mask, value, minterms: mintermsOf(n, mask, value), used: false });
        }
      }
      if (!next.length) break;
      next.sort((a, b) => a.minterms[0] - b.minterms[0]);
      columns.push(next);
      column = next;
    }
    return columns;
  }

  // Product term for a cube, literals in variable order: A·B'
  function cubeToTerm(cube, vars) {
    const n = vars.length, lits = [];
    vars.forEach((v, i) => {
      const bit = 1 << (n - 1 - i);
      if (cube.mask & bit) lits.push(cube.value & bit ? v : v + "'");
    });
    return lits.length ? lits.join('·') : '1';
  }

  // Sum term for a cube of zeros: (A + B')
  function cubeToSum(cube, vars) {
    const n = vars.length, lits = [];
    vars.forEach((v, i) => {
      const bit = 1 << (n - 1 - i);
      if (cube.mask & bit) lits.push(cube.value & bit ? v + "'" : v);
    });
    return lits.length ? '(' + lits.join(' + ') + ')' : '(0)';
  }

  // Cube written as bits with dashes for free variables: 1-0-
  function cubeToPattern(cube, n) {
    let s = '';
    for (let i = 0; i < n; i++) {
      const bit = 1 << (n - 1 - i);
      s += cube.mask & bit ? (cube.value & bit ? '1' : '0') : '-';
    }
    return s;
  }

  global.LogicMin = { minimize, qmColumns, cubeToTerm, cubeToSum, cubeToPattern, popcount };
})(typeof window !== 'undefined' ? window : globalThis);
