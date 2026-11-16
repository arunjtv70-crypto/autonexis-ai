import asyncio, json, os, sys
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
import httpx
import llm_client as lc


def test_429_text_has_no_status_code():
    msg = lc._format_safe_upstream_error(429, "")
    assert "429" not in msg and "rate limit" not in msg.lower()


def test_search_key_accepts_search_api_key(monkeypatch):
    monkeypatch.delenv("TAVILY_API_KEY", raising=False)
    monkeypatch.setenv("SEARCH_API_KEY", "k")
    assert lc._get_tavily_key() == "k"


def test_hinglish_detected_without_classic_markers():
    d = lc.detect_language_directive("cricket score btao")
    assert "Hinglish" in d
    d2 = lc.detect_language_directive("ok", ["mujhe ek kahani sunao"])
    assert "Hinglish" in d2
    assert "English" in lc.detect_language_directive("what is the capital of France")


def test_stream_falls_back_after_429(monkeypatch):
    monkeypatch.setenv("LLM_FALLBACK_MODELS", "m2")
    calls = []

    def handler(request):
        model = json.loads(request.content)["model"]
        calls.append(model)
        if model != "m2":
            return httpx.Response(429, headers={"retry-after": "0"}, json={"error": "rl"})
        body = 'data: {"choices":[{"delta":{"content":"hello"}}]}\n\ndata: [DONE]\n\n'
        return httpx.Response(200, content=body.encode())

    real = httpx.AsyncClient
    monkeypatch.setattr(lc.httpx, "AsyncClient", lambda *a, **k: real(*a, transport=httpx.MockTransport(handler), **{x: y for x, y in k.items() if x != "transport"}))
    client = lc.LLMClient()

    async def run():
        out = []
        async for ev in client.chat_stream([{"role": "user", "content": "hi"}], uid="u1"):
            out.append(ev)
        return "".join(out)

    text = asyncio.run(run())
    assert "hello" in text and '"error"' not in text
    assert calls[-1] == "m2" and len(calls) >= 2


def test_chip_on_forces_search_and_injects_results(monkeypatch):
    monkeypatch.setenv("SEARCH_API_KEY", "k")
    searched = []

    async def fake_exec(name, args, uid="guest"):
        searched.append((name, args))
        from tools.base import ToolResult
        return ToolResult(ok=True, data={"results": [{"title": "IND vs AUS", "content": "India won by 5 wickets"}]},
                          source="Tavily", fetched_at="now", ttl=0)

    monkeypatch.setattr(lc, "execute_tool_call", fake_exec)
    seen = {}

    def handler(request):
        seen["system"] = json.loads(request.content)["messages"][0]["content"]
        return httpx.Response(200, content=b'data: {"choices":[{"delta":{"content":"ok"}}]}\n\ndata: [DONE]\n\n')

    real = httpx.AsyncClient
    monkeypatch.setattr(lc.httpx, "AsyncClient", lambda *a, **k: real(*a, transport=httpx.MockTransport(handler)))
    client = lc.LLMClient()

    async def run():
        async for _ in client.chat_stream([{"role": "user", "content": "kal match ka result"}], user_context={"web_search": True}, uid="u1"):
            pass

    asyncio.run(run())
    assert searched and searched[0][0] == "web_search"
    assert "India won by 5 wickets" in seen["system"]
