#!/bin/bash
# Start Playwright MCP server for hybrid browser panel.
# The TrustChain Agent auto-discovers it via Vite proxy /playwright-mcp → localhost:8931/mcp

echo "🎭 Starting Playwright MCP server on port 8931..."
echo "   The Agent will auto-discover it on next page load."
echo ""

npx @playwright/mcp@latest --port 8931 "$@"
