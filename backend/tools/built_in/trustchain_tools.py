"""
TrustChain Tools — Native BaseTool subclasses for LLM function-calling.

These tools expose TrustChain's cryptographic audit, compliance, and
observability capabilities to the agent via the standard OpenAI
function-calling protocol.  The LLM picks the right tool based on the
docstring (= description in openai_schema); no system-prompt hacks needed.
"""

from typing import Optional

from pydantic import Field

from backend.tools.base_tool import BaseTool, ToolContext


# ── Helpers: lazy access to singletons already initialised elsewhere ──

def _get_tc():
    """Return the global TrustChain signing instance."""
    from backend.routers.trustchain_api import _tc, _operations
    return _tc, _operations


def _get_pro_modules():
    """Return Pro module singletons (may be None if not installed)."""
    try:
        from backend.routers.trustchain_pro_api import (
            _compliance_report,
            _policy_engine,
            _analytics,
            _local_tsa,
            _get_operations,
        )
        return {
            "compliance": _compliance_report,
            "policy": _policy_engine,
            "analytics": _analytics,
            "tsa": _local_tsa,
            "operations": _get_operations(),
        }
    except ImportError:
        return {}


# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
#  1. TrustChainVerify
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━


class TrustChainVerify(BaseTool):
    """Verify the Ed25519 cryptographic signature and chain-of-trust integrity
    for a specific signed operation.  Use this when the user asks to prove
    authenticity, check whether a result was tampered with, or verify the
    integrity of the audit trail."""

    signature_id: str = Field(
        ...,
        description="The signature ID (nonce) of the operation to verify, "
                    "e.g. the 'id' field returned by a previous signing call.",
    )

    async def run(self, context: Optional[ToolContext] = None) -> str:
        _tc, operations = _get_tc()

        # Find the operation by signature id
        target = None
        for op in operations:
            if op.get("id") == self.signature_id or \
               op.get("nonce") == self.signature_id:
                target = op
                break

        if target is None:
            return (
                f"[ERROR] Operation `{self.signature_id}` not found in the current "
                f"audit trail ({len(operations)} operations recorded). "
                f"Provide a valid signature ID."
            )

        # Verify the signature
        try:
            sig = target.get("signature", "")
            data = target.get("raw_data", target.get("data", {}))
            is_valid = _tc.verify(sig, data) if hasattr(_tc, "verify") else True
            parent = target.get("parent_signature", "—")
            tool = target.get("tool", "unknown")

            status = "VALID" if is_valid else "INVALID -- possible tampering"
            return (
                f"## Signature Verification\n\n"
                f"| Field | Value |\n|---|---|\n"
                f"| **Status** | {status} |\n"
                f"| **Tool** | `{tool}` |\n"
                f"| **Signature** | `{sig[:24]}…` |\n"
                f"| **Parent Sig** | `{str(parent)[:24]}…` |\n"
                f"| **Key ID** | `{target.get('key_id', '—')}` |\n"
                f"| **Algorithm** | `{target.get('algorithm', 'Ed25519')}` |\n"
            )
        except Exception as e:
            return f"[ERROR] Verification failed: {e}"


# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
#  2. TrustChainAuditReport
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━


class TrustChainAuditReport(BaseTool):
    """Generate a full audit-trail report showing every cryptographically
    signed operation in the current session.  Use this when the user asks
    for an audit log, session summary, security report, or wants to see
    which tools were called and their Ed25519 signatures."""

    last_n: int = Field(
        0,
        ge=0,
        description="Return only the last N operations (0 = all).",
    )

    async def run(self, context: Optional[ToolContext] = None) -> str:
        _, operations = _get_tc()

        if not operations:
            return "No signed operations recorded yet in this session."

        ops = operations if self.last_n == 0 else operations[-self.last_n:]

        lines = [
            f"## TrustChain Audit Report — {len(ops)} operations\n",
            "| # | Tool | Signature | Parent | Verified |",
            "|---|---|---|---|---|",
        ]
        for i, op in enumerate(ops, 1):
            sig = op.get("signature", "—")[:16]
            parent = (op.get("parent_signature") or "—")[:16]
            verified = "OK" if op.get("verified", False) else "WARN"
            tool = op.get("tool", "?")
            lines.append(f"| {i} | `{tool}` | `{sig}…` | `{parent}…` | {verified} |")

        lines.append(f"\n**Total:** {len(operations)} signed operations "
                     f"| **Key:** `{ops[-1].get('key_id', '—')}` "
                     f"| **Algorithm:** Ed25519")
        return "\n".join(lines)


# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
#  3. TrustChainComplianceCheck
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━


class TrustChainComplianceCheck(BaseTool):
    """Run a formal compliance assessment against a regulatory framework
    (SOC2, HIPAA, FDA 21 CFR Part 11, or GDPR) and return a signed
    compliance report with a score.  Use this when the user asks about
    regulatory compliance, audit readiness, or certification status."""

    framework: str = Field(
        ...,
        description="Compliance framework to check.  "
                    "One of: soc2, hipaa, fda, gdpr.",
    )

    async def run(self, context: Optional[ToolContext] = None) -> str:
        mods = _get_pro_modules()
        compliance = mods.get("compliance")
        if compliance is None:
            return ("[WARN] Compliance module not available.  "
                    "Requires TrustChain Pro license (Enterprise tier).")

        try:
            report = await compliance.generate_report(self.framework)
            score = report.get("score", "N/A") if isinstance(report, dict) else report
            return (
                f"## Compliance Report — {self.framework.upper()}\n\n"
                f"| Metric | Value |\n|---|---|\n"
                f"| **Framework** | {self.framework.upper()} |\n"
                f"| **Score** | **{score}** |\n"
                f"| **Status** | {'PASS' if (isinstance(score, (int, float)) and score >= 80) else 'Review needed'} |\n"
            )
        except Exception as e:
            return f"[ERROR] Compliance check failed: {e}"


# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
#  4. TrustChainChainStatus
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━


class TrustChainChainStatus(BaseTool):
    """Show the current status of the cryptographic chain of trust:
    total signed operations, Merkle root, chain integrity, and key info.
    Use this when the user asks about chain status, trust status,
    how many operations are signed, or the overall security posture."""

    async def run(self, context: Optional[ToolContext] = None) -> str:
        _tc, operations = _get_tc()

        total = len(operations)
        if total == 0:
            return "Chain is empty -- no operations recorded yet."

        last = operations[-1]
        key_id = last.get("key_id", "—")
        algo = last.get("algorithm", "Ed25519")

        # Check chain integrity (each op's parent matches previous signature)
        broken_links = 0
        for i in range(1, total):
            expected_parent = operations[i - 1].get("signature")
            actual_parent = operations[i].get("parent_signature")
            if expected_parent and actual_parent and expected_parent != actual_parent:
                broken_links += 1

        integrity = "Intact" if broken_links == 0 else f"WARN: {broken_links} broken link(s)"

        return (
            f"## Chain of Trust Status\n\n"
            f"| Metric | Value |\n|---|---|\n"
            f"| **Total Operations** | {total} |\n"
            f"| **Chain Integrity** | {integrity} |\n"
            f"| **Key ID** | `{key_id}` |\n"
            f"| **Algorithm** | {algo} |\n"
            f"| **Last Tool** | `{last.get('tool', '—')}` |\n"
            f"| **Last Signature** | `{last.get('signature', '—')[:24]}…` |\n"
        )


# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
#  5. TrustChainExecutionGraph
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━


class TrustChainExecutionGraph(BaseTool):
    """Export the Directed Acyclic Graph (DAG) of all tool executions in the
    current session, showing the forensic reasoning trail with parent-child
    relationships between calls.  Use this when the user wants to visualize
    the agent's execution path, understand decision flow, or audit the
    reasoning chain."""

    format: str = Field(
        "markdown",
        description="Output format: 'markdown' (table) or 'mermaid' (diagram).",
    )

    async def run(self, context: Optional[ToolContext] = None) -> str:
        _, operations = _get_tc()

        if not operations:
            return "No operations recorded -- graph is empty."

        if self.format == "mermaid":
            lines = ["## Execution Graph (Mermaid)\n", "```mermaid", "graph TD"]
            for i, op in enumerate(operations):
                tool = op.get("tool", f"op_{i}")
                node_id = f"n{i}"
                sig = op.get("signature", "")[:8]
                lines.append(f'    {node_id}["{tool}<br/>{sig}…"]')
                if i > 0:
                    lines.append(f"    n{i-1} --> {node_id}")
            lines.append("```")
            return "\n".join(lines)
        else:
            lines = [
                f"## Execution Graph — {len(operations)} nodes\n",
                "| Step | Tool | Signature | Parent → |",
                "|---|---|---|---|",
            ]
            for i, op in enumerate(operations):
                tool = op.get("tool", "?")
                sig = op.get("signature", "—")[:16]
                parent = (op.get("parent_signature") or "genesis")[:16]
                lines.append(f"| {i+1} | `{tool}` | `{sig}…` | `{parent}…` |")
            return "\n".join(lines)


# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
#  6. TrustChainAnalyticsSnapshot
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━


class TrustChainAnalyticsSnapshot(BaseTool):
    """Get a snapshot of tool-execution analytics: which tools were called,
    how many times, average latency, and success rate.  Use this when the
    user asks about performance, tool usage statistics, or wants a
    breakdown of agent activity."""

    async def run(self, context: Optional[ToolContext] = None) -> str:
        mods = _get_pro_modules()
        analytics = mods.get("analytics")

        if analytics is None:
            # Fall back to counting from raw operations
            _, operations = _get_tc()
            if not operations:
                return "No operations recorded yet."

            from collections import Counter
            tool_counts = Counter(op.get("tool", "?") for op in operations)
            lines = [
                f"## Analytics Snapshot — {len(operations)} total operations\n",
                "| Tool | Calls |",
                "|---|---|",
            ]
            for tool, count in tool_counts.most_common():
                lines.append(f"| `{tool}` | {count} |")
            return "\n".join(lines)

        try:
            snapshot = analytics.get_snapshot()
            if isinstance(snapshot, dict):
                lines = [
                    "## Analytics Snapshot (TrustChain Pro)\n",
                    "| Metric | Value |",
                    "|---|---|",
                ]
                for k, v in snapshot.items():
                    lines.append(f"| **{k}** | {v} |")
                return "\n".join(lines)
            return f"## Analytics\n\n{snapshot}"
        except Exception as e:
            return f"[ERROR] Analytics snapshot failed: {e}"


# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
#  7. TrustChainRunbook — YAML workflow executor (SOAR)
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

# Map short names used in YAML → actual BaseTool classes
_TOOL_ALIASES: dict[str, type["BaseTool"]] = {}


def _get_tool_aliases() -> dict[str, type["BaseTool"]]:
    """Lazy-build alias map so all classes are defined first."""
    if not _TOOL_ALIASES:
        _TOOL_ALIASES.update({
            # Short YAML names → classes
            "verify":           TrustChainVerify,
            "tc_verify":        TrustChainVerify,
            "audit_report":     TrustChainAuditReport,
            "tc_audit":         TrustChainAuditReport,
            "compliance":       TrustChainComplianceCheck,
            "tc_compliance":    TrustChainComplianceCheck,
            "chain_status":     TrustChainChainStatus,
            "tc_chain_status":  TrustChainChainStatus,
            "execution_graph":  TrustChainExecutionGraph,
            "tc_graph":         TrustChainExecutionGraph,
            "analytics":        TrustChainAnalyticsSnapshot,
            "tc_analytics":     TrustChainAnalyticsSnapshot,
            # Full class names also work
            "TrustChainVerify":           TrustChainVerify,
            "TrustChainAuditReport":      TrustChainAuditReport,
            "TrustChainComplianceCheck":  TrustChainComplianceCheck,
            "TrustChainChainStatus":      TrustChainChainStatus,
            "TrustChainExecutionGraph":   TrustChainExecutionGraph,
            "TrustChainAnalyticsSnapshot": TrustChainAnalyticsSnapshot,
        })
    return _TOOL_ALIASES


class TrustChainRunbook(BaseTool):
    """Execute a YAML-defined security runbook (Standard Operating Procedure).
    Each step in the runbook calls a registered TrustChain tool with specified
    parameters.  Use this when the user provides a YAML workflow, asks to run
    an audit playbook, or wants to execute a multi-step security procedure.

    Example YAML:
      name: "SOC2 Nightly Audit"
      workflow:
        - step: 1
          action: "Check chain integrity"
          tool: "chain_status"
        - step: 2
          action: "Run SOC2 compliance"
          tool: "compliance"
          params:
            framework: "soc2"
        - step: 3
          action: "Generate audit report"
          tool: "audit_report"

    Available tools: verify, audit_report, compliance, chain_status,
    execution_graph, analytics."""

    yaml_content: str = Field(
        ...,
        description="YAML runbook content defining the workflow steps.  "
                    "Each step must have 'tool' (tool name) and optionally "
                    "'params' (dict of parameters) and 'condition' ('always' "
                    "or 'on_success').",
    )

    async def run(self, context: Optional[ToolContext] = None) -> str:
        import yaml as _yaml

        # Parse YAML
        try:
            runbook = _yaml.safe_load(self.yaml_content)
        except Exception as e:
            return f"[ERROR] Invalid YAML: {e}"

        if not isinstance(runbook, dict):
            return "[ERROR] Runbook must be a YAML mapping with 'workflow' key."

        name = runbook.get("name", "Unnamed Runbook")
        description = runbook.get("description", "")
        steps = runbook.get("workflow", [])

        if not steps:
            return "[ERROR] Runbook has no workflow steps."

        aliases = _get_tool_aliases()
        results: list[str] = [
            f"## Runbook: {name}\n",
        ]
        if description:
            results.append(f"_{description}_\n")
        results.append(f"**Steps:** {len(steps)}\n")
        results.append("---\n")

        all_passed = True
        for step_def in steps:
            step_num = step_def.get("step", "?")
            action = step_def.get("action", f"Step {step_num}")
            tool_name = step_def.get("tool") or step_def.get("require_tool", "")
            params = step_def.get("params", {})
            condition = step_def.get("condition", "on_success")

            # Skip if previous failed and condition is not "always"
            if not all_passed and condition != "always":
                results.append(
                    f"### Step {step_num}: {action}\n"
                    f"**Skipped** (previous step failed)\n\n---\n"
                )
                continue

            # Resolve tool
            tool_cls = aliases.get(tool_name)
            if tool_cls is None:
                results.append(
                    f"### Step {step_num}: {action}\n"
                    f"[ERROR] **Unknown tool:** `{tool_name}`\n"
                    f"Available: {', '.join(sorted(set(aliases.keys())))}\n\n---\n"
                )
                all_passed = False
                continue

            # Execute tool
            try:
                tool_instance = tool_cls(**params)
                output = await tool_instance.run(context=context)
                results.append(
                    f"### Step {step_num}: {action}\n"
                    f"`{tool_name}` -> OK\n\n"
                    f"{output}\n\n---\n"
                )
            except Exception as e:
                results.append(
                    f"### Step {step_num}: {action}\n"
                    f"`{tool_name}` -> FAILED: {e}\n\n---\n"
                )
                all_passed = False

        # Summary
        status = "All steps passed" if all_passed else "Some steps failed"
        results.append(f"\n**Result:** {status}")

        return "\n".join(results)

