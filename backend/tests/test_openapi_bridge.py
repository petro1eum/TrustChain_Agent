import asyncio
import os
import sys

# Ensure backend is in path
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "../..")))

from backend.tools.built_in.openapi_bridge import OpenAPIBridgeTool
from backend.tools.base_tool import ToolContext

from unittest.mock import patch, MagicMock

async def main():
    print("🚀 Starting OpenAPI Bridge Test...")
    
    # Using a 100% genuine, live OpenAPI 3.0 specification from the Swagger examples repo
    url = "https://raw.githubusercontent.com/OAI/OpenAPI-Specification/main/examples/v3.0/petstore.yaml"
    # Actually, main branch might have moved things. Let's use a stable commit hash or another swagger domain
    url = "https://raw.githubusercontent.com/swagger-api/swagger-petstore/master/src/main/resources/openapi.yaml"
    
    context = ToolContext(session_id="test_openapi_session")
    tool = OpenAPIBridgeTool(openapi_url=url, service_name="petstore")
    
    print(f"Fetching and generating client for Live Schema: {url}")
    
    result = await tool.run(context=context)
    
    if "error" in result:
        print(f"❌ TEST FAILED: {result['error']}")
        sys.exit(1)
        
    print(f"✅ TEST SUCCESS: {result['message']}")
    
    ku = result.get("knowledge_unit")
    if not isinstance(ku, dict) or ku.get("status") != "success":
        print(f"❌ TEST FAILED: Knowledge Unit was not generated properly. Got: {ku}")
        sys.exit(1)
        
    print(f"✅ Knowledge unit saved to: {ku.get('filepath')}")
    print("\n--- GENERATED CODE PREVIEW ---")
    print(result["preview_code"])
    print("------------------------------")
    
    # Let's verify our knowledge unit file actually contains Pydantic models
    with open(ku.get("filepath"), "r") as f:
        file_content = f.read()
        
    if "class Pet(BaseModel):" in file_content or "BaseModel" in file_content:
         print("✅ TEST SUCCESS: Found Pydantic models in generated knowledge unit!")
    else:
         print("❌ TEST FAILED: Pydantic models not found in generated Knowledge Unit.")
         sys.exit(1)
         
    print("\n🎉 ALL TESTS PASSED.")

if __name__ == "__main__":
    asyncio.run(main())
