"""FastAPI app. Run: uvicorn app.main:app --reload  (from backend/)"""
from __future__ import annotations

import logging
import uuid

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

from .api.routes import router
from .config import Settings, get_settings
from .legal_ai import GeminiClient, RateLimiter
from .store import MemoryStore, Store, SupabaseStore

logger = logging.getLogger("settle45")


def build_store(settings: Settings) -> Store:
    if settings.store == "supabase":
        if not (settings.supabase_url and settings.supabase_service_key):
            raise RuntimeError("STORE=supabase needs SUPABASE_URL and SUPABASE_SERVICE_KEY")
        return SupabaseStore(settings.supabase_url, settings.supabase_service_key)
    return MemoryStore(seed=True)


def create_app(settings: Settings | None = None, store: Store | None = None) -> FastAPI:
    settings = settings or get_settings()
    app = FastAPI(title="Settle45 API (LS-03)", version="0.1.0")
    app.state.settings = settings
    app.state.store = store or build_store(settings)
    # AI legal Q&A: off (prepared answers only) unless GEMINI_API_KEY is set.
    app.state.llm = GeminiClient(settings.gemini_api_key, settings.gemini_model) if settings.gemini_api_key else None
    app.state.llm_limiter = RateLimiter()
    app.add_middleware(CORSMiddleware, allow_origins=settings.cors_origins,
                       allow_methods=["*"], allow_headers=["*"])

    @app.exception_handler(RequestValidationError)
    async def validation_error(request: Request, exc: RequestValidationError):
        errors = [{"field": ".".join(str(p) for p in e["loc"] if p != "body") or "body",
                   "message": e["msg"].removeprefix("Value error, ")}
                  for e in exc.errors()]
        return JSONResponse(status_code=422, content={**errors[0], "errors": errors})

    @app.exception_handler(Exception)
    async def global_exception_handler(request: Request, exc: Exception):
        if isinstance(exc, StarletteHTTPException):
            return JSONResponse(
                status_code=exc.status_code,
                content={"detail": exc.detail},
                headers=exc.headers,
            )
        error_id = str(uuid.uuid4())
        logger.exception("Unhandled server exception [%s] on %s %s: %s",
                         error_id, request.method, request.url.path, exc)
        return JSONResponse(
            status_code=500,
            content={
                "detail": f"An unexpected internal error occurred. (Ref: {error_id})",
                "error_id": error_id,
            },
        )

    app.include_router(router)
    return app


app = create_app()
