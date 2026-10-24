/**
 * Все числа игры в одном месте.
 *
 * Конфиг общий для клиента и сервера, и это не удобство, а условие честности:
 * если сервер посчитает очки по другой формуле или с другим лимитом ходов,
 * чем клиент, честная попытка будет выглядеть подделкой. Поэтому оба берут
 * `DEFAULT_CONFIG` из движка и ничего не переопределяют у себя.
 *
 * Менять числа после запуска можно только вместе с версией правил:
 * сохранённые результаты прошлых дней считались по старым.
 */

/** Цвет точки — индекс в палитре, от 0 до `colors - 1`. */
export type Color = number;

/** Цель дня: что сделать за попытку, чтобы итог умножился. */
export type Goal =
  /** Убрать с платы `count` точек цвета `color`. */
  | { kind: 'clear'; color: Color; count: number }
  /** Собрать `count` цепочек длиной от `length` точек. */
  | { kind: 'chains'; length: number; count: number }
  /** Набрать `target` очков до множителя. */
  | { kind: 'score'; target: number };

export interface ScoreConfig {
  /** Цена одного «звена» цепочки. */
  base: number;
  /**
   * Очки за цепочку из `n` точек. Нелинейная: цепочка из шести стоит
   * 150, а три цепочки по две — 30. Иначе выгоднее всего было бы снимать
   * пары не глядя, и пазл превратился бы в кликер.
   */
  chainPoints: (n: number, base: number) => number;
}

export interface EngineConfig {
  rows: number;
  cols: number;
  /** Сколько цветов на плате. */
  colors: number;
  /** Минимальная длина цепочки. */
  minChain: number;
  /** Лимит ходов на попытку. */
  moveLimit: number;
  score: ScoreConfig;
  /** Множитель итога за выполненную цель дня. */
  goalMultiplier: number;
  /**
   * Из этого списка сид выбирает цель дня. Пороги прикинуты ботом, который
   * всегда тянет самую длинную цепочку и о цели не думает: у него медиана
   * около 950 очков за 25 ходов. Цель должна даваться тому, кто под неё
   * играет, а не сама собой.
   */
  goals: readonly Goal[];
  /**
   * Сколько раз подряд перемешивать плату без ходов, прежде чем подправить
   * её вручную. На 6×6 с пятью цветами до второго перемешивания доходит
   * исчезающе редко, но цикл без предела — это зависший сервер.
   */
  maxShuffles: number;
  /** День №1 «Вызова дня», UTC. */
  epoch: string;
}

export const COLOR_NAMES = ['красных', 'жёлтых', 'зелёных', 'синих', 'фиолетовых'] as const;

export const DEFAULT_CONFIG: EngineConfig = {
  rows: 6,
  cols: 6,
  colors: 5,
  minChain: 2,
  moveLimit: 25,
  score: {
    base: 10,
    chainPoints: (n, base) => (base * n * (n - 1)) / 2,
  },
  goalMultiplier: 1.5,
  goals: [
    { kind: 'clear', color: 0, count: 20 },
    { kind: 'clear', color: 1, count: 20 },
    { kind: 'clear', color: 2, count: 20 },
    { kind: 'clear', color: 3, count: 20 },
    { kind: 'clear', color: 4, count: 20 },
    { kind: 'chains', length: 5, count: 3 },
    { kind: 'chains', length: 6, count: 1 },
    { kind: 'chains', length: 7, count: 1 },
    { kind: 'score', target: 900 },
    { kind: 'score', target: 1200 },
  ],
  maxShuffles: 20,
  epoch: '2026-10-24',
};
