import json
import logging
from typing import AsyncGenerator, List, Dict, Optional
import httpx
from config import settings

logger = logging.getLogger("autonexis.llm")
logging.basicConfig(level=logging.INFO)

FRIENDLY_ERROR_MESSAGE = "क्षमा करें, इस समय सेवा अनुपलब्ध है। कृपया थोड़ी देर बाद पुनः प्रयास करें।"

class LLMClient:
    def __init__(self):
        self.api_key = settings.llm_api_key
        self.model = settings.llm_model
        # Strip trailing slash from base url if present
        self.base_url = settings.llm_base_url.rstrip("/")
        self.system_prompt = settings.system_prompt

    def _prepare_messages(self, messages: List[Dict[str, str]], user_memory: Optional[str] = None) -> List[Dict[str, str]]:
        """
        Prepends the strict AUTONEXIS Assistant system prompt plus persistent cross-chat memory.
        Preserves complete conversation history context.
        """
        extra_system_context = []
        if user_memory and user_memory.strip():
            extra_system_context.append(
                f"[ACTIVE PERSISTENT USER MEMORY ACROSS ALL CONVERSATIONS]:\n{user_memory.strip()}\n"
                "INSTRUCTION: You must strictly remember and respect this memory. Always address the user by their preferred name and accurately answer any questions about their identity or saved facts."
            )
        
        user_and_assistant = []
        for msg in messages:
            if msg.get("role") == "system":
                c = msg.get("content", "").strip()
                if c:
                    extra_system_context.append(c)
            else:
                user_and_assistant.append({
                    "role": msg.get("role", "user"),
                    "content": msg.get("content", "")
                })

        full_system = self.system_prompt
        if extra_system_context:
            full_system += "\n\n" + "\n\n".join(extra_system_context)
            full_system += "\n\nNOTE: You MUST accurately remember and reference these persistent user details across all conversations whenever asked."

        return [{"role": "system", "content": full_system}] + user_and_assistant

    async def chat_stream(self, messages: List[Dict[str, str]], user_memory: Optional[str] = None) -> AsyncGenerator[str, None]:
        """
        Streams completion tokens as Server-Sent Events (SSE) data chunks.
        Compatible with any standard OpenAI-compatible chat completions API.
        """
        endpoint = f"{self.base_url}/chat/completions"
        headers = {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json",
        }
        payload = {
            "model": self.model,
            "messages": self._prepare_messages(messages, user_memory),
            "stream": True,
            "temperature": 0.7,
        }

        try:
            timeout = httpx.Timeout(connect=15.0, read=60.0, write=15.0, pool=15.0)
            async with httpx.AsyncClient(timeout=timeout) as client:
                async with client.stream("POST", endpoint, json=payload, headers=headers) as response:
                    if response.status_code != 200:
                        error_body = await response.aread()
                        logger.error(f"[AUTONEXIS LLM ERROR] Status {response.status_code}: {error_body.decode('utf-8', errors='ignore')}")
                        yield f"data: {json.dumps({'error': True, 'content': FRIENDLY_ERROR_MESSAGE}, ensure_ascii=False)}\n\n"
                        yield "data: [DONE]\n\n"
                        return

                    async for line in response.aiter_lines():
                        if not line:
                            continue
                        if line.startswith("data: "):
                            data_str = line[6:].strip()
                            if data_str == "[DONE]":
                                yield "data: [DONE]\n\n"
                                break
                            try:
                                chunk = json.loads(data_str)
                                choices = chunk.get("choices", [])
                                if choices and "delta" in choices[0]:
                                    delta_content = choices[0]["delta"].get("content")
                                    if delta_content:
                                        payload_out = json.dumps({"content": delta_content}, ensure_ascii=False)
                                        yield f"data: {payload_out}\n\n"
                            except json.JSONDecodeError:
                                continue

        except Exception as exc:
            logger.exception(f"[AUTONEXIS LLM EXCEPTION] {str(exc)}")
            yield f"data: {json.dumps({'error': True, 'content': FRIENDLY_ERROR_MESSAGE}, ensure_ascii=False)}\n\n"
            yield "data: [DONE]\n\n"

    async def chat_non_stream(self, messages: List[Dict[str, str]], user_memory: Optional[str] = None) -> Dict[str, str]:
        """
        Non-streaming chat completion for quick API testing or single request-response.
        """
        endpoint = f"{self.base_url}/chat/completions"
        headers = {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json",
        }
        payload = {
            "model": self.model,
            "messages": self._prepare_messages(messages, user_memory),
            "stream": False,
            "temperature": 0.7,
        }

        try:
            timeout = httpx.Timeout(connect=15.0, read=60.0, write=15.0, pool=15.0)
            async with httpx.AsyncClient(timeout=timeout) as client:
                response = await client.post(endpoint, json=payload, headers=headers)
                if response.status_code != 200:
                    logger.error(f"[AUTONEXIS LLM ERROR] Status {response.status_code}: {response.text}")
                    return {"reply": FRIENDLY_ERROR_MESSAGE, "status": "error"}
                data = response.json()
                reply = data["choices"][0]["message"]["content"]
                return {"reply": reply, "status": "success"}
        except Exception as exc:
            logger.exception(f"[AUTONEXIS LLM EXCEPTION] {str(exc)}")
            return {"reply": FRIENDLY_ERROR_MESSAGE, "status": "error"}

llm_client = LLMClient()

