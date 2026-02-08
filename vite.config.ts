import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
    plugins: [
        react(),
        tailwindcss(),
    ],
    server: {
        port: 5173,
        open: false,
        // Proxy Playwright MCP to bypass CORS (browser can't fetch cross-origin :8931)
        proxy: {
            '/playwright-mcp': {
                target: 'http://localhost:8931',
                changeOrigin: true,
                rewrite: (path) => path.replace('/playwright-mcp', '/mcp'),
            },
        },
    },
    // Ensure /panel path doesn't 404 in dev
    appType: 'spa',
});
