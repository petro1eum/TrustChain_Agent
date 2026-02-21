"""
GeminiMediaGeneratorTool — Generate images and videos using OpenRouter's Gemini integration.

These models (like google/gemini-3-pro-image-preview) return image URLs inside standard chat completions.
The frontend markdown parser will natively render these URLs as images.
"""

from typing import Any, Optional
from pydantic import Field
import os
import httpx

from backend.tools.base_tool import BaseTool, ToolContext

# In dev, the key is usually passed via OpenRouter, the agent already has its API key in OPENROUTER_API_KEY
class GeminiMediaGeneratorTool(BaseTool):
    """
    Generates high-quality images and media using Google's state-of-the-art models (Imagen 3 / Veo) 
    via OpenRouter integration.
    
    Returns standard Markdown `![Image](url)` which the TrustChain frontend will automatically render.
    """
    
    prompt: str = Field(
        ..., 
        description="Detailed description of the image or media you want to generate. Be specific about style, lighting, and composition."
    )
    model: str = Field(
        "google/gemini-3-pro-image-preview", 
        description="The Generation model to use. Options: 'google/gemini-3-pro-image-preview' (default, Imagen 3), 'google/gemini-2.5-flash-image'."
    )

    async def run(self, context: Optional[ToolContext] = None, **kwargs) -> Any:
        # Resolve API Key
        api_key = os.getenv("OPENROUTER_API_KEY")
        if not api_key:
            return {"error": "OPENROUTER_API_KEY environment variable is not set. Cannot access Gemini Image models."}

        # Ensure we only use allowed image models to prevent wasting text generation tokens
        allowed_models = ["google/gemini-3-pro-image-preview", "google/gemini-2.5-flash-image"]
        
        target_model = self.model
        if target_model not in allowed_models:
             target_model = allowed_models[0]

        headers = {
            "Authorization": f"Bearer {api_key}",
            "HTTP-Referer": "https://github.com/petro1eum/TrustChain", 
            "X-Title": "TrustChain Agent",
            "Content-Type": "application/json"
        }

        payload = {
            "model": target_model,
            "messages": [
                {"role": "user", "content": self.prompt}
            ]
        }

        try:
            async with httpx.AsyncClient(timeout=60.0) as client:
                response = await client.post(
                    "https://openrouter.ai/api/v1/chat/completions",
                    headers=headers,
                    json=payload
                )
                
            if response.status_code != 200:
                try:
                    err_json = response.json()
                    err_msg = err_json.get("error", {}).get("message", response.text)
                except Exception:
                    err_msg = response.text
                return {"error": f"OpenRouter API Error (HTTP {response.status_code}): {err_msg}"}
                
            data = response.json()
            
            # OpenRouter typically returns the image as a markdown URL in the content 
            # for these specific Gemini Image models
            if "choices" in data and len(data["choices"]) > 0:
                content = data["choices"][0]["message"].get("content", "")
                
                # If content is empty or unexpected, provide a raw debug fallback
                if not content.strip():
                     return {"error": "API returned an empty response. The prompt may violate safety guidelines or the preview model failed."}
                     
                return {
                    "status": "success",
                    "model": target_model,
                    "prompt": self.prompt,
                    "markdown_result": content,  # e.g., "![image](https://...)"
                    "instruction": "Output the `markdown_result` string exactly as it is in your Chat response so the user can see the image."
                }
            else:
                return {"error": "Unexpected JSON structure from OpenRouter", "raw_response": data}
                
        except Exception as e:
            return {"error": f"Failed to execute HTTP request: {str(e)}"}
