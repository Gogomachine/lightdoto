/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** База API; пусто — игра без сервера, «Вызов дня» считается на месте. */
  readonly VITE_API_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
