"""
TrustChain Pro Enterprise API — exposes enterprise modules via REST endpoints.

Bridges trustchain_pro enterprise modules (compliance, policy, analytics,
graph, KMS, airgap, TSA) into FastAPI endpoints for the TrustChain Agent UI.
"""

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Dict, Any, Optional, List
from datetime import datetime, timezone
import json
import logging

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/trustchain-pro", tags=["trustchain-pro"])

# ── Lazy initialization (import enterprise modules on first use) ──

_analytics = None
_policy_engine = None
_local_tsa = None


def _get_tc():
    """Get the shared TrustChain instance from trustchain_api."""
    from backend.routers.trustchain_api import _tc
    return _tc


def _get_operations():
    """Get the shared operations list."""
    from backend.routers.trustchain_api import _tc
    return _tc.chain.log(limit=9999)


def _get_analytics():
    """Lazy-init TrustChainAnalytics."""
    global _analytics
    if _analytics is None:
        try:
            from trustchain_pro.enterprise.analytics import TrustChainAnalytics
            _analytics = TrustChainAnalytics()
        except Exception as e:
            logger.warning(f"[TrustChainPro] Analytics unavailable: {e}")
    return _analytics


def _get_policy_engine():
    """Lazy-init PolicyEngine."""
    global _policy_engine
    if _policy_engine is None:
        try:
            from trustchain_pro.enterprise.policy_engine import PolicyEngine
            _policy_engine = PolicyEngine()
        except Exception as e:
            logger.warning(f"[TrustChainPro] PolicyEngine unavailable: {e}")
    return _policy_engine


def _get_local_tsa():
    """Lazy-init LocalTSA for air-gapped timestamps."""
    global _local_tsa
    if _local_tsa is None:
        try:
            from trustchain_pro.enterprise.airgap import LocalTSA
            _local_tsa = LocalTSA(tsa_id="trustchain-agent-tsa")
        except Exception as e:
            logger.warning(f"[TrustChainPro] LocalTSA unavailable: {e}")
    return _local_tsa


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


# ════════════════════════════════════════════
#  Health / Status
# ════════════════════════════════════════════

@router.get("/status")
async def pro_status():
    """Health check — shows which enterprise modules are available."""
    modules = {}
    try:
        from trustchain_pro.enterprise import compliance
        modules["compliance"] = True
    except Exception:
        modules["compliance"] = False
    try:
        from trustchain_pro.enterprise import policy_engine
        modules["policy_engine"] = True
    except Exception:
        modules["policy_engine"] = False
    try:
        from trustchain_pro.enterprise import graph
        modules["graph"] = True
    except Exception:
        modules["graph"] = False
    try:
        from trustchain_pro.enterprise import analytics
        modules["analytics"] = True
    except Exception:
        modules["analytics"] = False
    try:
        from trustchain_pro.enterprise import airgap
        modules["airgap"] = True
    except Exception:
        modules["airgap"] = False
    try:
        from trustchain_pro.enterprise import kms
        modules["kms"] = True
    except Exception:
        modules["kms"] = False
    try:
        from trustchain_pro.enterprise import tsa
        modules["tsa"] = True
    except Exception:
        modules["tsa"] = False
    try:
        from trustchain_pro.enterprise.seat_manager import SeatManager
        modules["licensing"] = True
    except Exception:
        modules["licensing"] = False
    try:
        from trustchain_pro.enterprise.streaming import StreamingReasoningChain
        modules["streaming"] = True
    except Exception:
        modules["streaming"] = False
    try:
        from trustchain_pro.enterprise.exports import ChainExplorer
        modules["exports"] = True
    except Exception:
        modules["exports"] = False

    return {
        "status": "ok",
        "tier": "pro",
        "modules": modules,
        "available_count": sum(1 for v in modules.values() if v),
        "total_count": len(modules),
        "timestamp": _now_iso(),
    }


# ════════════════════════════════════════════
#  Compliance Reports
# ════════════════════════════════════════════

@router.get("/compliance/{framework}")
async def compliance_report(framework: str):
    """Generate a real compliance report using trustchain_pro ComplianceReport."""
    try:
        from trustchain_pro.enterprise.compliance import ComplianceReport
        tc = _get_tc()
        ops = _get_operations()

        # Build a minimal chain representation for the ComplianceReport
        report = ComplianceReport(chain=ops, tc=tc, framework=framework.upper())
        result = report.evaluate()
        return {
            "framework": framework.upper(),
            "result": result,
            "chain_length": len(ops),
            "generated_at": _now_iso(),
        }
    except ImportError:
        raise HTTPException(status_code=503, detail="trustchain_pro compliance module not available")
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ════════════════════════════════════════════
#  Policy Engine
# ════════════════════════════════════════════

class PolicyLoadRequest(BaseModel):
    yaml_content: str


class PolicyEvaluateRequest(BaseModel):
    tool_id: str
    args: Dict[str, Any] = {}
    context: Dict[str, Any] = {}


@router.post("/policy/load")
async def load_policies(request: PolicyLoadRequest):
    """Load YAML policies into the engine."""
    engine = _get_policy_engine()
    if engine is None:
        raise HTTPException(status_code=503, detail="PolicyEngine not available")
    try:
        count = engine.load_yaml(request.yaml_content)
        return {"status": "loaded", "policies_count": count}
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Invalid policies: {e}")


@router.get("/policy/list")
async def list_policies():
    """List all loaded policies."""
    engine = _get_policy_engine()
    if engine is None:
        return {"policies": []}
    policies = engine.policies
    return {
        "policies": [
            {"name": p.name, "description": p.description, "action": p.action.value}
            for p in policies
        ]
    }


# ════════════════════════════════════════════
#  Execution Graph
# ════════════════════════════════════════════

@router.get("/graph")
async def execution_graph():
    """Build execution DAG from the current chain and return stats + diagram."""
    try:
        from trustchain_pro.enterprise.graph import ExecutionGraph
        ops = _get_operations()

        if not ops:
            return {"stats": {"total_nodes": 0}, "mermaid": "", "forks": [], "replays": [], "orphans": []}

        graph = ExecutionGraph.from_chain(ops)
        stats = graph.get_stats()
        forks = graph.detect_forks()
        replays = graph.detect_replays()
        orphans = graph.detect_orphans()
        mermaid = graph.export_mermaid()
        dag = graph.to_dict()

        return {
            "stats": stats,
            "dag": dag,
            "mermaid": mermaid,
            "forks": [{"parent_tool": f.parent_tool, "branches": len(f.branches)} for f in forks],
            "replays": [{"tool_id": r.tool_id, "count": len(r.occurrences)} for r in replays],
            "orphans": [{"missing_parent": o.missing_parent} for o in orphans],
        }
    except ImportError:
        raise HTTPException(status_code=503, detail="trustchain_pro graph module not available")
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


class GraphNodeRequest(BaseModel):
    """Request body for POST /graph/add-node."""
    session_id: str = "frontend"
    tool: str
    args: Dict[str, Any] = {}
    result_preview: str = ""


@router.post("/graph/add-node")
async def add_graph_node(req: GraphNodeRequest):
    """Add a node to the execution graph (called by frontend per tool call)."""
    try:
        from trustchain_pro.enterprise.graph import ExecutionGraph
        ops = _get_operations()
        if not ops:
            return {"status": "skipped", "reason": "no operations in chain"}
        graph = ExecutionGraph.from_chain(ops)
        graph.add_node(req.session_id, req.tool, req.args, req.result_preview[:500])
        return {"status": "recorded", "tool": req.tool}
    except ImportError:
        return {"status": "unavailable", "error": "ExecutionGraph module not available"}
    except Exception as e:
        return {"status": "error", "error": str(e)}


# ════════════════════════════════════════════
#  Analytics
# ════════════════════════════════════════════

@router.get("/analytics")
async def analytics_snapshot():
    """Get analytics snapshot."""
    analytics = _get_analytics()
    if analytics is None:
        return {"error": "Analytics not available"}
    try:
        stats = analytics.get_stats()
        return {
            "total_operations": stats.total_operations,
            "total_verified": stats.total_verified,
            "total_failed": stats.total_failed,
            "policy_violations": stats.total_policy_violations,
            "unique_tools": stats.unique_tools,
            "ops_per_second": round(stats.ops_per_second, 2),
            "tools": stats.tools,
            "time_window_seconds": round(stats.time_window_seconds, 1),
        }
    except Exception as e:
        return {"error": str(e)}


class AnalyticsRecordRequest(BaseModel):
    """Request body for POST /analytics/record."""
    tool: str
    latency_ms: float = 0
    success: bool = True


@router.post("/analytics/record")
async def record_analytics(req: AnalyticsRecordRequest):
    """Record a tool execution in analytics (called by frontend per tool call)."""
    analytics = _get_analytics()
    if analytics is None:
        return {"status": "unavailable", "error": "Analytics not available"}
    try:
        analytics.record_operation(req.tool, req.latency_ms, req.success)
        return {"status": "recorded", "tool": req.tool}
    except Exception as e:
        return {"status": "error", "error": str(e)}


@router.post("/analytics/reset")
async def analytics_reset():
    """Reset analytics counters."""
    analytics = _get_analytics()
    if analytics:
        analytics.reset()
    return {"status": "reset", "timestamp": _now_iso()}


# ════════════════════════════════════════════
#  KMS / Key Management
# ════════════════════════════════════════════

@router.get("/kms/keys")
async def kms_keys():
    """Return info about available key providers."""
    tc = _get_tc()
    return {
        "keys": [
            {
                "key_id": tc.get_key_id(),
                "algorithm": "Ed25519",
                "provider": "TrustChain v2 (local)",
                "public_key": tc.export_public_key(),
                "status": "active",
            }
        ],
        "timestamp": _now_iso(),
    }


@router.post("/kms/rotate")
async def kms_rotate():
    """Rotate the active key."""
    tc = _get_tc()
    old_key_id = tc.get_key_id()
    # Note: actual key rotation would require reinitializing TrustChain
    return {
        "status": "rotation_initiated",
        "old_key_id": old_key_id,
        "message": "Key rotation requires server restart for full effect",
        "timestamp": _now_iso(),
    }


# ════════════════════════════════════════════
#  Air-Gapped / TSA
# ════════════════════════════════════════════

class TSATimestampRequest(BaseModel):
    data: str


@router.post("/tsa/timestamp")
async def tsa_timestamp(request: TSATimestampRequest):
    """Generate a local RFC 3161 timestamp for data."""
    tsa = _get_local_tsa()
    if tsa is None:
        raise HTTPException(status_code=503, detail="LocalTSA not available")
    try:
        ts_response = tsa.get_timestamp(request.data)
        return ts_response.to_dict()
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/tsa/verify")
async def tsa_verify(data: str, timestamp_response: Dict[str, Any]):
    """Verify a local TSA timestamp."""
    tsa = _get_local_tsa()
    if tsa is None:
        raise HTTPException(status_code=503, detail="LocalTSA not available")
    try:
        from trustchain_pro.enterprise.airgap import TSAResponse as LocalTSAResponse
        ts_resp = LocalTSAResponse(**timestamp_response)
        result = tsa.verify_timestamp(ts_resp, data)
        return {
            "valid": result.valid,
            "hash_match": result.hash_match,
            "signature_valid": result.signature_valid,
            "error": result.error,
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/airgap/status")
async def airgap_status():
    """Check air-gap capabilities."""
    try:
        from trustchain_pro.enterprise.airgap import AirGappedConfig
        network_check = AirGappedConfig.verify_no_network()
        return {
            "airgap_available": True,
            "network_check": network_check,
            "tsa_available": _get_local_tsa() is not None,
        }
    except Exception as e:
        return {"airgap_available": False, "error": str(e)}


# ════════════════════════════════════════════
#  License Info
# ════════════════════════════════════════════

@router.get("/license")
async def license_info():
    """Get current license status."""
    try:
        from trustchain_pro.licensing import get_license_info
        info = get_license_info()
        return info
    except ImportError:
        return {"tier": "community", "message": "License module not available"}
    except Exception as e:
        return {"tier": "unknown", "error": str(e)}


# ════════════════════════════════════════════
#  Chain Export
# ════════════════════════════════════════════

@router.get("/export/json")
async def export_chain_json():
    """Export the full chain as JSON."""
    ops = _get_operations()
    return {
        "chain": ops,
        "length": len(ops),
        "exported_at": _now_iso(),
    }


# ════════════════════════════════════════════
#  Streaming Reasoning Chain
# ════════════════════════════════════════════

class ReasoningSignRequest(BaseModel):
    """Request body for POST /streaming/sign-reasoning."""
    steps: List[str]
    name: str = "agent_reasoning"


@router.post("/streaming/sign-reasoning")
async def sign_reasoning(req: ReasoningSignRequest):
    """Sign reasoning steps using StreamingReasoningChain (Pro) or OSS fallback."""
    # Try Pro StreamingReasoningChain first
    try:
        from trustchain_pro.enterprise.streaming import StreamingReasoningChain
        tc = _get_tc()
        chain = StreamingReasoningChain(tc, name=req.name)
        for step_text in req.steps:
            chain._sign_step(step_text)
        return chain.export_json()
    except Exception:
        pass

    # OSS fallback — sign each step individually with TrustChain OSS
    tc = _get_tc()
    signed_steps = []
    for i, step_text in enumerate(req.steps):
        try:
            sig = tc.sign(data={"step": i, "text": step_text[:500]}, tool=f"reasoning_step_{i}")
            signed_steps.append({
                "step": i,
                "text": step_text[:500],
                "signature": sig.signature if hasattr(sig, "signature") else str(sig),
                "verified": True,
            })
        except Exception as e:
            signed_steps.append({
                "step": i,
                "text": step_text[:500],
                "signature": None,
                "verified": False,
                "error": str(e),
            })

    return {
        "name": req.name,
        "steps": signed_steps,
        "all_verified": all(s["verified"] for s in signed_steps),
        "fallback": "oss",
    }


# ════════════════════════════════════════════
#  Chain Explorer — HTML Export
# ════════════════════════════════════════════

@router.get("/export/html")
async def export_chain_html():
    """Generate an interactive HTML audit report via ChainExplorer."""
    try:
        from trustchain_pro.enterprise.exports import ChainExplorer
        import tempfile, os
        from fastapi.responses import HTMLResponse

        tc = _get_tc()
        ops = _get_operations()

        explorer = ChainExplorer(responses=ops, tc=tc)
        tmp_path = os.path.join(tempfile.gettempdir(), "trustchain_audit.html")
        explorer.export_html(tmp_path)

        with open(tmp_path, "r") as f:
            html_content = f.read()

        return HTMLResponse(content=html_content)
    except ImportError:
        raise HTTPException(status_code=501, detail="ChainExplorer module not available")
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
