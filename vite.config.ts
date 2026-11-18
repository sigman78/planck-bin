import { defineConfig } from 'vite';
import { resolve } from 'path';
import type { Plugin } from 'vite';
import { securityHeadersFile } from './src/shared/security-headers';

/**
 * Write dist/client/_headers from the worker's header policy. Files the assets
 * layer serves directly (`/`, robots.txt, bundles) never reach the worker, so
 * without this they would go out with no CSP or frame protection.
 */
function securityHeaders(): Plugin {
  return {
    name: 'haste-security-headers',
    apply: 'build',
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: '_headers', source: securityHeadersFile() });
    },
  };
}

export default defineConfig({
  root: 'src/client',
  plugins: [securityHeaders()],
  build: {
    outDir: '../../dist/client',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'src/client/index.html'),
      },
      output: {
        entryFileNames: 'assets/[name].[hash].js',
        chunkFileNames: 'assets/[name].[hash].js',
        assetFileNames: 'assets/[name].[hash].[ext]',
        manualChunks: {
          // Split highlight.js into its own chunk for better caching
          highlight: ['highlight.js'],
        },
      },
    },
  },
  server: {
    port: 5173,
  },
});
