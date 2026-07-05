import { defineConfig } from 'vite';

export default defineConfig({
  // 相對路徑：讓 dist 可以直接丟到 GitHub Pages / itch.io 任何子路徑
  base: './',
});
