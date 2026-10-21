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
const mainnetMvp = process.env.VITE_VEYRA_MAINNET_MVP === '1';
const identityBeta = process.env.VITE_VEYRA_IDENTITY_BETA === '1';
if (Number(uiOnlyPreview) + Number(mainnetMvp) + Number(identityBeta) > 1) {
  throw new Error('[build] Identity Beta, Testnet Preview and Mainnet must have separate bundles.');
}
if (process.env.VITE_VEYRA_MAINNET_PAY === '1' && !mainnetMvp) {
  throw new Error('[build] Mainnet signing may only be requested in its isolated Mainnet MVP bundle.');
}
const previewHtml = path.resolve(__dirname, 'preview.html');
const mainnetHtml = path.resolve(__dirname, 'mainnet.html');
const identityHtml = path.resolve(__dirname, 'identity-beta.html');
const outputDir = path.resolve(__dirname, 'dist');

export default defineConfig({
  plugins: [
    react(),
    ...(!uiOnlyPreview && !mainnetMvp && !identityBeta ? [nodePolyfills()] : []),
    ...((uiOnlyPreview || mainnetMvp || identityBeta)
      ? [{
          name: 'veyra-isolated-financial-preview',
          closeBundle() {
            const index = path.join(outputDir, 'index.html');
            const preview = path.join(outputDir, 'preview.html');
            const mainnet = path.join(outputDir, 'mainnet.html');
            const identity = path.join(outputDir, 'identity-beta.html');
            const selected = identityBeta ? identity : mainnetMvp ? mainnet : preview;
            if (!existsSync(selected) || existsSync(index) ||
                [preview, mainnet, identity].filter(item => item !== selected).some(existsSync)) {
              throw new Error('[preview] expected exactly one isolated HTML entry; refusing mixed build');
            }
            const html = readFileSync(selected, 'utf8');
            if (!html.includes('<title>Veyra —')) {
              throw new Error('[preview] unexpected HTML entry; refusing unsafe deploy');
            }
            renameSync(selected, index);
          },
        }]
      : []),
  ],
  build: identityBeta
    ? { rollupOptions: { input: identityHtml } }
    : uiOnlyPreview
      ? { rollupOptions: { input: previewHtml } }
      : mainnetMvp
        ? { rollupOptions: { input: mainnetHtml } }
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
