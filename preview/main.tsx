import React from 'react';
import { createRoot } from 'react-dom/client';
import TrustChainAgentApp from '../src/ui/TrustChainAgentApp';
import '../src/index.css';

const root = createRoot(document.getElementById('root')!);
root.render(<TrustChainAgentApp />);
