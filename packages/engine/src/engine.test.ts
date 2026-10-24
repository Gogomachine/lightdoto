import { describe, expect, it } from 'vitest';
import {
  applyMove,
  chainPoints,
  collapse,
  createGame,
  daily,
  dailySeed,
  dayNumber,
  DEFAULT_CONFIG as cfg,
  describeGoal,
  finalScore,
  goalProgress,
  hasMoves,
  nextInt,
  pickGoal,
  replay,
  seedRng,
  shiftDay,
  shuffleGrid,
  validateMove,
  type Cell,
  type GameState,
  type Grid,
  type Move,
} from './index.js';

/** Первый попавшийся ход: пара одноцветных соседей, поиск вправо и вниз. */
function findPair(grid: Grid): Move {
  for (let r = 0; r < cfg.rows; r++) {
    for (let c = 0; c < cfg.cols; c++) {
      if (grid[r]![c + 1] === grid[r]![c]) return [[r, c], [r, c + 1]];
      if (grid[r + 1]?.[c] === grid[r]![c]) return [[r, c], [r + 1, c]];
    }
  }
  throw new Error('на плате нет хода');
}

/** Играет `count` ходов «первой парой» и возвращает журнал и состояние. */
function play(seed: number, count: number): { log: Move[]; state: GameState } {
  let state = createGame(seed, pickGoal(seed, cfg), cfg);
  const log: Move[] = [];
  for (let i = 0; i < count; i++) {
    const move = findPair(state.grid);
    const step = applyMove(state, move, cfg);
    if (!step.ok) throw new Error(step.error);
    log.push(move);
    state = step.result.state;
  }
  return { log, state };
}

/** Состояние с заданной платой — для проверок гравитации и валидации. */
function withGrid(grid: Grid, rng = 1): GameState {
  return { ...createGame(1, cfg.goals[0]!, cfg), grid, rng };
}

const G: Grid = [
  [0, 0, 1, 2, 3, 4],
  [1, 0, 2, 3, 4, 0],
  [2, 0, 3, 4, 0, 1],
  [3, 1, 4, 0, 1, 2],
  [4, 2, 0, 1, 2, 3],
  [0, 3, 1, 2, 3, 4],
];

describe('PRNG', () => {
  it('один сид — одна последовательность', () => {
    const run = (seed: number) => {
      let s = seedRng(seed);
      const out: number[] = [];
      for (let i = 0; i < 50; i++) {
        const r = nextInt(s, 1000);
        out.push(r.value);
        s = r.state;
      }
      return out;
    };
    expect(run(42)).toEqual(run(42));
    expect(run(42)).not.toEqual(run(43));
  });

  it('значения в диапазоне', () => {
    let s = seedRng(7);
    for (let i = 0; i < 1000; i++) {
      const r = nextInt(s, 5);
      expect(r.value).toBeGreaterThanOrEqual(0);
      expect(r.value).toBeLessThan(5);
      s = r.state;
    }
  });
});

describe('детерминизм', () => {
  it('один сид — одна стартовая плата', () => {
    const a = createGame(123, cfg.goals[0]!, cfg);
    const b = createGame(123, cfg.goals[0]!, cfg);
    expect(a.grid).toEqual(b.grid);
    expect(createGame(124, cfg.goals[0]!, cfg).grid).not.toEqual(a.grid);
  });

  it('одни ходы на одном сиде — одна плата и один счёт', () => {
    const a = play(2026, 25);
    const b = play(2026, 25);
    expect(a.state.grid).toEqual(b.state.grid);
    expect(a.state.score).toBe(b.state.score);
    expect(a.state.rng).toBe(b.state.rng);
  });

  it('стартовая плата всегда в цветах конфига и с ходом', () => {
    for (let seed = 0; seed < 200; seed++) {
      const { grid } = createGame(seed, cfg.goals[0]!, cfg);
      expect(grid).toHaveLength(cfg.rows);
      for (const row of grid) {
        expect(row).toHaveLength(cfg.cols);
        for (const color of row) expect(color).toBeLessThan(cfg.colors);
      }
      expect(hasMoves(grid, cfg)).toBe(true);
    }
  });
});

describe('гравитация и досыпка', () => {
  it('точки над снятыми падают вниз, сверху досыпаются новые', () => {
    // Снимаем столбец 1, строки 0–2: три нуля.
    const removed: Cell[] = [[0, 1], [1, 1], [2, 1]];
    const { grid } = collapse(G, removed, seedRng(5), cfg);

    // Уцелевшие точки столбца 1 (1, 2, 3) лежат внизу в прежнем порядке.
    expect([grid[3]![1], grid[4]![1], grid[5]![1]]).toEqual([1, 2, 3]);
    // Остальные столбцы не тронуты.
    for (let r = 0; r < cfg.rows; r++) {
      for (const c of [0, 2, 3, 4, 5]) expect(grid[r]![c]).toBe(G[r]![c]);
    }
    // Новые точки сверху — из потока, по порядку сверху вниз.
    let s = seedRng(5);
    const fresh: number[] = [];
    for (let i = 0; i < 3; i++) {
      const r = nextInt(s, cfg.colors);
      fresh.push(r.value);
      s = r.state;
    }
    expect([grid[0]![1], grid[1]![1], grid[2]![1]]).toEqual(fresh);
  });

  it('досыпка идёт по столбцам слева направо', () => {
    // Снимаем по одной точке в столбцах 3 и 0 — поток расходуется на 0, потом на 3.
    const { grid } = collapse(G, [[4, 3], [2, 0]], seedRng(9), cfg);
    const first = nextInt(seedRng(9), cfg.colors);
    const second = nextInt(first.state, cfg.colors);
    expect(grid[0]![0]).toBe(first.value);
    expect(grid[0]![3]).toBe(second.value);
    // Под упавшими: столбец 0 — [0,1] сдвинулись на строку вниз, ниже — как было.
    expect([grid[1]![0], grid[2]![0], grid[3]![0]]).toEqual([0, 1, 3]);
  });

  it('плата без ходов перемешивается детерминированно и получает ход', () => {
    // Шахматка из пяти цветов по диагоналям: ни одной пары соседей.
    const dead: Grid = Array.from({ length: 6 }, (_, r) =>
      Array.from({ length: 6 }, (_, c) => (r * 2 + c) % 5),
    );
    expect(hasMoves(dead, cfg)).toBe(false);
    const a = shuffleGrid(dead, seedRng(11), cfg);
    const b = shuffleGrid(dead, seedRng(11), cfg);
    expect(a.grid).toEqual(b.grid);
    expect(hasMoves(a.grid, cfg)).toBe(true);
    // Перемешивание не меняет набор цветов.
    expect(a.grid.flat().sort()).toEqual(dead.flat().sort());
  });

  it('ход, после которого плата в тупике, перемешивает её', () => {
    // Плата, где единственная пара — в углу, а досыпка на сиде даст тупик,
    // подбирается перебором сидов потока.
    const dead: Grid = Array.from({ length: 6 }, (_, r) =>
      Array.from({ length: 6 }, (_, c) => (r * 2 + c) % 5),
    );
    dead[0]![1] = dead[0]![0]!;
    let found = false;
    for (let rng = 0; rng < 5000 && !found; rng++) {
      const step = applyMove(withGrid(dead, rng), [[0, 0], [0, 1]], cfg);
      if (!step.ok) throw new Error(step.error);
      if (step.result.shuffled) {
        found = true;
        expect(hasMoves(step.result.state.grid, cfg)).toBe(true);
        expect(step.result.state.shuffles).toBeGreaterThan(0);
      }
    }
    expect(found).toBe(true);
  });
});

describe('валидация хода', () => {
  const s = withGrid(G);

  it('годная цепочка', () => {
    expect(validateMove(s, [[0, 0], [0, 1], [1, 1], [2, 1]], cfg)).toBeNull();
  });
  it('слишком короткая', () => {
    expect(validateMove(s, [[0, 0]], cfg)).toBe('too-short');
    expect(validateMove(s, [], cfg)).toBe('too-short');
  });
  it('несоседние клетки', () => {
    expect(validateMove(s, [[0, 0], [2, 1]], cfg)).toBe('not-adjacent');
  });
  it('по диагонали нельзя', () => {
    expect(validateMove(s, [[0, 0], [1, 1]], cfg)).toBe('not-adjacent');
  });
  it('разные цвета', () => {
    expect(validateMove(s, [[0, 0], [1, 0]], cfg)).toBe('color-mismatch');
  });
  it('повтор клетки', () => {
    expect(validateMove(s, [[0, 0], [0, 1], [0, 0]], cfg)).toBe('repeat');
  });
  it('за краем платы и дробные координаты', () => {
    expect(validateMove(s, [[0, 0], [-1, 0]], cfg)).toBe('out-of-bounds');
    expect(validateMove(s, [[5, 5], [5, 6]], cfg)).toBe('out-of-bounds');
    expect(validateMove(s, [[0, 0], [0, 0.5]], cfg)).toBe('out-of-bounds');
  });
  it('после лимита ходов — конец игры', () => {
    expect(validateMove({ ...s, moves: cfg.moveLimit }, [[0, 0], [0, 1]], cfg)).toBe('game-over');
  });
  it('applyMove не мутирует исходное состояние', () => {
    const before = JSON.stringify(s);
    applyMove(s, [[0, 0], [0, 1]], cfg);
    expect(JSON.stringify(s)).toBe(before);
  });
});

describe('очки', () => {
  it('формула 10·n(n−1)/2', () => {
    expect(chainPoints(2, cfg)).toBe(10);
    expect(chainPoints(3, cfg)).toBe(30);
    expect(chainPoints(6, cfg)).toBe(150);
  });
  it('длинная цепь дороже двух коротких той же суммарной длины', () => {
    expect(chainPoints(6, cfg)).toBeGreaterThan(2 * chainPoints(3, cfg));
    expect(chainPoints(4, cfg)).toBeGreaterThan(2 * chainPoints(2, cfg));
  });
  it('ход приносит очки и учитывает цвет', () => {
    const step = applyMove(withGrid(G), [[0, 0], [0, 1], [1, 1], [2, 1]], cfg);
    if (!step.ok) throw new Error(step.error);
    expect(step.result.points).toBe(60);
    expect(step.result.state.score).toBe(60);
    expect(step.result.state.cleared[0]).toBe(4);
    expect(step.result.state.chains).toEqual([4]);
  });
});

describe('цели дня', () => {
  it('цель выбирается по сиду детерминированно и из списка', () => {
    for (let seed = 0; seed < 100; seed++) {
      expect(pickGoal(seed, cfg)).toEqual(pickGoal(seed, cfg));
      expect(cfg.goals).toContain(pickGoal(seed, cfg));
    }
  });
  it('выбор покрывает весь список', () => {
    const seen = new Set<string>();
    for (let seed = 0; seed < 2000; seed++) seen.add(JSON.stringify(pickGoal(seed, cfg)));
    expect(seen.size).toBe(cfg.goals.length);
  });
  it('выполненная цель умножает итог на 1.5', () => {
    const base = withGrid(G);
    const s: GameState = { ...base, score: 1001, cleared: [20, 0, 0, 0, 0], goal: { kind: 'clear', color: 0, count: 20 } };
    expect(goalProgress(s).done).toBe(true);
    expect(finalScore(s, cfg)).toBe(1501);
    expect(finalScore({ ...s, cleared: [19, 0, 0, 0, 0] }, cfg)).toBe(1001);
  });
  it('цели на цепочки и на очки', () => {
    const s = withGrid(G);
    const chains: GameState = { ...s, chains: [5, 2, 6, 5], goal: { kind: 'chains', length: 5, count: 3 } };
    expect(goalProgress(chains)).toEqual({ current: 3, target: 3, done: true });
    const score: GameState = { ...s, score: 900, goal: { kind: 'score', target: 1500 } };
    expect(goalProgress(score)).toEqual({ current: 900, target: 1500, done: false });
  });
  it('описание цели', () => {
    expect(describeGoal({ kind: 'clear', color: 0, count: 20 })).toBe('Убери 20 красных');
  });
});

describe('день', () => {
  it('сид дня зависит только от даты UTC', () => {
    const morning = daily(new Date('2026-10-25T00:00:01Z'), cfg);
    const night = daily(new Date('2026-10-25T23:59:59Z'), cfg);
    expect(morning).toEqual(night);
    expect(daily(new Date('2026-10-26T00:00:00Z'), cfg).seed).not.toBe(morning.seed);
    expect(morning.seed).toBe(dailySeed('2026-10-25'));
  });
  it('номер дня от эпохи', () => {
    expect(dayNumber(cfg.epoch, cfg)).toBe(1);
    expect(dayNumber(shiftDay(cfg.epoch, 9), cfg)).toBe(10);
    expect(shiftDay('2026-12-31', 1)).toBe('2027-01-01');
  });
});

describe('реплей', () => {
  it('честный журнал даёт тот же счёт, что и игра', () => {
    const seed = dailySeed('2026-10-24');
    const { log, state } = play(seed, 25);
    const r = replay(seed, JSON.parse(JSON.stringify(log)), cfg);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.score).toBe(state.score);
    expect(r.state.grid).toEqual(state.grid);
    expect(r.final).toBe(finalScore(state, cfg));
  });

  it('журнал с другого сида не проходит', () => {
    const { log } = play(1, 25);
    // На чужой плате первые же ходы почти наверняка негодны; ищем сид, где так.
    const r = replay(2, log, cfg);
    expect(r.ok).toBe(false);
  });

  it('больше лимита ходов — отказ', () => {
    const { log } = play(3, 25);
    const r = replay(3, [...log, log[0]!], cfg);
    expect(r).toMatchObject({ ok: false, error: 'too-many-moves' });
  });

  it('подменённый ход — отказ с номером хода', () => {
    const { log } = play(4, 10);
    const forged = log.slice();
    forged[5] = [[0, 0], [2, 2]];
    expect(replay(4, forged, cfg)).toMatchObject({ ok: false, error: 'not-adjacent', at: 5 });
  });

  it('мусор вместо журнала — отказ', () => {
    expect(replay(1, 'nope', cfg)).toMatchObject({ ok: false, error: 'bad-log' });
    expect(replay(1, [[['a', 1], [0, 0]]], cfg)).toMatchObject({ ok: false, error: 'bad-log', at: 0 });
    expect(replay(1, [{ length: 2 }], cfg)).toMatchObject({ ok: false, error: 'bad-log', at: 0 });
  });

  it('неполный журнал засчитывается как есть', () => {
    const { log, state } = play(5, 7);
    const r = replay(5, log, cfg);
    expect(r).toMatchObject({ ok: true, score: state.score });
  });
});
