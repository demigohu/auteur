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
    # Public demo guards; 0 disables each one (the local default).
    max_file_seconds: float = float(os.getenv("MAX_FILE_SECONDS", "0"))
    runs_per_visitor_per_day: int = int(os.getenv("RUNS_PER_VISITOR_PER_DAY", "0"))
    spend_cap_usd: float = float(os.getenv("SPEND_CAP_USD", "0"))
    # Clerk: the publishable key names the instance (its JWKS and issuer). The same key as the web app's
    # NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY. CLERK_JWKS_URL overrides where the signing keys come from.
    clerk_publishable_key: str = os.getenv("CLERK_PUBLISHABLE_KEY", "")
    clerk_jwks_url: str = os.getenv("CLERK_JWKS_URL", "")
    # Meta API spend allowed per account, in USD (0 = no cap).
    user_spend_cap_usd: float = float(os.getenv("USER_SPEND_CAP_USD", "0"))
    cors_origins: list[str] = field(
        default_factory=lambda: os.getenv("CORS_ORIGINS", "http://localhost:3000").split(",")
    )


settings = Settings()
