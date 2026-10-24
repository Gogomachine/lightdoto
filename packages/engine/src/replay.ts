import type { EngineConfig } from './config.js';
import { applyMove, createGame, type GameState, type Move, type MoveError } from './game.js';
import { finalScore, goalProgress, pickGoal } from './goals.js';

export type ReplayResult =
  | {
      ok: true;
      state: GameState;
      score: number;
      final: number;
      goalDone: boolean;
    }
  | { ok: false; error: MoveError | 'too-many-moves' | 'bad-log'; at: number };

/**
 * Переигрывает журнал с нуля на сиде. Так сервер считает очки сам: от
 * клиента он принимает только ходы, а счёт клиента не читает вовсе.
 *
 * Первый же негодный ход отклоняет всю попытку, а не пропускается: честный
 * клиент негодных ходов не пишет, значит журнал подделан или испорчен, и
 * засчитывать его хвост было бы гаданием.
 */
export function replay(seed: number, log: unknown, cfg: EngineConfig): ReplayResult {
  if (!Array.isArray(log)) return { ok: false, error: 'bad-log', at: -1 };
  if (log.length > cfg.moveLimit) return { ok: false, error: 'too-many-moves', at: cfg.moveLimit };

  let state = createGame(seed, pickGoal(seed, cfg), cfg);
  for (let i = 0; i < log.length; i++) {
    const move = log[i] as unknown;
    if (!isMoveShape(move)) return { ok: false, error: 'bad-log', at: i };
    const step = applyMove(state, move, cfg);
    if (!step.ok) return { ok: false, error: step.error, at: i };
    state = step.result.state;
  }
  return {
    ok: true,
    state,
    score: state.score,
    final: finalScore(state, cfg),
    goalDone: goalProgress(state).done,
  };
}

/** Журнал приходит из сети — форму проверяем до того, как верить типам. */
function isMoveShape(move: unknown): move is Move {
  return (
    Array.isArray(move) &&
    move.every(
      (cell) =>
        Array.isArray(cell) &&
        cell.length === 2 &&
        typeof cell[0] === 'number' &&
        typeof cell[1] === 'number',
    )
  );
}
