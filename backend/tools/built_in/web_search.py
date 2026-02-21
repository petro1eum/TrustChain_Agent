import httpx
from typing import Any
from backend.tools.base_tool import BaseTool, ToolContext

class WebSearchTool(BaseTool):
    """
    Performs a web search using Jina.ai and returns markdown content of the search results.
    Useful for finding real-time information, documentation, and news.
    """
    query: str

    async def run(self, context: ToolContext) -> Any:
        try:
            url = f"https://s.jina.ai/{self.query}"
            headers = {
                "Accept": "application/json",
                "X-Retain-Images": "none"
            }
            
            async with httpx.AsyncClient(timeout=30.0) as client:
                response = await client.get(url, headers=headers)
                
            if response.status_code != 200:
                return {"error": f"Search failed with HTTP {response.status_code}", "raw": response.text[:200]}
                
            data = response.json()
            
            # Format the output to be readable for the LLM
            results = []
            for idx, item in enumerate(data.get("data", [])[:5]):
                title = item.get("title", "No Title")
                desc = item.get("description", "No Description")
                link = item.get("url", "")
                content = item.get("content", "")[:1000] # Truncate long content
                results.append(f"### {idx+1}. {title}\n**URL**: {link}\n**Description**: {desc}\n**Content Snippet**:\n{content}...\n")
                
            if not results:
                return {"success": True, "results": "No results found."}
                
            return {
                "success": True,
                "results": "\n\n".join(results)
            }
            
        except httpx.TimeoutException:
            return {"error": "Search request timed out"}
        except Exception as e:
            return {"error": f"Failed to perform search: {str(e)}"}
