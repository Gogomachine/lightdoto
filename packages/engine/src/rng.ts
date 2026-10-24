/**
 * Детерминированный PRNG (mulberry32) с явным состоянием.
 *
 * Состояние — одно 32-битное число, и оно лежит в состоянии партии, а не в
 * замыкании: так партию можно сохранить, передать и переиграть, а сервер
 * получает ровно тот же поток, что и клиент. Одинаковый сид даёт одинаковую
 * последовательность на любой платформе — на этом стоит весь античит.
 */

export type RngState = number;

export function seedRng(seed: number): RngState {
  return seed >>> 0;
}

function step(state: RngState): { value: number; state: RngState } {
  const next = (state + 0x6d2b79f5) >>> 0;
  let t = next;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  const value = ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  return { value, state: next };
}

/** Целое из [0, bound). */
export function nextInt(state: RngState, bound: number): { value: number; state: RngState } {
  const r = step(state);
  return { value: Math.floor(r.value * bound), state: r.state };
}

/**
 * Хеш строки в 32-битный сид (FNV-1a). Нужен для сида дня: дата — строка,
 * а поток ждёт число, и одна и та же дата обязана давать одно число везде.
 */
export function hashString(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}
