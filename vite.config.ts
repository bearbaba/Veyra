import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'
import { existsSync, readFileSync, renameSync } from 'node:fs'
import { nodePolyfills } from 'vite-plugin-node-polyfills'

/**
 * Preview must be selected as Rollup's INITIAL HTML input, before Vite resolves
 * any imports. An HTML transform hook is too late: it could include live
 * src/main.tsx and wallet libraries in the output graph before transformation.
 *
 * The source preview.html is emitted as dist/preview.html by Vite; after build,
 * we atomically rename ONLY that entry to dist/index.html for Vercel hosting.
 * No default live index.html is compiled in this mode.
 */
const uiOnlyPreview = process.env.VITE_VEYRA_UI_ONLY === '1';
const previewHtml = path.resolve(__dirname, 'preview.html');
const outputDir = path.resolve(__dirname, 'dist');

export default defineConfig({
  plugins: [
    react(),
    ...(!uiOnlyPreview ? [nodePolyfills()] : []),
    ...(uiOnlyPreview
      ? [{
          name: 'veyra-static-preview-only',
          closeBundle() {
            const index = path.join(outputDir, 'index.html');
            const preview = path.join(outputDir, 'preview.html');
            if (!existsSync(preview) || existsSync(index)) {
              throw new Error('[preview] expected exclusively preview.html output; refusing unsafe deploy');
            }
            const html = readFileSync(preview, 'utf8');
            if (!html.includes('<title>Veyra Preview')) {
              throw new Error('[preview] Vite produced an unexpected HTML entry');
            }
            renameSync(preview, index);
          },
        }]
      : []),
  ],
  build: uiOnlyPreview
    ? { rollupOptions: { input: previewHtml } }
    : undefined,
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
    dedupe: ['react', 'react-dom'],
  },
  optimizeDeps: {
    include: [
      'react',
      'react-dom',
      'react-dom/client',
      'react/jsx-runtime',
      '@tanstack/react-query',
      'wagmi',
      'wagmi/chains',
      'wagmi/connectors',
      'viem',
      'viem/chains',
      'connectkit',
      'framer-motion',
      'lucide-react',
      'sonner',
      'clsx',
      'tailwind-merge',
      'vite-plugin-node-polyfills/shims/buffer',
      'vite-plugin-node-polyfills/shims/global',
      'vite-plugin-node-polyfills/shims/process',
    ],
  },
  server: {
    allowedHosts: true,
    cors: true,
    hmr: {
      clientPort: 443,
    },
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
    },
  },
})
