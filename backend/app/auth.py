"""Who is calling, and which business they own.

AUTH_MODE=supabase (required for any deployment with real data):
  The frontend's server sends the Supabase session token as `Authorization: Bearer <jwt>`.
  We verify it, take `sub` as the user id, read that user's row in `profiles` (role and
  approval_status, which only trusted code can set; see supabase/migrations/003) and look
  up the business whose owner_id is that user. X-Business-Id is ignored.
  Roles: business data (cases, invoices, payments, drafts...) needs an approved supplier.
  The calculator and rate table need any approved account.
  Verification: HS256 with SUPABASE_JWT_SECRET if set (legacy projects), otherwise the
  project's public keys from /auth/v1/.well-known/jwks.json (asymmetric signing keys).

AUTH_MODE=demo (default only with STORE=memory, for local work and the offline demo):
  No token needed; X-Business-Id or the demo business is used.
"""
from __future__ import annotations

import time
from dataclasses import dataclass
from functools import lru_cache

import jwt
from fastapi import Header, HTTPException, Request

from .store import Store


ROLES = ("supplier", "buyer", "adviser", "admin")


@dataclass
class AuthContext:
    user_id: str | None
    business_id: str | None = None
    role: str = "supplier"          # demo mode acts as the demo supplier
    approved: bool = True


@lru_cache(maxsize=4)
def _jwks_client(url: str) -> jwt.PyJWKClient:
    return jwt.PyJWKClient(url.rstrip("/") + "/auth/v1/.well-known/jwks.json")


def verify_token(token: str, settings) -> str:
    try:
        if settings.supabase_jwt_secret:
            claims = jwt.decode(token, settings.supabase_jwt_secret, algorithms=["HS256"],
                                audience="authenticated")
        else:
            if not settings.supabase_url:
                raise HTTPException(500, "auth is not configured")
            key = _jwks_client(settings.supabase_url).get_signing_key_from_jwt(token)
            claims = jwt.decode(token, key.key, algorithms=["ES256", "RS256"],
                                audience="authenticated")
    except jwt.ExpiredSignatureError:
        raise HTTPException(401, "Your session expired. Sign in again.")
    except jwt.PyJWTError:
        raise HTTPException(401, "Sign in to continue.")
    sub = claims.get("sub")
    if not sub:
        raise HTTPException(401, "Sign in to continue.")
    return sub


def auth_context(request: Request, authorization: str | None = Header(default=None),
                 x_business_id: str | None = Header(default=None)) -> AuthContext:
    settings = request.app.state.settings
    store: Store = request.app.state.store
    if settings.auth_mode == "demo":
        return AuthContext(user_id=None, business_id=x_business_id or settings.demo_business_id)

    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(401, "Sign in to continue.")
    user_id = verify_token(authorization.split(" ", 1)[1].strip(), settings)
    cache = _ctx_cache(request)
    hit = cache.get(user_id)
    if hit and hit[0] > time.monotonic():
        return hit[1]
    profile = store.get("profiles", user_id)
    if profile is None or profile.get("role") not in ROLES:
        raise HTTPException(403, "Your account has no profile yet. Sign out and sign in again, "
                                 "or contact support.")
    owned = store.select("businesses", owner_id=user_id)
    ctx = AuthContext(user_id=user_id, business_id=owned[0]["id"] if owned else None,
                      role=profile["role"], approved=profile.get("approval_status") == "approved")
    if ctx.approved:                      # pending accounts are re-read, so approval shows at once
        if len(cache) > 1000:
            cache.clear()
        cache[user_id] = (time.monotonic() + CTX_TTL_SECONDS, ctx)
    return ctx


# The token is verified on every request (locally, no network). Who the user is in the app
# (profile and business) is kept for a short time so a page's parallel API calls do not each
# make two more database round trips. Role or approval changes show within this time.
CTX_TTL_SECONDS = 30


def _ctx_cache(request: Request) -> dict:
    cache = getattr(request.app.state, "auth_ctx_cache", None)
    if cache is None:
        cache = request.app.state.auth_ctx_cache = {}
    return cache


def forget_user(request: Request, user_id: str | None) -> None:
    """Call after changing a user's profile or business so the next request sees it."""
    if user_id:
        _ctx_cache(request).pop(user_id, None)


def approved_user(request: Request, authorization: str | None = Header(default=None),
                  x_business_id: str | None = Header(default=None)) -> AuthContext:
    """Any signed-in account that is approved (pending advisers are refused)."""
    ctx = auth_context(request, authorization, x_business_id)
    if not ctx.approved:
        raise HTTPException(403, "Your account is waiting for approval.")
    return ctx


def supplier(request: Request, authorization: str | None = Header(default=None),
             x_business_id: str | None = Header(default=None)) -> AuthContext:
    """An approved MSME supplier account: the only role that owns business data."""
    ctx = approved_user(request, authorization, x_business_id)
    if ctx.role != "supplier":
        raise HTTPException(403, "This needs an MSME supplier account.")
    return ctx


def current_business_id(request: Request, authorization: str | None = Header(default=None),
                        x_business_id: str | None = Header(default=None)) -> str:
    ctx = supplier(request, authorization, x_business_id)
    if ctx.business_id is None:
        raise HTTPException(404, "Set up your business profile first.")
    return ctx.business_id


def buyer(request: Request, authorization: str | None = Header(default=None),
          x_business_id: str | None = Header(default=None)) -> AuthContext:
    """An approved buyer account."""
    if request.app.state.settings.auth_mode == "demo":
        return AuthContext(user_id=None, role="buyer", approved=True)
    ctx = approved_user(request, authorization, x_business_id)
    if ctx.role not in ("buyer", "supplier", "admin"):
        raise HTTPException(403, "This needs a buyer account.")
    return ctx


def adviser(request: Request, authorization: str | None = Header(default=None),
            x_business_id: str | None = Header(default=None)) -> AuthContext:
    """An approved adviser account."""
    if request.app.state.settings.auth_mode == "demo":
        return AuthContext(user_id=None, role="adviser", approved=True)
    ctx = approved_user(request, authorization, x_business_id)
    if ctx.role not in ("adviser", "supplier", "admin"):
        raise HTTPException(403, "This needs an approved adviser account.")
    return ctx
