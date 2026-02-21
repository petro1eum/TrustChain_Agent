import asyncio
import os
import sys

# Ensure backend package can be imported
sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), "../..")))

from backend.tools.agent_runtime import run_agent, get_collective_memory

async def test_swarm():
    print("🚀 Starting Agency Swarm Test...")
    
    # Give the CEO agent a task that requires delegating and remembering
    instruction = (
        "1. Write a secret code 'ALPHA-77' to the shared collective memory using WriteMemoryTool under key 'secret'. "
        "2. Message a 'Developer' subagent asking them to read the collective memory for key 'secret' and return it reversed."
    )
    
    session_id = "test_swarm_001"
    
    task = await run_agent(
        instruction=instruction,
        session_id=session_id,
        model="gemini-2.0-flash", # Use standard model
        max_iterations=5,
    )
    
    print("\n✅ Task Finished!")
    print(f"Status: {task.status}")
    print(f"Result:\n{task.result or task.error}")
    
    mem = get_collective_memory()
    print("\n🧠 Collective Memory Contents:")
    for k, v in mem.items():
        print(f"  {k}: {v}")

    print("\n🔧 Tools Used:")
    for tc in task.tool_calls:
        print(f"  - {tc['tool']}")

if __name__ == "__main__":
    asyncio.run(test_swarm())
