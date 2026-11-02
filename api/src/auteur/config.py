import os
from dataclasses import dataclass, field
from pathlib import Path

from dotenv import load_dotenv

load_dotenv()


@dataclass(frozen=True)
class Settings:
    meta_api_key: str = os.getenv("META_API_KEY", "")
    meta_base_url: str = os.getenv("META_BASE_URL", "https://api.meta.ai/v1")
    data_dir: Path = Path(os.getenv("AUTEUR_DATA_DIR", "data")).resolve()
    font_path: str = os.getenv("FONT_PATH", "")
    cors_origins: list[str] = field(
        default_factory=lambda: os.getenv("CORS_ORIGINS", "http://localhost:3000").split(",")
    )


settings = Settings()
