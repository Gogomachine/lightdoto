/**
 * Обёртка над Telegram WebApp SDK.
 *
 * Вне Telegram игра работает в режиме разработки: окна нет, initData пустая,
 * а пользователь — подставной лаборант. Остальной код про это не знает и
 * зовёт одни и те же функции: в браузере они просто ничего не делают.
 */

interface ThemeParams {
  bg_color?: string;
  secondary_bg_color?: string;
  text_color?: string;
  hint_color?: string;
  button_color?: string;
}

interface TelegramWebApp {
  initData: string;
  initDataUnsafe?: {
    user?: { id: number; first_name: string; username?: string };
    start_param?: string;
  };
  colorScheme?: 'light' | 'dark';
  themeParams?: ThemeParams;
  ready(): void;
  expand?(): void;
  disableVerticalSwipes?(): void;
  setBackgroundColor?(color: string): void;
  setHeaderColor?(color: string): void;
  onEvent?(event: string, cb: () => void): void;
  BackButton?: {
    show(): void;
    hide(): void;
    onClick(cb: () => void): void;
    offClick(cb: () => void): void;
  };
  HapticFeedback?: {
    impactOccurred(style: 'light' | 'medium' | 'heavy' | 'rigid' | 'soft'): void;
    notificationOccurred(type: 'error' | 'success' | 'warning'): void;
    selectionChanged(): void;
  };
}

export interface Player {
  id: number;
  name: string;
}

const DEV_PLAYER: Player = { id: 1, name: 'Лаборант' };

function webApp(): TelegramWebApp | null {
  const tg = (window as { Telegram?: { WebApp?: TelegramWebApp } }).Telegram?.WebApp;
  return tg && tg.initData.length > 0 ? tg : null;
}

/**
 * Методы окна появлялись в разных версиях Bot API, и старый клиент на
 * незнакомый вызов бросает исключение, даже когда функция в скрипте есть.
 * Поэтому каждый вызов необязательный.
 */
function tryCall(action: () => void): void {
  try {
    action();
  } catch {
    // Старый Telegram: обойдёмся без этой возможности.
  }
}

export function isTelegram(): boolean {
  return webApp() !== null;
}

export function player(): Player {
  const user = webApp()?.initDataUnsafe?.user;
  return user ? { id: user.id, name: user.username ?? user.first_name } : DEV_PLAYER;
}

/** initData для сервера; в режиме разработки — пустая строка. */
export function initData(): string {
  return webApp()?.initData ?? '';
}

export function startParam(): string | null {
  const value = webApp()?.initDataUnsafe?.start_param;
  return value ? value : null;
}

/**
 * Готовит окно и переносит цвета темы Telegram на корпус. Стекло платы
 * всегда чёрное — светлеет и темнеет только корпус вокруг, как у прибора.
 */
export function setupTelegram(): void {
  const tg = webApp();
  if (!tg) return;
  tryCall(() => tg.ready());
  // Мини-приложение открывается в половину экрана: плата туда не влезает.
  tryCall(() => tg.expand?.());
  // Цепочку ведут пальцем, и свайп вниз сворачивал бы игру посреди хода.
  tryCall(() => tg.disableVerticalSwipes?.());
  applyTheme(tg);
  tryCall(() => tg.onEvent?.('themeChanged', () => applyTheme(tg)));
}

function applyTheme(tg: TelegramWebApp): void {
  const t = tg.themeParams ?? {};
  const root = document.documentElement.style;
  if (t.bg_color) root.setProperty('--case', t.bg_color);
  if (t.secondary_bg_color) root.setProperty('--case-2', t.secondary_bg_color);
  if (t.text_color) root.setProperty('--silk', t.text_color);
  if (t.hint_color) root.setProperty('--silk-2', t.hint_color);
  const bg = t.bg_color ?? getComputedStyle(document.documentElement).getPropertyValue('--case').trim();
  tryCall(() => tg.setBackgroundColor?.(bg));
  tryCall(() => tg.setHeaderColor?.(bg));
}

let backHandler: (() => void) | null = null;

/** Системная кнопка «Назад»; null — спрятать. */
export function setBackButton(handler: (() => void) | null): void {
  const button = webApp()?.BackButton;
  if (!button) return;
  if (backHandler) tryCall(() => button.offClick(backHandler!));
  backHandler = handler;
  if (handler) {
    tryCall(() => button.onClick(handler));
    tryCall(() => button.show());
  } else {
    tryCall(() => button.hide());
  }
}

/** Отклик пальцу: каждая новая точка цепочки — щелчок, снятие — удар. */
export const haptic = {
  link(): void {
    tryCall(() => webApp()?.HapticFeedback?.selectionChanged());
  },
  commit(length: number): void {
    const style = length >= 6 ? 'heavy' : length >= 4 ? 'medium' : 'light';
    tryCall(() => webApp()?.HapticFeedback?.impactOccurred(style));
  },
  success(): void {
    tryCall(() => webApp()?.HapticFeedback?.notificationOccurred('success'));
  },
  error(): void {
    tryCall(() => webApp()?.HapticFeedback?.notificationOccurred('error'));
  },
};
