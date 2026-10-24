import {
  applyMove,
  createGame,
  daily,
  DEFAULT_CONFIG as cfg,
  describeGoal,
  finalScore,
  goalProgress,
  isOver,
  pickGoal,
  randomSeed,
  replay,
  type Cell,
  type Daily,
  type GameState,
  type Move,
} from '@dotoscope/engine';
import { brandLockup } from './brand';
import { Plate } from './plate';
import { loadDaily, localStreak, saveDaily } from './store';
import { haptic, player, setBackButton, setupTelegram } from './telegram';
import './style.css';

type Mode = 'daily' | 'free';

interface Session {
  mode: Mode;
  seed: number;
  state: GameState;
  log: Move[];
  /** Чтобы «цель выполнена» прозвучала один раз, а не на каждом ходу после. */
  goalWasDone: boolean;
}

function el<T extends HTMLElement = HTMLElement>(id: string): T {
  return document.getElementById(id) as T;
}

const screens = { menu: el('menu'), game: el('game'), result: el('result') };
let session: Session | null = null;
let today: Daily = daily(new Date(), cfg);

const plate = new Plate(el<HTMLCanvasElement>('plate'), cfg, {
  onLink(length) {
    haptic.link();
    el('chain-len').textContent = length >= 2 ? `ЦЕПЬ ${length} · +${chainValue(length)}` : '';
  },
  onCommit: commit,
});

function chainValue(n: number): number {
  return cfg.score.chainPoints(n, cfg.score.base);
}

function sampleName(seed: number): string {
  return `#${seed.toString(16).padStart(8, '0')}`;
}

function show(name: keyof typeof screens): void {
  for (const [key, node] of Object.entries(screens)) node.hidden = key !== name;
  // «Назад» Telegram ведёт в меню отовсюду, кроме самого меню.
  setBackButton(name === 'menu' ? null : () => openMenu());
}

/* ---------- Меню ---------- */

function openMenu(): void {
  session = null;
  // День мог смениться, пока приложение было открыто.
  today = daily(new Date(), cfg);
  const record = loadDaily(today.day);
  el('daily-no').textContent = `№${today.number}`;
  el('daily-goal').textContent = `${describeGoal(today.goal)} — итог ×${cfg.goalMultiplier}.`;
  const state = el('daily-state');
  state.classList.toggle('done', Boolean(record?.done));
  state.textContent = record?.done
    ? `ПРОЙДЕН · ${record.final ?? 0} · СЛЕДУЮЩИЙ ЧЕРЕЗ ${untilTomorrow()}`
    : record && record.log.length > 0
      ? `В РАБОТЕ · ХОД ${record.log.length}/${cfg.moveLimit}`
      : `ОДНА ПОПЫТКА · ${cfg.moveLimit} ХОДОВ`;
  renderWho();
  show('menu');
}

function renderWho(): void {
  el('who-name').textContent = player().name.toUpperCase();
  const streak = localStreak(today.day);
  el('who-streak').textContent = streak > 0 ? `СТРИК ${streak}` : '';
}

function untilTomorrow(): string {
  const now = new Date();
  const next = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1);
  const minutes = Math.ceil((next - now.getTime()) / 60000);
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
}

/* ---------- Игра ---------- */

function startDaily(): void {
  today = daily(new Date(), cfg);
  const record = loadDaily(today.day);
  if (record?.done) {
    showDailyResult(record.log);
    return;
  }
  // Начатую попытку восстанавливаем реплеем: заново её не начать.
  const log = record?.log ?? [];
  const restored = replay(today.seed, log, cfg);
  const state = restored.ok ? restored.state : createGame(today.seed, today.goal, cfg);
  startSession({ mode: 'daily', seed: today.seed, state, log: restored.ok ? log : [], goalWasDone: false });
}

function startFree(): void {
  const seed = randomSeed();
  const state = createGame(seed, pickGoal(seed, cfg), cfg);
  startSession({ mode: 'free', seed, state, log: [], goalWasDone: false });
}

function startSession(next: Session): void {
  session = next;
  session.goalWasDone = goalProgress(next.state).done;
  el('mode-name').textContent = next.mode === 'daily' ? `ВЫЗОВ ДНЯ №${today.number}` : 'СВОБОДНО';
  el('sample').textContent = `ОБРАЗЕЦ ${sampleName(next.seed)}`;
  el('goal-text').textContent = describeGoal(next.state.goal);
  setStatus('СЕТЬ СТАБИЛЬНА', '');
  plate.enabled = true;
  plate.show(next.state.grid);
  renderHud();
  show('game');
}

function renderHud(): void {
  if (!session) return;
  const { state } = session;
  const left = cfg.moveLimit - state.moves;
  el('score').textContent = String(state.score);
  const moves = el('moves');
  moves.textContent = String(left);
  moves.classList.toggle('low', left <= 5);
  const progress = goalProgress(state);
  const goal = el('goal-progress');
  goal.textContent = progress.done ? `×${cfg.goalMultiplier}` : `${progress.current}/${progress.target}`;
  goal.classList.toggle('done', progress.done);
  el('chain-len').textContent = '';
}

function setStatus(text: string, tone: '' | 'warn' | 'win'): void {
  const bar = el('status').parentElement!;
  bar.classList.remove('warn', 'win');
  if (tone) bar.classList.add(tone);
  el('status').textContent = text;
}

function commit(chain: Cell[]): void {
  if (!session) return;
  const step = applyMove(session.state, chain, cfg);
  if (!step.ok) {
    haptic.error();
    return;
  }
  const prev = session.state;
  const { state, shuffled } = step.result;
  session.state = state;
  session.log.push(chain);
  haptic.commit(chain.length);
  plate.advance(prev.grid, chain, state.grid, shuffled);

  if (session.mode === 'daily') {
    saveDaily(today.day, { log: session.log, done: false });
  }

  const done = goalProgress(state).done;
  if (done && !session.goalWasDone) {
    session.goalWasDone = true;
    haptic.success();
    setStatus(`ЦЕЛЬ ВЫПОЛНЕНА · ×${cfg.goalMultiplier}`, 'win');
  } else if (shuffled) {
    // Тупик платы: перемешали из того же потока, сеть пересобрана.
    setStatus('ПЕРЕКОММУТАЦИЯ · НЕТ ХОДОВ', 'warn');
  } else if (!done) {
    setStatus('СЕТЬ СТАБИЛЬНА', '');
  }
  renderHud();

  if (isOver(state, cfg)) {
    plate.enabled = false;
    if (session.mode === 'daily') {
      saveDaily(today.day, { log: session.log, done: true, final: finalScore(state, cfg) });
    }
    const finished = session;
    setTimeout(() => showResult(finished), 450);
  }
}

/* ---------- Итог ---------- */

function showDailyResult(log: Move[]): void {
  const r = replay(today.seed, log, cfg);
  if (!r.ok) {
    openMenu();
    return;
  }
  showResult({ mode: 'daily', seed: today.seed, state: r.state, log, goalWasDone: r.goalDone });
}

function showResult(s: Session): void {
  const progress = goalProgress(s.state);
  const longest = s.state.chains.reduce((a, b) => Math.max(a, b), 0);
  el('res-head').textContent =
    s.mode === 'daily' ? `ИТОГ · ВЫЗОВ ДНЯ №${today.number}` : `ИТОГ · ОБРАЗЕЦ ${sampleName(s.seed)}`;
  el('res-final').textContent = String(finalScore(s.state, cfg));
  el('res-score').textContent = String(s.state.score);
  el('res-goal-text').textContent = describeGoal(s.state.goal);
  const goal = el('res-goal');
  goal.textContent = progress.done ? `выполнена · ×${cfg.goalMultiplier}` : `${progress.current}/${progress.target}`;
  goal.classList.toggle('done', progress.done);
  el('res-chains').textContent = String(s.state.chains.length);
  el('res-longest').textContent = longest > 0 ? `${longest} · +${chainValue(longest)}` : '—';
  el('res-note').textContent =
    s.mode === 'daily'
      ? `Попытка дня сыграна. Следующий вызов через ${untilTomorrow()} (полночь UTC).`
      : 'Свободный режим: без рейтинга, сыграйте новый образец.';
  el('res-again').hidden = s.mode === 'daily';
  renderWho();
  show('result');
}

/* ---------- Запуск ---------- */

setupTelegram();
el('brand').innerHTML = brandLockup(112);
el('go-daily').addEventListener('click', startDaily);
el('go-free').addEventListener('click', startFree);
el('quit').addEventListener('click', openMenu);
el('res-menu').addEventListener('click', openMenu);
el('res-again').addEventListener('click', startFree);
openMenu();
