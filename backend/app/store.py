"""Storage behind one small interface.

MemoryStore: in-process dicts pre-loaded with the demo case. Used by tests and as an
offline fallback for the demo (STORE=memory).
SupabaseStore: Supabase's PostgREST API over HTTPS with the service-role key
(STORE=supabase). Server-side only; never expose this key to the frontend.

Rows are plain dicts with JSON-friendly values (dates and money as strings).
"""
from __future__ import annotations

import copy
import time
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
_ALL_EVIDENCE = [("po", "have"), ("invoice", "have"), ("delivery_proof", "have"),
                 ("acceptance_reply", "have"), ("ledger", "have"),
                 ("communications", "have"), ("udyam_cert", "have")]


def _ev_rows(prefix: str, case_id: str, items: list[tuple[str, str]]) -> list[Row]:
    return [
        {"id": f"{prefix}{i}", "case_id": case_id, "kind": k, "status": s,
         "file_path": None, "sha256": None, "prev_hash": None}
        for i, (k, s) in enumerate(items, start=1)
    ]


DEMO_ROWS: dict[str, list[Row]] = {
    "businesses": [
        {
            "id": "11111111-1111-1111-1111-111111111111", "owner_id": None,
            "phone": "+910000000001", "name": "Sri Lakshmi Packaging",
            "udyam_no": "UDYAM-KR-00-0000000", "size": "micro", "activity": "manufacturing",
            "udyam_registered": True, "udyam_reg_date": "2023-04-15", "preferred_lang": "en",
            "description": "Corrugated boxes, die-cut cartons and industrial protective packaging.",
            "email": "accounts@srilakshmipackaging.example", "address": "Plot 42, Phase 2, Peenya Industrial Area, Bengaluru, Karnataka 560058",
            "website": None, "gstin": "29ABCDE1234F1ZW", "pan": "ABCDE1234F", "established_year": 2018,
            "products": ["5-ply corrugated shipper cartons", "Heavy-duty machinery wrap", "Die-cut pharmaceutical boxes"],
            "team": [{"name": "Lakshmi Narayanan", "role": "Managing Director", "email": "lakshmi@srilakshmipackaging.example"},
                     {"name": "S. R. Venkatesh", "role": "Accounts Head", "email": "accounts@srilakshmipackaging.example"}],
            "documents": {"udyam_certificate": "have", "gst_certificate": "have", "pan_card": "have",
                          "address_proof": "have", "bank_details": "have"},
        },
        {
            "id": "81000000-0000-4000-8000-000000000001", "owner_id": None,
            "phone": "+910000000002", "name": "Arunodaya Precision Components",
            "udyam_no": "UDYAM-TN-04-0048291", "size": "micro", "activity": "manufacturing",
            "udyam_registered": True, "udyam_reg_date": "2024-02-10", "preferred_lang": "en",
            "description": "CNC turned parts, precision shafts and fasteners for automotive OEMs.",
            "email": "finance@arunodaya.example", "address": "Plot 18, SIPCOT Phase 1, Hosur, Tamil Nadu 635126",
            "website": None, "gstin": "33AAACA4892K1Z7", "pan": "AAACA4892K", "established_year": 2019,
            "products": ["Hardened steel pins", "M12 flanged studs", "Splined shafts"],
            "team": [{"name": "P. Arunachalam", "role": "Partner", "email": "arun@arunodaya.example"}],
            "documents": {"udyam_certificate": "have", "gst_certificate": "have", "pan_card": "have",
                          "address_proof": "have", "bank_details": "have"},
        },
        {
            "id": "82000000-0000-4000-8000-000000000001", "owner_id": None,
            "phone": "+910000000004", "name": "Thenmozhi Knit Works",
            "udyam_no": "UDYAM-TN-27-0091384", "size": "small", "activity": "services",
            "udyam_registered": True, "udyam_reg_date": "2026-06-15", "preferred_lang": "en",
            "description": "Knitted garment job work, dyeing and custom fabric finishing.",
            "email": "accounts@thenmozhi.example", "address": "Avinashi Road, Anupparpalayam, Tiruppur, Tamil Nadu 641652",
            "website": None, "gstin": "33AAACT9182P1ZB", "pan": "AAACT9182P", "established_year": 2020,
            "products": ["Knitted cotton wear", "Single jersey job work", "Fabric bleaching"],
            "team": [{"name": "T. Murugesan", "role": "Proprietor", "email": "murugesan@thenmozhi.example"}],
            "documents": {"udyam_certificate": "have", "gst_certificate": "have", "pan_card": "have",
                          "address_proof": "have", "bank_details": "unknown"},
        },
        {
            "id": "91000000-0000-4000-8000-000000000001", "owner_id": None,
            "phone": "+910000000003", "name": "Thenmozhi Knit Works",
            "udyam_no": "UDYAM-TN-27-0091384", "size": "small", "activity": "services",
            "udyam_registered": True, "udyam_reg_date": "2026-06-15", "preferred_lang": "en",
            "description": "Knitted garment job work, dyeing and custom fabric finishing.",
            "email": "accounts@thenmozhi.example", "address": "Avinashi Road, Anupparpalayam, Tiruppur, Tamil Nadu 641652",
            "website": None, "gstin": "33AAACT9182P1ZB", "pan": "AAACT9182P", "established_year": 2020,
            "products": ["Knitted cotton wear", "Single jersey job work", "Fabric bleaching"],
            "team": [{"name": "T. Murugesan", "role": "Proprietor", "email": "murugesan@thenmozhi.example"}],
            "documents": {"udyam_certificate": "have", "gst_certificate": "have", "pan_card": "have",
                          "address_proof": "have", "bank_details": "unknown"},
        },
    ],
    "buyers": [
        {
            "id": "22222222-2222-2222-2222-222222222222",
            "business_id": "11111111-1111-1111-1111-111111111111",
            "profile_id": "22222222-2222-2222-2222-222222222221",
            "name": "Kaveri Foods Pvt Ltd", "gstin": "29AABCK3419Q1ZP",
            "is_cpse": False, "relationship_importance": "high",
        },
        {
            "id": "71000000-0000-4000-8000-000000000002",
            "business_id": "11111111-1111-1111-1111-111111111111",
            "name": "Sundar Pharma Chemicals Pvt Ltd", "gstin": "29AABCS8891J1ZT",
            "is_cpse": False, "relationship_importance": "medium",
        },
        {
            "id": "72000000-0000-4000-8000-000000000002",
            "business_id": "11111111-1111-1111-1111-111111111111",
            "name": "Harvest Basket Retail LLP", "gstin": "27AAEFH4910C1ZU",
            "is_cpse": False, "relationship_importance": "low",
        },
        {
            "id": "73000000-0000-4000-8000-000000000002",
            "business_id": "11111111-1111-1111-1111-111111111111",
            "name": "Saffron Process Equipments Ltd", "gstin": "24AABCS7812R1ZW",
            "is_cpse": False, "relationship_importance": "medium",
        },
        {
            "id": "74000000-0000-4000-8000-000000000002",
            "business_id": "11111111-1111-1111-1111-111111111111",
            "name": "Nila Fashion House Pvt Ltd", "gstin": "33AAACN8374M1Z2",
            "is_cpse": False, "relationship_importance": "high",
        },
        {
            "id": "75000000-0000-4000-8000-000000000002",
            "business_id": "11111111-1111-1111-1111-111111111111",
            "name": "Apex Pumps and Motors Ltd", "gstin": "29AAACA6521K1ZN",
            "is_cpse": False, "relationship_importance": "medium",
        },
        {
            "id": "78000000-0000-4000-8000-000000000002",
            "business_id": "11111111-1111-1111-1111-111111111111",
            "name": "Deccan Agro Systems Pvt Ltd", "gstin": "36AAACD1234F1Z5",
            "is_cpse": False, "relationship_importance": "medium",
        },
        {
            "id": "81000000-0000-4000-8000-000000000002",
            "business_id": "81000000-0000-4000-8000-000000000001",
            "name": "Velan Auto Systems Pvt Ltd", "gstin": "33AAACV9812L1Z9",
            "is_cpse": False, "relationship_importance": "high",
        },
        {
            "id": "82000000-0000-4000-8000-000000000002",
            "business_id": "81000000-0000-4000-8000-000000000001",
            "name": "Bharat Heavy Castings Ltd", "gstin": "33AAACB0001M1Z1",
            "is_cpse": True, "relationship_importance": "high",
        },
        {
            "id": "91000000-0000-4000-8000-000000000002",
            "business_id": "82000000-0000-4000-8000-000000000001",
            "profile_id": "22222222-2222-2222-2222-222222222221",
            "name": "Kaveri Foods Pvt Ltd", "gstin": "29AABCK3419Q1ZP",
            "is_cpse": False, "relationship_importance": "high",
        },
        {
            "id": "92000000-0000-4000-8000-000000000002",
            "business_id": "82000000-0000-4000-8000-000000000001",
            "name": "Coastline Apparel Exports LLP", "gstin": "33AAACC5514E1Z2",
            "is_cpse": False, "relationship_importance": "medium",
        },
    ],
    "cases": [
        {
            "id": "33333333-3333-3333-3333-333333333333",
            "business_id": "11111111-1111-1111-1111-111111111111",
            "buyer_id": "22222222-2222-2222-2222-222222222222",
            "contract_date": "2026-02-15", "status": "active", "ladder_step": 1,
            "allocation": "interest_first", "po_amount": "280000.00", "dispute_reason": "none",
        },
        {
            "id": "71000000-0000-4000-8000-000000000003",
            "business_id": "11111111-1111-1111-1111-111111111111",
            "buyer_id": "71000000-0000-4000-8000-000000000002",
            "contract_date": "2026-08-01", "status": "settled", "ladder_step": 0,
            "allocation": "interest_first", "po_amount": "125000.00", "dispute_reason": "none",
        },
        {
            "id": "72000000-0000-4000-8000-000000000003",
            "business_id": "11111111-1111-1111-1111-111111111111",
            "buyer_id": "72000000-0000-4000-8000-000000000002",
            "contract_date": "2026-05-01", "status": "active", "ladder_step": 0,
            "allocation": "interest_first", "po_amount": "68000.00", "dispute_reason": "none",
        },
        {
            "id": "73000000-0000-4000-8000-000000000003",
            "business_id": "11111111-1111-1111-1111-111111111111",
            "buyer_id": "73000000-0000-4000-8000-000000000002",
            "contract_date": "2026-04-10", "status": "active", "ladder_step": 2,
            "allocation": "interest_first", "po_amount": "200000.00", "dispute_reason": "none",
        },
        {
            "id": "74000000-0000-4000-8000-000000000003",
            "business_id": "11111111-1111-1111-1111-111111111111",
            "buyer_id": "74000000-0000-4000-8000-000000000002",
            "contract_date": "2026-06-24", "status": "active", "ladder_step": 1,
            "allocation": "interest_first", "po_amount": "92500.00", "dispute_reason": "quality",
        },
        {
            "id": "75000000-0000-4000-8000-000000000003",
            "business_id": "11111111-1111-1111-1111-111111111111",
            "buyer_id": "75000000-0000-4000-8000-000000000002",
            "contract_date": "2026-07-20", "status": "active", "ladder_step": 1,
            "allocation": "interest_first", "po_amount": "150000.00", "dispute_reason": "none",
        },
        {
            "id": "76000000-0000-4000-8000-000000000003",
            "business_id": "11111111-1111-1111-1111-111111111111",
            "buyer_id": "22222222-2222-2222-2222-222222222222",
            "contract_date": "2026-01-05", "status": "settled", "ladder_step": 0,
            "allocation": "interest_first", "po_amount": "210000.00", "dispute_reason": "none",
        },
        {
            "id": "77000000-0000-4000-8000-000000000003",
            "business_id": "11111111-1111-1111-1111-111111111111",
            "buyer_id": "75000000-0000-4000-8000-000000000002",
            "contract_date": "2026-09-25", "status": "active", "ladder_step": 0,
            "allocation": "interest_first", "po_amount": "240000.00", "dispute_reason": "none",
        },
        {
            "id": "78000000-0000-4000-8000-000000000003",
            "business_id": "11111111-1111-1111-1111-111111111111",
            "buyer_id": "78000000-0000-4000-8000-000000000002",
            "contract_date": "2026-06-15", "status": "active", "ladder_step": 1,
            "allocation": "interest_first", "po_amount": "200000.00", "dispute_reason": "none",
        },
        {
            "id": "81000000-0000-4000-8000-000000000003",
            "business_id": "81000000-0000-4000-8000-000000000001",
            "buyer_id": "81000000-0000-4000-8000-000000000002",
            "contract_date": "2026-03-15", "status": "active", "ladder_step": 0,
            "allocation": "principal_first", "po_amount": "150000.00", "dispute_reason": "none",
        },
        {
            "id": "82000000-0000-4000-8000-000000000003",
            "business_id": "81000000-0000-4000-8000-000000000001",
            "buyer_id": "82000000-0000-4000-8000-000000000002",
            "contract_date": "2026-02-01", "status": "active", "ladder_step": 2,
            "allocation": "interest_first", "po_amount": "350000.00", "dispute_reason": "none",
        },
        {
            "id": "91000000-0000-4000-8000-000000000003",
            "business_id": "82000000-0000-4000-8000-000000000001",
            "buyer_id": "91000000-0000-4000-8000-000000000002",
            "contract_date": "2026-04-10", "status": "active", "ladder_step": 0,
            "allocation": "interest_first", "po_amount": "85000.00", "dispute_reason": "none",
        },
        {
            "id": "92000000-0000-4000-8000-000000000003",
            "business_id": "82000000-0000-4000-8000-000000000001",
            "buyer_id": "92000000-0000-4000-8000-000000000002",
            "contract_date": "2026-05-15", "status": "active", "ladder_step": 1,
            "allocation": "interest_first", "po_amount": "110000.00", "dispute_reason": "quality",
        },
    ],
    "invoices": [
        {"id": "44444444-4444-4444-4444-444444444441",
         "case_id": "33333333-3333-3333-3333-333333333333", "number": "INV-114",
         "invoice_date": "2026-03-08", "amount": "180000.00", "delivery_date": "2026-03-10",
         "agreed_due_date": None, "objection_date": None, "objection_removed_date": None},
        {"id": "44444444-4444-4444-4444-444444444442",
         "case_id": "33333333-3333-3333-3333-333333333333", "number": "INV-131",
         "invoice_date": "2026-05-02", "amount": "95000.00", "delivery_date": "2026-05-04",
         "agreed_due_date": "2026-06-03", "objection_date": None, "objection_removed_date": None},
        {"id": "71000000-0000-4000-8000-000000000004",
         "case_id": "71000000-0000-4000-8000-000000000003", "number": "SPC-2608-041",
         "invoice_date": "2026-08-05", "amount": "125000.00", "delivery_date": "2026-08-06",
         "agreed_due_date": "2026-09-05", "objection_date": None, "objection_removed_date": None},
        {"id": "72000000-0000-4000-8000-000000000004",
         "case_id": "72000000-0000-4000-8000-000000000003", "number": "NCC-2605-118",
         "invoice_date": "2026-05-05", "amount": "68000.00", "delivery_date": "2026-05-06",
         "agreed_due_date": None, "objection_date": None, "objection_removed_date": None},
        {"id": "73000000-0000-4000-8000-000000000004",
         "case_id": "73000000-0000-4000-8000-000000000003", "number": "VTW-2604-077",
         "invoice_date": "2026-04-11", "amount": "200000.00", "delivery_date": "2026-04-12",
         "agreed_due_date": None, "objection_date": None, "objection_removed_date": None},
        {"id": "74000000-0000-4000-8000-000000000004",
         "case_id": "74000000-0000-4000-8000-000000000003", "number": "MTP-2607-212",
         "invoice_date": "2026-07-01", "amount": "92500.00", "delivery_date": "2026-07-02",
         "agreed_due_date": None, "objection_date": "2026-07-10", "objection_removed_date": None},
        {"id": "75000000-0000-4000-8000-000000000004",
         "case_id": "75000000-0000-4000-8000-000000000003", "number": "KIC-2608-063",
         "invoice_date": "2026-08-05", "amount": "150000.00", "delivery_date": "2026-08-06",
         "agreed_due_date": "2026-09-05", "objection_date": None, "objection_removed_date": None},
        {"id": "76000000-0000-4000-8000-000000000004",
         "case_id": "76000000-0000-4000-8000-000000000003", "number": "INV-088",
         "invoice_date": "2026-01-10", "amount": "75000.00", "delivery_date": "2026-01-11",
         "agreed_due_date": "2026-01-26", "objection_date": None, "objection_removed_date": None},
        {"id": "76000000-0000-4000-8000-000000000005",
         "case_id": "76000000-0000-4000-8000-000000000003", "number": "INV-094",
         "invoice_date": "2026-01-28", "amount": "65000.00", "delivery_date": "2026-01-29",
         "agreed_due_date": "2026-02-13", "objection_date": None, "objection_removed_date": None},
        {"id": "76000000-0000-4000-8000-000000000006",
         "case_id": "76000000-0000-4000-8000-000000000003", "number": "INV-102",
         "invoice_date": "2026-02-08", "amount": "70000.00", "delivery_date": "2026-02-09",
         "agreed_due_date": "2026-02-24", "objection_date": None, "objection_removed_date": None},
        {"id": "77000000-0000-4000-8000-000000000004",
         "case_id": "77000000-0000-4000-8000-000000000003", "number": "INV-198",
         "invoice_date": "2026-09-28", "amount": "150000.00", "delivery_date": "2026-09-29",
         "agreed_due_date": "2026-10-29", "objection_date": None, "objection_removed_date": None},
        {"id": "77000000-0000-4000-8000-000000000005",
         "case_id": "77000000-0000-4000-8000-000000000003", "number": "INV-204",
         "invoice_date": "2026-10-12", "amount": "90000.00", "delivery_date": "2026-10-13",
         "agreed_due_date": "2026-11-12", "objection_date": None, "objection_removed_date": None},
        {"id": "78000000-0000-4000-8000-000000000004",
         "case_id": "78000000-0000-4000-8000-000000000003", "number": "INV-162",
         "invoice_date": "2026-06-20", "amount": "180000.00", "delivery_date": "2026-06-22",
         "agreed_due_date": "2026-09-20", "objection_date": None, "objection_removed_date": None},
        {"id": "81000000-0000-4000-8000-000000000004",
         "case_id": "81000000-0000-4000-8000-000000000003", "number": "INV-APC-041",
         "invoice_date": "2026-03-20", "amount": "150000.00", "delivery_date": "2026-03-20",
         "agreed_due_date": "2026-04-04", "objection_date": None, "objection_removed_date": None},
        {"id": "82000000-0000-4000-8000-000000000004",
         "case_id": "82000000-0000-4000-8000-000000000003", "number": "INV-APC-058",
         "invoice_date": "2026-02-13", "amount": "303282.94", "delivery_date": "2026-02-13",
         "agreed_due_date": None, "objection_date": None, "objection_removed_date": None},
        {"id": "91000000-0000-4000-8000-000000000004",
         "case_id": "91000000-0000-4000-8000-000000000003", "number": "TKW-118",
         "invoice_date": "2026-04-15", "amount": "85000.00", "delivery_date": "2026-04-18",
         "agreed_due_date": "2026-05-18", "objection_date": None, "objection_removed_date": None},
        {"id": "92000000-0000-4000-8000-000000000004",
         "case_id": "92000000-0000-4000-8000-000000000003", "number": "INV-TKW-025",
         "invoice_date": "2026-05-20", "amount": "110000.00", "delivery_date": "2026-05-22",
         "agreed_due_date": None, "objection_date": "2026-05-28", "objection_removed_date": None,
         # Buyer rejected 140 of 1,000 pieces in writing: only Rs 15,400 is disputed (A2).
         "disputed_amount": "15400.00"},
    ],
    "payments": [
        {"id": "55555555-5555-5555-5555-555555555551",
         "invoice_id": "44444444-4444-4444-4444-444444444441",
         "paid_on": "2026-06-01", "amount": "50000.00"},
        {"id": "71000000-0000-4000-8000-000000000005",
         "invoice_id": "71000000-0000-4000-8000-000000000004",
         "paid_on": "2026-08-31", "amount": "125000.00"},
        {"id": "73000000-0000-4000-8000-000000000005",
         "invoice_id": "73000000-0000-4000-8000-000000000004",
         "paid_on": "2026-06-05", "amount": "40000.00"},
        {"id": "76000000-0000-4000-8000-000000000007",
         "invoice_id": "76000000-0000-4000-8000-000000000004",
         "paid_on": "2026-01-26", "amount": "75000.00"},
        {"id": "76000000-0000-4000-8000-000000000008",
         "invoice_id": "76000000-0000-4000-8000-000000000005",
         "paid_on": "2026-02-13", "amount": "65000.00"},
        {"id": "76000000-0000-4000-8000-000000000009",
         "invoice_id": "76000000-0000-4000-8000-000000000006",
         "paid_on": "2026-03-05", "amount": "70253.15"},
        {"id": "81000000-0000-4000-8000-000000000005",
         "invoice_id": "81000000-0000-4000-8000-000000000004",
         "paid_on": "2026-05-20", "amount": "150000.00"},
    ],
    "evidence_items": [
        {"id": f"66666666-6666-6666-6666-66666666666{i}",
         "case_id": "33333333-3333-3333-3333-333333333333", "kind": k, "status": s,
         "file_path": None, "sha256": None, "prev_hash": None}
        for i, (k, s) in enumerate([("po", "have"), ("invoice", "have"),
                                    ("delivery_proof", "have"), ("acceptance_reply", "missing"),
                                    ("ledger", "have"), ("communications", "unknown"),
                                    ("udyam_cert", "have")])
    ] + _ev_rows("71000000-0000-4000-8000-00000000001",
                 "71000000-0000-4000-8000-000000000003", _ALL_EVIDENCE)
      + _ev_rows("72000000-0000-4000-8000-00000000001",
                 "72000000-0000-4000-8000-000000000003",
                 [("po", "have"), ("invoice", "have"), ("delivery_proof", "missing"),
                  ("acceptance_reply", "missing"), ("ledger", "unknown"),
                  ("communications", "unknown"), ("udyam_cert", "have")])
      + _ev_rows("73000000-0000-4000-8000-00000000001",
                 "73000000-0000-4000-8000-000000000003", _ALL_EVIDENCE)
      + _ev_rows("74000000-0000-4000-8000-00000000001",
                 "74000000-0000-4000-8000-000000000003", _ALL_EVIDENCE)
      + _ev_rows("75000000-0000-4000-8000-00000000001",
                 "75000000-0000-4000-8000-000000000003", _ALL_EVIDENCE)
      + _ev_rows("76000000-0000-4000-8000-00000000001",
                 "76000000-0000-4000-8000-000000000003", _ALL_EVIDENCE)
      + _ev_rows("77000000-0000-4000-8000-00000000001",
                 "77000000-0000-4000-8000-000000000003", _ALL_EVIDENCE)
      + _ev_rows("78000000-0000-4000-8000-00000000001",
                 "78000000-0000-4000-8000-000000000003", _ALL_EVIDENCE)
      + _ev_rows("81000000-0000-4000-8000-00000000001",
                 "81000000-0000-4000-8000-000000000003", _ALL_EVIDENCE)
      + _ev_rows("82000000-0000-4000-8000-00000000001",
                 "82000000-0000-4000-8000-000000000003", _ALL_EVIDENCE)
      + _ev_rows("91000000-0000-4000-8000-00000000001",
                 "91000000-0000-4000-8000-000000000003", _ALL_EVIDENCE)
      + _ev_rows("92000000-0000-4000-8000-00000000001",
                 "92000000-0000-4000-8000-000000000003", _ALL_EVIDENCE),
    "calculations": [], "drafts": [], "conversations": [], "inbound_messages": [],
    "promises": [
        {"id": "73000000-0000-4000-8000-000000000006",
         "case_id": "73000000-0000-4000-8000-000000000003",
         "made_on": "2026-05-20", "due_date": "2026-05-30", "amount": "100000.00",
         "source_text": "We will clear Rs 1 lakh by 30 May."},
        {"id": "73000000-0000-4000-8000-000000000009",
         "case_id": "73000000-0000-4000-8000-000000000003",
         "made_on": "2026-06-10", "due_date": "2026-06-30", "amount": "60000.00",
         "source_text": "Will transfer the remaining Rs 60,000 by 30 June."},
        {"id": "75000000-0000-4000-8000-000000000007",
         "case_id": "75000000-0000-4000-8000-000000000003",
         "made_on": "2026-10-22", "due_date": "2026-10-28", "amount": "150000.00",
         "source_text": "Payment of Rs 1,50,000 approved in this week's run; NEFT by 28 Oct."},
    ],
    "followups": [
        {"id": "73000000-0000-4000-8000-000000000007",
         "case_id": "73000000-0000-4000-8000-000000000003",
         "step": 1, "sent_on": "2026-05-20", "reply_received": True,
         "note": "Buyer confirmed the Rs 1 lakh payment commitment by 30 May."},
        {"id": "73000000-0000-4000-8000-000000000008",
         "case_id": "73000000-0000-4000-8000-000000000003",
         "step": 2, "sent_on": "2026-06-07", "reply_received": True,
         "note": "Firm reminder after only Rs 40,000 was received on 5 Jun; buyer promised the remaining Rs 60,000 by 30 Jun."},
        {"id": "73000000-0000-4000-8000-000000000010",
         "case_id": "73000000-0000-4000-8000-000000000003",
         "step": 2, "sent_on": "2026-07-05", "reply_received": False,
         "note": "Second firm reminder after the 30 Jun balance commitment was missed; no reply."},
        {"id": "74000000-0000-4000-8000-000000000006",
         "case_id": "74000000-0000-4000-8000-000000000003",
         "step": 1, "sent_on": "2026-07-12", "reply_received": True,
         "note": "Buyer cited colour variance in the 10 Jul email; sample review requested."},
        {"id": "75000000-0000-4000-8000-000000000006",
         "case_id": "75000000-0000-4000-8000-000000000003",
         "step": 1, "sent_on": "2026-10-21", "reply_received": True,
         "note": "Accounts head confirmed the 28 Oct NEFT run commitment."},
        {"id": "82000000-0000-4000-8000-000000000007",
         "case_id": "82000000-0000-4000-8000-000000000003",
         "step": 2, "sent_on": "2026-08-15", "reply_received": False,
         "note": "Firm reminder sent to CPSE finance desk; no reply received."},
    ],
    "milestones": [
        {"id": "55555555-5555-5555-5555-555555555551", "case_id": "33333333-3333-3333-3333-333333333333",
         "title": "First delivery: 3,000 cartons", "due_date": "2026-03-10", "amount": "180000.00",
         "invoice_id": "44444444-4444-4444-4444-444444444441", "created_at": "2026-02-20T10:00:00+00:00"},
        {"id": "55555555-5555-5555-5555-555555555552", "case_id": "33333333-3333-3333-3333-333333333333",
         "title": "Second delivery: 1,500 cartons", "due_date": "2026-05-04", "amount": "95000.00",
         "invoice_id": "44444444-4444-4444-4444-444444444442", "created_at": "2026-02-20T10:00:00+00:00"},
    ],
    "invoice_notes": [],
    "profiles": [
        {
            "id": "88888888-8888-8888-8888-888888888888",
            "full_name": "Meera Raghavan, CA",
            "email": "adviser@example.com",
            "role": "adviser",
            "approval_status": "approved",
            "professional_role": "Chartered Accountant",
            "qualifications": "FCA, DISA (ICAI) · MSME Advisory",
        },
        {
            "id": "22222222-2222-2222-2222-222222222221",
            "full_name": "Kaveri Accounts Desk",
            "email": "buyer@example.com",
            "role": "buyer",
            "approval_status": "approved",
            "business_name": "Kaveri Foods & Beverages Pvt Ltd",
        },
    ],
    "case_shares": [
        {
            "id": "88880001-0000-4000-8000-000000000001",
            "case_id": "33333333-3333-3333-3333-333333333333",
            "adviser_id": "88888888-8888-8888-8888-888888888888",
            "created_at": "2026-10-10T09:00:00+00:00",
        },
        {
            "id": "88880002-0000-4000-8000-000000000001",
            "case_id": "73000000-0000-4000-8000-000000000003",
            "adviser_id": "88888888-8888-8888-8888-888888888888",
            "created_at": "2026-10-12T11:30:00+00:00",
        },
        {
            "id": "88880003-0000-4000-8000-000000000001",
            "case_id": "82000000-0000-4000-8000-000000000003",
            "adviser_id": "88888888-8888-8888-8888-888888888888",
            "created_at": "2026-10-15T14:15:00+00:00",
        },
        {
            "id": "88880004-0000-4000-8000-000000000001",
            "case_id": "92000000-0000-4000-8000-000000000003",
            "adviser_id": "88888888-8888-8888-8888-888888888888",
            "created_at": "2026-10-18T16:45:00+00:00",
        },
    ],
    "payment_blockers": [
        {
            "id": "77770001-0000-4000-8000-000000000001",
            "case_id": "33333333-3333-3333-3333-333333333333",
            "invoice_id": "44444444-4444-4444-4444-444444444441",
            "reason": "po_missing",
            "source": "buyer_said",
            "disputed_amount": None,
            "note": "Accounts team requested PO number 2026/PO/0882 to be printed on the invoice copy.",
            "reported_on": "2026-03-20",
            "resolved_on": "2026-03-24",
            "created_at": "2026-03-20T10:30:00+00:00",
        },
    ],
}

class MemoryStore:
    def __init__(self, seed: bool = True):
        self._last_ts: float = 0.0
        self.tables: dict[str, list[Row]] = copy.deepcopy(DEMO_ROWS) if seed else {
            t: [] for t in DEMO_ROWS}

    def select(self, table: str, **eq: Any) -> list[Row]:
        return [copy.deepcopy(r) for r in self.tables[table]
                if all((r.get(k) in v if isinstance(v, (list, tuple, set)) else r.get(k) == v)
                       for k, v in eq.items())]

    def get(self, table: str, id: str) -> Row | None:
        rows = self.select(table, id=id)
        return rows[0] if rows else None

    def insert(self, table: str, row: Row) -> Row:
        row = {"id": str(uuid.uuid4()), **row}
        if table in ("calculations", "drafts", "cases", "businesses", "promises", "followups",
                     "milestones", "invoice_notes", "case_shares", "payment_blockers"):
            now = time.time()
            if now <= self._last_ts:
                now = self._last_ts + 0.001
            self._last_ts = now
            row.setdefault("created_at", datetime.fromtimestamp(now, tz=timezone.utc).isoformat())
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
        self._fallback_tables: dict[str, list[Row]] = {
            "case_shares": copy.deepcopy(DEMO_ROWS.get("case_shares", [])),
            "milestones": copy.deepcopy(DEMO_ROWS.get("milestones", [])),
            "invoice_notes": copy.deepcopy(DEMO_ROWS.get("invoice_notes", [])),
            "payment_blockers": copy.deepcopy(DEMO_ROWS.get("payment_blockers", [])),
        }

    def _fallback_select(self, table: str, eq: dict[str, Any]) -> list[Row]:
        rows = self._fallback_tables.get(table, [])
        return [
            copy.deepcopy(r) for r in rows
            if all((r.get(k) in v if isinstance(v, (list, tuple, set)) else r.get(k) == v)
                   for k, v in eq.items())
        ]

    def select(self, table: str, **eq: Any) -> list[Row]:
        for v in eq.values():
            if isinstance(v, (list, tuple, set)) and not v:
                return []
        params = {
            "select": "*",
            **{k: f"in.({','.join(str(x) for x in v)})" if isinstance(v, (list, tuple, set)) else f"eq.{v}"
               for k, v in eq.items()},
        }
        try:
            r = self.client.get(f"{self.base}/{table}", params=params)
            if r.status_code == 404 and table in self._fallback_tables:
                return self._fallback_select(table, eq)
            if r.status_code == 400 and ("column" in r.text or "schema cache" in r.text):
                return []
            r.raise_for_status()
            return r.json()
        except httpx.HTTPStatusError as e:
            if e.response.status_code == 404 and table in self._fallback_tables:
                return self._fallback_select(table, eq)
            if e.response.status_code == 400 and ("column" in e.response.text or "schema cache" in e.response.text):
                return []
            raise

    def get(self, table: str, id: str) -> Row | None:
        rows = self.select(table, id=id)
        return rows[0] if rows else None

    def insert(self, table: str, row: Row) -> Row:
        row = {"id": str(uuid.uuid4()), **row}
        try:
            r = self.client.post(f"{self.base}/{table}", json=row,
                                 headers={"Prefer": "return=representation"})
            if r.status_code == 404 and table in self._fallback_tables:
                self._fallback_tables[table].append(copy.deepcopy(row))
                return row
            r.raise_for_status()
            return r.json()[0]
        except httpx.HTTPStatusError as e:
            if e.response.status_code == 404 and table in self._fallback_tables:
                self._fallback_tables[table].append(copy.deepcopy(row))
                return row
            raise

    def update(self, table: str, id: str, patch: Row) -> Row | None:
        try:
            r = self.client.patch(f"{self.base}/{table}", params={"id": f"eq.{id}"}, json=patch,
                                  headers={"Prefer": "return=representation"})
            if r.status_code == 404 and table in self._fallback_tables:
                for row in self._fallback_tables[table]:
                    if row["id"] == id:
                        row.update(patch)
                        return copy.deepcopy(row)
                return None
            r.raise_for_status()
            rows = r.json()
            return rows[0] if rows else None
        except httpx.HTTPStatusError as e:
            if e.response.status_code == 404 and table in self._fallback_tables:
                for row in self._fallback_tables[table]:
                    if row["id"] == id:
                        row.update(patch)
                        return copy.deepcopy(row)
                return None
            raise

    def upsert(self, table: str, row: Row, on_conflict: list[str]) -> Row:
        try:
            r = self.client.post(f"{self.base}/{table}", json=row,
                                 params={"on_conflict": ",".join(on_conflict)},
                                 headers={"Prefer": "return=representation,resolution=merge-duplicates"})
            if r.status_code == 404 and table in self._fallback_tables:
                for r_idx, existing in enumerate(self._fallback_tables[table]):
                    if all(existing.get(k) == row.get(k) for k in on_conflict):
                        self._fallback_tables[table][r_idx].update(row)
                        return copy.deepcopy(self._fallback_tables[table][r_idx])
                self._fallback_tables[table].append(copy.deepcopy(row))
                return row
            r.raise_for_status()
            return r.json()[0]
        except httpx.HTTPStatusError as e:
            if e.response.status_code == 404 and table in self._fallback_tables:
                for r_idx, existing in enumerate(self._fallback_tables[table]):
                    if all(existing.get(k) == row.get(k) for k in on_conflict):
                        self._fallback_tables[table][r_idx].update(row)
                        return copy.deepcopy(self._fallback_tables[table][r_idx])
                self._fallback_tables[table].append(copy.deepcopy(row))
                return row
            raise

    def delete(self, table: str, id: str) -> bool:
        try:
            r = self.client.delete(f"{self.base}/{table}", params={"id": f"eq.{id}"},
                                   headers={"Prefer": "return=representation"})
            if r.status_code == 404 and table in self._fallback_tables:
                before = len(self._fallback_tables[table])
                self._fallback_tables[table] = [r for r in self._fallback_tables[table] if r["id"] != id]
                return len(self._fallback_tables[table]) < before
            r.raise_for_status()
            return bool(r.json())
        except httpx.HTTPStatusError as e:
            if e.response.status_code == 404 and table in self._fallback_tables:
                before = len(self._fallback_tables[table])
                self._fallback_tables[table] = [r for r in self._fallback_tables[table] if r["id"] != id]
                return len(self._fallback_tables[table]) < before
            raise
