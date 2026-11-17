import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The web app lives in web/ and reads config/, lang/, examples/, contracts/ and the compiled artifacts from the
// repository root, so the root is the Vite root. `npm run build` compiles the contracts first.
export default defineConfig({
  plugins: [react()],
  build: { outDir: 'dist', assetsDir: 'assets', sourcemap: false, chunkSizeWarningLimit: 4000 },
  server: { port: 5173, strictPort: true },
  preview: { port: 4173, strictPort: true },
});
