import {
  applyLayerTurns, CORNER_FACELETS_4, FACES, formatMove, parseFacelets4,
  SOLVED_4, cube4ToFacelets, toMove,
} from '@cube/core';
import { buildTwoPhaseTables } from '../upstream/packages/solver-ts/src/tables.ts';
import { createTwoPhaseSolver } from '../upstream/packages/solver-ts/src/two-phase.ts';
import { buildReductionTables } from '../upstream/packages/solver-ts/src/four/tables.ts';
import { buildEdgePairing } from '../upstream/packages/solver-ts/src/four/edge-pairing.ts';
import { createReductionSolver } from '../upstream/packages/solver-ts/src/four/reduction.ts';

let solve: ReturnType<typeof createReductionSolver> | undefined;
const exampleTurns = [
  { face: 'R', from: 1, to: 2, turns: 1 },
  { face: 'U', from: 1, to: 1, turns: 1 },
  { face: 'F', from: 2, to: 2, turns: 3 },
  { face: 'L', from: 1, to: 2, turns: 2 },
  { face: 'D', from: 1, to: 1, turns: 3 },
  { face: 'B', from: 1, to: 2, turns: 1 },
] as const;

function corrections(input: string) {
  const candidates: { label: string; next: string[]; changes: number[] }[] = [];
  const add = (label: string, next: string[]) => {
    if (!parseFacelets4(next.join('')).ok) return;
    const changes = next.flatMap((colour, index) => colour === input[index] ? [] : [index]);
    if (changes.length) candidates.push({ label, next, changes });
  };
  for (const [face, letter] of FACES.entries()) {
    const offset = face * 16;
    for (let turns = 1; turns <= 3; turns++) {
      const next = [...input];
      for (let i = 0; i < 16; i++) {
        let position = i;
        for (let turn = 0; turn < turns; turn++) {
          position = (position % 4) * 4 + 3 - Math.floor(position / 4);
        }
        next[offset + position] = input[offset + i];
      }
      add(letter + ' face · rotate entry ' + turns * 90 + '° clockwise', next);
    }
  }
  for (const [corner, indices] of CORNER_FACELETS_4.entries()) {
    for (const shift of [1, 2]) {
      const next = [...input];
      indices.forEach((index, i) => { next[index] = input[indices[(i + shift) % 3]]; });
      add('Reorient the ' + ['top right front', 'top front left', 'top left back', 'top back right',
        'bottom front right', 'bottom left front', 'bottom back left', 'bottom right back'][corner] + ' corner', next);
    }
  }
  return candidates;
}

self.onmessage = ({ data }) => {
  const { id, scheme, example } = data;
  const decode = (letter: string) => scheme[FACES.indexOf(letter as typeof FACES[number])];
  try {
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
      const repairs = corrections(input).map(repair => ({ ...repair, next: repair.next.map(decode) }));
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

