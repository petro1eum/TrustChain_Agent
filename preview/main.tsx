import React, { lazy, Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import '../src/index.css';
import 'katex/dist/katex.min.css';
import '../src/ui/hljs-theme.css';

// Path-based routing: /panel renders the embeddable panel widget
const isPanel = window.location.pathname === '/panel';

const TrustChainAgentApp = lazy(() => import('../src/ui/TrustChainAgentApp'));
const PanelApp = lazy(() => import('../src/ui/panel/PanelApp'));

const App = isPanel ? PanelApp : TrustChainAgentApp;

const root = createRoot(document.getElementById('root')!);
root.render(
    <Suspense fallback={<div style={{ background: '#0f172a', height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#64748b' }}>Loading...</div>}>
        <App />
    </Suspense>
);
