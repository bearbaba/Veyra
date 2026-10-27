/**
 * Static Vercel Preview entry. This module deliberately does not import:
 * wagmi, viem, ConnectKit, production App, securityBootstrap, receipts,
 * backend clients or transaction-signing providers. Injected EIP-1193
 * wallet account connection is deliberately allowed (no signatures).
 */
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { PreviewApp } from './PreviewApp';
import '../index.css';
import './preview.css';

const root = document.getElementById('root');
if (!root) throw new Error('Veyra preview root not found');

createRoot(root).render(
  <StrictMode>
    <PreviewApp />
  </StrictMode>,
);
