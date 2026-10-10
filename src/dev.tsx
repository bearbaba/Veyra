import './tracing';
import './console-capture';
import './index.css';

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { WagmiProvider } from 'wagmi';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ConnectKitProvider } from 'connectkit';
import { Toaster } from 'sonner';
import { config } from './config';
import { initializeSecurityRuntime } from './lib/securityBootstrap';
import { CctpE2EPage } from './components/dev/CctpE2EPage';

const root = document.getElementById('root');
if (!root) throw new Error('Missing #root');

if (import.meta.env.VITE_DEV_TOOLS !== 'true') {
  root.replaceChildren(document.createTextNode('404 — developer tools are disabled'));
} else {
  const queryClient = new QueryClient();

  void initializeSecurityRuntime().catch((error) => {
    console.error('[securityBootstrap] DEV initialization failed', error);
  });

  createRoot(root).render(
    <StrictMode>
      <WagmiProvider config={config}>
        <QueryClientProvider client={queryClient}>
          <ConnectKitProvider>
            <CctpE2EPage />
            <Toaster position="top-center" />
          </ConnectKitProvider>
        </QueryClientProvider>
      </WagmiProvider>
    </StrictMode>,
  );
}
