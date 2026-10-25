"""Document check: AI reads, code compares, invented values never reach the user."""
import json

import httpx
import pytest
from fastapi.testclient import TestClient

from app import doc_check
from app.config import get_settings
from app.legal_ai import GeminiClient
from app.main import create_app
from app.store import MemoryStore

INV114 = "44444444-4444-4444-4444-444444444441"     # demo: INV-114, 8 Mar 2026, ₹1,80,000, Kaveri Foods
PNG = b"\x89PNG\r\n\x1a\n" + b"0" * 100
PDF = b"%PDF-1.7\n" + b"0" * 100


def gemini_returning(obj, seen=None):
    def handler(req):
        if seen is not None:
            seen.append(json.loads(req.content))
        return httpx.Response(200, json={"candidates": [{"content": {"parts": [{"text": json.dumps(obj)}]}}]})
    return GeminiClient("k", "gemini-3.8-flash", transport=httpx.MockTransport(handler))


def f(name, value, src=None):
    return {"name": name, "value": value, "source_text": src if src is not None else f"{name}: {value}"}


GOOD_INVOICE = {"document_type": "invoice", "notes": "", "fields": [
    f("invoice_number", "INV-114", "Invoice No: INV-114"),
    f("invoice_date", "08/03/2026", "Date: 08/03/2026"),
    f("total_amount", "1,80,000.00", "Grand Total Rs. 1,80,000.00"),
    f("buyer_name", "Kaveri Foods Pvt. Ltd.", "Bill to: Kaveri Foods Pvt. Ltd."),
    f("seller_name", "Sri Lakshmi Packaging", "Sri Lakshmi Packaging, Peenya"),
    f("seller_gstin", "29ABCDE1234F1ZW", "GSTIN: 29ABCDE1234F1ZW"),
]}


@pytest.fixture
def api():
    return TestClient(create_app(get_settings(), MemoryStore(seed=True)))


def upload(api, content=PNG, name="inv.png", mime="image/png", **form):
    return api.post("/api/documents/check", files={"file": (name, content, mime)}, data=form)


# ------------------------------------------------------------------ reading

def test_values_not_in_their_quoted_text_are_dropped():
    r = doc_check.read_document(json.dumps({"document_type": "invoice", "fields": [
        f("invoice_number", "INV-114", "Invoice No: INV-114"),
        f("total_amount", "2,50,000", "Grand Total Rs. 1,80,000.00"),     # invented amount
        f("buyer_name", "Kaveri Foods", ""),                               # no source quoted
        f("made_up_field", "x", "x"),                                      # unknown field
    ]}))
    assert [x["name"] for x in r.fields] == ["invoice_number"]
    assert set(r.dropped) == {"total_amount", "buyer_name"}


def test_amount_formats_are_compared_as_numbers():
    assert doc_check.supported("1,80,000.00", "Total Rs.180000.00", "total_amount")
    assert not doc_check.supported("1,80,000", "Total Rs. 18,000", "total_amount")


@pytest.mark.parametrize("raw", ["not json", json.dumps({"document_type": "letter", "fields": []}),
                                 json.dumps({"document_type": "invoice", "fields": "x"})])
def test_bad_model_output_is_unavailable(raw):
    assert doc_check.read_document(raw).source == "unavailable"


def test_date_and_name_helpers():
    assert str(doc_check.parse_date("8th Mar 2026")) == "2026-03-08"
    assert str(doc_check.parse_date("08-03-2026")) == "2026-03-08"
    assert doc_check.names_match("M/s Kaveri Foods Private Limited", "Kaveri Foods Pvt Ltd")
    assert not doc_check.names_match("Kaveri Foods", "Deccan Agro Mills")


def test_file_type_is_sniffed_not_trusted():
    assert doc_check.sniff_mime(PNG) == "image/png" and doc_check.sniff_mime(PDF) == "application/pdf"
    assert doc_check.sniff_mime(b"MZ\x90\x00 an exe") is None


# ------------------------------------------------------------------ endpoint

def test_matching_invoice_looks_right(api):
    seen = []
    api.app.state.llm = gemini_returning(GOOD_INVOICE, seen)
    j = upload(api, invoice_id=INV114, expected="invoice").json()
    assert j["verdict"] == "looks_right" and j["evidence_kind"] == "invoice"
    assert j["case_id"] == "33333333-3333-3333-3333-333333333333"
    assert {x["check"]: x["status"] for x in j["findings"]} == {
        "Document type": "match", "Invoice number": "match", "Amount": "match", "Invoice date": "match",
        "Buyer": "match", "Seller (you)": "match", "Seller GSTIN": "match"}
    part = seen[0]["contents"][0]["parts"][0]["inlineData"]
    assert part["mimeType"] == "image/png" and part["data"]           # the file went as inline data


def test_wrong_amount_and_number_are_flagged(api):
    bad = json.loads(json.dumps(GOOD_INVOICE))
    bad["fields"][0] = f("invoice_number", "INV-141", "Invoice No: INV-141")
    bad["fields"][2] = f("total_amount", "1,08,000.00", "Grand Total 1,08,000.00")
    api.app.state.llm = gemini_returning(bad)
    j = upload(api, invoice_id=INV114, expected="invoice").json()
    st = {x["check"]: x for x in j["findings"]}
    assert j["verdict"] == "check_this" and j["evidence_kind"] is None
    assert st["Invoice number"]["status"] == "mismatch" and st["Amount"]["status"] == "mismatch"
    assert "₹1,08,000.00" in st["Amount"]["detail"] and "₹1,80,000.00" in st["Amount"]["detail"]


def test_wrong_document_type(api):
    api.app.state.llm = gemini_returning({"document_type": "purchase_order", "fields": [
        f("po_number", "PO-77", "PO No. PO-77")]})
    j = upload(api, invoice_id=INV114, expected="invoice").json()
    assert j["verdict"] == "wrong_document" and "purchase order" in j["findings"][0]["detail"]


def test_bad_gstin_on_document_is_warned(api):
    doc = {"document_type": "invoice", "fields": [f("buyer_gstin", "29ABCDE1234F1ZX", "GSTIN 29ABCDE1234F1ZX")]}
    api.app.state.llm = gemini_returning(doc)
    j = upload(api).json()
    assert j["verdict"] == "check_this" and any(x["check"] == "Buyer GSTIN" and x["status"] == "warning" for x in j["findings"])


def test_unreadable(api):
    api.app.state.llm = gemini_returning({"document_type": "unreadable", "fields": []})
    assert upload(api).json()["verdict"] == "unreadable"


def test_no_key_and_bad_files(api):
    assert upload(api).json()["source"] == "unavailable"
    assert upload(api, content=b"MZ not an image", name="x.png").status_code == 415
    assert upload(api, content=PNG + b"0" * (8 * 1024 * 1024)).status_code == 413
    assert upload(api, expected="passport").status_code == 422


def test_other_business_invoice_is_not_found():
    from tests.test_api import OWNER, STRANGER, bearer, token  # noqa: F401
    from app.config import Settings
    store = MemoryStore(seed=True)
    store.update("businesses", "11111111-1111-1111-1111-111111111111", {"owner_id": OWNER})
    for uid in (OWNER, STRANGER):
        store.insert("profiles", {"id": uid, "role": "supplier", "approval_status": "approved"})
    s = Settings(store="memory", auth_mode="supabase", supabase_url=None, supabase_service_key=None,
                 supabase_jwt_secret="test-secret-at-least-32-characters-long", cors_origins=[],
                 demo_business_id="11111111-1111-1111-1111-111111111111")
    api = TestClient(create_app(s, store))
    h = bearer(token(STRANGER))
    api.post("/api/businesses", json={"name": "Other Co"}, headers=h)
    r = api.post("/api/documents/check", files={"file": ("a.png", PNG, "image/png")}, data={"invoice_id": INV114}, headers=h)
    assert r.status_code == 404
    assert api.post("/api/documents/check", files={"file": ("a.png", PNG, "image/png")}).status_code == 401
