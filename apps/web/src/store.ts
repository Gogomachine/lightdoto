import { shiftDay, type Move } from '@dotoscope/engine';

/**
 * Местная память «Вызова дня»: журнал попытки и отметка, что она сыграна.
 *
 * Попытка засчитывается с первого хода, а не с последнего: иначе закрыл
 * приложение на плохом ходу — и начал заново. Поэтому журнал пишется после
 * каждого хода, а при возврате партия восстанавливается реплеем.
 *
 * Без сервера это честное слово, а не защита: localStorage стирается одной
 * кнопкой. Настоящую одну попытку в день держит сервер.
 */

export interface DailyRecord {
  log: Move[];
  done: boolean;
  final?: number;
}

const PREFIX = 'dotoscope-daily-';

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Приватный режим или переполнение: игра идёт и без памяти.
  }
}

export function loadDaily(day: string): DailyRecord | null {
  const raw = read(PREFIX + day);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as DailyRecord;
  } catch {
    return null;
  }
}

export function saveDaily(day: string, record: DailyRecord): void {
  write(PREFIX + day, JSON.stringify(record));
}

/**
 * Стрик по местной памяти: дни подряд с завершённым вызовом. Сегодняшний
 * ещё не сыгранный день стрик не рвёт — день не кончился.
 */
export function localStreak(today: string): number {
  let day = loadDaily(today)?.done ? today : shiftDay(today, -1);
  let streak = 0;
  while (loadDaily(day)?.done) {
    streak++;
    day = shiftDay(day, -1);
  }
  return streak;
}
