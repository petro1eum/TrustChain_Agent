"""
Browser Proxy Router — Proxies external websites for the TrustChain Browser Panel.
Strips X-Frame-Options and Content-Security-Policy to allow embedding in iframes.
Injects a <base> tag to correctly resolve relative asset paths.
"""

from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import HTMLResponse, StreamingResponse
import httpx
from urllib.parse import urlparse

router = APIRouter(prefix="/api/browser", tags=["browser_proxy"])

FILTERED_HEADERS = {
    "x-frame-options",
    "content-security-policy",
    "content-security-policy-report-only",
    "transfer-encoding",
    "content-encoding", # We let httpx decode it and we return raw UTF-8
    "content-length",
    "strict-transport-security",
}

@router.get("/proxy")
async def proxy_browser_page(url: str = Query(..., description="URL to proxy")):
    if not url.startswith(("http://", "https://")):
        url = "https://" + url

    try:
        parsed_url = urlparse(url)
        base_url = f"{parsed_url.scheme}://{parsed_url.netloc}"
        
        async with httpx.AsyncClient(timeout=10.0, follow_redirects=True) as client:
            # Mask User-Agent to avoid early rejections from basic bot protections
            headers = {
                "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
                "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
                "Accept-Language": "en-US,en;q=0.9",
            }
            response = await client.get(url, headers=headers)
            
            # Create Safe Headers
            safe_headers = {
                k: v for k, v in response.headers.items() 
                if k.lower() not in FILTERED_HEADERS
            }
            
            content_type = response.headers.get("content-type", "")
            
            # If it's HTML, inject the <base> tag
            if "text/html" in content_type:
                html_text = response.text
                
                # Simple injection before </head> or <head> or at the start
                base_tag = f'<base href="{url}">'
                
                if "<head>" in html_text.lower():
                    # Replace first occurrence case-insensitively
                    head_idx = html_text.lower().find("<head>") + 6
                    injected_html = html_text[:head_idx] + base_tag + html_text[head_idx:]
                elif "<html>" in html_text.lower():
                    html_idx = html_text.lower().find("<html>") + 6
                    injected_html = html_text[:html_idx] + "<head>" + base_tag + "</head>" + html_text[html_idx:]
                else:
                    injected_html = base_tag + html_text
                    
                return HTMLResponse(content=injected_html, status_code=response.status_code, headers=safe_headers)
            
            # Return raw content for non-HTML (though this endpoint is mainly for the initial page load)
            return StreamingResponse(
                response.aiter_bytes(), 
                status_code=response.status_code, 
                headers=safe_headers
            )
            
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Proxy error: {str(e)}")
