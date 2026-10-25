"""TEST HARNESS ONLY. A small stand-in for the parts of Supabase this app calls, so the
sign-in flows can be tested end to end without a cloud project.

What is real here: Postgres with supabase/migrations/001-003 applied, so the sign-up
trigger, column grants, guard trigger, review_adviser() and row level security are the real
ones. Every REST query runs as the `authenticated` role with the caller's JWT claims, as
PostgREST does.

What is imitated: Supabase Auth (GoTrue) endpoints used by @supabase/supabase-js: sign-up
with PKCE, email verification links (kept in memory, readable at /__test/mail), password
sign-in, refresh, get/update user, logout, recovery and resend; and a minimal PostgREST
(select with eq filters, order, limit; rpc). It is not Supabase and proves nothing about
Supabase's own security; it lets the app's flows, cookies, redirects and role checks run.

    STANDIN_DB=postgresql://postgres@127.0.0.1:54329/ls03_e2e JWT_SECRET=... \
        uvicorn standin_supabase:app --port 54321
"""
from __future__ import annotations

import base64
import hashlib
import json
import os
import re
import secrets
import time
import uuid
from datetime import datetime, timezone
from urllib.parse import urlencode, urlparse, urlunparse, parse_qsl

import jwt
import psycopg
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse, RedirectResponse, Response

DB = os.environ["STANDIN_DB"]
SECRET = os.environ["JWT_SECRET"]
PUBLIC_URL = os.getenv("STANDIN_URL", "http://127.0.0.1:54321")
TOKEN_TTL = int(os.getenv("STANDIN_TOKEN_TTL", "3600"))
API_VERSION = {"X-Supabase-Api-Version": "2024-01-01"}

app = FastAPI()
passwords: dict[str, str] = {}            # user id -> pbkdf2 hash (the real service uses bcrypt)
email_tokens: dict[str, dict] = {}        # token -> {user_id, type, redirect_to, challenge}
auth_codes: dict[str, dict] = {}          # code -> {user_id, challenge}
sessions: dict[str, str] = {}             # session id -> user id
refresh_tokens: dict[str, str] = {}       # refresh token -> session id
mail: list[dict] = []                     # sent emails, newest last


def now_iso():
    return datetime.now(timezone.utc).isoformat()


def hash_pw(p: str) -> str:
    return hashlib.pbkdf2_hmac("sha256", p.encode(), b"standin", 100_000).hex()


def err(status: int, code: str, message: str):
    return JSONResponse({"code": code, "message": message}, status_code=status, headers=API_VERSION)


def db():
    return psycopg.connect(DB, autocommit=True)


def user_row(uid: str | None = None, email: str | None = None):
    with db() as c:
        q = "select id, email, raw_user_meta_data, email_confirmed_at, created_at from auth.users where "
        r = c.execute(q + ("id = %s" if uid else "lower(email) = lower(%s)"), (uid or email,)).fetchone()
    if not r:
        return None
    return {"id": str(r[0]), "aud": "authenticated", "role": "authenticated", "email": r[1],
            "email_confirmed_at": r[3].isoformat() if r[3] else None,
            "user_metadata": r[2] or {}, "app_metadata": {"provider": "email", "providers": ["email"]},
            "identities": [{"id": str(r[0]), "provider": "email"}],
            "created_at": r[4].isoformat(), "updated_at": now_iso()}


def issue_session(uid: str) -> dict:
    sid = str(uuid.uuid4())
    sessions[sid] = uid
    rt = secrets.token_urlsafe(24)
    refresh_tokens[rt] = sid
    u = user_row(uid)
    t = int(time.time())
    access = jwt.encode({"sub": uid, "aud": "authenticated", "role": "authenticated", "email": u["email"],
                         "session_id": sid, "iat": t, "exp": t + TOKEN_TTL}, SECRET, algorithm="HS256")
    return {"access_token": access, "token_type": "bearer", "expires_in": TOKEN_TTL,
            "expires_at": t + TOKEN_TTL, "refresh_token": rt, "user": u}


def bearer_claims(req: Request):
    h = req.headers.get("authorization", "")
    if not h.lower().startswith("bearer "):
        return None
    try:
        claims = jwt.decode(h[7:], SECRET, algorithms=["HS256"], audience="authenticated")
    except jwt.PyJWTError:
        return None
    return claims if claims.get("session_id") in sessions else None


def challenge_of(verifier: str) -> str:
    return base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).rstrip(b"=").decode()


def send_link(uid: str, email: str, kind: str, redirect_to: str | None, challenge: str | None):
    tok = secrets.token_urlsafe(16)
    email_tokens[tok] = {"user_id": uid, "type": kind, "redirect_to": redirect_to, "challenge": challenge}
    link = f"{PUBLIC_URL}/auth/v1/verify?" + urlencode({"token": tok, "type": kind, "redirect_to": redirect_to or ""})
    mail.append({"to": email, "type": kind, "link": link, "at": now_iso()})


def with_query(url: str, **params) -> str:
    p = urlparse(url)
    q = dict(parse_qsl(p.query))
    q.update(params)
    return urlunparse(p._replace(query=urlencode(q)))


# ------------------------------------------------------------------ auth

@app.post("/auth/v1/signup")
async def signup(req: Request):
    body = await req.json()
    email, password = (body.get("email") or "").strip().lower(), body.get("password") or ""
    if len(password) < 6:
        return err(422, "weak_password", "Password should be at least 6 characters.")
    existing = user_row(email=email)
    if existing:   # like Supabase with confirmations on: no error, no email, an obfuscated user
        return JSONResponse({**existing, "id": str(uuid.uuid4()), "identities": []}, headers=API_VERSION)
    uid = str(uuid.uuid4())
    with db() as c:   # fires the real handle_new_user() trigger from migration 003
        c.execute("insert into auth.users (id, email, raw_user_meta_data) values (%s, %s, %s)",
                  (uid, email, json.dumps(body.get("data") or {})))
    passwords[uid] = hash_pw(password)
    send_link(uid, email, "signup", req.query_params.get("redirect_to"), body.get("code_challenge"))
    return JSONResponse(user_row(uid), headers=API_VERSION)


@app.get("/auth/v1/verify")
def verify(token: str, type: str, redirect_to: str = ""):
    t = email_tokens.pop(token, None)
    target = redirect_to or "http://localhost:3000"
    if not t:
        return RedirectResponse(with_query(target, error="access_denied", error_code="otp_expired"), 303)
    if t["type"] == "signup":
        with db() as c:
            c.execute("update auth.users set email_confirmed_at = now() where id = %s", (t["user_id"],))
    code = secrets.token_urlsafe(16)
    auth_codes[code] = {"user_id": t["user_id"], "challenge": t["challenge"]}
    return RedirectResponse(with_query(target, code=code), 303)


@app.post("/auth/v1/token")
async def token(req: Request):
    grant = req.query_params.get("grant_type")
    body = await req.json()
    if grant == "password":
        u = user_row(email=(body.get("email") or "").strip())
        if not u or passwords.get(u["id"]) != hash_pw(body.get("password") or ""):
            return err(400, "invalid_credentials", "Invalid login credentials")
        if not u["email_confirmed_at"]:
            return err(400, "email_not_confirmed", "Email not confirmed")
        return JSONResponse(issue_session(u["id"]), headers=API_VERSION)
    if grant == "pkce":
        c = auth_codes.pop(body.get("auth_code") or "", None)
        if not c or (c["challenge"] and challenge_of(body.get("code_verifier") or "") != c["challenge"]):
            return err(400, "bad_code_verifier", "invalid flow state")
        return JSONResponse(issue_session(c["user_id"]), headers=API_VERSION)
    if grant == "refresh_token":
        sid = refresh_tokens.pop(body.get("refresh_token") or "", None)
        if not sid or sid not in sessions:
            return err(400, "refresh_token_not_found", "Invalid Refresh Token")
        uid = sessions.pop(sid)
        return JSONResponse(issue_session(uid), headers=API_VERSION)
    return err(400, "unsupported_grant_type", "unsupported grant")


@app.get("/auth/v1/user")
def get_user(req: Request):
    claims = bearer_claims(req)
    if not claims:
        return err(403, "session_not_found", "Session from session_id claim in JWT does not exist")
    return JSONResponse(user_row(claims["sub"]), headers=API_VERSION)


@app.put("/auth/v1/user")
async def update_user(req: Request):
    claims = bearer_claims(req)
    if not claims:
        return err(403, "session_not_found", "Session not found")
    body = await req.json()
    if "password" in body:
        if passwords.get(claims["sub"]) == hash_pw(body["password"]):
            return err(422, "same_password", "New password should be different from the old password.")
        passwords[claims["sub"]] = hash_pw(body["password"])
    return JSONResponse(user_row(claims["sub"]), headers=API_VERSION)


@app.post("/auth/v1/logout")
def logout(req: Request, scope: str = "global"):
    claims = bearer_claims(req)
    if claims:
        mine = claims["session_id"]
        for sid, uid in list(sessions.items()):
            if uid == claims["sub"] and (scope == "global" or (scope == "local") == (sid == mine)):
                sessions.pop(sid)
    return Response(status_code=204)


@app.post("/auth/v1/recover")
async def recover(req: Request):
    body = await req.json()
    u = user_row(email=(body.get("email") or "").strip())
    if u:
        send_link(u["id"], u["email"], "recovery", req.query_params.get("redirect_to"), body.get("code_challenge"))
    return JSONResponse({}, headers=API_VERSION)


@app.post("/auth/v1/resend")
async def resend(req: Request):
    body = await req.json()
    u = user_row(email=(body.get("email") or "").strip())
    if u and not u["email_confirmed_at"]:
        send_link(u["id"], u["email"], "signup", req.query_params.get("redirect_to") or body.get("redirect_to"),
                  body.get("code_challenge"))
    return JSONResponse({}, headers=API_VERSION)


# ------------------------------------------------------------------ PostgREST (subset)

IDENT = re.compile(r"^[a-z_][a-z0-9_]*$")


def as_caller(req: Request):
    """A transaction running as PostgREST would: SET ROLE + request.jwt.claims."""
    claims = bearer_claims(req)
    c = psycopg.connect(DB)
    c.execute("set local role " + ("authenticated" if claims else "anon"))
    c.execute("select set_config('request.jwt.claims', %s, true)", (json.dumps(claims or {}),))
    return c


def pg_error(e: psycopg.Error):
    code = e.sqlstate or "XX000"
    status = 403 if code == "42501" else 404 if code == "P0002" else 400
    return JSONResponse({"code": code, "message": str(e).split("\n")[0], "details": None, "hint": None}, status_code=status)


def rejected_token(req: Request) -> JSONResponse | None:
    """Like PostgREST: a bearer that looks like a user JWT but is invalid or revoked gets 401."""
    h = req.headers.get("authorization", "")
    if h.lower().startswith("bearer ") and h[7:].count(".") == 2 and bearer_claims(req) is None:
        try:
            role = jwt.decode(h[7:], options={"verify_signature": False}).get("role")
        except jwt.PyJWTError:
            role = "authenticated"
        if role == "authenticated":
            return JSONResponse({"code": "PGRST301", "message": "JWT invalid or expired"}, status_code=401)
    return None


@app.get("/rest/v1/{table}")
def rest_select(table: str, req: Request):
    if (bad := rejected_token(req)) is not None:
        return bad
    if not IDENT.match(table):
        return JSONResponse({"message": "bad table"}, status_code=400)
    cols, where, args, order, limit = "*", [], [], "", ""
    for k, v in req.query_params.multi_items():
        if k == "select":
            parts = [p.strip() for p in v.split(",")]
            if v != "*" and not all(IDENT.match(p) for p in parts):
                return JSONResponse({"message": "bad select"}, status_code=400)
            cols = v if v == "*" else ", ".join(parts)
        elif k == "order":
            terms = []
            for t in v.split(","):
                col, *dirn = t.split(".")
                if not IDENT.match(col):
                    return JSONResponse({"message": "bad order"}, status_code=400)
                terms.append(f"{col} {'desc' if 'desc' in dirn else 'asc'}")
            order = " order by " + ", ".join(terms)
        elif k == "limit":
            limit = f" limit {int(v)}"
        elif IDENT.match(k) and v.startswith("eq."):
            where.append(f"{k} = %s")
            args.append(v[3:])
    sql = f"select {cols} from public.{table}" + (" where " + " and ".join(where) if where else "") + order + limit
    try:
        with as_caller(req) as c:
            cur = c.execute(sql, args)
            names = [d.name for d in cur.description]
            rows = [dict(zip(names, r)) for r in cur.fetchall()]
    except psycopg.Error as e:
        return pg_error(e)
    body = json.loads(json.dumps(rows, default=str))
    if "vnd.pgrst.object" in req.headers.get("accept", ""):
        if len(body) != 1:
            return JSONResponse({"code": "PGRST116", "message": "not one row"}, status_code=406)
        body = body[0]
    return JSONResponse(body)


@app.post("/rest/v1/rpc/{fn}")
async def rest_rpc(fn: str, req: Request):
    if not IDENT.match(fn):
        return JSONResponse({"message": "bad function"}, status_code=400)
    args = await req.json()
    if not all(IDENT.match(k) for k in args):
        return JSONResponse({"message": "bad args"}, status_code=400)
    named = ", ".join(f"{k} => %s" for k in args)
    try:
        with as_caller(req) as c:
            cur = c.execute(f"select to_jsonb(r) from public.{fn}({named}) r", list(args.values()))
            row = cur.fetchone()
    except psycopg.Error as e:
        return pg_error(e)
    return JSONResponse(row[0] if row else None)


# ------------------------------------------------------------------ test helpers

@app.get("/__test/mail")
def last_mail(to: str, type: str = "signup"):
    for m in reversed(mail):
        if m["to"] == to.lower() and m["type"] == type:
            return m
    return JSONResponse({"detail": "no mail"}, status_code=404)


@app.post("/__test/revoke")
def revoke(email: str):
    u = user_row(email=email)
    for sid, uid in list(sessions.items()):
        if u and uid == u["id"]:
            sessions.pop(sid)
    return {"ok": True}
