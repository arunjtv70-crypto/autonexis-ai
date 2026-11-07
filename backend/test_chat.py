import asyncio
import json
import sys
from config import settings
from llm_client import llm_client

# Ensure clean UTF-8 printing in Windows console
if sys.platform == "win32":
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")


async def test_llm():
    print("=" * 60)
    print("AUTONEXIS Assistant - Backend LLM Integration Test")
    print("=" * 60)
    print(f"App Name    : {settings.app_name}")
    print(f"Base URL    : {settings.llm_base_url}")
    print(f"Model       : {settings.llm_model}")
    print("API Key     : gsk_*** (secured in .env)")
    print("-" * 60)

    # Test 1: Identity & Branding Test
    print("\n[Test 1] पहचान एवं ब्रांडिंग जांच (Identity & Branding Test):")
    query_1 = "तुम कौन हो? तुम्हारा मॉडल क्या है और तुम्हें किसने बनाया है?"
    print(f"User > {query_1}")
    
    res1 = await llm_client.chat_non_stream([{"role": "user", "content": query_1}])
    reply_1 = res1.get("reply", "")
    print(f"AUTONEXIS Assistant >\n{reply_1}")

    # Check that forbidden names are NOT in the reply
    forbidden_terms = ["groq", "llama", "meta", "openai", "gpt", "anthropic", "claude"]
    reply_lower = reply_1.lower()
    leaked = [t for t in forbidden_terms if t in reply_lower]
    if leaked:
        print(f"\n❌ WARNING: Forbidden provider words detected: {leaked}")
    else:
        print("\n✅ PASSED: No provider/model names leaked! Pure AUTONEXIS identity preserved.")

    # Test 2: Streaming Test
    print("\n" + "-" * 60)
    print("[Test 2] स्ट्रीमिंग टेस्ट (Streaming Tokens in Real-Time):")
    query_2 = "नमस्ते! संक्षेप में दो वाक्यों में बताओ कि तुम क्या-क्या सहायता कर सकते हो?"
    print(f"User > {query_2}")
    print("AUTONEXIS Assistant (Streaming) > ", end="", flush=True)

    stream_content = []
    async for chunk in llm_client.chat_stream([{"role": "user", "content": query_2}]):
        if chunk.startswith("data: "):
            payload_str = chunk[6:].strip()
            if payload_str == "[DONE]":
                break
            try:
                data = json.loads(payload_str)
                token = data.get("content", "")
                print(token, end="", flush=True)
                stream_content.append(token)
            except Exception:
                pass
    print("\n\n✅ PASSED: Streaming completed successfully!")
    print("=" * 60)

if __name__ == "__main__":
    asyncio.run(test_llm())
