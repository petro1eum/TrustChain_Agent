# TrustChain Agent

**Cryptographically verified AI coding agent** with ReAct loop, planning, reflection, and Docker sandbox execution.

> Built on [TrustChain](https://github.com/petro1eum/trust_chain) — every tool call cryptographically signed.

## Architecture

```
┌──────────────────────────────────────────┐
│              TrustChain Agent            │
├──────────────┬───────────────────────────┤
│  Agent Core  │  Services                │
│  • ReAct     │  • Planning              │
│  • Planning  │  • Reflection            │
│  • Execution │  • Quality Evaluation    │
│              │  • Error Recovery        │
│              │  • Persistent Memory     │
│              │  • MCP Client            │
│              │  • Code Analysis         │
│              │  • Task Queue            │
├──────────────┼───────────────────────────┤
│  Tools       │  Backend (Docker)        │
│  • bash      │  • docker_agent.py       │
│  • file ops  │  • bash_executor.py      │
│  • code exec │  • agent_mcp.py          │
│  • web       │  • agent_memory.py       │
├──────────────┼───────────────────────────┤
│  UI          │  TrustChain Integration  │
│  • ChatAgent │  • Ed25519 signing       │
│  • Artifacts │  • Chain of Trust        │
│  • Debug     │  • Merkle audit trail    │
└──────────────┴───────────────────────────┘
```

## Quick Start

```bash
# Frontend
npm install
npm run dev

# Backend (Python)
cd backend
pip install fastapi uvicorn docker trustchain
uvicorn main:app --reload
```

## Key Features

- **ReAct Loop** — multi-step reasoning with tool calling
- **Planning Service** — creates and executes multi-step plans
- **Reflection** — self-evaluates and corrects responses
- **Docker Sandbox** — safe code execution in isolated containers
- **Persistent Memory** — cross-session context retention
- **MCP Protocol** — Model Context Protocol support
- **TrustChain** — cryptographic proof for every AI action
- **Plugin Architecture** — register custom domain-specific tools

## Plugin System

```typescript
import { SmartAIAgent } from 'trustchain-agent';
import { myCustomTools } from './my-tools';

const agent = new SmartAIAgent({
  additionalTools: myCustomTools,
  trustchain: true,
});
```

## License

MIT — [Ed Cherednik](https://github.com/petro1eum)
