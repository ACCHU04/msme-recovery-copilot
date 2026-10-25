"""More demo data: two more suppliers, a demo adviser and shared cases.

All names are fictional. Places, products, invoice sizes, Udyam/GSTIN formats, the law and
the RBI Bank Rate dates are realistic. GSTINs carry a valid check digit but are not real
registrations. `supabase/seed.sql` holds the same rows (generated from this file by
`python -m app.demo_extra > /tmp/extra.sql`).

What each supplier shows:
  Arunodaya Precision Components (Hosur, micro, manufacturing)
    - Velan Auto Systems: principal paid late, only the s.16 interest is still owed
    - Bharat Heavy Castings Ltd (a CPSE): overdue, evidence complete, formal demand stage
  Thenmozhi Knit Works (Tiruppur, small, job-work services; Udyam registered AFTER the first
  order, so eligibility for that order is "uncertain")
    - Kaveri Foods: staff uniforms, overdue. Kaveri Foods also buys from Sri Lakshmi
      Packaging, so the Kaveri buyer account sees invoices from two suppliers.
    - Coastline Apparel Exports: part of a lot rejected in writing within 15 days (dispute)
"""
from __future__ import annotations

_CHARS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ"


def gstin(state: str, pan: str, entity: str = "1") -> str:
    """A format-valid GSTIN with the correct check digit (mod-36 algorithm)."""
    body = f"{state}{pan}{entity}Z"
    total = 0
    for i, ch in enumerate(body):
        v = _CHARS.index(ch) * (2 if i % 2 else 1)
        total += v // 36 + v % 36
    return body + _CHARS[(36 - total % 36) % 36]


BIZ2 = "81000000-0000-4000-8000-000000000001"
BIZ3 = "82000000-0000-4000-8000-000000000001"
SRI = "11111111-1111-1111-1111-111111111111"
ADVISER = "84000000-0000-4000-8000-000000000001"
KAVERI_ROW_SRI = "22222222-2222-2222-2222-222222222222"


def _ev(prefix: str, case_id: str, missing: tuple[str, ...] = ()) -> list[dict]:
    kinds = ["po", "invoice", "delivery_proof", "acceptance_reply", "ledger",
             "communications", "udyam_cert"]
    return [{"id": f"{prefix}{i}", "case_id": case_id, "kind": k,
             "status": "missing" if k in missing else "have",
             "file_path": None, "sha256": None, "prev_hash": None}
            for i, k in enumerate(kinds, start=1)]


BUSINESSES = [
    {"id": BIZ2, "owner_id": None, "phone": "+919845001102",
     "name": "Arunodaya Precision Components", "udyam_no": "UDYAM-TN-11-0048213",
     "size": "micro", "activity": "manufacturing", "udyam_registered": True,
     "udyam_reg_date": "2021-09-03", "preferred_lang": "en",
     "description": "CNC-machined brackets, flanges and pump housings for auto and heavy-engineering buyers.",
     "email": "accounts@arunodaya.example", "address": "Plot 7, SIPCOT Phase II, Hosur 635109, Tamil Nadu",
     "website": None, "gstin": gstin("33", "AQKPA4471M"), "pan": "AQKPA4471M",
     "established_year": 2014,
     "products": ["CNC machined brackets", "Pump housings", "Flanges"],
     "team": [{"name": "Karthik Arumugam", "role": "Owner", "email": "karthik@arunodaya.example"}],
     "documents": {"udyam_certificate": "have", "gst_certificate": "have", "pan_card": "have",
                   "address_proof": "have", "bank_details": "have"}},
    {"id": BIZ3, "owner_id": None, "phone": "+919843002203",
     "name": "Thenmozhi Knit Works", "udyam_no": "UDYAM-TN-32-0091547",
     "size": "small", "activity": "services", "udyam_registered": True,
     "udyam_reg_date": "2026-03-15", "preferred_lang": "en",
     "description": "Knitting and stitching job work: uniforms and T-shirts made from buyers' fabric.",
     "email": "office@thenmozhiknit.example", "address": "12 Kumar Nagar South, Tiruppur 641603, Tamil Nadu",
     "website": None, "gstin": gstin("33", "BDTPT8820K"), "pan": "BDTPT8820K",
     "established_year": 2011,
     "products": ["Uniform stitching", "T-shirt job work", "Knitting"],
     "team": [{"name": "Thenmozhi Selvaraj", "role": "Owner", "email": "thenmozhi@thenmozhiknit.example"}],
     "documents": {"udyam_certificate": "have", "gst_certificate": "have", "pan_card": "have",
                   "address_proof": "unknown", "bank_details": "have"}},
]

BUYERS = [
    {"id": "81000000-0000-4000-8000-000000000002", "business_id": BIZ2,
     "name": "Velan Auto Systems Pvt Ltd", "gstin": gstin("33", "AABCV5521R"),
     "is_cpse": False, "relationship_importance": "high"},
    {"id": "81000000-0000-4000-8000-000000000012", "business_id": BIZ2,
     "name": "Bharat Heavy Castings Ltd", "gstin": gstin("29", "AAACB3108G"),
     "is_cpse": True, "relationship_importance": "medium"},
    {"id": "82000000-0000-4000-8000-000000000002", "business_id": BIZ3,
     "name": "Kaveri Foods Pvt Ltd", "gstin": None,
     "is_cpse": False, "relationship_importance": "high"},
    {"id": "82000000-0000-4000-8000-000000000012", "business_id": BIZ3,
     "name": "Coastline Apparel Exports LLP", "gstin": gstin("33", "AAQFC6609H"),
     "is_cpse": False, "relationship_importance": "medium"},
]

CASES = [
    {"id": "81000000-0000-4000-8000-000000000003", "business_id": BIZ2,
     "buyer_id": "81000000-0000-4000-8000-000000000002", "contract_date": "2026-01-12",
     "status": "active", "ladder_step": 1, "allocation": "principal_first",
     "po_amount": "320000.00", "dispute_reason": "none"},
    {"id": "81000000-0000-4000-8000-000000000013", "business_id": BIZ2,
     "buyer_id": "81000000-0000-4000-8000-000000000012", "contract_date": "2026-03-02",
     "status": "active", "ladder_step": 3, "allocation": "interest_first",
     "po_amount": "410000.00", "dispute_reason": "none"},
    {"id": "82000000-0000-4000-8000-000000000003", "business_id": BIZ3,
     "buyer_id": "82000000-0000-4000-8000-000000000002", "contract_date": "2026-02-10",
     "status": "active", "ladder_step": 1, "allocation": "interest_first",
     "po_amount": "138000.00", "dispute_reason": "none"},
    {"id": "82000000-0000-4000-8000-000000000013", "business_id": BIZ3,
     "buyer_id": "82000000-0000-4000-8000-000000000012", "contract_date": "2026-07-01",
     "status": "active", "ladder_step": 1, "allocation": "interest_first",
     "po_amount": "246000.00", "dispute_reason": "quality"},
]

INVOICES = [
    # Velan Auto: 30 days agreed; both invoices paid in full but late -> interest only.
    {"id": "81000000-0000-4000-8000-000000000004", "case_id": CASES[0]["id"],
     "number": "APC/25-26/0412", "invoice_date": "2026-01-20", "amount": "160000.00",
     "delivery_date": "2026-01-21", "agreed_due_date": "2026-02-20",
     "objection_date": None, "objection_removed_date": None},
    {"id": "81000000-0000-4000-8000-000000000005", "case_id": CASES[0]["id"],
     "number": "APC/25-26/0447", "invoice_date": "2026-02-16", "amount": "160000.00",
     "delivery_date": "2026-02-17", "agreed_due_date": "2026-03-19",
     "objection_date": None, "objection_removed_date": None},
    # Bharat Heavy Castings (CPSE): no written credit period.
    {"id": "81000000-0000-4000-8000-000000000014", "case_id": CASES[1]["id"],
     "number": "APC/26-27/0031", "invoice_date": "2026-04-06", "amount": "205000.00",
     "delivery_date": "2026-04-08", "agreed_due_date": None,
     "objection_date": None, "objection_removed_date": None},
    {"id": "81000000-0000-4000-8000-000000000015", "case_id": CASES[1]["id"],
     "number": "APC/26-27/0058", "invoice_date": "2026-05-11", "amount": "205000.00",
     "delivery_date": "2026-05-12", "agreed_due_date": None,
     "objection_date": None, "objection_removed_date": None},
    # Kaveri Foods uniforms: order before Udyam registration (eligibility uncertain).
    {"id": "82000000-0000-4000-8000-000000000004", "case_id": CASES[2]["id"],
     "number": "TKW-118", "invoice_date": "2026-03-28", "amount": "138000.00",
     "delivery_date": "2026-03-30", "agreed_due_date": "2026-04-29",
     "objection_date": None, "objection_removed_date": None},
    # Coastline: written objection on 9 Jul (within 15 days of the 2 Jul delivery).
    {"id": "82000000-0000-4000-8000-000000000014", "case_id": CASES[3]["id"],
     "number": "TKW-163", "invoice_date": "2026-07-01", "amount": "246000.00",
     "delivery_date": "2026-07-02", "agreed_due_date": "2026-08-01",
     "objection_date": "2026-07-09", "objection_removed_date": None},
]

PAYMENTS = [
    {"id": "81000000-0000-4000-8000-000000000006", "invoice_id": INVOICES[0]["id"],
     "paid_on": "2026-05-08", "amount": "160000.00"},
    {"id": "81000000-0000-4000-8000-000000000007", "invoice_id": INVOICES[1]["id"],
     "paid_on": "2026-06-12", "amount": "160000.00"},
    {"id": "81000000-0000-4000-8000-000000000016", "invoice_id": INVOICES[2]["id"],
     "paid_on": "2026-07-20", "amount": "100000.00"},
    {"id": "82000000-0000-4000-8000-000000000005", "invoice_id": INVOICES[4]["id"],
     "paid_on": "2026-06-15", "amount": "40000.00"},
]

PROMISES = [
    {"id": "82000000-0000-4000-8000-000000000006", "case_id": CASES[2]["id"],
     "made_on": "2026-09-18", "due_date": "2026-10-10", "amount": "98000.00",
     "source_text": "Madam, balance 98,000 will be cleared before Dussehra, 10th Oct."},
]

FOLLOWUPS = [
    {"id": "81000000-0000-4000-8000-000000000008", "case_id": CASES[0]["id"],
     "step": 1, "sent_on": "2026-04-10", "reply_received": True,
     "note": "Velan accounts: 'Bills are in the vendor payment cycle, will release in May.' Paid in May and June."},
    {"id": "81000000-0000-4000-8000-000000000017", "case_id": CASES[1]["id"],
     "step": 2, "sent_on": "2026-08-05", "reply_received": True,
     "note": "Finance dept: 'File is pending for approval with the competent authority.' Rs 1,00,000 released on 20 Jul only."},
    {"id": "81000000-0000-4000-8000-000000000018", "case_id": CASES[1]["id"],
     "step": 2, "sent_on": "2026-09-22", "reply_received": False,
     "note": "Second firm reminder by email and speed post; no reply."},
    {"id": "82000000-0000-4000-8000-000000000007", "case_id": CASES[2]["id"],
     "step": 1, "sent_on": "2026-09-16", "reply_received": True,
     "note": "Kaveri purchase team confirmed balance before Dussehra."},
    {"id": "82000000-0000-4000-8000-000000000015", "case_id": CASES[3]["id"],
     "step": 1, "sent_on": "2026-07-14", "reply_received": True,
     "note": "Coastline QC email: 420 of 3,000 pieces rejected for shade variation; rest accepted. Asked for a credit note on the rejected pieces."},
]

EVIDENCE = (_ev("81000000-0000-4000-8000-00000000010", CASES[0]["id"])
            + _ev("81000000-0000-4000-8000-00000000011", CASES[1]["id"])
            + _ev("82000000-0000-4000-8000-00000000010", CASES[2]["id"], ("acceptance_reply",))
            + _ev("82000000-0000-4000-8000-00000000011", CASES[3]["id"], ("ledger",)))

# Demo adviser and the cases suppliers have shared with them.
ADVISER_PROFILE = {
    "id": ADVISER, "email": "meera.adviser@example.com", "full_name": "Meera Raghavan",
    "business_name": "Raghavan & Co, Chartered Accountants", "mobile_number": "+919880011223",
    "role": "adviser", "approval_status": "approved", "requested_role": "adviser",
    "business_address": None, "udyam_number": None,
    "professional_role": "Chartered Accountant, MSME delayed-payment cases",
    "qualifications": "FCA; MSEFC conciliation experience",
}

SHARES = [
    {"id": "83000000-0000-4000-8000-000000000001", "case_id": "33333333-3333-3333-3333-333333333333",
     "adviser_id": ADVISER, "created_at": "2026-10-21T09:30:00+00:00"},
    {"id": "83000000-0000-4000-8000-000000000002", "case_id": "73000000-0000-4000-8000-000000000003",
     "adviser_id": ADVISER, "created_at": "2026-10-22T11:00:00+00:00"},
    {"id": "83000000-0000-4000-8000-000000000003", "case_id": CASES[1]["id"],
     "adviser_id": ADVISER, "created_at": "2026-10-23T15:45:00+00:00"},
    {"id": "83000000-0000-4000-8000-000000000004", "case_id": CASES[2]["id"],
     "adviser_id": ADVISER, "created_at": "2026-10-24T10:10:00+00:00"},
]

# Buyer records that the demo buyer account ("Kaveri Foods") is linked to, one per supplier.
DEMO_BUYER_ROWS = [KAVERI_ROW_SRI, "82000000-0000-4000-8000-000000000002"]


def extend(rows: dict[str, list]) -> None:
    rows["businesses"] += BUSINESSES
    rows["buyers"] += BUYERS
    rows["cases"] += CASES
    rows["invoices"] += INVOICES
    rows["payments"] += PAYMENTS
    rows["promises"] += PROMISES
    rows["followups"] += FOLLOWUPS
    rows["evidence_items"] += EVIDENCE
    rows.setdefault("case_shares", []).extend(SHARES)


# ---------------------------------------------------------------- SQL for seed.sql
def _lit(v) -> str:
    if v is None:
        return "null"
    if isinstance(v, bool):
        return "true" if v else "false"
    if isinstance(v, (list, dict)):
        import json
        return "'" + json.dumps(v).replace("'", "''") + "'::jsonb"
    return "'" + str(v).replace("'", "''") + "'"


def _insert(table: str, rows: list[dict], cols: list[str], conflict: str) -> str:
    vals = ",\n".join("  (" + ", ".join(_lit(r.get(c)) for c in cols) + ")" for r in rows)
    upd = ", ".join(f"{c} = excluded.{c}" for c in cols if c not in conflict.split(", "))
    return (f"insert into {table} ({', '.join(cols)}) values\n{vals}\n"
            f"on conflict ({conflict}) do update set {upd};\n")


def to_sql() -> str:
    biz_cols = ["id", "name", "phone", "udyam_no", "size", "activity", "udyam_registered",
                "udyam_reg_date", "description", "email", "address", "gstin", "pan",
                "established_year", "products", "team", "documents"]
    parts = [
        _insert("businesses", BUSINESSES, biz_cols, "id"),
        _insert("buyers", BUYERS, ["id", "business_id", "name", "gstin", "is_cpse",
                                   "relationship_importance"], "id"),
        _insert("cases", CASES, ["id", "business_id", "buyer_id", "contract_date", "status",
                                 "ladder_step", "allocation", "po_amount", "dispute_reason"], "id"),
        _insert("invoices", INVOICES, ["id", "case_id", "number", "invoice_date", "amount",
                                       "delivery_date", "agreed_due_date", "objection_date",
                                       "objection_removed_date"], "id"),
        _insert("payments", PAYMENTS, ["id", "invoice_id", "paid_on", "amount"], "id"),
        _insert("promises", PROMISES, ["id", "case_id", "made_on", "due_date", "amount",
                                       "source_text"], "id"),
        _insert("followups", FOLLOWUPS, ["id", "case_id", "step", "sent_on", "reply_received",
                                         "note"], "id"),
        _insert("evidence_items", EVIDENCE, ["id", "case_id", "kind", "status"], "case_id, kind"),
    ]
    return ("-- Suppliers 2 and 3 (generated from backend/app/demo_extra.py; all names fictional).\n"
            + "\n".join(parts))


if __name__ == "__main__":
    print(to_sql())
