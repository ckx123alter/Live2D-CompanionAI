from pathlib import Path
from urllib.parse import urlsplit
from typing import Literal

from pydantic import Field, SecretStr, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

ROOT = Path(__file__).resolve().parent.parent


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=ROOT / ".env", env_file_encoding="utf-8", extra="ignore", hide_input_in_errors=True)

    app_env: Literal["local", "production"] = "local"
    # Optional server-key budgets; local use and BYOK are unlimited by default.
    server_daily_budgets_enabled: bool = False
    daily_session_calls: int = Field(default=80, ge=1)
    daily_ip_calls: int = Field(default=150, ge=1)
    daily_global_calls: int = Field(default=2000, ge=1)
    daily_session_tokens: int = Field(default=500_000, ge=1)
    daily_ip_tokens: int = Field(default=1_000_000, ge=1)
    daily_global_tokens: int = Field(default=10_000_000, ge=1)
    daily_session_tts_chars: int = Field(default=15_000, ge=1)
    daily_ip_tts_chars: int = Field(default=30_000, ge=1)
    daily_global_tts_chars: int = Field(default=250_000, ge=1)
    max_session_messages: int = Field(default=100, ge=20, le=2000, multiple_of=2)
    max_sessions: int = Field(default=2000, ge=1)
    session_retention_days: int = Field(default=3, ge=1, le=30)
    audio_retention_days: int = Field(default=3, ge=1, le=30)
    max_session_audio_mb: int = Field(default=20, ge=1)
    max_audio_cache_mb: int = Field(default=256, ge=10)
    max_shared_audio_mb: int = Field(default=32, ge=1)
    min_free_disk_mb: int = Field(default=256, ge=0)
    maintenance_interval: int = Field(default=300, ge=10)

    llm_api_key: SecretStr = SecretStr("")
    llm_base_url: str = "https://api.deepseek.com/v1"
    llm_model: str = "deepseek-flash"
    llm_json_mode: bool = True
    llm_thinking: Literal["auto", "disabled", "enabled"] = "auto"
    tts_provider: Literal["openai", "doubao"] = "openai"
    doubao_tts_api_key: SecretStr = SecretStr("")
    doubao_tts_voice: str = Field(default="ICL_uranus_zh_female_tianmeijiaoqiao_tob", min_length=1)
    doubao_tts_resource_id: Literal["seed-tts-2.0"] = "seed-tts-2.0"
    doubao_tts_speech_rate: int = Field(default=0, ge=-50, le=100)
    tts_api_key: SecretStr = SecretStr("")
    tts_base_url: str = "https://api.siliconflow.cn/v1"
    tts_model: str = "FunAudioLLM/CosyVoice2-0.5B"
    tts_voice: str = "FunAudioLLM/CosyVoice2-0.5B:anna"
    request_timeout: float = Field(default=60, ge=1, le=180)
    database_path: Path = ROOT / "data" / "chat.sqlite3"
    static_dir: Path = ROOT / "frontend" / "dist"
    app_password: SecretStr = SecretStr("")
    cookie_secure: bool = False
    allowed_origins: str = "http://127.0.0.1:8000,http://localhost:8000,http://127.0.0.1:5173,http://localhost:5173,http://127.0.0.1:5175,http://localhost:5175"
    requests_per_minute: int = Field(default=30, ge=1, le=1000)
    max_concurrent_requests: int = Field(default=4, ge=1, le=100)

    @model_validator(mode="after")
    def validate_provider(self):
        if self.max_shared_audio_mb > self.max_audio_cache_mb:
            raise ValueError("共享音频上限不能超过总音频上限")
        for url in (self.llm_base_url, self.tts_base_url):
            if not url.startswith(("http://", "https://")):
                raise ValueError("服务地址必须是 HTTP(S) URL")
        if self.app_env == "production":
            if not self.cookie_secure:
                raise ValueError("生产模式必须设置 COOKIE_SECURE=true")
            if not self.origins:
                raise ValueError("生产模式必须配置 HTTPS ALLOWED_ORIGINS")
            for origin in self.origins:
                parsed = urlsplit(origin)
                if parsed.scheme != "https" or not parsed.hostname or parsed.hostname in {"localhost", "127.0.0.1", "::1"} or parsed.username or parsed.password or parsed.path not in {"", "/"} or parsed.query or parsed.fragment:
                    raise ValueError("生产模式 ALLOWED_ORIGINS 必须是完整的公网 HTTPS Origin")
            for url in (self.llm_base_url, self.tts_base_url):
                if urlsplit(url).scheme != "https":
                    raise ValueError("生产模式的供应商地址必须使用 HTTPS")
            # Even accidentally copied server credentials must not survive in
            # production provider configuration. User keys arrive per request.
            self.llm_api_key = SecretStr("")
            self.tts_api_key = SecretStr("")
            self.doubao_tts_api_key = SecretStr("")
        return self

    @property
    def tts_enabled(self) -> bool:
        if self.tts_provider == "doubao":
            return bool(self.doubao_tts_api_key.get_secret_value())
        return bool(self.tts_api_key.get_secret_value())

    @property
    def tts_mode(self) -> str:
        if self.app_env == "production" or self.tts_enabled:
            return "server"
        return "disabled" if self.tts_provider == "doubao" else "browser"

    @property
    def origins(self) -> set[str]:
        return {value.strip().rstrip("/") for value in self.allowed_origins.split(",") if value.strip()}
