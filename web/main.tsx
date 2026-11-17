import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource/fraunces/latin-600.css';
import '@fontsource/ibm-plex-sans/latin-400.css';
import '@fontsource/ibm-plex-sans/latin-600.css';
import '@fontsource/ibm-plex-mono/latin-400.css';
import './styles.css';
import { App } from './App.js';
import { LangProvider } from './i18n.js';

const root = document.getElementById('root');
if (!root) throw new Error('#root missing');
createRoot(root).render(<StrictMode><LangProvider><App /></LangProvider></StrictMode>);
