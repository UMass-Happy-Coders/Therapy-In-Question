from functools import lru_cache
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=(".env", "../.env"), extra="ignore")

    database_url: str
    mongodb_uri: str
    mongodb_db: str = "therapy"
    gemini_api_key: str
    gemini_model: str = "gemini-3.8-flash"
    jwt_secret: str

    @field_validator("database_url")
    @classmethod
    def to_asyncpg(cls, url: str) -> str:
        parts = urlsplit(url)
        scheme = (
            "postgresql+asyncpg"
            if parts.scheme in ("postgres", "postgresql")
            else parts.scheme
        )
        query = [("ssl" if k == "sslmode" else k, v) for k, v in parse_qsl(parts.query)]
        return urlunsplit(
            (scheme, parts.netloc, parts.path, urlencode(query), parts.fragment)
        )


@lru_cache
def get_settings() -> Settings:
    return Settings()
