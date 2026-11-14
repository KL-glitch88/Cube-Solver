import {
  applyLayerTurns, CORNER_FACELETS, CORNER_FACELETS_4, CORNERS, EDGE_FACELETS,
  EDGES, FACES, formatMove, parseFacelets, parseFacelets4, SOLVED_FACELETS,
  SOLVED_4, cube4ToFacelets, toMove,
} from '@cube/core';
import { buildTwoPhaseTables } from '../upstream/packages/solver-ts/src/tables.ts';
import { createTwoPhaseSolver } from '../upstream/packages/solver-ts/src/two-phase.ts';
import { buildReductionTables } from '../upstream/packages/solver-ts/src/four/tables.ts';
import { buildEdgePairing } from '../upstream/packages/solver-ts/src/four/edge-pairing.ts';
import { createReductionSolver } from '../upstream/packages/solver-ts/src/four/reduction.ts';

let solve: ReturnType<typeof createReductionSolver> | undefined;
let solveThree: ReturnType<typeof createTwoPhaseSolver> | undefined;
const exampleTurns = [
  { face: 'R', from: 1, to: 2, turns: 1 },
  { face: 'U', from: 1, to: 1, turns: 1 },
  { face: 'F', from: 2, to: 2, turns: 3 },
  { face: 'L', from: 1, to: 2, turns: 2 },
  { face: 'D', from: 1, to: 1, turns: 3 },
  { face: 'B', from: 1, to: 2, turns: 1 },
] as const;

function corrections(input: string, size: number, codes: readonly string[]) {
  const perFace = size * size;
  const corners = size === 3 ? CORNER_FACELETS : CORNER_FACELETS_4;
  const candidates: { label: string; next: string[]; changes: number[] }[] = [];
  const add = (label: string, next: string[]) => {
    if (!(size === 3 ? parseFacelets(next) : parseFacelets4(next.join(''))).ok) return;
    const changes = next.flatMap((colour, index) => colour === input[index] ? [] : [index]);
    if (changes.length) candidates.push({ label, next, changes });
  };
  for (const [face, letter] of FACES.entries()) {
    const offset = face * perFace;
    for (let turns = 1; turns <= 3; turns++) {
      const next = [...input];
      for (let i = 0; i < perFace; i++) {
        let position = i;
        for (let turn = 0; turn < turns; turn++) {
          position = (position % size) * size + size - 1 - Math.floor(position / size);
        }
        next[offset + position] = input[offset + i];
      }
      add(letter + ' face · rotate entry ' + turns * 90 + '° clockwise', next);
    }
  }
  for (const [corner, indices] of corners.entries()) {
    for (const shift of [1, 2]) {
      const next = [...input];
      indices.forEach((index, i) => { next[index] = input[indices[(i + shift) % 3]]; });
      add('Reorient the ' + ['top right front', 'top front left', 'top left back', 'top back right',
        'bottom front right', 'bottom left front', 'bottom back left', 'bottom right back'][corner] + ' corner', next);
    }
  }
  if (size === 3 && codes.includes('flipped-edge')) {
    for (const [edge, [a, b]] of EDGE_FACELETS.entries()) {
      const next = [...input];
      [next[a], next[b]] = [next[b], next[a]];
      add('Reorient the ' + EDGES[edge] + ' edge', next);
    }
  }
  return candidates;
}

function checkThree(stickers: string[]) {
  const centres = FACES.map((_, face) => stickers[face * 9 + 4]);
  const parsed = parseFacelets(stickers);
  if (!parsed.ok) {
    const errors = parsed.errors.map(error => {
      if (error.code === 'colour-count') return { ...error, colour: centres[FACES.indexOf(error.face)] };
      if (error.code === 'duplicate-corner') return {
        ...error, facelets: error.positions.flatMap(position => CORNER_FACELETS[CORNERS.indexOf(position)]),
      };
      if (error.code === 'duplicate-edge') return {
        ...error, facelets: error.positions.flatMap(position => EDGE_FACELETS[EDGES.indexOf(position)]),
      };
      return error;
    });
    return { stickers, errors, repairs: corrections(stickers.join(''), 3, errors.map(error => error.code)) };
  }
  const solved = centres.map(colour => colour.repeat(9)).join('');
  let input = stickers.join('');
  const turns = input === solved ? [] : (solveThree ??= createTwoPhaseSolver(buildTwoPhaseTables()))(
    parsed.value, { timeLimitMs: 500 },
  ).moves?.map(({ face, turns }) => ({ face, from: 1, to: 1, turns }));
  if (!turns) throw new Error('No 3×3 solution was returned');
  const states = [stickers];
  for (const turn of turns) {
    input = applyLayerTurns(input, 3, [turn]);
    states.push([...input]);
  }
  if (input !== solved) throw new Error('3×3 solution did not match the centre colours');
  const moves = turns.map(turn => ({ ...turn, notation: formatMove(toMove(turn, 3)) }));
  return { stickers, states, moves };
}

self.onmessage = ({ data }) => {
  const { id, scheme, example } = data;
  const decode = (letter: string) => scheme[FACES.indexOf(letter as typeof FACES[number])];
  try {
    if (data.size === 3) {
      let stickers = data.stickers;
      if (example) {
        const outerTurns = exampleTurns.map(turn => ({ ...turn, from: 1, to: 1 }));
        stickers = [...applyLayerTurns(SOLVED_FACELETS, 3, outerTurns)].map(decode);
        if (example === 'twisted') {
          const [a, b, c] = CORNER_FACELETS[0];
          [stickers[a], stickers[b], stickers[c]] = [stickers[b], stickers[c], stickers[a]];
        }
      }
      self.postMessage({ id, ...checkThree(stickers) });
      return;
    }
    let input = data.stickers.map((colour: string) => FACES[scheme.indexOf(colour)]).join('');
    if (example) {
      const scrambled = [...applyLayerTurns(cube4ToFacelets(SOLVED_4), 4, exampleTurns)];
      if (example === 'twisted') {
        const [a, b, c] = CORNER_FACELETS_4[0];
        [scrambled[a], scrambled[b], scrambled[c]] = [scrambled[b], scrambled[c], scrambled[a]];
      }
      input = scrambled.join('');
    }
    const stickers = [...input].map(decode);
    const parsed = parseFacelets4(input);
    if (!parsed.ok) {
      const repairs = corrections(input, 4, parsed.errors.map(error => error.code))
        .map(repair => ({ ...repair, next: repair.next.map(decode) }));
      self.postMessage({ id, stickers, errors: parsed.errors, repairs });
      return;
    }
    const solid = FACES.every((_, i) => new Set(input.slice(i * 16, i * 16 + 16)).size === 1);
    const turns = solid ? [] : (solve ??= createReductionSolver(
      buildReductionTables(), buildEdgePairing(), createTwoPhaseSolver(buildTwoPhaseTables()),
    ))(parsed.value).moves;
    if (!turns) throw new Error('No solution was returned');
    const states = [stickers];
    for (const turn of turns) {
      input = applyLayerTurns(input, 4, [turn]);
      states.push([...input].map(decode));
    }
    if (FACES.some((_, i) => new Set(input.slice(i * 16, i * 16 + 16)).size !== 1)) {
      throw new Error('Solution did not finish on six solid faces');
    }
    const moves = turns.map(turn => ({ ...turn, notation: formatMove(toMove(turn, 4)) }));
    self.postMessage({ id, stickers, states, moves });
  } catch (error) {
    self.postMessage({ id, failed: true });
    console.error(error);
  }
};

