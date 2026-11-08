import asyncio
import os
import json
import logging
import re
from typing import AsyncGenerator, List, Dict, Any, Optional, Union
import httpx
from config import settings
from math_engine import EXACT_MATH_TOOL_DEFINITION, execute_exact_math, is_math_request
from prompts import MATH_PROMPT

logger = logging.getLogger("autonexis.llm")
logging.basicConfig(level=logging.INFO)

FRIENDLY_ERROR_MESSAGE = "I am currently having trouble connecting. Please try again in a moment."
VISION_ERROR_MESSAGE = "I couldn't read this image. Please try a smaller or clearer one."

def has_image_content(messages: List[Dict[str, Any]]) -> bool:
    """Checks if any message contains an image_url block."""
    for msg in messages:
        content = msg.get("content")
        if isinstance(content, list):
            for part in content:
                if isinstance(part, dict) and part.get("type") == "image_url":
                    return True
    return False

def extract_text_from_content(content: Union[str, List[Dict[str, Any]]]) -> str:
    """Extracts plain text string from either string or multimodal list."""
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        texts = []
        for part in content:
            if isinstance(part, dict) and part.get("type") == "text":
                texts.append(part.get("text", ""))
        return " ".join(texts)
    return ""

def detect_language_directive(user_text: str) -> str:
    """
    Analyzes the user's message and outputs a strict language matching directive
    so the model speaks in the exact same language (Hinglish, English, or Hindi).
    """
    clean = user_text.strip()
    if not clean:
        return "LANGUAGE MANDATE: Reply in the same language as the user."
    
    # 1. Devanagari Hindi check (\u0900 to \u097F)
    has_devanagari = any('\u0900' <= char <= '\u097f' for char in clean)
    if has_devanagari:
        return (
            "LANGUAGE MANDATE: The user wrote in Devanagari Hindi (हिंदी). "
            "You MUST reply in natural, fluent Hindi using Devanagari script."
        )
    
    # 2. Hinglish vocabulary check (Hindi written in Roman/English script)
    hinglish_markers = {
        "kya", "kar", "rhe", "rahe", "ho", "hai", "hain", "hu", "hoon", "mera", "meri", "mere",
        "naam", "nam", "kaise", "kaisa", "kaisi", "batao", "bataiye", "bol", "bolo", "bolna",
        "kaho", "kehna", "aaj", "kal", "dukhi", "khush", "yaar", "bhai", "dost", "thik", "theek",
        "nahi", "nahin", "mat", "karo", "karna", "acha", "achha", "accha", "bahut", "bohot",
        "samajh", "aaya", "gaya", "chahiye", "kuch", "kuchh", "yeh", "ye", "woh", "wo", "apna",
        "apne", "apni", "aap", "tum", "tu", "kyu", "kyun", "kaha", "kahan", "kab", "kaun",
        "kaam", "baat", "bata", "rakho", "rakh", "dekh", "dekho", "suno", "sun", "paas", "bhi",
        "hoga", "hogi", "dena", "le", "lo", "bhaiya", "sir", "madam", "badhiya", "chal", "raha",
        "pehle", "pichli", "purani", "yaad", "bolo", "bhi", "sahi", "sab", "toh", "to"
    }
    
    words = set(w.lower().strip(".,!?:;\"'()[]{}") for w in clean.split())
    if any(w in hinglish_markers for w in words):
        return (
            "LANGUAGE MANDATE (CRITICAL - HIGHEST PRIORITY):\n"
            "The user is speaking to you in HINGLISH (Hindi typed in English alphabet, e.g. 'kya kar rhe ho', 'me aaj dukhi hu').\n"
            "You MUST reply in natural, conversational HINGLISH using the English/Roman alphabet (e.g. 'Main theek hoon! Aap batao, sab kaisa chal raha hai?').\n"
            "DO NOT USE DEVANAGARI SCRIPT (हिंदी)! Strictly use Roman/English alphabet to match the user."
        )
    
    # 3. Default to English
    return (
        "LANGUAGE MANDATE: The user wrote in English. You MUST reply completely in natural, fluent English."
    )

class LLMClient:
    def __init__(self):
        self.api_key = settings.llm_api_key
        self.model = settings.llm_model
        self.vision_model = getattr(settings, "llm_vision_model", "qwen/qwen3.8-27b")
        self.model_think = getattr(settings, "llm_model_think", "openai/gpt-oss-120b")
        self.base_url = settings.llm_base_url.rstrip("/")
        self.system_prompt = settings.system_prompt

    def _get_active_model(self, messages: List[Dict[str, Any]]) -> str:
        """
        Dynamically picks:
        - Vision model if messages contain an image.
        - Think/Reasoning model if messages contain a mathematical/quantitative inquiry.
        - Default text model otherwise.
        """
        if has_image_content(messages):
            return os.environ.get("LLM_VISION_MODEL") or self.vision_model or "qwen/qwen3.8-27b"
        if is_math_request(messages):
            return os.environ.get("LLM_MODEL_THINK") or self.model_think or "openai/gpt-oss-120b"
        return os.environ.get("LLM_MODEL") or self.model

    def _prepare_messages(
        self,
        messages: List[Dict[str, Any]],
        user_memory: Optional[str] = None,
        max_history: int = 18,
        is_math: bool = False
    ) -> List[Dict[str, Any]]:
        """
        Prepends the strict AUTONEXIS Assistant system prompt plus persistent memory,
        math rigor prompt (if math detected), and language matching directive.
        """
        extra_system_context = []
        if user_memory and user_memory.strip():
            extra_system_context.append(
                f"[CONTINUOUS PERSISTENT CROSS-CHAT MEMORY]:\n{user_memory.strip()}\n\n"
                "CRITICAL MEMORY MANDATE: You have 100% active memory across all previous conversations. "
                "The memories and chat logs provided above are your true memories with this user. "
                "If the user asks what was discussed in past chats, tests your memory, or asks for their name/details, "
                "answer accurately and warmly from this history. "
                "NEVER say you do not remember or that you cannot access past conversations."
            )

        if is_math:
            extra_system_context.append(MATH_PROMPT)
        
        # Trim history if excessively long while keeping recent context
        trimmed_messages = messages[-max_history:] if len(messages) > max_history else messages

        user_and_assistant = []
        last_user_text = ""
        for msg in trimmed_messages:
            role = msg.get("role", "user")
            content = msg.get("content", "")
            if role == "system":
                c = extract_text_from_content(content).strip()
                if c:
                    extra_system_context.append(c)
            else:
                user_and_assistant.append({
                    "role": role,
                    "content": content
                })
                if role == "user":
                    text_val = extract_text_from_content(content).strip()
                    if text_val:
                        last_user_text = text_val

        # Dynamic Language Matching Directive
        if last_user_text:
            lang_mandate = detect_language_directive(last_user_text)
            extra_system_context.append(lang_mandate)

        full_system = self.system_prompt
        if extra_system_context:
            full_system += "\n\n" + "\n\n".join(extra_system_context)
            full_system += "\n\nNOTE: You MUST accurately remember and reference user details and ALWAYS match the user's language."

        return [{"role": "system", "content": full_system}] + user_and_assistant

    async def chat_stream(
        self,
        messages: List[Dict[str, Any]],
        user_memory: Optional[str] = None,
        is_guest: bool = False
    ) -> AsyncGenerator[str, None]:
        """
        Streams completion tokens as Server-Sent Events (SSE) data chunks.
        For mathematical inquiries, resolves exact_math tools with high precision before streaming.
        """
        endpoint = f"{self.base_url}/chat/completions"
        headers = {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json",
        }
        active_model = self._get_active_model(messages)
        is_vision = has_image_content(messages)
        is_math = is_math_request(messages)
        fallback_error_msg = VISION_ERROR_MESSAGE if is_vision else FRIENDLY_ERROR_MESSAGE

        # -------------------------------------------------------------------
        # MATH ROUTE: Multi-turn exact calculation tool loop (up to 10 turns)
        # -------------------------------------------------------------------
        if is_math:
            max_tokens = 512 if is_guest else 3000
            conversation = self._prepare_messages(messages, user_memory, is_math=True)
            tools = [EXACT_MATH_TOOL_DEFINITION]

            try:
                timeout = httpx.Timeout(connect=15.0, read=90.0, write=15.0, pool=15.0)
                async with httpx.AsyncClient(timeout=timeout) as client:
                    final_content = ""
                    for turn in range(10):
                        payload = {
                            "model": active_model,
                            "messages": conversation,
                            "tools": tools,
                            "tool_choice": "auto",
                            "temperature": 0.2,
                            "max_tokens": max_tokens,
                            "stream": False,
                        }
                        res = await client.post(endpoint, json=payload, headers=headers)
                        if res.status_code != 200:
                            logger.error(f"[AUTONEXIS LLM MATH ERROR] {res.status_code}: {res.text}")
                            yield f"data: {json.dumps({'error': True, 'content': fallback_error_msg}, ensure_ascii=False)}\n\n"
                            yield "data: [DONE]\n\n"
                            return

                        choice = res.json()["choices"][0]
                        msg = choice["message"]
                        tool_calls = msg.get("tool_calls")

                        if not tool_calls:
                            final_content = msg.get("content") or ""
                            break

                        conversation.append(msg)
                        for tc in tool_calls:
                            fn_name = tc.get("function", {}).get("name")
                            args_str = tc.get("function", {}).get("arguments", "{}")
                            try:
                                args = json.loads(args_str)
                                expr = args.get("expression", "")
                                if fn_name == "exact_math":
                                    result_str = execute_exact_math(expr)
                                else:
                                    result_str = f"Error: Unknown tool '{fn_name}'"
                            except Exception as parse_err:
                                result_str = f"Error parsing arguments: {parse_err}"

                            conversation.append({
                                "role": "tool",
                                "tool_call_id": tc.get("id"),
                                "name": fn_name,
                                "content": str(result_str)
                            })

                    # Suppress any internal reasoning / <think> tags from final text
                    final_content = re.sub(r"<think>[\s\S]*?</think>", "", final_content).strip()

                    # Stream text in smooth chunks to client
                    chunk_size = 12
                    for i in range(0, len(final_content), chunk_size):
                        sub_str = final_content[i:i + chunk_size]
                        yield f"data: {json.dumps({'content': sub_str}, ensure_ascii=False)}\n\n"
                        await asyncio.sleep(0.015)

                    yield "data: [DONE]\n\n"
                    return

            except Exception as e:
                logger.error(f"[AUTONEXIS LLM MATH EXCEPTION] {e}")
                yield f"data: {json.dumps({'error': True, 'content': fallback_error_msg}, ensure_ascii=False)}\n\n"
                yield "data: [DONE]\n\n"
                return

        # -------------------------------------------------------------------
        # GENERAL CHAT ROUTE: Standard real-time SSE token streaming
        # -------------------------------------------------------------------
        max_tokens = 512 if is_guest else 2048
        payload = {
            "model": active_model,
            "messages": self._prepare_messages(messages, user_memory, is_math=False),
            "stream": True,
            "temperature": 0.6,
            "max_tokens": max_tokens,
        }

        try:
            timeout = httpx.Timeout(connect=15.0, read=60.0, write=15.0, pool=15.0)
            async with httpx.AsyncClient(timeout=timeout) as client:
                async with client.stream("POST", endpoint, json=payload, headers=headers) as response:
                    if response.status_code != 200:
                        error_body = await response.aread()
                        logger.error(f"[AUTONEXIS LLM ERROR] Status {response.status_code}: {error_body.decode('utf-8', errors='ignore')}")
                        yield f"data: {json.dumps({'error': True, 'content': fallback_error_msg}, ensure_ascii=False)}\n\n"
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
                                    # Never stream reasoning tokens or delta_content containing internal think tags
                                    if delta_content is not None and not delta_content.startswith("<think>"):
                                        payload_out = json.dumps({"content": delta_content}, ensure_ascii=False)
                                        yield f"data: {payload_out}\n\n"
                            except json.JSONDecodeError:
                                continue
        except Exception as e:
            logger.error(f"[AUTONEXIS LLM STREAM EXCEPTION] {e}")
            yield f"data: {json.dumps({'error': True, 'content': fallback_error_msg}, ensure_ascii=False)}\n\n"
            yield "data: [DONE]\n\n"

    async def chat_non_stream(
        self,
        messages: List[Dict[str, Any]],
        user_memory: Optional[str] = None,
        is_guest: bool = False
    ) -> Dict[str, str]:
        """
        Non-streaming completion fallback.
        """
        endpoint = f"{self.base_url}/chat/completions"
        headers = {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json",
        }
        active_model = self._get_active_model(messages)
        is_vision = has_image_content(messages)
        is_math = is_math_request(messages)
        fallback_error_msg = VISION_ERROR_MESSAGE if is_vision else FRIENDLY_ERROR_MESSAGE

        if is_math:
            max_tokens = 512 if is_guest else 3000
            conversation = self._prepare_messages(messages, user_memory, is_math=True)
            tools = [EXACT_MATH_TOOL_DEFINITION]

            try:
                timeout = httpx.Timeout(connect=15.0, read=90.0, write=15.0, pool=15.0)
                async with httpx.AsyncClient(timeout=timeout) as client:
                    for _ in range(10):
                        payload = {
                            "model": active_model,
                            "messages": conversation,
                            "tools": tools,
                            "tool_choice": "auto",
                            "temperature": 0.2,
                            "max_tokens": max_tokens,
                            "stream": False,
                        }
                        res = await client.post(endpoint, json=payload, headers=headers)
                        if res.status_code != 200:
                            logger.error(f"[AUTONEXIS LLM MATH ERROR] {res.status_code}: {res.text}")
                            return {"reply": fallback_error_msg}

                        choice = res.json()["choices"][0]
                        msg = choice["message"]
                        tool_calls = msg.get("tool_calls")
                        if not tool_calls:
                            raw_reply = msg.get("content") or ""
                            clean_reply = re.sub(r"<think>[\s\S]*?</think>", "", raw_reply).strip()
                            return {"reply": clean_reply}

                        conversation.append(msg)
                        for tc in tool_calls:
                            fn_name = tc.get("function", {}).get("name")
                            args_str = tc.get("function", {}).get("arguments", "{}")
                            try:
                                args = json.loads(args_str)
                                expr = args.get("expression", "")
                                if fn_name == "exact_math":
                                    result_str = execute_exact_math(expr)
                                else:
                                    result_str = f"Error: Unknown tool '{fn_name}'"
                            except Exception as parse_err:
                                result_str = f"Error parsing arguments: {parse_err}"

                            conversation.append({
                                "role": "tool",
                                "tool_call_id": tc.get("id"),
                                "name": fn_name,
                                "content": str(result_str)
                            })
                    return {"reply": "Unable to complete calculation."}
            except Exception as e:
                logger.error(f"[AUTONEXIS LLM MATH EXCEPTION] {e}")
                return {"reply": fallback_error_msg}

        max_tokens = 512 if is_guest else 2048
        payload = {
            "model": active_model,
            "messages": self._prepare_messages(messages, user_memory, is_math=False),
            "stream": False,
            "temperature": 0.6,
            "max_tokens": max_tokens,
        }

        try:
            timeout = httpx.Timeout(connect=15.0, read=60.0, write=15.0, pool=15.0)
            async with httpx.AsyncClient(timeout=timeout) as client:
                res = await client.post(endpoint, json=payload, headers=headers)
                if res.status_code != 200:
                    logger.error(f"[AUTONEXIS LLM ERROR] {res.status_code}: {res.text}")
                    return {"reply": fallback_error_msg}
                data = res.json()
                reply = data["choices"][0]["message"]["content"]
                clean_reply = re.sub(r"<think>[\s\S]*?</think>", "", reply).strip()
                return {"reply": clean_reply}
        except Exception as e:
            logger.error(f"[AUTONEXIS LLM EXCEPTION] {e}")
            return {"reply": fallback_error_msg}

llm_client = LLMClient()
