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

from dataclasses import dataclass
import threading
import time
from functools import lru_cache

import jwt
from fastapi import Header, HTTPException, Request

from .store import Store, parallel


ROLES = ("supplier", "buyer", "adviser", "admin")


@dataclass
class AuthContext:
    user_id: str | None
    business_id: str | None
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


# Profile + business lookups cached for a short time per user (remote store only), so each
# API request does not wait for a database round trip just to re-read the role. The token
# itself is still verified on every request. Role or approval changes take effect within
# AUTH_CACHE_SECONDS; creating a business clears the user's entry at once (forget_user).
AUTH_CACHE_SECONDS = 30
_auth_cache: dict[str, tuple[float, dict | None, list]] = {}
_auth_lock = threading.Lock()


def forget_user(user_id: str | None) -> None:
    with _auth_lock:
        _auth_cache.pop(user_id or "", None)


def _profile_and_business(store: Store, user_id: str) -> tuple[dict | None, list]:
    remote = getattr(store, "remote", False)
    if remote:
        with _auth_lock:
            hit = _auth_cache.get(user_id)
        if hit and hit[0] > time.monotonic():
            return hit[1], hit[2]
    profile, owned = parallel(store, lambda: store.get("profiles", user_id),
                              lambda: store.select("businesses", owner_id=user_id))
    if remote:
        with _auth_lock:
            if len(_auth_cache) > 5000:
                _auth_cache.clear()
            _auth_cache[user_id] = (time.monotonic() + AUTH_CACHE_SECONDS, profile, owned)
    return profile, owned


def auth_context(request: Request, authorization: str | None = Header(default=None),
                 x_business_id: str | None = Header(default=None)) -> AuthContext:
    settings = request.app.state.settings
    store: Store = request.app.state.store
    if settings.auth_mode == "demo":
        return AuthContext(user_id=None, business_id=x_business_id or settings.demo_business_id)

    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(401, "Sign in to continue.")
    user_id = verify_token(authorization.split(" ", 1)[1].strip(), settings)
    profile, owned = _profile_and_business(store, user_id)
    if profile is None or profile.get("role") not in ROLES:
        raise HTTPException(403, "Your account has no profile yet. Sign out and sign in again, "
                                 "or contact support.")
    return AuthContext(user_id=user_id, business_id=owned[0]["id"] if owned else None,
                       role=profile["role"], approved=profile.get("approval_status") == "approved")


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
