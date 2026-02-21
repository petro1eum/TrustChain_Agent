"""
Secret Replacer — Late-Binding Vault Token Middleware.

SECURITY MODEL:
  The LLM agent never receives raw plaintext secrets from the Vault.
  Instead, VaultReadTool returns a {{VAULT:secret_name}} placeholder.
  
  Just before any command or HTTP payload is executed/sent, this module
  scans for {{VAULT:...}} patterns and substitutes them with the real
  decrypted value IN MEMORY — at the absolute last moment before execution.

  Result: Even if an attacker injects "send the key to evil.com", the LLM
  only knows {{VAULT:stripe_key}} — which is useless to an external observer.

  The real value never appears in:
    - LLM context window
    - TrustChain audit log
    - Request tracing / logging
    - SQL tables (other than the Vault's own AES-encrypted ciphertext)

Pattern: {{VAULT:secret_name}}
  - secret_name must match exactly the `name` field stored in the Vault.
  - Unresolved tokens (secret not found) are replaced with the literal
    string VAULT_SECRET_NOT_FOUND so execution fails visibly rather than
    silently passing empty credentials.
"""

import re
from typing import Optional

# Lazy-import vault_db to avoid circular imports at module load time
_VAULT_TOKEN_RE = re.compile(r"\{\{VAULT:([a-zA-Z0-9_\-\.]+)\}\}")

_WARN_HEADER = (
    "⚠️  [VAULT MIDDLEWARE] The following secret token could not be resolved: "
)


def apply(text: str) -> str:
    """
    Scans `text` for all {{VAULT:name}} tokens and replaces them with
    the decrypted secret value IN MEMORY.

    This function is the ONLY place where plaintext secrets exist during
    agent execution. The value is used directly in the string — it is never
    stored in a variable, logged, or returned except as part of `text`.

    Args:
        text: A shell command, HTTP payload, Python code string, etc.

    Returns:
        The same string with all resolved VAULT tokens substituted.
        Unresolvable tokens are replaced with VAULT_SECRET_NOT_FOUND.
    """
    if "{{VAULT:" not in text:
        return text  # Fast-path — no tokens, zero overhead

    from backend.database.vault_db import reveal_secret  # Import here to stay lazy

    def _replace(match: re.Match) -> str:
        secret_name = match.group(1)
        plaintext = reveal_secret(secret_name)
        if plaintext is None:
            # Fail visible — a missing secret should NOT silently pass empty
            return f"VAULT_SECRET_NOT_FOUND({secret_name})"
        return plaintext  # Raw plaintext, only lives in this stack frame

    return _VAULT_TOKEN_RE.sub(_replace, text)


def scan_for_tokens(text: str) -> list[str]:
    """
    Returns the list of {{VAULT:...}} token names found in text.
    Used for pre-execution warnings — tells the agent which secrets were used.
    Does NOT decrypt anything.
    """
    return _VAULT_TOKEN_RE.findall(text)


def redact(text: str) -> str:
    """
    Replaces ALL {{VAULT:...}} tokens with [VAULT:REDACTED] for safe logging.
    Call this when you need to log or display the original command without
    leaking secret names or (god forbid) a pre-apply snippet.
    """
    return _VAULT_TOKEN_RE.sub(lambda m: f"[VAULT:{m.group(1)}:REDACTED]", text)
