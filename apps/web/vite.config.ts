import { defineConfig } from 'vite';

// BASE_PATH задаёт сборка под подпуть (например, GitHub Pages).
export default defineConfig({
  base: process.env.BASE_PATH ?? '/',
  server: { host: true },
});
