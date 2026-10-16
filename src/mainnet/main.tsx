/** Arc Mainnet Pay is compiled ONLY when VITE_VEYRA_MAINNET_MVP=1. */
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { MainnetApp } from './MainnetApp';
import './mainnet.css';

const root = document.getElementById('root');
if (!root) throw new Error('Arc Mainnet app root was not mounted.');
createRoot(root).render(<StrictMode><MainnetApp/></StrictMode>);
