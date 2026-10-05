import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import AuthGate from './AuthGate.jsx';
import './styles.css';
let root;
function mount() {
  root = createRoot(document.getElementById('root'));
  root.render(<StrictMode><AuthGate><App /></AuthGate></StrictMode>);
}
mount();
window.addEventListener('pagehide', () => { root?.unmount(); root = null; });
window.addEventListener('pageshow', event => { if (event.persisted && !root) mount(); });
