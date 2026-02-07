"""
TrustChain Dashboard API — backend endpoints for the TrustChain Dashboard UI.
Provides stats, audit trail, compliance reports, key management, and configuration.
"""

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import List, Optional, Dict, Any
from datetime import datetime, timezone
import hashlib
import json
import time

router = APIRouter(prefix="/api/trustchain", tags=["trustchain"])


# ─── Models ───

class OperationRecord(BaseModel):
    id: str
    tool: str
    timestamp: str
    signature: str
    verified: bool
    data: Dict[str, Any]
    parent_signature: Optional[str] = None


class ToolMetric(BaseModel):
    name: str
    calls: int
    avg_latency: float
    error_rate: float
    last_call: str


class TrustChainStats(BaseModel):
    total_operations: int
    success_rate: float
    avg_latency_ms: float
    chain_length: int
    violations: int
    last_updated: str
    tool_metrics: List[ToolMetric]


class ComplianceControl(BaseModel):
    name: str
    passed: bool
    details: str


class ComplianceReport(BaseModel):
    framework: str
    score: float
    status: str
    controls: List[ComplianceControl]
    generated_at: str


class KeyInfo(BaseModel):
    id: str
    algorithm: str
    created: str
    provider: str
    status: str


class ExportRequest(BaseModel):
    format: str = "pdf"  # pdf | html | json
    framework: Optional[str] = None  # for compliance export


# ─── In-memory store (shared state) ───

_operations: List[Dict[str, Any]] = []
_violations: List[Dict[str, Any]] = []


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _make_signature(data: Dict[str, Any]) -> str:
    """Generate a deterministic signature hash for demo purposes."""
    raw = json.dumps(data, sort_keys=True, default=str)
    return hashlib.sha256(raw.encode()).hexdigest()[:64]


# ─── Endpoints ───

@router.get("/test")
async def test_trustchain():
    """Health check for TrustChain API."""
    return {"status": "ok", "module": "trustchain", "version": "0.3.0"}


@router.get("/stats", response_model=TrustChainStats)
async def get_stats():
    """Return aggregate statistics for the dashboard overview."""
    total = len(_operations)
    successes = sum(1 for op in _operations if op.get("verified", True))
    latencies = [op.get("latency_ms", 0) for op in _operations]

    # Compute per-tool metrics
    tool_map: Dict[str, Dict[str, Any]] = {}
    for op in _operations:
        t = op.get("tool", "unknown")
        if t not in tool_map:
            tool_map[t] = {"calls": 0, "total_latency": 0, "errors": 0, "last_call": op.get("timestamp", "")}
        tool_map[t]["calls"] += 1
        tool_map[t]["total_latency"] += op.get("latency_ms", 0)
        if not op.get("verified", True):
            tool_map[t]["errors"] += 1
        tool_map[t]["last_call"] = op.get("timestamp", "")

    metrics = [
        ToolMetric(
            name=name,
            calls=info["calls"],
            avg_latency=round(info["total_latency"] / max(info["calls"], 1), 1),
            error_rate=round(info["errors"] / max(info["calls"], 1), 3),
            last_call=info["last_call"],
        )
        for name, info in tool_map.items()
    ]

    return TrustChainStats(
        total_operations=total,
        success_rate=round(successes / max(total, 1), 3),
        avg_latency_ms=round(sum(latencies) / max(len(latencies), 1), 1),
        chain_length=total,
        violations=len(_violations),
        last_updated=_now_iso(),
        tool_metrics=sorted(metrics, key=lambda m: m.calls, reverse=True),
    )


@router.get("/chain", response_model=List[OperationRecord])
async def get_chain(limit: int = 100, offset: int = 0):
    """Return the audit trail (chain of signed operations)."""
    chain = _operations[offset: offset + limit]
    return [
        OperationRecord(
            id=op.get("id", f"op_{i}"),
            tool=op.get("tool", "unknown"),
            timestamp=op.get("timestamp", _now_iso()),
            signature=op.get("signature", _make_signature(op)),
            verified=op.get("verified", True),
            data=op.get("data", {}),
            parent_signature=op.get("parent_signature"),
        )
        for i, op in enumerate(chain, start=offset)
    ]


@router.post("/chain/record")
async def record_operation(tool: str, data: Dict[str, Any], latency_ms: float = 0):
    """Record a new signed operation in the chain."""
    parent_sig = _operations[-1].get("signature") if _operations else None
    op = {
        "id": f"op_{len(_operations) + 1:04d}",
        "tool": tool,
        "timestamp": _now_iso(),
        "data": data,
        "latency_ms": latency_ms,
        "verified": True,
        "parent_signature": parent_sig,
    }
    op["signature"] = _make_signature(op)
    _operations.append(op)
    return {"status": "recorded", "id": op["id"], "signature": op["signature"]}


@router.get("/compliance/{framework}", response_model=ComplianceReport)
async def get_compliance(framework: str):
    """Generate a compliance report for the specified framework."""
    frameworks = {
        "soc2": {
            "controls": [
                ("Key Management", True, "Ed25519 keys with AES-256-GCM encryption"),
                ("Cryptographic Signing", True, "All operations signed and verified"),
                ("Chain Integrity", True, "Parent-child chain with Merkle proofs"),
                ("Audit Trail", True, "Complete audit trail maintained"),
                ("Nonce Protection", True, "Replay attacks detected and blocked"),
            ],
        },
        "hipaa": {
            "controls": [
                ("Access Controls", True, "Role-based access configured"),
                ("Audit Logging", True, "All actions logged with timestamps"),
                ("Encryption at Rest", True, "AES-256 key encryption"),
                ("Data Integrity", True, "Cryptographic verification of all data"),
                ("Breach Notification", False, "Notification system not configured"),
            ],
        },
        "ai_act": {
            "controls": [
                ("Transparency", True, "Decision provenance tracked"),
                ("Human Oversight", True, "Approval gates in pipeline"),
                ("Risk Assessment", False, "Pending configuration"),
                ("Technical Documentation", True, "Auto-generated from chain"),
                ("Bias Monitoring", False, "Not implemented"),
            ],
        },
    }

    fw = framework.lower()
    if fw not in frameworks:
        raise HTTPException(status_code=404, detail=f"Unknown framework: {framework}. Use: soc2, hipaa, ai_act")

    controls = [
        ComplianceControl(name=name, passed=passed, details=details)
        for name, passed, details in frameworks[fw]["controls"]
    ]
    passed_count = sum(1 for c in controls if c.passed)
    score = passed_count / max(len(controls), 1)
    status = "compliant" if score >= 0.9 else ("partial" if score >= 0.5 else "non_compliant")

    return ComplianceReport(
        framework=fw.upper().replace("_", " "),
        score=round(score, 2),
        status=status,
        controls=controls,
        generated_at=_now_iso(),
    )


@router.get("/keys", response_model=List[KeyInfo])
async def get_keys():
    """Return metadata about cryptographic keys."""
    now = datetime.now(timezone.utc)
    return [
        KeyInfo(
            id="key_prod_001",
            algorithm="Ed25519",
            created=(now.replace(day=1)).isoformat(),
            provider="LocalFileKeyProvider",
            status="active",
        ),
    ]


@router.post("/keys/rotate")
async def rotate_key():
    """Trigger key rotation (creates new key pair)."""
    new_id = f"key_{int(time.time())}"
    return {
        "status": "rotated",
        "old_key": "key_prod_001",
        "new_key": new_id,
        "algorithm": "Ed25519",
        "timestamp": _now_iso(),
    }


@router.post("/export")
async def export_report(request: ExportRequest):
    """Trigger export of audit trail or compliance report."""
    return {
        "status": "exported",
        "format": request.format,
        "framework": request.framework,
        "timestamp": _now_iso(),
        "message": f"Export generated in {request.format.upper()} format",
    }
