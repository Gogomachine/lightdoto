import type { Cell, EngineConfig, Grid } from '@dotoscope/engine';

/**
 * Плата: отрисовка на канвасе и ввод цепочки пальцем или мышью.
 *
 * Плата знает только сетку цветов и то, что под пальцем. Правил хода она не
 * проверяет — это делает движок, когда палец поднят; здесь лишь местная
 * подсказка, чтобы цепочка не тянулась туда, куда ход всё равно не пройдёт.
 */

/** Цвета точек в порядке движка: красный, жёлтый, зелёный, синий, фиолетовый. */
export const DOT_COLORS = ['#D9584A', '#E3AE45', '#3F9C79', '#4589C4', '#9670C2'] as const;

const GLASS = '#0c0d0e';
const TRACE = '#1d1e1d';
const PAD = '#262725';

/** Сколько длится падение точек, мс. */
const FALL_MS = 220;
/** Доля клетки, в которую надо попасть, чтобы точка взялась в цепочку. */
const HIT = 0.42;

interface Ghost {
  row: number;
  col: number;
  color: number;
}

export interface PlateHandlers {
  onLink(length: number): void;
  onCommit(chain: Cell[]): void;
}

export class Plate {
  private grid: Grid = [];
  private chain: Cell[] = [];
  private pointer: { x: number; y: number } | null = null;
  /** Смещение каждой точки вверх в клетках к началу падения. */
  private drop: number[][] = [];
  private ghosts: Ghost[] = [];
  private animStart = 0;
  private frame = 0;
  private size = 0;
  enabled = true;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly cfg: EngineConfig,
    private readonly handlers: PlateHandlers,
  ) {
    canvas.addEventListener('pointerdown', this.onDown);
    canvas.addEventListener('pointermove', this.onMove);
    canvas.addEventListener('pointerup', this.onUp);
    canvas.addEventListener('pointercancel', this.onCancel);
    new ResizeObserver(() => this.resize()).observe(canvas);
    this.resize();
  }

  /** Ставит плату без анимации — новая игра или восстановление. */
  show(grid: Grid): void {
    this.grid = grid;
    this.drop = grid.map((row) => row.map(() => 0));
    this.ghosts = [];
    this.chain = [];
    this.request();
  }

  /**
   * Ставит плату после хода: снятые точки гаснут, уцелевшие падают на
   * свои места, новые въезжают сверху. Смещения считаются тем же правилом,
   * что гравитация в движке, — по столбцам.
   */
  advance(prev: Grid, removed: readonly Cell[], next: Grid, shuffled: boolean): void {
    this.grid = next;
    this.chain = [];
    this.ghosts = removed.map(([r, c]) => ({ row: r, col: c, color: prev[r]![c]! }));
    this.drop = next.map((row) => row.map(() => 0));
    if (!shuffled) {
      for (let c = 0; c < this.cfg.cols; c++) {
        const gone = new Set(removed.filter(([, col]) => col === c).map(([r]) => r));
        let fallen = 0;
        // Снизу вверх: каждая уцелевшая точка падает на число снятых под ней.
        let target = this.cfg.rows - 1;
        for (let r = this.cfg.rows - 1; r >= 0; r--) {
          if (gone.has(r)) {
            fallen++;
            continue;
          }
          this.drop[target]![c] = target - r;
          target--;
        }
        for (let r = 0; r < fallen; r++) this.drop[r]![c] = fallen;
      }
    }
    this.animStart = performance.now();
    this.request();
  }

  private resize(): void {
    const rect = this.canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    this.size = rect.width;
    this.canvas.width = Math.round(rect.width * dpr);
    this.canvas.height = Math.round(rect.width * dpr);
    this.canvas.getContext('2d')!.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.request();
  }

  private get cell(): number {
    return this.size / this.cfg.cols;
  }

  private cellAt(x: number, y: number): Cell | null {
    const size = this.cell;
    const c = Math.floor(x / size);
    const r = Math.floor(y / size);
    if (r < 0 || r >= this.cfg.rows || c < 0 || c >= this.cfg.cols) return null;
    // Берём точку только ближе к центру: иначе быстрый росчерк по
    // диагонали задевал бы угол соседней клетки.
    const dx = x - (c + 0.5) * size;
    const dy = y - (r + 0.5) * size;
    return Math.hypot(dx, dy) <= size * HIT ? [r, c] : null;
  }

  private local(e: PointerEvent): { x: number; y: number } {
    const rect = this.canvas.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  private get animating(): boolean {
    return performance.now() - this.animStart < FALL_MS;
  }

  private readonly onDown = (e: PointerEvent): void => {
    if (!this.enabled || this.animating) return;
    const p = this.local(e);
    const cell = this.cellAt(p.x, p.y);
    if (!cell) return;
    this.canvas.setPointerCapture(e.pointerId);
    this.chain = [cell];
    this.pointer = p;
    this.handlers.onLink(1);
    this.request();
  };

  private readonly onMove = (e: PointerEvent): void => {
    if (this.chain.length === 0) return;
    this.pointer = this.local(e);
    const cell = this.cellAt(this.pointer.x, this.pointer.y);
    if (cell) this.extend(cell);
    this.request();
  };

  private extend(cell: Cell): void {
    const last = this.chain[this.chain.length - 1]!;
    if (same(cell, last)) return;
    // Шаг назад по своему следу снимает последнюю точку: так передумывают.
    const prev = this.chain[this.chain.length - 2];
    if (prev && same(cell, prev)) {
      this.chain.pop();
      this.handlers.onLink(this.chain.length);
      return;
    }
    if (this.chain.some((c) => same(c, cell))) return;
    if (Math.abs(cell[0] - last[0]) + Math.abs(cell[1] - last[1]) !== 1) return;
    if (this.grid[cell[0]]![cell[1]] !== this.grid[last[0]]![last[1]]) return;
    this.chain.push(cell);
    this.handlers.onLink(this.chain.length);
  }

  private readonly onUp = (): void => {
    const chain = this.chain;
    this.chain = [];
    this.pointer = null;
    this.request();
    if (chain.length >= this.cfg.minChain) this.handlers.onCommit(chain);
  };

  private readonly onCancel = (): void => {
    this.chain = [];
    this.pointer = null;
    this.request();
  };

  private request(): void {
    if (this.frame) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      this.draw();
      if (this.animating) this.request();
    });
  }

  private draw(): void {
    const ctx = this.canvas.getContext('2d')!;
    const size = this.cell;
    const radius = size * 0.26;
    const t = Math.min(1, (performance.now() - this.animStart) / FALL_MS);
    const ease = 1 - (1 - t) ** 3;

    ctx.fillStyle = GLASS;
    ctx.fillRect(0, 0, this.size, this.size);

    // Дорожки платы: точки сидят на перекрёстках, как пайки.
    ctx.strokeStyle = TRACE;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let i = 0; i < this.cfg.cols; i++) {
      const p = (i + 0.5) * size;
      ctx.moveTo(p, size * 0.5);
      ctx.lineTo(p, this.size - size * 0.5);
      ctx.moveTo(size * 0.5, p);
      ctx.lineTo(this.size - size * 0.5, p);
    }
    ctx.stroke();
    ctx.fillStyle = PAD;
    for (let r = 0; r < this.cfg.rows; r++) {
      for (let c = 0; c < this.cfg.cols; c++) {
        ctx.beginPath();
        ctx.arc((c + 0.5) * size, (r + 0.5) * size, radius * 1.25, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // Снятые точки гаснут на месте.
    if (t < 1) {
      ctx.globalAlpha = 1 - ease;
      for (const g of this.ghosts) {
        ctx.fillStyle = DOT_COLORS[g.color]!;
        ctx.beginPath();
        ctx.arc((g.col + 0.5) * size, (g.row + 0.5) * size, radius * (1 + ease * 0.6), 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    }

    const color = this.chain[0] && this.grid.length > 0 ? this.grid[this.chain[0][0]]![this.chain[0][1]]! : -1;

    // След цепочки — проводник цвета цепочки, к пальцу тянется хвост.
    if (this.chain.length > 0) {
      ctx.strokeStyle = DOT_COLORS[color]!;
      ctx.lineWidth = size * 0.14;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.beginPath();
      this.chain.forEach(([r, c], i) => {
        const x = (c + 0.5) * size;
        const y = (r + 0.5) * size;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      if (this.pointer) ctx.lineTo(this.pointer.x, this.pointer.y);
      ctx.stroke();
    }

    // До первой партии сетки ещё нет — рисуем пустую плату.
    if (this.grid.length === 0) return;
    const inChain = new Set(this.chain.map(([r, c]) => r * this.cfg.cols + c));
    for (let r = 0; r < this.cfg.rows; r++) {
      for (let c = 0; c < this.cfg.cols; c++) {
        const offset = (this.drop[r]?.[c] ?? 0) * (1 - ease);
        const x = (c + 0.5) * size;
        const y = (r + 0.5 - offset) * size;
        if (y < -size) continue;
        const dot = this.grid[r]![c]!;
        const linked = inChain.has(r * this.cfg.cols + c);
        // Пока ведут цепочку, чужие цвета приглушены — видно, куда можно.
        ctx.globalAlpha = color >= 0 && dot !== color ? 0.35 : 1;
        ctx.fillStyle = DOT_COLORS[dot]!;
        ctx.beginPath();
        ctx.arc(x, y, linked ? radius * 1.18 : radius, 0, Math.PI * 2);
        ctx.fill();
        if (linked) {
          ctx.strokeStyle = 'rgba(237, 234, 227, 0.7)';
          ctx.lineWidth = 1.5;
          ctx.stroke();
        }
      }
    }
    ctx.globalAlpha = 1;
  }
}

function same(a: Cell, b: Cell): boolean {
  return a[0] === b[0] && a[1] === b[1];
}
