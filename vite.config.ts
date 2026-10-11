import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'
import { nodePolyfills } from 'vite-plugin-node-polyfills'

/**
 * The static Vercel preview has its OWN HTML entrypoint. Importing the live
 * App/main.tsx would include wallet transaction code in the published bundle
 * even if its buttons were hidden by an environment flag.
 *
 * Transforming the index HTML before Rollup graph construction means no live
 * wallet, identity, transaction or server API modules are imported at all.
 */
const uiOnlyPreview = process.env.VITE_VEYRA_UI_ONLY === '1';

export default defineConfig({
  plugins: [
    react(),
    ...(!uiOnlyPreview ? [nodePolyfills()] : []),
    ...(uiOnlyPreview
      ? [{
          name: 'veyra-static-preview-entry',
          enforce: 'pre' as const,
          transformIndexHtml(html: string) {
            const liveEntry = 'src="/src/main.tsx"';
            if (!html.includes(liveEntry)) {
              throw new Error('[preview] index.html live entry missing; refuse unsafe preview build');
            }
            return html.replace(liveEntry, 'src="/src/preview/main.tsx"');
          },
        }]
      : []),
  ],
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
