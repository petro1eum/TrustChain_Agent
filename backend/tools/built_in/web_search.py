from typing import Optional, Any
from pydantic import Field
import asyncio
import json

from backend.tools.base_tool import BaseTool, ToolContext

class WebSearchTool(BaseTool):
    """
    Perform a web search using DuckDuckGo to find real-time information, URLs, and documentation.
    Use this when you need up-to-date facts or external knowledge.
    """
    
    query: str = Field(..., description="The search query.")
    max_results: int = Field(5, description="Maximum number of results to return (1-10).")

    async def run(self, context: Optional[ToolContext] = None) -> Any:
        try:
            from duckduckgo_search import DDGS
        except ImportError:
            return {"error": "duckduckgo_search module is missing. Run `pip install duckduckgo_search`"}

        def _search():
            try:
                results = []
                with DDGS() as ddgs:
                    for r in ddgs.text(self.query, max_results=self.max_results):
                        results.append({
                            "title": r.get("title"),
                            "url": r.get("href"),
                            "snippet": r.get("body")
                        })
                return results
            except Exception as e:
                return {"error": f"Search failed: {str(e)}"}

        results = await asyncio.to_thread(_search)
        
        if isinstance(results, dict) and "error" in results:
            return results
            
        if not results:
            return {"message": "No results found."}
            
        # Format gracefully for the LLM
        formatted = "## Search Results\\n\\n"
        for i, r in enumerate(results, 1):
            formatted += f"{i}. **{r['title']}**\\n   URL: {r['url']}\\n   Snippet: {r['snippet']}\\n\\n"
            
        return formatted
