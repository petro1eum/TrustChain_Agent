---
name: playwright-browser
description: Control any web browser using Playwright — navigate, click, type, screenshot. Token-efficient CLI approach preferred over MCP.
---

# Playwright Browser Automation Skill

## When to Use

Use this skill when the agent needs to interact with **any web page** beyond the structured `page_action` protocol. Examples:
- Clicking buttons, links, or UI elements
- Filling forms
- Taking screenshots for verification
- Reading page content / accessibility tree
- Automating multi-step browser workflows

## Decision Matrix

| Scenario | Use | Why |
|----------|-----|-----|
| Navigate to known page | `page_action` MCP tool | Fast, no browser overhead |
| Select/focus a known entity | `page_action` MCP tool | Direct Zustand dispatch |
| Click a specific button on page | Playwright CLI | Universal, works on any page |
| Fill a form field | Playwright CLI | Universal |
| Take a screenshot | Playwright CLI | Token-efficient (saves to disk) |
| Read page structure | Playwright CLI `snapshot` | Accessibility tree, not pixels |

## Playwright CLI Usage (Preferred — Token Efficient)

CLI saves all output to files on disk, avoiding context bloat.

### Install (one-time)
```bash
npx @playwright/mcp@latest --port 8931
```

### Core Commands

**Navigate:**
```bash
# Navigate to a URL
playwright-cli navigate "http://localhost:3001/radar"
```

**Snapshot (accessibility tree):**
```bash
# Get structured page content — much cheaper than screenshots
playwright-cli snapshot
```

**Click:**
```bash
# Click by accessibility ref
playwright-cli click --ref "button[name='Export']"
```

**Type:**
```bash
# Type into an input
playwright-cli type --ref "input[name='search']" --text "R04"
```

**Screenshot:**
```bash
# Save screenshot to file (NOT sent to LLM context)
playwright-cli screenshot --output /tmp/radar_screenshot.png
```

**Evaluate JS:**
```bash
# Run JavaScript on the page
playwright-cli evaluate "document.title"
```

## Playwright MCP Server (Alternative — For Persistent Sessions)

When running as MCP, the browser stays open between calls. Use for exploratory automation or long-running workflows.

### Start MCP Server
```bash
npx @playwright/mcp@latest --port 8931
```

### Available MCP Tools
- `browser_navigate` — Go to URL
- `browser_snapshot` — Get accessibility tree
- `browser_click` — Click element by ref
- `browser_type` — Type text
- `browser_evaluate` — Execute JavaScript  
- `browser_screenshot` — Capture screenshot
- `browser_drag` — Drag and drop
- `browser_close` — Close page
- `browser_console_messages` — Get console output

### Connect from Agent
The MCP server URL is: `http://localhost:8931/mcp`

## Best Practices

1. **Prefer `snapshot` over `screenshot`** — accessibility tree is structured text, costs ~100 tokens vs ~1000+ for an image
2. **Use CLI over MCP when possible** — CLI saves output to disk (26K tokens vs 114K for same task)
3. **Combine with `page_action`** — use structured protocol for known actions, Playwright for discovery/interaction
4. **Target by accessibility ref** — use `ref` from snapshot for reliable element targeting
5. **Headless by default** — add `--headed` flag only for debugging
