import asyncio
import sys
import httpx
from main import app
from database import init_db

if sys.platform == "win32":
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")

async def run_tests():
    print("=" * 70)
    print("AUTONEXIS Assistant - STEP 2: Auth, Accounts & Chat History Test")
    print("=" * 70)

    # Initialize DB tables
    await init_db()

    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://testserver") as client:

        # -------------------------------------------------------------
        # 1. EMAIL & PASSWORD AUTHENTICATION TEST
        # -------------------------------------------------------------
        print("\n[1] ईमेल और पासवर्ड प्रमाणीकरण (Email & Password Auth):")
        email_payload = {
            "email": "owner@autonexis.ai",
            "password": "PremiumPassword2026!",
            "display_name": "Autonexis Admin"
        }
        # Registration
        reg_resp = await client.post("/api/auth/register-email", json=email_payload)
        print(f"Register status: {reg_resp.status_code}")
        assert reg_resp.status_code == 200, reg_resp.text
        reg_data = reg_resp.json()
        token1 = reg_data["token"]
        user1_id = reg_data["user"]["id"]
        print(f"✅ User registered! ID: {user1_id}, Name: {reg_data['user']['display_name']}")

        # Wrong password check
        bad_login = await client.post("/api/auth/login-email", json={"email": "owner@autonexis.ai", "password": "wrong"})
        assert bad_login.status_code == 401
        print("✅ Wrong password correctly rejected (401)")

        # Correct login check
        login_resp = await client.post("/api/auth/login-email", json={"email": "owner@autonexis.ai", "password": "PremiumPassword2026!"})
        assert login_resp.status_code == 200
        print("✅ Correct password login successful!")

        # -------------------------------------------------------------
        # 2. GOOGLE LOGIN & UNIFIED ACCOUNT TEST
        # -------------------------------------------------------------
        print("\n[2] गूगल लॉगिन एवं एकीकृत खाता (Google Login & Unified Account):")
        # Login with Google using same email "owner@autonexis.ai"
        google_payload = {
            "id_token": "mock_google_token_123",
            "email": "owner@autonexis.ai",
            "display_name": "Autonexis Admin",
            "sub": "google_sub_owner_999"
        }
        g_resp = await client.post("/api/auth/google", json=google_payload)
        assert g_resp.status_code == 200
        g_data = g_resp.json()
        assert g_data["user"]["id"] == user1_id, "Account must be unified by email!"
        print(f"✅ Unified Account Verified: User logged in via Google has identical User ID ({user1_id})!")

        # -------------------------------------------------------------
        # 3. MOBILE OTP AUTHENTICATION & LOCKOUT TEST
        # -------------------------------------------------------------
        print("\n[3] मोबाइल नंबर एवं 6-अंकों का ओटीपी (Mobile OTP & Security):")
        phone_num = "+919876500001"
        otp_send = await client.post("/api/auth/phone/send-otp", json={"phone": phone_num})
        assert otp_send.status_code == 200, otp_send.text
        otp_code = otp_send.json().get("dev_otp")
        print(f"✅ OTP sent to {phone_num}: (Received 6-digit code: {otp_code})")

        # Test wrong OTP attempt counter
        wrong_otp_resp = await client.post("/api/auth/phone/verify-otp", json={"phone": phone_num, "otp": "000000"})
        assert wrong_otp_resp.status_code == 400
        print(f"✅ Wrong OTP caught: {wrong_otp_resp.json()['detail']}")

        # Test consecutive wrong OTPs leading to lockout
        lockout_phone = "+919876500002"
        await client.post("/api/auth/phone/send-otp", json={"phone": lockout_phone})
        print(f"Testing 5 wrong OTP attempts for lockout on {lockout_phone}...")
        for i in range(4):
            await client.post("/api/auth/phone/verify-otp", json={"phone": lockout_phone, "otp": "111111"})
        fifth_resp = await client.post("/api/auth/phone/verify-otp", json={"phone": lockout_phone, "otp": "111111"})
        assert fifth_resp.status_code == 429
        print(f"✅ 5th wrong attempt triggered lockout (429): {fifth_resp.json()['detail']}")

        # Verify correct OTP on first phone
        verify_resp = await client.post("/api/auth/phone/verify-otp", json={"phone": phone_num, "otp": otp_code})
        assert verify_resp.status_code == 200
        phone_user = verify_resp.json()
        print(f"✅ Valid OTP verified! User ID: {phone_user['user']['id']}")

        # -------------------------------------------------------------
        # 4. CHAT HISTORY & CONVERSATION CONTEXT
        # -------------------------------------------------------------
        print("\n[4] चैट हिस्ट्री एवं संवादात्मक संदर्भ (Chat History & Context):")
        auth_headers = {"Authorization": f"Bearer {token1}"}

        # Create new chat
        create_chat_resp = await client.post("/api/chats", json={"title": "नई बातचीत"}, headers=auth_headers)
        assert create_chat_resp.status_code == 200
        chat_id = create_chat_resp.json()["id"]
        print(f"✅ New chat created! Chat ID: {chat_id}")

        # Send first message (ask about sorting)
        msg1_resp = await client.post(
            f"/api/chats/{chat_id}/message",
            json={"content": "पायथन में लिस्ट को उलटने (reverse) का सबसे छोटा तरीका क्या है?"},
            headers=auth_headers
        )
        assert msg1_resp.status_code == 200, msg1_resp.text
        msg1_data = msg1_resp.json()
        print(f"Auto-generated Chat Title: '{msg1_data['title']}'")
        print(f"Assistant Reply:\n{msg1_data['assistant_message']['content'][:120]}...")

        # Send follow-up message (requires context)
        msg2_resp = await client.post(
            f"/api/chats/{chat_id}/message",
            json={"content": "क्या इसका कोई दूसरा तरीका भी है?"},
            headers=auth_headers
        )
        assert msg2_resp.status_code == 200
        msg2_data = msg2_resp.json()
        print(f"\nContextual Follow-up Reply:\n{msg2_data['assistant_message']['content'][:120]}...")

        # Fetch full chat details
        chat_details = await client.get(f"/api/chats/{chat_id}", headers=auth_headers)
        assert chat_details.status_code == 200
        messages = chat_details.json()["messages"]
        print(f"✅ Chat messages persisted in SQLite DB: {len(messages)} messages stored.")

        # List all chats
        chat_list = await client.get("/api/chats", headers=auth_headers)
        assert chat_list.status_code == 200
        assert len(chat_list.json()) >= 1
        print(f"✅ List chats endpoint returned {len(chat_list.json())} conversation(s).")

        # -------------------------------------------------------------
        # 5. USER SETTINGS & THEME PREFERENCE
        # -------------------------------------------------------------
        print("\n[5] सेटिंग्स एवं थीम पसंद (Settings & Theme Preference):")
        update_profile = await client.put(
            "/api/auth/profile",
            json={"display_name": "ऑटोनेक्सिस स्वामी", "theme_preference": "dark"},
            headers=auth_headers
        )
        assert update_profile.status_code == 200
        profile_data = update_profile.json()["user"]
        assert profile_data["theme_preference"] == "dark"
        assert profile_data["display_name"] == "ऑटोनेक्सिस स्वामी"
        print(f"✅ Profile & Theme updated: {profile_data['display_name']} | Theme: {profile_data['theme_preference']}")

        # -------------------------------------------------------------
        # 6. DELETE CHAT
        # -------------------------------------------------------------
        print("\n[6] चैट डिलीट (Delete Chat):")
        del_resp = await client.delete(f"/api/chats/{chat_id}", headers=auth_headers)
        assert del_resp.status_code == 200
        print(f"✅ Chat deleted: {del_resp.json()['message']}")

        # Confirm deleted
        check_del = await client.get(f"/api/chats/{chat_id}", headers=auth_headers)
        assert check_del.status_code == 404
        print("✅ Confirmed: Deleted chat is no longer accessible (404).")

    print("\n" + "=" * 70)
    print("STEP 2 COMPLETE: ALL 3 AUTH METHODS, LOCKOUT, AND CHAT HISTORY PASSED 100%!")
    print("=" * 70)

if __name__ == "__main__":
    asyncio.run(run_tests())

