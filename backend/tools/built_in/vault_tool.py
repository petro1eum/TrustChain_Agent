"""
VaultReadTool — Agent Tool for in-memory secret injection.

When an agent needs a credential (e.g., Stripe API key), it calls this tool
with the secret name. The tool decrypts the value in RAM, returns it to the
agent's working context, and immediately discards the reference.

CRITICAL SECURITY NOTES:
  - The decrypted value is returned as part of the tool result.
  - TrustChain signatures WILL include the result hash — to prevent the actual
    key value from appearing in the chain, we return only a masked preview
    in the `chain_safe` field and put the raw value in `inject_as`.
  - Callers should use `inject_as` to construct the HTTP header and then
    discard the object immediately.
"""

from typing import Any, Optional
from pydantic import Field

from backend.tools.base_tool import BaseTool, ToolContext
from backend.database.vault_db import reveal_secret, list_secrets


class VaultReadTool(BaseTool):
    """
    Retrieves an encrypted credential from the Vault and decrypts it in RAM.
    Use this to get API keys, OAuth tokens, or passwords before making external HTTP calls.
    The plaintext value is returned ONLY in memory and should be used immediately.
    
    Example usage: retrieve the 'stripe_secret_key' credential before calling the Stripe API.
    """
    secret_name: str = Field(..., description="The name of the secret to retrieve (e.g. 'stripe_secret_key', 'salesforce_token')")

    async def run(self, context: Optional[ToolContext] = None, **kwargs) -> Any:
        plaintext = reveal_secret(self.secret_name)

        if plaintext is None:
            # List available names to help the agent recover
            available = [s["name"] for s in list_secrets()]
            return {
                "error": f"Secret '{self.secret_name}' not found in vault.",
                "available_secrets": available,
                "hint": "Use the exact name as stored. To add a new secret, use the Vault UI."
            }

        # Mask the value in the chain-safe preview (first 4 chars + *** )
        masked = plaintext[:4] + "*" * max(0, len(plaintext) - 4)

        return {
            "status": "decrypted",
            "secret_name": self.secret_name,
            "inject_as": plaintext,           # Raw value — use this for HTTP headers
            "chain_safe_preview": masked,      # This is what gets hashed into TrustChain
            "usage_hint": (
                f"Use inject_as as the value for your Authorization header or API key. "
                f"Example: headers={{\"Authorization\": \"Bearer {{inject_as}}\"}}"
            )
        }


class VaultListTool(BaseTool):
    """
    Lists the names and services of all credentials stored in the Vault.
    Use this before VaultReadTool to find the correct secret name.
    No plaintext values are exposed — only metadata.
    """

    async def run(self, context: Optional[ToolContext] = None, **kwargs) -> Any:
        secrets = list_secrets()
        if not secrets:
            return {
                "message": "No credentials stored in the Vault yet.",
                "hint": "Use the Vault UI (🔐 icon) to add credentials for external services."
            }
        return {
            "stored_credentials": [
                {"name": s["name"], "service": s["service"], "created": s["created_at"]}
                for s in secrets
            ],
            "count": len(secrets)
        }
