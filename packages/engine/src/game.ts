import { collapse, colorAt, fillGrid, hasMoves, shuffleGrid, type Cell, type Grid } from './board.js';
import type { Color, EngineConfig, Goal } from './config.js';
import { seedRng, type RngState } from './rng.js';

/** Ход в журнале — цепочка клеток в том порядке, в каком её провели. */
export type Move = readonly Cell[];

export interface GameState {
  seed: number;
  grid: Grid;
  rng: RngState;
  /** Сделано ходов. */
  moves: number;
  /** Очки до множителя цели. */
  score: number;
  /** Сколько точек каждого цвета убрано. */
  cleared: number[];
  /** Длины всех цепочек по порядку — из них считаются цели «на цепочки». */
  chains: number[];
  /** Сколько раз плата перемешивалась из-за тупика. */
  shuffles: number;
  goal: Goal;
}

export type MoveError =
  | 'game-over'
  | 'too-short'
  | 'out-of-bounds'
  | 'repeat'
  | 'not-adjacent'
  | 'color-mismatch';

export interface MoveResult {
  state: GameState;
  /** Цвет снятой цепочки. */
  color: Color;
  points: number;
  /** Перемешалась ли плата после хода. */
  shuffled: boolean;
}

export function createGame(seed: number, goal: Goal, cfg: EngineConfig): GameState {
  let { grid, rng } = fillGrid(seedRng(seed), cfg);
  let shuffles = 0;
  if (!hasMoves(grid, cfg)) {
    const mixed = shuffleGrid(grid, rng, cfg);
    grid = mixed.grid;
    rng = mixed.rng;
    shuffles = mixed.shuffles;
  }
  return {
    seed,
    grid,
    rng,
    moves: 0,
    score: 0,
    cleared: Array<number>(cfg.colors).fill(0),
    chains: [],
    shuffles,
    goal,
  };
}

export function isOver(state: GameState, cfg: EngineConfig): boolean {
  return state.moves >= cfg.moveLimit;
}

/**
 * Проверка хода против платы. Возвращает причину отказа или null. Это
 * единственная проверка в игре: клиент зовёт её, чтобы не дать провести
 * негодную цепочку, сервер — чтобы отклонить подделанный журнал. Двух
 * разных правил «что такое ход» быть не должно.
 */
export function validateMove(state: GameState, move: Move, cfg: EngineConfig): MoveError | null {
  if (isOver(state, cfg)) return 'game-over';
  if (!Array.isArray(move) || move.length < cfg.minChain) return 'too-short';

  const seen = new Set<number>();
  let color: Color | undefined;
  for (let i = 0; i < move.length; i++) {
    const cell = move[i]!;
    const [r, c] = cell;
    if (!Number.isInteger(r) || !Number.isInteger(c)) return 'out-of-bounds';
    if (r < 0 || r >= cfg.rows || c < 0 || c >= cfg.cols) return 'out-of-bounds';

    const key = r * cfg.cols + c;
    if (seen.has(key)) return 'repeat';
    seen.add(key);

    if (i > 0) {
      const [pr, pc] = move[i - 1]!;
      if (Math.abs(pr - r) + Math.abs(pc - c) !== 1) return 'not-adjacent';
    }

    const here = colorAt(state.grid, cell);
    if (color === undefined) color = here;
    else if (here !== color) return 'color-mismatch';
  }
  return null;
}

/** Очки за одну цепочку по формуле из конфига. */
export function chainPoints(length: number, cfg: EngineConfig): number {
  return cfg.score.chainPoints(length, cfg.score.base);
}

/**
 * Применяет ход. Состояние не мутируется — возвращается новое, поэтому
 * клиент может держать прошлое для анимации, а реплей не боится, что
 * кто-то подправил плату на полпути.
 */
export function applyMove(
  state: GameState,
  move: Move,
  cfg: EngineConfig,
): { ok: true; result: MoveResult } | { ok: false; error: MoveError } {
  const error = validateMove(state, move, cfg);
  if (error) return { ok: false, error };

  const color = colorAt(state.grid, move[0]!)!;
  const points = chainPoints(move.length, cfg);
  let { grid, rng } = collapse(state.grid, move, state.rng, cfg);

  let shuffled = false;
  let shuffles = state.shuffles;
  if (!hasMoves(grid, cfg)) {
    const mixed = shuffleGrid(grid, rng, cfg);
    grid = mixed.grid;
    rng = mixed.rng;
    shuffles += mixed.shuffles;
    shuffled = true;
  }

  const cleared = state.cleared.slice();
  cleared[color] = (cleared[color] ?? 0) + move.length;

  return {
    ok: true,
    result: {
      state: {
        ...state,
        grid,
        rng,
        moves: state.moves + 1,
        score: state.score + points,
        cleared,
        chains: [...state.chains, move.length],
        shuffles,
      },
      color,
      points,
      shuffled,
    },
  };
}
