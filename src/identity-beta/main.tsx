/** Dedicated Testnet identity entry; unrelated to existing Vercel financial preview. */
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { IdentityBetaApp } from './IdentityBetaApp';
import './styles.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode><IdentityBetaApp /></StrictMode>,
);
