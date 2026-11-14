(() => {
  'use strict';

  const faces = ['U', 'R', 'F', 'D', 'L', 'B'];
  const names = { U: 'Top', R: 'Right', F: 'Front', D: 'Bottom', L: 'Left', B: 'Back' };
  const colours = {
    W: ['White', '#f8fafc'], Y: ['Yellow', '#ffce4b'], R: ['Red', '#f34f59'],
    O: ['Orange', '#ff9052'], G: ['Green', '#42cd91'], B: ['Blue', '#538bff'],
  };
  const standard = ['W', 'R', 'G', 'Y', 'O', 'B'];
  const vectors = {
    U: [[0, 1, 0], [1, 0, 0], [0, 0, 1]], R: [[1, 0, 0], [0, 0, -1], [0, -1, 0]],
    F: [[0, 0, 1], [1, 0, 0], [0, -1, 0]], D: [[0, -1, 0], [1, 0, 0], [0, 0, -1]],
    L: [[-1, 0, 0], [0, 0, 1], [0, -1, 0]], B: [[0, 0, -1], [-1, 0, 0], [0, -1, 0]],
  };
  const stickers = faces.flatMap(face => {
    const [normal, right, down] = vectors[face];
    return Array.from({ length: 4 }, (_, i) => ({ face, normal, position: normal.map((n, axis) =>
      n + right[axis] * (i % 2 ? 1 : -1) + down[axis] * (i >= 2 ? 1 : -1)) }));
  });
  const cornerNames = ['URF', 'UFL', 'ULB', 'UBR', 'DFR', 'DLF', 'DBL', 'DRB'];
  const cornerLabels = ['Top front right', 'Top front left', 'Top back left', 'Top back right',
    'Bottom front right', 'Bottom front left', 'Bottom back left', 'Bottom back right'];
  const corners = cornerNames.map(letters => {
    const position = [0, 1, 2].map(axis => [...letters].reduce((sum, face) => sum + vectors[face][0][axis], 0));
    return [...letters].map(face => stickers.findIndex(s => s.face === face && String(s.position) === String(position)));
  });
  const solved = (scheme = standard) => scheme.flatMap(colour => Array(4).fill(colour));
  const turns = ['U', 'U2', "U'", 'R', 'R2', "R'", 'F', 'F2', "F'"];

  function rotation([x, y, z], axis) {
    if (axis === 0) return [x, z, -y];
    if (axis === 1) return [-z, y, x];
    return [y, -x, z];
  }

  function permutation(face, wholeCube = false) {
    const normal = vectors[face][0];
    const axis = normal.findIndex(Boolean);
    const sign = normal[axis];
    return stickers.map(s => {
      if (!wholeCube && s.position[axis] !== sign) return stickers.indexOf(s);
      let position = s.position;
      let direction = s.normal;
      for (let count = sign === 1 ? 1 : 3; count > 0; count--) {
        position = rotation(position, axis);
        direction = rotation(direction, axis);
      }
      return stickers.findIndex(t => String(t.position) === String(position) && String(t.normal) === String(direction));
    });
  }

  function transform(state, perm) {
    const next = [];
    perm.forEach((target, source) => { next[target] = state[source]; });
    return next;
  }

  const faceTurns = Object.fromEntries(faces.map(face => [face, permutation(face)]));
  function move(state, notation) {
    let result = state;
    const count = notation.endsWith('2') ? 2 : notation.endsWith("'") ? 3 : 1;
    for (let i = 0; i < count; i++) result = transform(result, faceTurns[notation[0]]);
    return result;
  }

  function decode(state, goal) {
    const pieces = corners.map(indices => indices.map(i => goal[i]));
    const p = [];
    const o = [];
    const faults = [];
    const used = new Map();
    let twist = 0;
    corners.forEach((indices, slot) => {
      const actual = indices.map(i => state[i]);
      const piece = pieces.findIndex(expected => expected.every(colour => actual.includes(colour)));
      if (piece < 0) {
        faults.push({ slot, type: 'The three colours do not form a corner in this colour scheme.' });
        return;
      }
      const expected = pieces[piece];
      const orientation = actual.indexOf(expected[0]);
      if (actual[(orientation + 1) % 3] !== expected[1]) {
        faults.push({ slot, type: 'The colours appear in reverse order around this corner.' });
      }
      if (!used.has(piece)) used.set(piece, []);
      used.get(piece).push(slot);
      p[slot] = piece;
      o[slot] = orientation;
      twist = (twist + orientation) % 3;
    });
    for (const positions of used.values()) {
      if (positions.length > 1) positions.forEach(slot => faults.push({ slot, type: 'This corner colour combination appears twice.' }));
    }
    return { p, o, faults, twist };
  }

  function analyse(state, scheme) {
    const counts = Object.fromEntries(Object.keys(colours).map(colour => [colour, state.filter(c => c === colour).length]));
    const missing = state.filter(c => !c).length;
    if (missing) return { counts, missing, faults: [], valid: false };
    const decoded = decode(state, solved(scheme));
    return { counts, missing, ...decoded, valid: Object.values(counts).every(count => count === 4) && !decoded.faults.length && decoded.twist === 0 };
  }

  function repairs(state, scheme, result) {
    const layouts = new Set();
    const candidates = [];
    const goal = solved(scheme);
    function add(next, type, slots, detail = '') {
      const key = next.join('');
      if (layouts.has(key) || !analyse(next, scheme).valid) return;
      layouts.add(key);
      candidates.push({ next, type, slots, detail, changes: next.flatMap((c, i) => c === state[i] ? [] : [i]) });
    }
    if (result.missing || result.valid) return candidates;
    for (const [slot, indices] of corners.entries()) {
      for (const piece of corners) {
        for (let spin = 0; spin < 3; spin++) {
          const next = state.slice();
          indices.forEach((index, j) => { next[index] = goal[piece[(j + spin) % 3]]; });
          if (indices.every(index => next[index] === state[index])) continue;
          const sameColours = indices.every(index => indices.some(other => next[index] === state[other]));
          const type = sameColours && !result.faults.length ? 'twist' : 'stickers';
          add(next, type, [slot]);
        }
      }
    }
    for (let i = 0; i < 24; i++) {
      for (let j = i + 1; j < 24; j++) {
        if (state[i] === state[j]) continue;
        const next = state.slice();
        [next[i], next[j]] = [next[j], next[i]];
        add(next, 'stickers', [...new Set([i, j].map(index => corners.findIndex(corner => corner.includes(index))))]);
      }
    }
    faces.forEach((face, fi) => {
      let next = state.slice();
      [90, 180, 270].forEach(angle => {
        const start = fi * 4;
        const rotated = next.slice();
        [2, 0, 3, 1].forEach((source, target) => { rotated[start + target] = next[start + source]; });
        next = rotated;
        add(next, 'entry', [], `${names[face]} (${face}) grid · ${angle}° clockwise`);
      });
    });
    if (!candidates.length) {
      const pieces = corners.map(indices => indices.map(i => goal[i]));
      const costs = corners.map(indices => pieces.map(piece => [0, 1, 2].map(spin =>
        indices.reduce((cost, index, i) => cost + Number(state[index] !== piece[(i + 3 - spin) % 3]), 0))));
      const memo = new Map();
      function closest(slot, used, twist) {
        if (slot === corners.length) return { cost: twist === 0 ? 0 : Infinity };
        const key = used * 3 + twist;
        if (memo.has(key)) return memo.get(key);
        let best = { cost: Infinity };
        for (let piece = 0; piece < pieces.length; piece++) {
          if (used & (1 << piece)) continue;
          for (let spin = 0; spin < 3; spin++) {
            const rest = closest(slot + 1, used | (1 << piece), (twist + spin) % 3);
            const cost = costs[slot][piece][spin] + rest.cost;
            if (cost < best.cost) best = { cost, piece, spin, rest };
          }
        }
        memo.set(key, best);
        return best;
      }
      const next = state.slice();
      let choice = closest(0, 0, 0);
      const changedSlots = [];
      corners.forEach((indices, slot) => {
        indices.forEach((index, i) => { next[index] = pieces[choice.piece][(i + 3 - choice.spin) % 3]; });
        if (indices.some(index => next[index] !== state[index])) changedSlots.push(slot);
        choice = choice.rest;
      });
      add(next, 'layout', changedSlots);
    }
    const priority = { entry: 0, twist: 1, stickers: 2 };
    return candidates.sort((a, b) => priority[a.type] - priority[b.type] || a.changes.length - b.changes.length);
  }

  const wholeTurns = ['U', 'R', 'F'].map(face => permutation(face, true));
  function rotatedGoals(scheme) {
    const states = [solved(scheme)];
    const seen = new Set([states[0].join('')]);
    for (const state of states) {
      for (const perm of wholeTurns) {
        const next = transform(state, perm);
        const key = next.join('');
        if (seen.has(key)) continue;
        seen.add(key);
        states.push(next);
      }
    }
    return states;
  }

  const anchor = 6;
  const active = [0, 1, 2, 3, 4, 5, 7];
  const kinematics = turns.map(turn => {
    const goal = solved();
    const { p, o } = decode(move(goal, turn), goal);
    return { source: active.map(slot => active.indexOf(p[slot])), twist: active.map(slot => o[slot]) };
  });
  const factorial = [1, 1, 2, 6, 24, 120, 720, 5040];

  function rankPermutation(p) {
    let rank = 0;
    for (let i = 0; i < 7; i++) {
      let count = 0;
      for (let j = i + 1; j < 7; j++) if (p[j] < p[i]) count++;
      rank += count * factorial[6 - i];
    }
    return rank;
  }

  function unrankPermutation(rank) {
    const remaining = [0, 1, 2, 3, 4, 5, 6];
    return Array.from({ length: 7 }, (_, i) => {
      const unit = factorial[6 - i];
      const [piece] = remaining.splice(Math.floor(rank / unit), 1);
      rank %= unit;
      return piece;
    });
  }

  function rankOrientation(o) {
    return o.slice(0, 6).reduce((rank, spin) => rank * 3 + spin, 0);
  }

  function unrankOrientation(rank) {
    const o = [0, 0, 0, 0, 0, 0, 0];
    for (let i = 5; i >= 0; i--) {
      o[i] = rank % 3;
      rank = Math.floor(rank / 3);
    }
    o[6] = (3 - o.reduce((sum, spin) => sum + spin, 0) % 3) % 3;
    return o;
  }

  function buildTable(size, unpack, transition) {
    const table = new Uint16Array(size * 9);
    for (let coordinate = 0; coordinate < size; coordinate++) {
      const decoded = unpack(coordinate);
      kinematics.forEach((turn, i) => { table[coordinate * 9 + i] = transition(decoded, turn); });
    }
    const depth = new Int8Array(size).fill(-1);
    const queue = new Uint16Array(size);
    depth[0] = 0;
    let tail = 1;
    for (let head = 0; head < tail; head++) {
      const current = queue[head];
      for (let i = 0; i < 9; i++) {
        const next = table[current * 9 + i];
        if (depth[next] !== -1) continue;
        depth[next] = depth[current] + 1;
        queue[tail++] = next;
      }
    }
    return { table, depth };
  }

  let tables;
  function solve(state, scheme) {
    if (!analyse(state, scheme).valid) return null;
    // Fix the bottom-back-left corner. Whole-cube rotation makes its current colours the target reference.
    const goal = rotatedGoals(scheme).find(candidate => corners[anchor].every(index => candidate[index] === state[index]));
    const { p, o } = decode(state, goal);
    const pStart = rankPermutation(active.map(slot => active.indexOf(p[slot])));
    const oStart = rankOrientation(active.map(slot => o[slot]));
    if (!pStart && !oStart) return [];
    tables ??= [
      buildTable(5040, unrankPermutation, (p, turn) => rankPermutation(turn.source.map(source => p[source]))),
      buildTable(729, unrankOrientation, (o, turn) => rankOrientation(turn.source.map((source, i) => (o[source] + turn.twist[i]) % 3))),
    ];
    const [perm, orient] = tables;
    const path = [];
    function search(p, o, remaining, previous) {
      if (Math.max(perm.depth[p], orient.depth[o]) > remaining) return false;
      if (p === 0 && o === 0) return true;
      for (let turn = 0; turn < turns.length; turn++) {
        const face = Math.floor(turn / 3);
        if (face === previous) continue;
        path.push(turns[turn]);
        if (search(perm.table[p * 9 + turn], orient.table[o * 9 + turn], remaining - 1, face)) return true;
        path.pop();
      }
      return false;
    }
    for (let limit = Math.max(perm.depth[pStart], orient.depth[oStart]); limit <= 11; limit++) {
      if (search(pStart, oStart, limit, -1)) return path;
    }
    throw new Error('No solution found for a valid layout');
  }

  function twistCorner(state, slot) {
    const next = state.slice();
    corners[slot].forEach((index, i, indices) => { next[index] = state[indices[(i + 1) % 3]]; });
    return next;
  }

  const api = { faces, names, colours, standard, vectors, stickers, corners, cornerNames, cornerLabels, solved, move, solve, analyse, repairs, twistCorner };
  if (typeof module === 'object') module.exports = api;
  else globalThis.Cube = api;
})();
