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
// VITE_VEYRA_MAINNET_PAY=1 is permitted in two build modes:
//   (a) MAINNET_MVP=1  — the isolated canary ERC-20 transfer bundle (src/mainnet/)
//   (b) ENV=mainnet with no isolated-bundle flag — the full Veyra app with SettlementPage
// It is never permitted in the UI-only Testnet preview or Identity Beta bundles.
if (process.env.VITE_VEYRA_MAINNET_PAY === '1') {
  const isFullMainnetApp = process.env.VITE_VEYRA_ENV === 'mainnet' && !uiOnlyPreview && !identityBeta;
  if (!mainnetMvp && !isFullMainnetApp) {
    throw new Error(
      '[build] VITE_VEYRA_MAINNET_PAY=1 requires either VITE_VEYRA_MAINNET_MVP=1 (isolated canary bundle) ' +
      'or VITE_VEYRA_ENV=mainnet with no isolated-bundle flag (full Veyra app with SettlementPage).'
    );
  }
}
const previewHtml = path.resolve(__dirname, 'preview.html');
const mainnetHtml = path.resolve(__dirname, 'mainnet.html');
const identityHtml = path.resolve(__dirname, 'identity-beta.html');
const outputDir = path.resolve(__dirname, 'dist');

export default defineConfig({
  define: {
    __VEYRA_RELEASE_SHA__: JSON.stringify(process.env.VERCEL_GIT_COMMIT_SHA || 'local'),
    __VEYRA_RELEASE_ENV__: JSON.stringify(process.env.VERCEL_ENV || 'local'),
  },
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
            // Preserve the established financial-preview rename invariant.
            if (uiOnlyPreview) renameSync(preview, index);
            else if (mainnetMvp) renameSync(mainnet, index);
            else renameSync(identity, index);
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
