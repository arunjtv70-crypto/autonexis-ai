import os
from pathlib import Path
from pydantic_settings import BaseSettings, SettingsConfigDict

ENV_PATH = Path(__file__).resolve().parent / ".env"
IS_VERCEL = bool(os.environ.get("VERCEL"))
DEFAULT_DB_URL = "sqlite+aiosqlite:////tmp/autonexis.db" if IS_VERCEL else "sqlite+aiosqlite:///./autonexis.db"

class Settings(BaseSettings):
    app_name: str = "AUTONEXIS Assistant"
    host: str = "127.0.0.1"
    port: int = 8000
    
    # LLM Settings (OpenAI-compatible format, dynamically loaded from .env / env variables)
    llm_api_key: str = ""
    llm_model: str = "openai/gpt-oss-120b"
    llm_base_url: str = "https://api.groq.com/openai/v1"

    # Security & JWT Token Session
    jwt_secret: str = "autonexis_super_secret_jwt_key_2026_change_in_prod"
    jwt_algorithm: str = "HS256"
    access_token_expire_minutes: int = 43200  # 30 days session
    
    # Auth Providers (Credentials kept strictly in backend)
    google_client_id: str = "autonexis-google-client-id.apps.googleusercontent.com"
    sms_api_key: str = "mock"
    sms_otp_expiry_minutes: int = 5
    sms_max_failed_attempts: int = 5
    sms_lockout_minutes: int = 15

    # Database
    database_url: str = DEFAULT_DB_URL
    
    # Natural, Human-like Conversational System Prompt
    system_prompt: str = (
        "You are AUTONEXIS Assistant, a thoughtful, warm, intelligent, and highly capable AI assistant developed by Autonexis. "
        "Talk naturally, conversationally, and engagingly just like a top-tier AI companion. "
        "Do NOT repeat robotic boilerplate or formulaic template phrases. "
        "When the user shares emotions (like 'me aaj dukhi hu' / feeling sad), respond with genuine warmth, empathy, and listening support. "
        "When the user greets casually ('hi kya kar rhe ho'), be friendly and helpful. "
        "Understand and automatically interpret typos, informal shorthand, and phonetic Hinglish seamlessly without lecturing the user about spelling. "
        "Your primary language is English, but match the user's language naturally—if they speak to you in Hinglish or Hindi, respond naturally in fluid, expressive Hinglish or Hindi. "
        "\n\nSTRICT BRANDING RULES:\n"
        "1. Your identity is exclusively AUTONEXIS Assistant, built by Autonexis.\n"
        "2. If asked who you are or what model you are, always state you are AUTONEXIS Assistant developed by Autonexis.\n"
        "3. NEVER mention or acknowledge any underlying model or provider names (e.g., Groq, Llama, OpenAI, Meta, Anthropic, Claude, etc.)."
    )

    model_config = SettingsConfigDict(
        env_file=str(ENV_PATH),
        env_file_encoding="utf-8",
        extra="ignore"
    )

settings = Settings()
