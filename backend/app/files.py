"""B2: keep evidence files (PO, delivery proof, buyer's reply...) with the case.

Files go to a private Supabase Storage bucket when the app uses Supabase, or stay in memory in
the offline demo. Browsers never get a storage link: every download goes through the backend,
which checks that the case belongs to the caller and that the file still matches the SHA-256
recorded at upload. Set EVIDENCE_FILES=off to turn the feature off."""
from __future__ import annotations

import hashlib
import os
import re
import unicodedata
from typing import Protocol

import httpx

MAX_BYTES = 10 * 1024 * 1024
MAX_FILES_PER_CASE = 50


class FileStoreError(RuntimeError):
    """The storage service failed or is not set up."""


class FileStore(Protocol):
    def put(self, path: str, data: bytes, mime: str) -> None: ...
    def get(self, path: str) -> bytes: ...
    def delete(self, path: str) -> None: ...


class MemoryFileStore:
    def __init__(self) -> None:
        self.blobs: dict[str, bytes] = {}

    def put(self, path: str, data: bytes, mime: str) -> None:
        self.blobs[path] = data

    def get(self, path: str) -> bytes:
        try:
            return self.blobs[path]
        except KeyError:
            raise FileStoreError("file missing from storage") from None

    def delete(self, path: str) -> None:
        self.blobs.pop(path, None)


class SupabaseFileStore:
    """Private bucket, used only with the service key (server side)."""

    def __init__(self, url: str, service_key: str, bucket: str) -> None:
        self.base = f"{url.rstrip('/')}/storage/v1/object/{bucket}"
        self.client = httpx.Client(timeout=30, headers={"apikey": service_key,
                                                        "Authorization": f"Bearer {service_key}"})

    def _call(self, method: str, path: str, **kw) -> httpx.Response:
        try:
            r = self.client.request(method, f"{self.base}/{path}", **kw)
        except httpx.HTTPError as e:
            raise FileStoreError("storage service unreachable") from e
        if r.status_code >= 300:
            raise FileStoreError(f"storage service returned {r.status_code}")
        return r

    def put(self, path: str, data: bytes, mime: str) -> None:
        self._call("POST", path, content=data, headers={"Content-Type": mime, "x-upsert": "false"})

    def get(self, path: str) -> bytes:
        return self._call("GET", path).content

    def delete(self, path: str) -> None:
        self._call("DELETE", path)


def build_file_store(settings) -> FileStore | None:
    if os.getenv("EVIDENCE_FILES", "on").lower() in ("off", "0", "false"):
        return None
    if settings.store == "supabase":
        if not (settings.supabase_url and settings.supabase_service_key):
            return None
        return SupabaseFileStore(settings.supabase_url, settings.supabase_service_key,
                                 os.getenv("EVIDENCE_BUCKET", "evidence"))
    return MemoryFileStore()


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


_EXT = {"application/pdf": ".pdf", "image/png": ".png", "image/jpeg": ".jpg", "image/webp": ".webp"}


def clean_name(name: str | None, mime: str) -> str:
    """A safe display name: no folders, no control characters, sensible length and extension."""
    base = re.split(r"[\\/]", name or "")[-1]
    base = "".join(ch for ch in unicodedata.normalize("NFC", base) if unicodedata.category(ch)[0] != "C")
    base = re.sub(r"\s+", " ", base).strip(" .") or "evidence"
    stem, dot, ext = base.rpartition(".")
    if not dot:
        stem, ext = base, ""
    stem = stem[:100]
    want = _EXT[mime]
    fits = {".jpg", ".jpeg"} if want == ".jpg" else {want}
    return f"{stem}.{ext}" if f".{ext.lower()}" in fits else f"{stem}{want}"


def ascii_name(name: str) -> str:
    return re.sub(r'[^A-Za-z0-9._ -]', "_", name)[:120] or "evidence"
