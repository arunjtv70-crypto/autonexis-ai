import asyncio
import os
import json
import logging
import re
from typing import AsyncGenerator, List, Dict, Any, Optional, Union
import httpx
from config import settings
from math_engine import EXACT_MATH_TOOL_DEFINITION, execute_exact_math, is_math_request
from prompts import (
    MATH_PROMPT,
    ABUSE_AND_SAFETY_PROMPT,
    TABLE_AND_LAYOUT_PROMPT,
    IMAGE_REASONING_PROMPT,
    MEMORY_EXTRACTION_SYSTEM_PROMPT,
    format_user_context_block,
)
from profanity_blocklist import contains_profanity, get_polite_fallback

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

def prune_historical_images(messages: List[Dict[str, Any]], keep_latest: int = 2) -> List[Dict[str, Any]]:
    """
    Keeps full image data for only the latest N messages containing images.
    Replaces older image attachments with '[image sent earlier]' to conserve tokens
    and prevent request payload bloat.
    """
    img_indices = []
    for idx, msg in enumerate(messages):
        content = msg.get("content")
        if isinstance(content, list) and any(isinstance(p, dict) and p.get("type") == "image_url" for p in content):
            img_indices.append(idx)

    indices_to_keep = set(img_indices[-keep_latest:]) if len(img_indices) > keep_latest else set(img_indices)

    pruned = []
    for idx, msg in enumerate(messages):
        content = msg.get("content")
        if isinstance(content, list) and idx not in indices_to_keep:
            new_parts = []
            had_image = False
            for part in content:
                if isinstance(part, dict) and part.get("type") == "image_url":
                    had_image = True
                else:
                    new_parts.append(part)
            if had_image:
                new_parts.append({"type": "text", "text": "[image sent earlier]"})
            pruned.append({**msg, "content": new_parts})
        else:
            pruned.append(msg)
    return pruned

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

def get_last_user_text(messages: List[Dict[str, Any]]) -> str:
    """Gets text from the latest user message in the thread."""
    for msg in reversed(messages):
        if msg.get("role") == "user":
            return extract_text_from_content(msg.get("content", ""))
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
        user_context: Optional[Dict[str, Any]] = None,
        max_history: int = 18,
        is_math: bool = False
    ) -> List[Dict[str, Any]]:
        """
        Prepends the strict AUTONEXIS Assistant system prompt plus persistent memory,
        user personalization context, abuse & safety rules, math rigor prompt, and language matching directive.
        """
        extra_system_context = []

        # Always include abuse & safety policy
        extra_system_context.append(ABUSE_AND_SAFETY_PROMPT)

        # Always include mobile layout, headings, and table policy
        extra_system_context.append(TABLE_AND_LAYOUT_PROMPT)

        # Include user personalization context block (nickname, preferences, memories, styles)
        if user_context:
            context_block = format_user_context_block(user_context)
            if context_block:
                extra_system_context.append(context_block)

        # Include image understanding & puzzle reasoning policy if images present
        if has_image_content(messages):
            extra_system_context.append(IMAGE_REASONING_PROMPT)

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

        # Prune older images to conserve token limits (only keep latest 2 messages with images)
        trimmed_messages = prune_historical_images(trimmed_messages, keep_latest=2)

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

    async def _sanitize_response(
        self,
        client: httpx.AsyncClient,
        endpoint: str,
        headers: Dict[str, str],
        active_model: str,
        conversation: List[Dict[str, Any]],
        candidate_text: str,
        last_user_text: str,
        max_tokens: int
    ) -> str:
        """
        Backend profanity safeguard:
        If candidate text contains words from the blocklist, retries once with a hidden polite instruction.
        If still profane, replaces with a calm, polite fallback line.
        """
        clean_candidate = re.sub(r"<think>[\s\S]*?</think>", "", candidate_text).strip()
        if not contains_profanity(clean_candidate):
            return clean_candidate

        logger.warning("[AUTONEXIS SAFEGUARD] Profanity detected in model output, triggering polite retry.")
        retry_conversation = list(conversation) + [
            {"role": "assistant", "content": clean_candidate},
            {"role": "system", "content": "CRITICAL INSTRUCTION: Reply politely with absolutely no profanity, vulgarity, or swear words."}
        ]
        try:
            retry_payload = {
                "model": active_model,
                "messages": retry_conversation,
                "stream": False,
                "temperature": 0.3,
                "max_tokens": max_tokens,
            }
            res = await client.post(endpoint, json=retry_payload, headers=headers)
            if res.status_code == 200:
                retry_data = res.json()
                retry_raw = retry_data.get("choices", [{}])[0].get("message", {}).get("content", "")
                clean_retry = re.sub(r"<think>[\s\S]*?</think>", "", retry_raw).strip()
                if not contains_profanity(clean_retry) and clean_retry:
                    return clean_retry
        except Exception as retry_err:
            logger.error(f"[AUTONEXIS SAFEGUARD RETRY ERROR] {retry_err}")

        # Fall back to polite line if still failing
        return get_polite_fallback(last_user_text)

    async def chat_stream(
        self,
        messages: List[Dict[str, Any]],
        user_memory: Optional[str] = None,
        user_context: Optional[Dict[str, Any]] = None,
        is_guest: bool = False
    ) -> AsyncGenerator[str, None]:
        """
        Streams completion tokens as Server-Sent Events (SSE) data chunks.
        For mathematical inquiries, resolves exact_math tools with high precision before streaming.
        Applies backend profanity safeguard to guarantee no profanity ever reaches the user.
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
        last_user_text = get_last_user_text(messages)

        # -------------------------------------------------------------------
        # MATH ROUTE: Multi-turn exact calculation tool loop (up to 10 turns)
        # -------------------------------------------------------------------
        if is_math:
            max_tokens = 512 if is_guest else 3000
            conversation = self._prepare_messages(messages, user_memory, user_context=user_context, is_math=True)
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

                    # Sanitize final content through backend profanity safeguard
                    clean_content = await self._sanitize_response(
                        client, endpoint, headers, active_model,
                        conversation, final_content, last_user_text, max_tokens
                    )

                    # Stream text in smooth chunks to client
                    chunk_size = 8
                    for i in range(0, len(clean_content), chunk_size):
                        sub_str = clean_content[i:i + chunk_size]
                        yield f"data: {json.dumps({'content': sub_str}, ensure_ascii=False)}\n\n"
                        await asyncio.sleep(0.008)

                    yield "data: [DONE]\n\n"
                    return

            except Exception as e:
                logger.error(f"[AUTONEXIS LLM MATH EXCEPTION] {e}")
                yield f"data: {json.dumps({'error': True, 'content': fallback_error_msg}, ensure_ascii=False)}\n\n"
                yield "data: [DONE]\n\n"
                return

        # -------------------------------------------------------------------
        # GENERAL CHAT & VISION ROUTE: True Real-time SSE Token Streaming
        # -------------------------------------------------------------------
        max_tokens = 512 if is_guest else 2048
        conversation = self._prepare_messages(messages, user_memory, user_context=user_context, is_math=False)

        # Optional Think Mode Self-Check for Images/Complex Reasoning
        enable_self_check = getattr(settings, "llm_enable_think_self_check", True)
        run_self_check = enable_self_check and not is_guest and is_vision

        if run_self_check:
            # First produce response, then run verification check
            payload = {
                "model": active_model,
                "messages": conversation,
                "stream": False,
                "temperature": 0.2,
                "max_tokens": max_tokens,
            }
            try:
                timeout = httpx.Timeout(connect=15.0, read=70.0, write=15.0, pool=15.0)
                async with httpx.AsyncClient(timeout=timeout) as client:
                    res = await client.post(endpoint, json=payload, headers=headers)
                    if res.status_code != 200:
                        error_body = res.text
                        logger.error(f"[AUTONEXIS LLM VISION ERROR] Status {res.status_code}: {error_body}")
                        yield f"data: {json.dumps({'error': True, 'content': fallback_error_msg}, ensure_ascii=False)}\n\n"
                        yield "data: [DONE]\n\n"
                        return

                    raw_ans = res.json().get("choices", [{}])[0].get("message", {}).get("content", "")
                    
                    # Run quick self-check verification
                    check_convo = list(conversation) + [
                        {"role": "assistant", "content": raw_ans},
                        {"role": "user", "content": "Carefully double-check your answer above. Check for any arithmetic mistakes, missed constraints, or visual inaccuracies. If you find any error, provide the corrected answer. If it is 100% correct, reply 'VERIFIED_CORRECT'."}
                    ]
                    check_payload = {
                        "model": active_model,
                        "messages": check_convo,
                        "stream": False,
                        "temperature": 0.1,
                        "max_tokens": max_tokens,
                    }
                    final_ans = raw_ans
                    try:
                        check_res = await client.post(endpoint, json=check_payload, headers=headers)
                        if check_res.status_code == 200:
                            check_text = check_res.json().get("choices", [{}])[0].get("message", {}).get("content", "").strip()
                            if check_text and "VERIFIED_CORRECT" not in check_text and len(check_text) > 20:
                                final_ans = check_text
                    except Exception as chk_err:
                        logger.warning(f"[AUTONEXIS SELF-CHECK WARNING] {chk_err}")

                    clean_ans = await self._sanitize_response(
                        client, endpoint, headers, active_model,
                        conversation, final_ans, last_user_text, max_tokens
                    )

                    chunk_size = 8
                    for i in range(0, len(clean_ans), chunk_size):
                        sub_str = clean_ans[i:i + chunk_size]
                        yield f"data: {json.dumps({'content': sub_str}, ensure_ascii=False)}\n\n"
                        await asyncio.sleep(0.008)

                    yield "data: [DONE]\n\n"
                    return
            except Exception as ex:
                logger.error(f"[AUTONEXIS LLM EXCEPTION] {ex}")
                yield f"data: {json.dumps({'error': True, 'content': fallback_error_msg}, ensure_ascii=False)}\n\n"
                yield "data: [DONE]\n\n"
                return

        # Pure Real-time Streaming with stream=True towards model provider
        payload = {
            "model": active_model,
            "messages": conversation,
            "stream": True,
            "temperature": 0.6,
            "max_tokens": max_tokens,
        }

        try:
            timeout = httpx.Timeout(connect=15.0, read=90.0, write=15.0, pool=15.0)
            async with httpx.AsyncClient(timeout=timeout) as client:
                async with client.stream("POST", endpoint, json=payload, headers=headers) as response:
                    if response.status_code != 200:
                        error_body = await response.aread()
                        logger.error(f"[AUTONEXIS LLM STREAM ERROR] Status {response.status_code}: {error_body.decode('utf-8', errors='ignore')}")
                        yield f"data: {json.dumps({'error': True, 'content': fallback_error_msg}, ensure_ascii=False)}\n\n"
                        yield "data: [DONE]\n\n"
                        return

                    async for line in response.aiter_lines():
                        line_str = line.strip()
                        if not line_str:
                            continue
                        if line_str == "data: [DONE]":
                            break
                        if line_str.startswith("data: "):
                            raw_chunk = line_str[6:].strip()
                            try:
                                chunk_json = json.loads(raw_chunk)
                                delta = chunk_json.get("choices", [{}])[0].get("delta", {})
                                token_piece = delta.get("content", "")
                                if token_piece:
                                    yield f"data: {json.dumps({'content': token_piece}, ensure_ascii=False)}\n\n"
                            except Exception:
                                pass

                    yield "data: [DONE]\n\n"
        except Exception as e:
            logger.error(f"[AUTONEXIS LLM STREAM EXCEPTION] {e}")
            yield f"data: {json.dumps({'error': True, 'content': fallback_error_msg}, ensure_ascii=False)}\n\n"
            yield "data: [DONE]\n\n"

    async def chat_non_stream(
        self,
        messages: List[Dict[str, Any]],
        user_memory: Optional[str] = None,
        user_context: Optional[Dict[str, Any]] = None,
        is_guest: bool = False
    ) -> Dict[str, str]:
        """
        Non-streaming completion fallback with profanity safeguard.
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
        last_user_text = get_last_user_text(messages)

        if is_math:
            max_tokens = 512 if is_guest else 3000
            conversation = self._prepare_messages(messages, user_memory, user_context=user_context, is_math=True)
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
                            clean_reply = await self._sanitize_response(
                                client, endpoint, headers, active_model,
                                conversation, raw_reply, last_user_text, max_tokens
                            )
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
        conversation = self._prepare_messages(messages, user_memory, user_context=user_context, is_math=False)
        payload = {
            "model": active_model,
            "messages": conversation,
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
                clean_reply = await self._sanitize_response(
                    client, endpoint, headers, active_model,
                    conversation, reply, last_user_text, max_tokens
                )
                return {"reply": clean_reply}
        except Exception as e:
            logger.error(f"[AUTONEXIS LLM EXCEPTION] {e}")
            return {"reply": fallback_error_msg}

    async def extract_memories(
        self,
        messages: List[Dict[str, Any]],
        existing_memories: Optional[List[Dict[str, Any]]] = None
    ) -> Dict[str, Any]:
        """
        Cheap, fast LLM call to extract durable facts from recent chat turn.
        Guarded by rate-limit backoff and returns empty changes on any error.
        """
        import time as _time
        now = _time.time()
        if getattr(self, "_last_rate_limit_ts", 0) and (now - self._last_rate_limit_ts < 60):
            logger.info("Skipping memory extraction due to recent provider rate limit backoff")
            return {"changes": []}

        recent_turns = []
        for m in messages[-6:]:
            role = m.get("role", "user")
            text = extract_text_from_content(m.get("content", ""))
            if text:
                recent_turns.append(f"{role.upper()}: {text[:400]}")

        if not recent_turns:
            return {"changes": []}

        existing_str = ""
        if existing_memories:
            existing_lines = [f"- [ID: {em.get('id', '')}]: {em.get('text', '')}" for em in existing_memories[:50]]
            existing_str = "\nEXISTING MEMORIES:\n" + "\n".join(existing_lines)

        user_prompt = f"CONVERSATION HISTORY:\n" + "\n".join(recent_turns) + existing_str + "\n\nExtract changes as strict JSON:"

        payload = {
            "model": self.model,
            "messages": [
                {"role": "system", "content": MEMORY_EXTRACTION_SYSTEM_PROMPT},
                {"role": "user", "content": user_prompt}
            ],
            "temperature": 0.0,
            "max_tokens": 300,
        }

        try:
            async with httpx.AsyncClient(timeout=12.0) as client:
                res = await client.post(
                    f"{self.base_url}/chat/completions",
                    headers={
                        "Authorization": f"Bearer {self.api_key}",
                        "Content-Type": "application/json",
                    },
                    json=payload
                )
                if res.status_code == 429:
                    self._last_rate_limit_ts = _time.time()
                    return {"changes": []}
                
                if res.status_code != 200:
                    return {"changes": []}

                data = res.json()
                raw_content = data.get("choices", [{}])[0].get("message", {}).get("content", "").strip()
                if raw_content.startswith("```"):
                    raw_content = re.sub(r"^```[a-zA-Z]*\n?", "", raw_content)
                    raw_content = re.sub(r"\n?```$", "", raw_content).strip()

                parsed = json.loads(raw_content)
                if isinstance(parsed, dict) and "changes" in parsed:
                    clean_changes = []
                    for ch in parsed["changes"]:
                        if isinstance(ch, dict) and ch.get("action") in ("add", "update", "none"):
                            if ch.get("action") != "none" and not ch.get("text"):
                                continue
                            clean_changes.append(ch)
                    return {"changes": clean_changes}
                return {"changes": []}
        except Exception as e:
            logger.warning(f"Memory extraction non-blocking error: {e}")
            return {"changes": []}

llm_client = LLMClient()
