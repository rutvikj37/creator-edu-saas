import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { z } from 'zod';
import './styles/index.css';
import './i18n/index.js';
import { App } from './app/App.jsx';

// The CSP forbids eval; without this zod probes `new Function` and the browser reports a violation.
z.config({ jitless: true });

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
