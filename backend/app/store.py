"""Storage behind one small interface.

MemoryStore: in-process dicts pre-loaded with the demo case. Used by tests and as an
offline fallback for the demo (STORE=memory).
SupabaseStore: Supabase's PostgREST API over HTTPS with the service-role key
(STORE=supabase). Server-side only; never expose this key to the frontend.

Rows are plain dicts with JSON-friendly values (dates and money as strings).
"""
from __future__ import annotations

import copy
import uuid
from datetime import datetime, timezone
from typing import Any, Protocol

import httpx

Row = dict[str, Any]


class Store(Protocol):
    def select(self, table: str, **eq: Any) -> list[Row]: ...
    def get(self, table: str, id: str) -> Row | None: ...
    def insert(self, table: str, row: Row) -> Row: ...
    def update(self, table: str, id: str, patch: Row) -> Row | None: ...
    def upsert(self, table: str, row: Row, on_conflict: list[str]) -> Row: ...
    def delete(self, table: str, id: str) -> bool: ...


# ---------------------------------------------------------------- memory
DEMO_ROWS: dict[str, list[Row]] = {
    "businesses": [{
        "id": "11111111-1111-1111-1111-111111111111", "owner_id": None,
        "phone": "+910000000001", "name": "Sri Lakshmi Packaging",
        "udyam_no": "UDYAM-KR-00-0000000", "size": "micro", "activity": "manufacturing",
        "udyam_registered": True, "udyam_reg_date": "2023-05-12", "preferred_lang": "en",
        # Fictional demo details (PAN/GSTIN are format-valid samples, not real registrations)
        "description": "Corrugated boxes and printed cartons for food and FMCG brands.",
        "email": "accounts@srilakshmi.example", "address": "Plot 14, Peenya Industrial Area, Bengaluru 560058",
        "website": None, "gstin": "29ABCDE1234F1ZW", "pan": "ABCDE1234F", "established_year": 2016,
        "products": ["Corrugated boxes", "Printed cartons", "Food-grade liners"],
        "team": [{"name": "Rajesh Sharma", "role": "Owner", "email": "rajesh@srilakshmi.example"},
                 {"name": "Priya Nair", "role": "Accounts", "email": "priya@srilakshmi.example"}],
        "documents": {"udyam_certificate": "have", "gst_certificate": "have", "pan_card": "have",
                      "address_proof": "missing", "bank_details": "unknown"},
    }],
    "buyers": [{
        "id": "22222222-2222-2222-2222-222222222222",
        "business_id": "11111111-1111-1111-1111-111111111111",
        "name": "Kaveri Foods Pvt Ltd", "gstin": None, "is_cpse": False,
        "relationship_importance": "high",
    }],
    "cases": [{
        "id": "33333333-3333-3333-3333-333333333333",
        "business_id": "11111111-1111-1111-1111-111111111111",
        "buyer_id": "22222222-2222-2222-2222-222222222222",
        "contract_date": "2026-02-20", "status": "active", "ladder_step": 0,
        "allocation": "interest_first", "po_amount": "275000.00", "dispute_reason": "none",
    }],
    "invoices": [
        {"id": "44444444-4444-4444-4444-444444444441",
         "case_id": "33333333-3333-3333-3333-333333333333", "number": "INV-114",
         "invoice_date": "2026-03-08", "amount": "180000.00", "delivery_date": "2026-03-10",
         "agreed_due_date": None, "objection_date": None, "objection_removed_date": None},
        {"id": "44444444-4444-4444-4444-444444444442",
         "case_id": "33333333-3333-3333-3333-333333333333", "number": "INV-131",
         "invoice_date": "2026-05-02", "amount": "95000.00", "delivery_date": "2026-05-04",
         "agreed_due_date": "2026-06-03", "objection_date": None, "objection_removed_date": None},
    ],
    "payments": [
        {"id": "55555555-5555-5555-5555-555555555551",
         "invoice_id": "44444444-4444-4444-4444-444444444441",
         "paid_on": "2026-06-01", "amount": "50000.00"},
    ],
    "evidence_items": [
        {"id": f"66666666-6666-6666-6666-66666666666{i}",
         "case_id": "33333333-3333-3333-3333-333333333333", "kind": k, "status": s,
         "file_path": None, "sha256": None, "prev_hash": None}
        for i, (k, s) in enumerate([("po", "have"), ("invoice", "have"),
                                    ("delivery_proof", "have"), ("acceptance_reply", "missing"),
                                    ("ledger", "have"), ("communications", "unknown"),
                                    ("udyam_cert", "have")])
    ],
    "calculations": [], "drafts": [], "conversations": [], "inbound_messages": [],
    "promises": [], "followups": [],
    # Planned deliveries of the demo PO: together they make up the ₹2,75,000 order.
    "milestones": [
        {"id": "55555555-5555-5555-5555-555555555551", "case_id": "33333333-3333-3333-3333-333333333333",
         "title": "First delivery: 3,000 cartons", "due_date": "2026-03-10", "amount": "180000.00",
         "invoice_id": "44444444-4444-4444-4444-444444444441", "created_at": "2026-02-20T10:00:00+00:00"},
        {"id": "55555555-5555-5555-5555-555555555552", "case_id": "33333333-3333-3333-3333-333333333333",
         "title": "Second delivery: 1,500 cartons", "due_date": "2026-05-04", "amount": "95000.00",
         "invoice_id": "44444444-4444-4444-4444-444444444442", "created_at": "2026-02-20T10:00:00+00:00"},
    ],
    "invoice_notes": [],
    "profiles": [],   # only used with AUTH_MODE=supabase (rows come from Supabase Auth sign-up)
}


class MemoryStore:
    def __init__(self, seed: bool = True):
        self.tables: dict[str, list[Row]] = copy.deepcopy(DEMO_ROWS) if seed else {
            t: [] for t in DEMO_ROWS}

    def select(self, table: str, **eq: Any) -> list[Row]:
        return [copy.deepcopy(r) for r in self.tables[table]
                if all(r.get(k) == v for k, v in eq.items())]

    def get(self, table: str, id: str) -> Row | None:
        rows = self.select(table, id=id)
        return rows[0] if rows else None

    def insert(self, table: str, row: Row) -> Row:
        row = {"id": str(uuid.uuid4()), **row}
        if table in ("calculations", "drafts", "cases", "businesses", "promises", "followups",
                     "milestones", "invoice_notes"):
            row.setdefault("created_at", datetime.now(timezone.utc).isoformat())
        self.tables[table].append(copy.deepcopy(row))
        return row

    def update(self, table: str, id: str, patch: Row) -> Row | None:
        for r in self.tables[table]:
            if r["id"] == id:
                r.update(patch)
                return copy.deepcopy(r)
        return None

    def upsert(self, table: str, row: Row, on_conflict: list[str]) -> Row:
        for r in self.tables[table]:
            if all(r.get(k) == row.get(k) for k in on_conflict):
                r.update(row)
                return copy.deepcopy(r)
        return self.insert(table, row)


    def delete(self, table: str, id: str) -> bool:
        before = len(self.tables[table])
        self.tables[table] = [r for r in self.tables[table] if r["id"] != id]
        return len(self.tables[table]) < before


# ---------------------------------------------------------------- supabase
class SupabaseStore:
    def __init__(self, url: str, service_key: str):
        self.base = url.rstrip("/") + "/rest/v1"
        self.client = httpx.Client(timeout=10, headers={
            "apikey": service_key,
            "Authorization": f"Bearer {service_key}",
            "Content-Type": "application/json",
        })

    def select(self, table: str, **eq: Any) -> list[Row]:
        params = {"select": "*", **{k: f"eq.{v}" for k, v in eq.items()}}
        r = self.client.get(f"{self.base}/{table}", params=params)
        r.raise_for_status()
        return r.json()

    def get(self, table: str, id: str) -> Row | None:
        rows = self.select(table, id=id)
        return rows[0] if rows else None

    def insert(self, table: str, row: Row) -> Row:
        r = self.client.post(f"{self.base}/{table}", json=row,
                             headers={"Prefer": "return=representation"})
        r.raise_for_status()
        return r.json()[0]

    def update(self, table: str, id: str, patch: Row) -> Row | None:
        r = self.client.patch(f"{self.base}/{table}", params={"id": f"eq.{id}"}, json=patch,
                              headers={"Prefer": "return=representation"})
        r.raise_for_status()
        rows = r.json()
        return rows[0] if rows else None

    def upsert(self, table: str, row: Row, on_conflict: list[str]) -> Row:
        r = self.client.post(f"{self.base}/{table}", json=row,
                             params={"on_conflict": ",".join(on_conflict)},
                             headers={"Prefer": "return=representation,resolution=merge-duplicates"})
        r.raise_for_status()
        return r.json()[0]

    def delete(self, table: str, id: str) -> bool:
        r = self.client.delete(f"{self.base}/{table}", params={"id": f"eq.{id}"},
                               headers={"Prefer": "return=representation"})
        r.raise_for_status()
        return bool(r.json())
