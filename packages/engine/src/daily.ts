import type { EngineConfig, Goal } from './config.js';
import { pickGoal } from './goals.js';
import { hashString } from './rng.js';

const DAY_MS = 86_400_000;

/** День как строка YYYY-MM-DD по UTC: смена дня у всех игроков в один миг. */
export function dayKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** Сид «Вызова дня» — хеш даты. Префикс отделяет его от прочих хешей. */
export function dailySeed(day: string): number {
  return hashString(`daily:${day}`);
}

/** Номер дня: эпоха из конфига — день №1. */
export function dayNumber(day: string, cfg: EngineConfig): number {
  const diff = Date.parse(`${day}T00:00:00Z`) - Date.parse(`${cfg.epoch}T00:00:00Z`);
  return Math.floor(diff / DAY_MS) + 1;
}

/** Соседний день: для стрика нужно знать, был ли вчера. */
export function shiftDay(day: string, delta: number): string {
  return dayKey(new Date(Date.parse(`${day}T00:00:00Z`) + delta * DAY_MS));
}

export interface Daily {
  day: string;
  number: number;
  seed: number;
  goal: Goal;
}

export function daily(date: Date, cfg: EngineConfig): Daily {
  const day = dayKey(date);
  const seed = dailySeed(day);
  return { day, number: dayNumber(day, cfg), seed, goal: pickGoal(seed, cfg) };
}

/** Случайный сид для свободной игры. Не детерминирован — и не должен быть. */
export function randomSeed(): number {
  return Math.floor(Math.random() * 4294967296) >>> 0;
}
