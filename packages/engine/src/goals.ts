import { COLOR_NAMES, type EngineConfig, type Goal } from './config.js';
import type { GameState } from './game.js';
import { hashString, nextInt, seedRng } from './rng.js';

/**
 * Цель по сиду. Выбор идёт из своего, отдельного розыгрыша — от хеша сида,
 * а не из потока платы. Иначе цель съела бы одно число из потока, и стоило
 * бы поменять список целей, как поменялась бы и сама плата: правка конфига
 * ломала бы все старые реплеи.
 */
export function pickGoal(seed: number, cfg: EngineConfig): Goal {
  const roll = nextInt(seedRng(hashString(`goal:${seed >>> 0}`)), cfg.goals.length);
  return cfg.goals[roll.value]!;
}

export interface GoalProgress {
  current: number;
  target: number;
  done: boolean;
}

export function goalProgress(state: GameState): GoalProgress {
  const goal = state.goal;
  let current: number;
  let target: number;
  switch (goal.kind) {
    case 'clear':
      current = state.cleared[goal.color] ?? 0;
      target = goal.count;
      break;
    case 'chains':
      current = state.chains.filter((n) => n >= goal.length).length;
      target = goal.count;
      break;
    case 'score':
      current = state.score;
      target = goal.target;
      break;
  }
  return { current: Math.min(current, target), target, done: current >= target };
}

/** Итог попытки: очки, умноженные на множитель цели, если она выполнена. */
export function finalScore(state: GameState, cfg: EngineConfig): number {
  const mult = goalProgress(state).done ? cfg.goalMultiplier : 1;
  return Math.floor(state.score * mult);
}

/** Цель словами — одна формулировка для платы, итога и сервера. */
export function describeGoal(goal: Goal): string {
  switch (goal.kind) {
    case 'clear':
      return `Убери ${goal.count} ${COLOR_NAMES[goal.color] ?? '?'}`;
    case 'chains':
      return goal.count === 1
        ? `Собери цепь от ${goal.length} точек`
        : `Собери ${goal.count} цепи от ${goal.length} точек`;
    case 'score':
      return `Набери ${goal.target} очков`;
  }
}
