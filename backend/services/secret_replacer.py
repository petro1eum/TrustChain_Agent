"""
Secret Replacer — Late-Binding Vault Token Middleware with URL Allowlist Guard.

SECURITY MODEL:
  Layer 1 — Late-Binding:
    VaultReadTool returns {{VAULT:secret_name}} placeholder tokens.
    The LLM agent never sees raw plaintext secrets.

  Layer 2 — URL Allowlist Guard (apply_guarded):
    After substituting tokens, all destination URLs in the command/payload
    are validated against VAULT_ALLOWED_DOMAINS.
    If any URL targets an unauthorized domain, execution is ABORTED before
    the subprocess or HTTP call is made — even if an attacker tricks the LLM.

Environment variables:
  VAULT_ALLOWED_DOMAINS — comma-separated list of allowed hostnames.
    Example: "api.stripe.com,api.salesforce.com,api.sendgrid.com,hooks.slack.com"
    If NOT set: dev mode — domains are unrestricted (log warning only).
    In production: ALWAYS set this to the minimum necessary surface.

Pattern: {{VAULT:secret_name}}
  - Unresolved tokens are replaced with VAULT_SECRET_NOT_FOUND(name).
  - Unresolved tokens DO trigger the URL guard (fail visible > fail silent).
"""

import os
import re
from urllib.parse import urlparse

_VAULT_TOKEN_RE = re.compile(r"\{\{VAULT:([a-zA-Z0-9_\-\.]+)\}\}")
_URL_RE = re.compile(r'https?://[^\s\'"\\>]+', re.IGNORECASE)


# ─── Layer 1: Token Substitution ──────────────────────────────────────────────

def apply(text: str) -> str:
    """
    Replaces all {{VAULT:name}} tokens with the decrypted plaintext IN MEMORY.
    No URL validation — use apply_guarded() in production execution paths.
    """
    if "{{VAULT:" not in text:
        return text  # Fast-path: zero overhead when no tokens present

    from backend.database.vault_db import reveal_secret  # Lazy import — no circular deps

    def _replace(match: re.Match) -> str:
        plaintext = reveal_secret(match.group(1))
        if plaintext is None:
            return f"VAULT_SECRET_NOT_FOUND({match.group(1)})"
        return plaintext  # Plaintext lives only in this stack frame

    return _VAULT_TOKEN_RE.sub(_replace, text)


# ─── Layer 2: URL Allowlist Guard ─────────────────────────────────────────────

class VaultExfiltrationError(RuntimeError):
    """
    Raised when a substituted command attempts to contact an unauthorized domain.
    This stops prompt injection attacks that try to send secrets to attacker servers.
    """


def _load_allowed_domains() -> frozenset[str]:
    raw = os.environ.get("VAULT_ALLOWED_DOMAINS", "").strip()
    if not raw:
        return frozenset()  # Empty = dev mode (unrestricted)
    return frozenset(d.strip().lower() for d in raw.split(",") if d.strip())


def _hostname_is_allowed(hostname: str, allowed: frozenset[str]) -> bool:
    """True if hostname exactly matches or is a subdomain of an allowed domain."""
    h = hostname.lower().split(":")[0]  # Strip port
    return any(h == d or h.endswith("." + d) for d in allowed)


def apply_guarded(text: str) -> str:
    """
    Layer 1 + Layer 2: substitute tokens THEN validate all outbound URLs.

    If VAULT_ALLOWED_DOMAINS is set and the substituted command contains a URL
    with a hostname NOT in the allowlist, raises VaultExfiltrationError.

    Use this in all tool execution paths (PersistentShellTool, OpenAPI calls, etc.)
    """
    had_tokens = "{{VAULT:" in text

    # — Layer 1: substitute —
    substituted = apply(text)

    if not had_tokens:
        return substituted  # No vault tokens were used — skip URL guard

    # — Layer 2: URL guard —
    allowed = _load_allowed_domains()
    if not allowed:
        # Dev mode: no allowlist configured — warn but allow
        import warnings
        warnings.warn(
            "⚠️  VAULT: VAULT_ALLOWED_DOMAINS not set. "
            "Vault secrets can be sent to ANY domain. "
            "Set VAULT_ALLOWED_DOMAINS in production!",
            RuntimeWarning,
            stacklevel=2
        )
        return substituted

    urls = _URL_RE.findall(substituted)
    for raw_url in urls:
        try:
            parsed = urlparse(raw_url)
            hostname = parsed.hostname or ""
        except Exception:
            continue
        if hostname and not _hostname_is_allowed(hostname, allowed):
            raise VaultExfiltrationError(
                f"🚫 VAULT SECURITY VIOLATION: command attempts to contact "
                f"unauthorized domain '{hostname}'.\n"
                f"Allowed domains: {', '.join(sorted(allowed))}\n"
                f"This request has been blocked. To authorize this domain, "
                f"add it to the VAULT_ALLOWED_DOMAINS environment variable."
            )

    return substituted


# ─── Utility helpers ──────────────────────────────────────────────────────────

def scan_for_tokens(text: str) -> list[str]:
    """Returns list of {{VAULT:name}} token names found (no decryption)."""
    return _VAULT_TOKEN_RE.findall(text)


def redact(text: str) -> str:
    """Replaces {{VAULT:...}} tokens with [VAULT:name:REDACTED] for safe logging."""
    return _VAULT_TOKEN_RE.sub(lambda m: f"[VAULT:{m.group(1)}:REDACTED]", text)
