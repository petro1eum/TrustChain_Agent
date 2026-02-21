import os
import re
from typing import Any, Dict, List, Optional
from pydantic import Field
from backend.tools.base_tool import BaseTool

class KnowledgeSynthesisTool(BaseTool):
    """
    Formally records a successful workflow, solution, or standard operating procedure into
    a persistent Markdown Knowledge Unit (.md file). This allows future agent sessions to
    automatically discover and utilize this knowledge when facing similar tasks.
    """
    
    title: str = Field(..., description="A short, descriptive title for the knowledge unit. Used for the filename (e.g., 'Bypassing JWT Authentication Locally').")
    description: str = Field(..., description="A 1-2 sentence description explaining what problem this knowledge unit solves.")
    tags: List[str] = Field(..., description="An array of 3-5 lowercase string keywords used for semantic routing and discovery (e.g., ['auth', 'jwt', 'testing']).")
    context: str = Field(..., description="Background information, symptoms of the problem, or the environment where this applies.")
    solution_steps: str = Field(..., description="A Markdown-formatted string containing the step-by-step resolution or explanation.")
    executable_action: Optional[str] = Field(None, description="(Optional) A specifically formatted bash shell command block (e.g., `npm install X`) that can be run to apply the fix automatically.")

    async def run(self, context=None, **kwargs) -> Any:
        title = self.title
        description = self.description
        tags = self.tags
        context = self.context
        solution_steps = self.solution_steps
        executable_action = self.executable_action
        
        # Sanitize title for filename
        safe_title = re.sub(r'[^a-zA-Z0-9_\-\.]', '_', title.lower())
        filename = f"{safe_title}.md"
        
        # Define the knowledge directory in the project root
        knowledge_dir = os.path.join(os.getcwd(), ".tc_knowledge")
        os.makedirs(knowledge_dir, exist_ok=True)
        
        filepath = os.path.join(knowledge_dir, filename)
        
        # Format the tags for YAML frontmatter
        yaml_tags = "\n".join([f"  - {tag}" for tag in tags])
        
        content = f"""---
title: "{title}"
description: "{description}"
tags:
{yaml_tags}
author: "TrustChain Agent Synthesis"
---
# {title}

## Context
{context}

## Solution
{solution_steps}
"""
        
        if executable_action:
            content += f"""
## Executable Action
To apply this setup automatically:
```bash
# // turbo
{executable_action}
```
"""
            
        try:
            # --- TrustChain Cryptographic Signing ---
            import hashlib
            from backend.routers.trustchain_api import _tc
            
            content_hash = hashlib.sha256(content.encode('utf-8')).hexdigest()
            # TrustChain v0.1.0 sign method signature: (tool_id, data, ...) -> SignedResponse
            signed_response = _tc.sign("knowledge_synthesis", content_hash)
            signature_b64 = signed_response.signature
            
            # Inject signature into frontmatter
            final_content = content.replace("---\ntitle:", f"---\ntc_signature: \"{signature_b64}\"\ntitle:")
            
            with open(filepath, "w", encoding="utf-8") as f:
                f.write(final_content)
            
            return {
                "status": "success",
                "message": f"Knowledge unit successfully synthesized and cryptographically signed.",
                "filepath": filepath,
                "title": title
            }
        except Exception as e:
            return {
                "status": "error",
                "error": f"Failed to save knowledge unit: {str(e)}"
            }

class WriteMemoryTool(BaseTool):
    """
    Writes a value to the persistent Cross-Agent Collective Memory. 
    Use this to share important discoveries, API keys, or task context with other subagents 
    running in parallel or in the future.
    """
    key: str = Field(..., description="The unique key to store the information under (e.g., 'discovered_api_key', 'user_preferences').")
    value: str = Field(..., description="The information to store. Can be a string, JSON, or markdown.")

    async def run(self, context=None, **kwargs) -> Any:
        from backend.tools.agent_runtime import set_collective_memory
        set_collective_memory(self.key, self.value)
        return {"status": "success", "message": f"Value stored in collective memory under key: '{self.key}'"}

class ReadMemoryTool(BaseTool):
    """
    Reads a value from the persistent Cross-Agent Collective Memory.
    Use this to retrieve context, shared variables, or discoveries made by other subagents.
    You can read a specific key, or read the key 'all' to get a list of all available keys.
    """
    key: str = Field(..., description="The key to retrieve. Use 'all' to get a list of all populated keys.")

    async def run(self, context=None, **kwargs) -> Any:
        from backend.tools.agent_runtime import get_collective_memory
        mem = get_collective_memory()
        
        if self.key.lower() == 'all':
            return {"status": "success", "available_keys": list(mem.keys())}
            
        if self.key in mem:
            return {"status": "success", "value": mem[self.key]}
        else:
            return {"status": "not_found", "message": f"Key '{self.key}' does not exist in collective memory."}

