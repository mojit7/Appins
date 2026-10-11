import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
// فونت فارسی وزیرمتن — self-host از node_modules؛ درخواست خارجی وجود ندارد
import '@fontsource/vazirmatn/400.css';
import '@fontsource/vazirmatn/500.css';
import '@fontsource/vazirmatn/700.css';
import '@fontsource/vazirmatn/800.css';
import './styles.css';

createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
