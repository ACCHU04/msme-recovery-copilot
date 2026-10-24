"""Settings read from environment variables (see .env.example)."""
from __future__ import annotations

import os
from dataclasses import dataclass

DEMO_BUSINESS_ID = "11111111-1111-1111-1111-111111111111"


@dataclass(frozen=True)
class Settings:
    store: str                  # "memory" (default, offline demo) or "supabase"
    auth_mode: str              # "demo" (memory store only) or "supabase"
    supabase_url: str | None
    supabase_service_key: str | None
    supabase_jwt_secret: str | None
    cors_origins: list[str]
    demo_business_id: str


def get_settings() -> Settings:
    store = os.getenv("STORE", "memory")
    auth_mode = os.getenv("AUTH_MODE", "demo" if store == "memory" else "supabase")
    if store == "supabase" and auth_mode != "supabase":
        raise RuntimeError("Real data needs real auth: STORE=supabase requires AUTH_MODE=supabase")
    return Settings(
        store=store,
        auth_mode=auth_mode,
        supabase_url=os.getenv("SUPABASE_URL"),
        supabase_service_key=os.getenv("SUPABASE_SERVICE_KEY"),
        supabase_jwt_secret=os.getenv("SUPABASE_JWT_SECRET") or None,
        cors_origins=[o.strip() for o in os.getenv(
            "CORS_ORIGINS", "http://localhost:3000").split(",") if o.strip()],
        demo_business_id=os.getenv("DEMO_BUSINESS_ID", DEMO_BUSINESS_ID),
    )
