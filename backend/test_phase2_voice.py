"""
Unit test suite for Phase 2: Casual, Natural Voice & Anti-Repetition Guard.
Verifies prompt guidelines, intent classifiers, fallback handlers, and sampling settings.
"""

import sys
import os

# Add backend directory to sys.path
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from prompts import ABUSE_AND_SAFETY_PROMPT
from config import settings
from profanity_blocklist import get_polite_fallback
from llm_client import LLMClient, _is_canned_or_repetitive

def run_tests():
    print("=== RUNNING PHASE 2 TEST SUITE: CASUAL NATURAL VOICE & ANTI-REPETITION ===")
    passed = 0
    total = 0

    def assert_test(condition, desc):
        nonlocal passed, total
        total += 1
        if condition:
            passed += 1
            print(f"✅ PASS: {desc}")
        else:
            print(f"❌ FAIL: {desc}")
            raise AssertionError(f"Failed: {desc}")

    # [1] Prompt Audit: No copyable boilerplate quotes
    assert_test(
        "Main yahan help ke liye hoon, aap kaam ki baat batao toh pakka madad karunga." not in ABUSE_AND_SAFETY_PROMPT,
        "No canned example quote in ABUSE_AND_SAFETY_PROMPT"
    )
    assert_test(
        "Claude" not in ABUSE_AND_SAFETY_PROMPT and "claude" not in ABUSE_AND_SAFETY_PROMPT.lower(),
        "Never mentions forbidden word in prompt text (except negative boundary)"
    )
    assert_test(
        "SLANG, CASUAL BANTER & TEASING" in ABUSE_AND_SAFETY_PROMPT,
        "Includes colloquial slang and banter principles"
    )
    assert_test(
        "ANTI-REPETITION & VARIETY MANDATE" in ABUSE_AND_SAFETY_PROMPT,
        "Includes explicit anti-repetition mandate in behavior prompt"
    )

    # [2] Conversational Tone & Intent Guidelines in _prepare_messages
    client = LLMClient()

    # Case A: Casual greeting
    msgs_greeting = [{"role": "user", "content": "Or bhai kya haal hai"}]
    prep_greeting = client._prepare_messages(msgs_greeting)
    sys_content_greeting = prep_greeting[0]["content"]
    assert_test(
        "[CASUAL GREETING GUIDELINE]" in sys_content_greeting,
        "Injects [CASUAL GREETING GUIDELINE] for 'Or bhai kya haal hai'"
    )
    assert_test(
        "DO NOT attach any corporate sign-off" in sys_content_greeting,
        "Forbids corporate sign-off on casual greeting"
    )

    # Case B: Casual Indian banter / teasing slang
    msgs_slang = [{"role": "user", "content": "Chal be lawde"}]
    prep_slang = client._prepare_messages(msgs_slang)
    sys_content_slang = prep_slang[0]["content"]
    assert_test(
        "[CASUAL BANTER & SLANG GUIDELINE]" in sys_content_slang,
        "Injects [CASUAL BANTER & SLANG GUIDELINE] for 'Chal be lawde'"
    )
    assert_test(
        "NEVER give a customer-care boundary line" in sys_content_slang,
        "Instructs zero customer-care line on casual banter"
    )

    # Case C: Playful pushback / challenge
    msgs_challenge = [{"role": "user", "content": "Nahi btai to kya kar lega Mera"}]
    prep_challenge = client._prepare_messages(msgs_challenge)
    sys_content_challenge = prep_challenge[0]["content"]
    assert_test(
        "[PLAYFUL CHALLENGE GUIDELINE]" in sys_content_challenge,
        "Injects [PLAYFUL CHALLENGE GUIDELINE] for 'Nahi btai to kya kar lega Mera'"
    )
    assert_test(
        "Zero ego, zero defensiveness" in sys_content_challenge,
        "Requires zero ego and lighthearted self-awareness"
    )

    # [3] Anti-Repetition Guard across turns
    msgs_convo = [
        {"role": "user", "content": "Chal be lawde"},
        {"role": "assistant", "content": "Chill maar bhai, bata kya hua?"},
        {"role": "user", "content": "Nahi btai to kya kar lega Mera"},
    ]
    prep_convo = client._prepare_messages(msgs_convo)
    sys_content_convo = prep_convo[0]["content"]
    assert_test(
        "[CONVERSATIONAL VARIETY & ANTI-REPETITION MANDATE]" in sys_content_convo,
        "Injects [CONVERSATIONAL VARIETY & ANTI-REPETITION MANDATE] when prior assistant turn exists"
    )
    assert_test(
        "Chill maar bhai, bata kya hua?" in sys_content_convo,
        "Embeds previous assistant turn snippet into anti-repetition mandate"
    )

    # [4] Canned Boilerplate & Repetition Defuser (_is_canned_or_repetitive)
    canned_str = "Main yahan help ke liye hoon, aap kaam ki baat batao toh pakka madad karunga."
    assert_test(
        _is_canned_or_repetitive(canned_str, "") is True,
        "Detects old canned Hindi/Hinglish line as canned boilerplate"
    )
    assert_test(
        _is_canned_or_repetitive("Main yahan aapki sahayata ke liye upasthit hoon.", "") is True,
        "Detects formal repetitive robotic line"
    )
    assert_test(
        _is_canned_or_repetitive("I am here to help you out. Let's focus on what you need done", "") is True,
        "Detects old canned English line"
    )
    assert_test(
        _is_canned_or_repetitive("Sab badhiya bhai, tu suna!", "Sab badhiya bhai, tu suna!") is True,
        "Detects exact duplicate turn loop"
    )
    assert_test(
        _is_canned_or_repetitive("Main kya karunga bhai, phone ke andar se bahar thodi aaunga! Chill maar.", "") is False,
        "Normal witty authentic reply is NOT flagged as canned"
    )

    # [5] Friendly, Natural Fallback Responses (get_polite_fallback)
    fb_banter = get_polite_fallback("Chal be lawde")
    assert_test(
        "chill maar bhai" in fb_banter.lower(),
        f"Fallback for friendly teasing is natural and chill ('{fb_banter}')"
    )
    assert_test(
        "madad" not in fb_banter.lower() and "help" not in fb_banter.lower(),
        "Fallback has zero customer-support words"
    )

    fb_challenge = get_polite_fallback("Nahi btai to kya kar lega Mera")
    assert_test(
        "phone ke andar" in fb_challenge.lower() or "chill maar" in fb_challenge.lower(),
        f"Fallback for playful challenge has witty self-awareness ('{fb_challenge}')"
    )

    fb_greeting = get_polite_fallback("Or bhai kya haal hai")
    assert_test(
        "kya chal raha hai" in fb_greeting.lower() or "bolo" in fb_greeting.lower(),
        f"Fallback for casual greeting is conversational and open ('{fb_greeting}')"
    )

    print(f"\n✨ ALL {passed}/{total} PHASE 2 TESTS PASSED SUCCESSFULLY! ✨")

if __name__ == "__main__":
    run_tests()

