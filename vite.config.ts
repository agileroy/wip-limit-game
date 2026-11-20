import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Le jeu est publié sur https://agileroy.github.io/wip-limit-game/
export default defineConfig({
  base: '/wip-limit-game/',
  plugins: [react()],
});
