#!/bin/bash
# Start Playwright MCP server — headed mode (DEFAULT).
# A real Chrome window opens. Ed controls it, you see everything.
# One browser, one truth, zero desync.
#
# Auto-discovered by TrustChain Agent via Vite proxy:
#   /playwright-mcp → localhost:8931/mcp

echo "🎭 Starting Playwright MCP on port 8931..."
echo "   Chrome will open when Ed navigates to a page."
echo "   You see what Ed sees. One browser. Zero desync."
echo ""

npx @playwright/mcp@latest --port 8931 "$@"
