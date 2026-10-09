/* Boolean algebra derivation: rewrites an expression into a target SOP one
   named law at a time. Used by the K-map Steps panel (Algebra view).

   BoolAlg.derive({ ast, vars, ones, dcs, target, xor }) returns
   { start, startNote, steps: [{ law, form, expr, details, note, flag }], note, reordered }
   where reordered means the last expression has the target's terms in another order
   or null if the derivation could not be verified. */
(function (global) {
  'use strict';

  const DOT = '·';
  const PREC = { or: 1, nor: 1, xor: 2, xnor: 2, and: 3, nand: 3, not: 4, v: 5, c: 5 };
  const SYM = { or: ' + ', nor: ' ⊽ ', xor: ' ⊕ ', xnor: ' ⊙ ', and: DOT, nand: ' ⊼ ' };
  const MAX_TREE_STEPS = 40;
  const MAX_STEPS = 80;
  const MAX_NODES = 800;
  const MAX_DETAILS = 6;
  const MAX_DETAIL_LEN = 100;

  /* ── expression trees ── */

  const V = n => ({ k: 'v', n });
  const C = v => ({ k: 'c', v });
  const NOT = x => ({ k: 'not', x });
  const NARY = (k, xs) => ({ k, xs });
  const conj = n => n.k === 'and' ? n.xs : [n];
  const disj = n => n.k === 'or' ? n.xs : [n];

  function fromAst(a) {
    switch (a.op) {
      case 'VAR': return V(a.name);
      case 'LITERAL': return C(a.value);
      case 'NOT': return NOT(fromAst(a.operand));
      default: return NARY(a.op.toLowerCase(), [fromAst(a.left), fromAst(a.right)]);
    }
  }

  // Flatten nested AND/OR (associativity) and unwrap single-child nodes
  function normalize(n) {
    if (n.k === 'not') return NOT(normalize(n.x));
    if (!n.xs) return n;
    const xs = [];
    for (const c of n.xs) {
      const m = normalize(c);
      if ((n.k === 'and' || n.k === 'or') && m.k === n.k) xs.push(...m.xs);
      else xs.push(m);
    }
    return xs.length === 1 ? xs[0] : NARY(n.k, xs);
  }

  function show(n) {
    switch (n.k) {
      case 'v': return n.n;
      case 'c': return String(n.v);
      case 'not': return PREC[n.x.k] >= PREC.not ? show(n.x) + "'" : '(' + show(n.x) + ")'";
      default: return n.xs.map(c => wrap(c, n)).join(SYM[n.k]);
    }
  }

  function wrap(c, p) {
    const tight = PREC[c.k] < PREC[p.k] ||
      (PREC[c.k] === PREC[p.k] && (c.k !== p.k || p.k === 'nand' || p.k === 'nor'));
    return tight ? '(' + show(c) + ')' : show(c);
  }

  // Structural key, order-insensitive for the commutative gates
  function key(n) {
    switch (n.k) {
      case 'v': return n.n;
      case 'c': return '#' + n.v;
      case 'not': return '!' + key(n.x);
      default: return n.k + '(' + n.xs.map(key).sort().join(',') + ')';
    }
  }

  function size(n) {
    if (n.k === 'not') return 1 + size(n.x);
    if (!n.xs) return 1;
    return n.xs.reduce((s, c) => s + size(c), 1);
  }

  function evalTree(n, bit) {
    switch (n.k) {
      case 'v': return bit(n.n);
      case 'c': return n.v;
      case 'not': return 1 - evalTree(n.x, bit);
      case 'and': return n.xs.every(c => evalTree(c, bit)) ? 1 : 0;
      case 'or': return n.xs.some(c => evalTree(c, bit)) ? 1 : 0;
      case 'nand': return n.xs.every(c => evalTree(c, bit)) ? 0 : 1;
      case 'nor': return n.xs.some(c => evalTree(c, bit)) ? 0 : 1;
      case 'xor': return evalTree(n.xs[0], bit) ^ evalTree(n.xs[1], bit);
      case 'xnor': return 1 - (evalTree(n.xs[0], bit) ^ evalTree(n.xs[1], bit));
    }
    throw new Error('Unknown node ' + n.k);
  }

  function isLiteral(n) { return n.k === 'v' || (n.k === 'not' && n.x.k === 'v'); }
  function isSop(n) {
    if (n.k === 'c') return true;
    return disj(n).every(p => conj(p).every(isLiteral));
  }

  /* ── tree laws, highest priority first ── */

  const TREE_RULES = [
    { law: 'Constant complement', form: "0' = 1, 1' = 0",
      apply: n => n.k === 'not' && n.x.k === 'c' ? C(1 - n.x.v) : null },
    { law: 'Double negation', form: "x'' = x",
      apply: n => n.k === 'not' && n.x.k === 'not' ? n.x.x : null },
    { law: 'Identity law', form: 'x' + DOT + '1 = x, x + 0 = x',
      apply: n => {
        if (n.k !== 'and' && n.k !== 'or') return null;
        const unit = n.k === 'and' ? 1 : 0;
        const xs = n.xs.filter(c => !(c.k === 'c' && c.v === unit));
        if (xs.length === n.xs.length) return null;
        return xs.length === 0 ? C(unit) : xs.length === 1 ? xs[0] : NARY(n.k, xs);
      } },
    { law: 'Null law', form: 'x' + DOT + '0 = 0, x + 1 = 1',
      apply: n => {
        if (n.k !== 'and' && n.k !== 'or') return null;
        const zero = n.k === 'and' ? 0 : 1;
        return n.xs.some(c => c.k === 'c' && c.v === zero) ? C(zero) : null;
      } },
    { law: 'Idempotent law', form: 'x' + DOT + 'x = x, x + x = x',
      apply: n => {
        if (n.k !== 'and' && n.k !== 'or') return null;
        const seen = new Set(), xs = [];
        for (const c of n.xs) {
          const k = key(c);
          if (!seen.has(k)) { seen.add(k); xs.push(c); }
        }
        if (xs.length === n.xs.length) return null;
        return xs.length === 1 ? xs[0] : NARY(n.k, xs);
      } },
    { law: 'Complement law', form: 'x' + DOT + "x' = 0, x + x' = 1",
      apply: n => {
        if (n.k !== 'and' && n.k !== 'or') return null;
        const keys = new Set(n.xs.map(key));
        return n.xs.some(c => keys.has('!' + key(c))) ? C(n.k === 'and' ? 0 : 1) : null;
      } },
    { law: 'Absorption law', form: 'x + x' + DOT + 'y = x, x' + DOT + '(x + y) = x',
      apply: n => {
        if (n.k !== 'and' && n.k !== 'or') return null;
        const parts = n.k === 'or' ? conj : disj;
        const sets = n.xs.map(c => new Set(parts(c).map(key)));
        const keep = n.xs.filter((c, j) => !sets.some((s, i) =>
          i !== j && s.size < sets[j].size && [...s].every(k => sets[j].has(k))));
        if (keep.length === n.xs.length) return null;
        return keep.length === 1 ? keep[0] : NARY(n.k, keep);
      } },
    { law: 'XOR definition', form: 'x ⊕ y = x' + DOT + "y' + x'" + DOT + 'y',
      apply: n => n.k !== 'xor' ? null : NARY('or', [
        NARY('and', [n.xs[0], NOT(n.xs[1])]), NARY('and', [NOT(n.xs[0]), n.xs[1]])]) },
    { law: 'XNOR definition', form: 'x ⊙ y = x' + DOT + "y + x'" + DOT + "y'",
      apply: n => n.k !== 'xnor' ? null : NARY('or', [
        NARY('and', [n.xs[0], n.xs[1]]), NARY('and', [NOT(n.xs[0]), NOT(n.xs[1])])]) },
    { law: 'NAND definition', form: 'x ⊼ y = (x' + DOT + "y)'",
      apply: n => n.k === 'nand' ? NOT(NARY('and', n.xs)) : null },
    { law: 'NOR definition', form: "x ⊽ y = (x + y)'",
      apply: n => n.k === 'nor' ? NOT(NARY('or', n.xs)) : null },
    { law: "De Morgan's law", form: '(x' + DOT + "y)' = x' + y', (x + y)' = x'" + DOT + "y'",
      apply: n => n.k === 'not' && (n.x.k === 'and' || n.x.k === 'or')
        ? NARY(n.x.k === 'and' ? 'or' : 'and', n.x.xs.map(NOT)) : null },
    { law: 'Distributive law', form: 'x' + DOT + '(y + z) = x' + DOT + 'y + x' + DOT + 'z',
      apply: n => {
        if (n.k !== 'and') return null;
        const i = n.xs.findIndex(c => c.k === 'or');
        if (i < 0) return null;
        return NARY('or', n.xs[i].xs.map(y => NARY('and', n.xs.map((c, j) => j === i ? y : c))));
      } },
  ];

  // Apply a rule at every outermost place it matches
  function rewrite(n, rule, hits) {
    const r = rule.apply(n);
    if (r) { hits.push([n, r]); return r; }
    if (n.k === 'not') {
      const x = rewrite(n.x, rule, hits);
      return x === n.x ? n : NOT(x);
    }
    if (!n.xs) return n;
    let changed = false;
    const xs = n.xs.map(c => {
      const m = rewrite(c, rule, hits);
      if (m !== c) changed = true;
      return m;
    });
    return changed ? NARY(n.k, xs) : n;
  }

  /* ── sum-of-products term sets ── */
  // A term maps variable name to 1 (plain) or 0 (complemented).

  function makeTerms(vars) {
    const idx = {};
    vars.forEach((v, i) => { idx[v] = i; });
    const n = vars.length;
    const showT = t => vars.filter(v => v in t).map(v => t[v] ? v : v + "'").join(DOT) || '1';
    return {
      show: showT,
      showS: S => S.length ? S.map(showT).join(' + ') : '0',
      covers: (t, m) => Object.keys(t).every(v => ((m >> (n - 1 - idx[v])) & 1) === t[v]),
      minterm: m => {
        const t = {};
        vars.forEach((v, i) => { t[v] = (m >> (n - 1 - i)) & 1; });
        return t;
      },
    };
  }

  const lits = t => Object.keys(t).length;
  const sub = (a, b) => Object.keys(a).every(v => b[v] === a[v]);

  // Variable two terms are adjacent on (same variables, one polarity differs)
  function adjacentOn(a, b) {
    const ka = Object.keys(a);
    if (ka.length !== lits(b)) return null;
    let diff = null;
    for (const v of ka) {
      if (!(v in b)) return null;
      if (a[v] !== b[v]) {
        if (diff !== null) return null;
        diff = v;
      }
    }
    return diff;
  }

  function consensusOf(q, r) {
    let x = null;
    for (const v in q) {
      if (v in r && r[v] !== q[v]) {
        if (x !== null) return null;
        x = v;
      }
    }
    if (x === null) return null;
    const c = Object.assign({}, q, r);
    delete c[x];
    return c;
  }

  function treeToTerms(n) {
    if (n.k === 'c') return n.v ? [{}] : [];
    return disj(n).map(p => {
      const t = {};
      for (const l of conj(p)) {
        if (l.k === 'v') t[l.n] = 1; else t[l.x.n] = 0;
      }
      return t;
    });
  }

  function parseSop(str) {
    if (!str || str === '0') return [];
    return str.split(' + ').map(ts => {
      const t = {};
      if (ts === '1') return t;
      for (const l of ts.split(DOT)) {
        if (l.endsWith("'")) t[l.slice(0, -1)] = 0; else t[l] = 1;
      }
      return t;
    });
  }

  /* ── sum-of-products laws ── */

  function sopRules(T) {
    const tk = T.show;
    return [
      S => {
        const seen = new Set(), out = [], dups = new Set();
        for (const t of S) {
          const k = tk(t);
          if (seen.has(k)) dups.add(k); else { seen.add(k); out.push(t); }
        }
        if (!dups.size) return null;
        return { law: 'Idempotent law', form: 'x + x = x', S: out,
          details: [...dups].map(k => k + ' + ' + k + ' = ' + k) };
      },
      S => {
        if (S.length < 2 || !S.some(t => lits(t) === 0)) return null;
        return { law: 'Null law', form: 'x + 1 = 1', S: [{}], details: [] };
      },
      S => {
        const details = [];
        const out = S.filter((b, j) => {
          const i = S.findIndex((a, i2) => i2 !== j && lits(a) < lits(b) && sub(a, b));
          if (i < 0) return true;
          details.push(tk(S[i]) + ' + ' + tk(b) + ' = ' + tk(S[i]));
          return false;
        });
        if (!details.length) return null;
        return { law: 'Absorption law', form: 'x + x' + DOT + 'y = x', S: out, details };
      },
      S => {
        // One Quine-McCluskey round: every adjacent pair merges, terms in a pair drop out
        const used = S.map(() => 0), byOrigin = S.map(() => []), seen = new Set(), details = [];
        let repeated = false;
        for (let i = 0; i < S.length; i++) {
          for (let j = i + 1; j < S.length; j++) {
            const v = adjacentOn(S[i], S[j]);
            if (v === null) continue;
            used[i]++; used[j]++;
            const m = Object.assign({}, S[i]);
            delete m[v];
            details.push(tk(S[i]) + ' + ' + tk(S[j]) + ' = ' + tk(m));
            if (seen.has(tk(m))) { repeated = true; continue; }
            seen.add(tk(m));
            byOrigin[i].push(m);
          }
        }
        if (!details.length) return null;
        const out = [];
        S.forEach((t, i) => { if (!used[i]) out.push(t); else out.push(...byOrigin[i]); });
        const notes = [];
        if (used.some(u => u > 1)) notes.push('A term that pairs with more than one other is copied first, using x = x + x.');
        if (repeated) notes.push('Pairs that give the same result are merged, using x + x = x.');
        return { law: 'Combining (adjacency)', form: 'x' + DOT + 'y + x' + DOT + "y' = x", S: out, details, note: notes.join(' ') };
      },
      S => {
        const out = S.slice(), changed = new Set(), used = new Set(), details = [];
        for (let j = 0; j < S.length; j++) {
          if (used.has(j)) continue;
          for (let i = 0; i < S.length; i++) {
            if (i === j || changed.has(i)) continue;
            const a = S[i], b = S[j];
            let pivot = null, ok = true;
            for (const v in a) {
              if (b[v] === a[v]) continue;
              if (v in b && pivot === null) pivot = v;
              else { ok = false; break; }
            }
            if (!ok || pivot === null) continue;
            const nb = Object.assign({}, b);
            delete nb[pivot];
            out[j] = nb;
            changed.add(j); used.add(i);
            details.push(tk(a) + ' + ' + tk(b) + ' = ' + tk(a) + ' + ' + tk(nb));
            break;
          }
        }
        if (!details.length) return null;
        return { law: 'Simplification theorem', form: "x + x'" + DOT + 'y = x + y', S: out, details };
      },
    ];
  }

  // Remove one term that is the consensus of two others, never a target term
  function sopConsensus(S, keep, T) {
    for (let p = 0; p < S.length; p++) {
      if (keep.has(T.show(S[p]))) continue;
      for (let q = 0; q < S.length; q++) {
        for (let r = q + 1; r < S.length; r++) {
          if (q === p || r === p) continue;
          const c = consensusOf(S[q], S[r]);
          if (!c || !sub(c, S[p])) continue;
          const base = T.show(S[q]) + ' + ' + T.show(S[r]);
          return { law: 'Consensus theorem', form: 'x' + DOT + "y + x'" + DOT + 'z + y' + DOT + 'z = x' + DOT + "y + x'" + DOT + 'z',
            S: S.filter((_, i) => i !== p), details: [base + ' + ' + T.show(S[p]) + ' = ' + base] };
        }
      }
    }
    return null;
  }

  /* ── derivation ── */

  function trimDetails(list) {
    const short = list.filter(d => d.length <= MAX_DETAIL_LEN);
    const out = short.slice(0, MAX_DETAILS);
    const rest = list.length - out.length;
    if (rest > 0 && out.length) out.push('and ' + rest + ' more');
    return out;
  }

  function derive(opts) {
    const vars = opts.vars, n = vars.length, rows = 1 << n;
    const T = makeTerms(vars);
    const target = parseSop(opts.target);
    const targetKeys = new Set(target.map(T.show));
    const dcs = new Set(opts.dcs || []);
    const bitFn = m => name => (m >> (n - 1 - vars.indexOf(name))) & 1;
    const vecTree = node => Array.from({ length: rows }, (_, m) => evalTree(node, bitFn(m)));
    const evalS = (S, m) => S.some(t => T.covers(t, m)) ? 1 : 0;
    const vecS = S => Array.from({ length: rows }, (_, m) => evalS(S, m));
    const sameSet = (S, U) => S.length === U.length && S.every(t => targetKeys.has(T.show(t))) &&
      new Set(S.map(T.show)).size === S.length;

    const steps = [];
    const push = (r, expr, vec) => steps.push({
      law: r.law, form: r.form, expr, details: trimDetails(r.details || []),
      note: r.note || '', flag: r.flag || '', vec });

    let F, start, startNote = '', S;

    if (opts.ast) {
      let tree = normalize(fromAst(opts.ast));
      start = show(tree);
      F = vecTree(tree);
      let shortcut = false;

      for (;;) {
        let r = null, next = null, hits = [];
        for (const rule of TREE_RULES) {
          hits = [];
          next = rewrite(tree, rule, hits);
          if (hits.length) { r = rule; break; }
        }
        if (!r) break;
        next = normalize(next);
        if (steps.length >= MAX_TREE_STEPS || size(next) > MAX_NODES) { shortcut = true; break; }
        const details = hits.filter(([a]) => a !== tree).map(([a, b]) => show(a) + ' = ' + show(b));
        tree = next;
        push({ law: r.law, form: r.form, details }, show(tree), vecTree(tree));
      }

      if (shortcut || !isSop(tree)) {
        S = [];
        for (let m = 0; m < rows; m++) if (F[m]) S.push(T.minterm(m));
        push({ law: 'Sum of minterms', form: 'F = Σ of the minterms where F = 1', flag: 'shortcut',
          note: 'Multiplying everything out takes too many steps here, so this reads the minterms from the truth table instead.' },
          T.showS(S), vecS(S));
      } else {
        S = treeToTerms(tree);
        if (T.showS(S) !== show(tree)) {
          push({ law: 'Commutative law', form: 'x' + DOT + 'y = y' + DOT + 'x',
            note: 'Literals in each product are written in variable order.' }, T.showS(S), vecS(S));
        }
      }
    } else {
      S = [];
      for (const m of opts.ones) S.push(T.minterm(m));
      start = T.showS(S);
      startNote = 'Starting from the sum of minterms.';
      F = vecS(S);
    }

    // Simplify the SOP, steering toward the K-map terms
    const rules = sopRules(T);
    while (!sameSet(S, target) && steps.length < MAX_STEPS) {
      let r = null;
      for (const rule of rules) { r = rule(S); if (r) break; }
      if (!r) r = sopConsensus(S, targetKeys, T);
      if (!r) break;
      S = r.S;
      push(r, T.showS(S), vecS(S));
    }

    const cost = U => U.reduce((s, t) => s + lits(t), 0) * 100 + U.length;
    let note = '';

    if (!sameSet(S, target) && cost(S) < cost(target)) {
      note = 'The algebra reached a form with fewer literals than the K-map grouping. ' +
        (dcs.size ? 'Both agree on every minterm that is not a don\'t-care.' : 'Both describe the same function.');
    } else if (!sameSet(S, target)) {
      bridge();
    }

    function bridge() {
      const have = () => new Set(S.map(T.show));
      const mintermsOf = t => Array.from({ length: rows }, (_, m) => m).filter(m => T.covers(t, m));
      const list = ms => ms.map(m => 'm' + m).join(', ');

      // Add the K-map terms that are missing
      const cons = [], cov = [], dc = [];
      const adds = target.filter(t => !have().has(T.show(t)));
      for (const t of adds) {
        let pair = null;
        for (let q = 0; q < S.length && !pair; q++) {
          for (let r = q + 1; r < S.length && !pair; r++) {
            const c = consensusOf(S[q], S[r]);
            if (c && T.show(c) === T.show(t)) pair = [S[q], S[r]];
          }
        }
        const zeros = mintermsOf(t).filter(m => !evalS(S, m));
        if (pair) cons.push([t, T.show(pair[0]) + ' + ' + T.show(pair[1]) + ' gives ' + T.show(t)]);
        else if (!zeros.length) cov.push([t, T.show(t) + ' covers ' + list(mintermsOf(t)) + ', all already 1']);
        else dc.push([t, T.show(t) + ' also covers don\'t-care ' + list(zeros)]);
      }
      const addStep = (group, r) => {
        if (!group.length) return;
        S = S.concat(group.map(g => g[0]));
        push(Object.assign(r, { details: group.map(g => g[1]) }), T.showS(S), vecS(S));
      };
      addStep(cons, { law: 'Consensus theorem', form: 'x' + DOT + "y + x'" + DOT + 'z = x' + DOT + "y + x'" + DOT + 'z + y' + DOT + 'z',
        note: 'Adding the consensus term does not change F.' });
      addStep(cov, { law: 'Adding an implied term', form: 'F = F + t when t implies F',
        note: 'Every minterm of the added term is already 1, so F is unchanged.' });
      addStep(dc, { law: 'Don\'t-care assignment', form: 'F is unspecified on don\'t-care minterms', flag: 'dc',
        note: 'Setting these don\'t-cares to 1 lets the K-map group grow.' });

      // Drop the terms the K-map cover does not use
      const absorbed = [], consensus = [], covered = [], dropped = [];
      for (const s of S) {
        if (targetKeys.has(T.show(s))) continue;
        const u = target.find(t => sub(t, s));
        if (u) { absorbed.push([s, T.show(u) + ' + ' + T.show(s) + ' = ' + T.show(u)]); continue; }
        let pair = null;
        for (let q = 0; q < target.length && !pair; q++) {
          for (let r = q + 1; r < target.length && !pair; r++) {
            const c = consensusOf(target[q], target[r]);
            if (c && sub(c, s)) pair = [target[q], target[r]];
          }
        }
        if (pair) { consensus.push([s, T.show(s) + ' is the consensus of ' + T.show(pair[0]) + ' and ' + T.show(pair[1])]); continue; }
        const open = mintermsOf(s).filter(m => !evalS(target, m));
        if (!open.length) {
          const by = target.filter(t => mintermsOf(s).some(m => T.covers(t, m))).map(T.show);
          covered.push([s, T.show(s) + ' is covered by ' + by.join(' + ')]);
        } else {
          dropped.push([s, 'dropping ' + T.show(s) + ' sets don\'t-care ' + list(open) + ' to 0']);
        }
      }
      const dropStep = (group, r) => {
        if (!group.length) return;
        const gone = new Set(group.map(g => T.show(g[0])));
        S = S.filter(t => !gone.has(T.show(t)));
        push(Object.assign(r, { details: group.map(g => g[1]) }), T.showS(S), vecS(S));
      };
      dropStep(absorbed, { law: 'Absorption law', form: 'x + x' + DOT + 'y = x' });
      dropStep(consensus, { law: 'Consensus theorem', form: 'x' + DOT + "y + x'" + DOT + 'z + y' + DOT + 'z = x' + DOT + "y + x'" + DOT + 'z' });
      dropStep(covered, { law: 'Removing a covered term', form: 'x + y = x when y implies x',
        note: 'Every minterm of the removed term is still 1 through the remaining terms.' });
      dropStep(dropped, { law: 'Don\'t-care assignment', form: 'F is unspecified on don\'t-care minterms', flag: 'dc',
        note: 'These don\'t-cares are left at 0.' });

    }


    const end = steps.length ? steps[steps.length - 1].expr : start;
    const reordered = !note && end !== (opts.target || '0');

    if (opts.xor && sameSet(S, target)) {
      push({ law: 'XOR factoring', form: 'x' + DOT + "y' + x'" + DOT + 'y = x ⊕ y',
        note: 'Reading the XOR definition backwards, after factoring out shared literals.' }, opts.xor, null);
    }

    // Every step must equal F, or match it off the don't-cares once one is assigned
    let relaxed = false;
    for (const st of steps) {
      if (st.flag === 'dc') relaxed = true;
      if (!st.vec) continue;
      for (let m = 0; m < rows; m++) {
        if (st.vec[m] !== F[m] && !(relaxed && dcs.has(m))) {
          console.warn('BoolAlg: step "' + st.law + '" does not match F at m' + m);
          return null;
        }
      }
      delete st.vec;
    }
    if (!note && !sameSet(S, target)) return null;

    return { start, startNote, steps, note, reordered };
  }

  global.BoolAlg = { derive };
})(typeof window !== 'undefined' ? window : globalThis);
