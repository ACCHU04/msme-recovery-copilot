"""FastAPI app. Run: uvicorn app.main:app --reload  (from backend/)"""
from __future__ import annotations

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from .api.routes import router
from .config import Settings, get_settings
from .store import MemoryStore, Store, SupabaseStore


def build_store(settings: Settings) -> Store:
    if settings.store == "supabase":
        if not (settings.supabase_url and settings.supabase_service_key):
            raise RuntimeError("STORE=supabase needs SUPABASE_URL and SUPABASE_SERVICE_KEY")
        return SupabaseStore(settings.supabase_url, settings.supabase_service_key)
    return MemoryStore(seed=True)


def create_app(settings: Settings | None = None, store: Store | None = None) -> FastAPI:
    settings = settings or get_settings()
    app = FastAPI(title="LS-03 MSME Payment Recovery API", version="0.1.0")
    app.state.settings = settings
    app.state.store = store or build_store(settings)
    app.add_middleware(CORSMiddleware, allow_origins=settings.cors_origins,
                       allow_methods=["*"], allow_headers=["*"])

    @app.exception_handler(RequestValidationError)
    async def validation_error(request: Request, exc: RequestValidationError):
        errors = [{"field": ".".join(str(p) for p in e["loc"] if p != "body") or "body",
                   "message": e["msg"].removeprefix("Value error, ")}
                  for e in exc.errors()]
        return JSONResponse(status_code=422, content={**errors[0], "errors": errors})

    app.include_router(router)
    return app


app = create_app()
