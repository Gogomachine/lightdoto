import type { Color, EngineConfig } from './config.js';
import { nextInt, type RngState } from './rng.js';

/** Плата: строки сверху вниз, в строке — столбцы слева направо. */
export type Grid = Color[][];

/** Клетка как её пишет журнал: [строка, столбец]. */
export type Cell = readonly [row: number, col: number];

function roll(rng: RngState, cfg: EngineConfig): { color: Color; rng: RngState } {
  const r = nextInt(rng, cfg.colors);
  return { color: r.value, rng: r.state };
}

/** Новая плата из потока. Заполнение — по строкам сверху вниз. */
export function fillGrid(rng: RngState, cfg: EngineConfig): { grid: Grid; rng: RngState } {
  const grid: Grid = [];
  for (let r = 0; r < cfg.rows; r++) {
    const row: Color[] = [];
    for (let c = 0; c < cfg.cols; c++) {
      const next = roll(rng, cfg);
      row.push(next.color);
      rng = next.rng;
    }
    grid.push(row);
  }
  return { grid, rng };
}

export function colorAt(grid: Grid, [r, c]: Cell): Color | undefined {
  return grid[r]?.[c];
}

/**
 * Есть ли на плате хоть один ход: путь из `minChain` одноцветных соседей.
 * Плата маленькая, поэтому честный поиск в глубину с отсечением на нужной
 * длине стоит копейки — а оценка «по размеру группы» врала бы на фигурах
 * вроде креста, где группа большая, а пути в ней короткие.
 */
export function hasMoves(grid: Grid, cfg: EngineConfig): boolean {
  const used = new Set<number>();
  const walk = (r: number, c: number, color: Color, length: number): boolean => {
    if (length >= cfg.minChain) return true;
    for (const [nr, nc] of neighbours([r, c])) {
      const key = nr * cfg.cols + nc;
      if (grid[nr]?.[nc] !== color || used.has(key)) continue;
      used.add(key);
      const found = walk(nr, nc, color, length + 1);
      used.delete(key);
      if (found) return true;
    }
    return false;
  };
  for (let r = 0; r < cfg.rows; r++) {
    for (let c = 0; c < cfg.cols; c++) {
      used.add(r * cfg.cols + c);
      const found = walk(r, c, grid[r]![c]!, 1);
      used.delete(r * cfg.cols + c);
      if (found) return true;
    }
  }
  return false;
}

function neighbours([r, c]: Cell): Cell[] {
  return [
    [r - 1, c],
    [r + 1, c],
    [r, c - 1],
    [r, c + 1],
  ];
}

/**
 * Перемешивание платы без ходов. Fisher–Yates по клеткам, прочитанным
 * построчно, из того же потока, что и досыпка: никакого второго генератора,
 * иначе реплей на сервере разошёлся бы с клиентом на первом же тупике.
 *
 * Перемешанная плата тоже может оказаться тупиком — тогда мешаем снова, до
 * `maxShuffles` раз. Если и это не помогло (такого не бывает, но предел
 * обязан что-то делать), вторая клетка первой строки перекрашивается в цвет
 * первой — ход гарантирован, и правка такая же детерминированная, как всё
 * остальное.
 */
export function shuffleGrid(
  grid: Grid,
  rng: RngState,
  cfg: EngineConfig,
): { grid: Grid; rng: RngState; shuffles: number } {
  const flat = grid.flat();
  let shuffles = 0;
  let next: Grid = grid;
  do {
    for (let i = flat.length - 1; i > 0; i--) {
      const j = nextInt(rng, i + 1);
      rng = j.state;
      const tmp = flat[i]!;
      flat[i] = flat[j.value]!;
      flat[j.value] = tmp;
    }
    next = toGrid(flat, cfg);
    shuffles++;
  } while (!hasMoves(next, cfg) && shuffles < cfg.maxShuffles);

  if (!hasMoves(next, cfg)) {
    next[0]![1] = next[0]![0]!;
  }
  return { grid: next, rng, shuffles };
}

function toGrid(flat: Color[], cfg: EngineConfig): Grid {
  const grid: Grid = [];
  for (let r = 0; r < cfg.rows; r++) {
    grid.push(flat.slice(r * cfg.cols, (r + 1) * cfg.cols));
  }
  return grid;
}

/**
 * Убирает клетки, роняет уцелевшие точки вниз и досыпает новые сверху.
 *
 * Порядок обращений к потоку зафиксирован и менять его нельзя — сломаются
 * все сохранённые реплеи: столбцы слева направо, в столбце новые точки
 * сверху вниз.
 */
export function collapse(
  grid: Grid,
  removed: readonly Cell[],
  rng: RngState,
  cfg: EngineConfig,
): { grid: Grid; rng: RngState } {
  const gone = new Set(removed.map(([r, c]) => r * cfg.cols + c));
  const next: Grid = Array.from({ length: cfg.rows }, () => Array<Color>(cfg.cols));

  for (let c = 0; c < cfg.cols; c++) {
    const survivors: Color[] = [];
    for (let r = 0; r < cfg.rows; r++) {
      if (!gone.has(r * cfg.cols + c)) survivors.push(grid[r]![c]!);
    }
    const fresh = cfg.rows - survivors.length;
    for (let r = 0; r < fresh; r++) {
      const dot = roll(rng, cfg);
      next[r]![c] = dot.color;
      rng = dot.rng;
    }
    for (let i = 0; i < survivors.length; i++) {
      next[fresh + i]![c] = survivors[i]!;
    }
  }
  return { grid: next, rng };
}
