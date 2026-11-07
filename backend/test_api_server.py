import asyncio
import json
import sys
import httpx
from config import settings
from main import app

if sys.platform == "win32":
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")

async def test_fastapi_endpoints():
    print("=" * 60)
    print("AUTONEXIS Assistant - FastAPI Endpoints Live Test")
    print("=" * 60)

    # Use httpx AsyncClient with ASGI transport to test directly without port blocking
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://testserver") as client:
        
        # 1. Health check
        print("\n[1] Testing GET /api/health ...")
        resp = await client.get("/api/health")
        print(f"Status Code: {resp.status_code}")
        print(f"Response: {resp.json()}")
        assert resp.status_code == 200
        assert resp.json()["app"] == "AUTONEXIS Assistant"
        print("✅ Health check passed!")

        # 2. Direct Chat POST /api/chat
        print("\n[2] Testing POST /api/chat ...")
        chat_payload = {
            "messages": [
                {"role": "user", "content": "AUTONEXIS Assistant के मुख्य मूल्य क्या हैं? एक पंक्ति में बताएं।"}
            ]
        }
        resp = await client.post("/api/chat", json=chat_payload)
        print(f"Status Code: {resp.status_code}")
        print(f"Response: {resp.json()}")
        assert resp.status_code == 200
        assert resp.json()["status"] == "success"
        print("✅ Direct chat endpoint passed!")

        # 3. Streaming Chat POST /api/chat/stream
        print("\n[3] Testing POST /api/chat/stream (SSE Streaming) ...")
        stream_payload = {
            "messages": [
                {"role": "user", "content": "एक शांत और प्रेरक विचार साझा करें।"}
            ]
        }
        async with client.stream("POST", "/api/chat/stream", json=stream_payload) as stream_resp:
            print(f"Status Code: {stream_resp.status_code}")
            print(f"Content-Type: {stream_resp.headers.get('content-type')}")
            assert stream_resp.status_code == 200
            
            received_tokens = []
            print("Streamed Output > ", end="", flush=True)
            async for line in stream_resp.aiter_lines():
                if line.startswith("data: "):
                    body = line[6:].strip()
                    if body == "[DONE]":
                        break
                    try:
                        item = json.loads(body)
                        token = item.get("content", "")
                        print(token, end="", flush=True)
                        received_tokens.append(token)
                    except Exception:
                        pass
            print(f"\nTotal tokens received: {len(received_tokens)}")
            assert len(received_tokens) > 0
            print("✅ SSE Streaming endpoint passed!")

    print("\n" + "=" * 60)
    print("ALL BACKEND CHAT TESTS COMPLETED WITH 100% SUCCESS!")
    print("=" * 60)

if __name__ == "__main__":
    asyncio.run(test_fastapi_endpoints())

