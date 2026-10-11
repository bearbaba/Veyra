/**
 * Static Vercel Preview entry. This module deliberately does not import:
 * wagmi, viem, ConnectKit, production App, securityBootstrap, receipts,
 * backend clients or any wallet/execution providers.
 */
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { PreviewApp } from './PreviewApp';
import '../index.css';

const root = document.getElementById('root');
if (!root) throw new Error('Veyra preview root not found');

createRoot(root).render(
  <StrictMode>
    <PreviewApp />
  </StrictMode>,
);
