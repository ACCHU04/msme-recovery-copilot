"""API tests against the in-memory store. The demo-case totals must match the
engine figures in the build plan (as of 2026-10-25, interest-first)."""
import pytest
from decimal import Decimal
from fastapi.testclient import TestClient

from app.config import get_settings
from app.main import create_app
from app.store import MemoryStore

CASE = "33333333-3333-3333-3333-333333333333"
INV114 = "44444444-4444-4444-4444-444444444441"
OTHER = {"X-Business-Id": "99999999-9999-9999-9999-999999999999"}


@pytest.fixture
def client():
    return TestClient(create_app(get_settings(), MemoryStore(seed=True)))


def evaluate(client, as_of="2026-10-25", case=CASE):
    r = client.post(f"/api/cases/{case}/evaluate", json={"as_of": as_of})
    assert r.status_code == 200, r.text
    return r.json()


def test_health(client):
    assert client.get("/api/health").json()["ok"] is True


def test_demo_case_matches_plan(client):
    ev = evaluate(client)
    assert ev["eligibility"]["verdict"] == "eligible"
    inv = {i["number"]: i for i in ev["invoices"]}
    assert inv["INV-114"]["status"] == "computed"
    assert inv["INV-114"]["due"]["interest_start"] == "2026-03-26"
    assert inv["INV-114"]["interest"]["total_outstanding"] == "144734.20"
    assert inv["INV-131"]["due"]["interest_start"] == "2026-06-04"
    assert inv["INV-131"]["interest"]["total_outstanding"] == "101338.41"
    assert ev["totals"] == {"principal": "230499.54", "interest": "15573.07",
                            "total": "246072.61"}
    assert ev["bucket"] == "overdue_interest_accruing"
    assert ev["calculation_id"]


def test_settlement_after_evaluate(client):
    assert client.get(f"/api/cases/{CASE}/settlement").status_code == 409
    evaluate(client)
    opts = client.get(f"/api/cases/{CASE}/settlement").json()["options"]
    assert opts[1]["amount_forgone"] == "7786.54"
    assert opts[2]["amount_requested"] == "230499.54"


def test_registered_after_contract_is_uncertain(client):
    client.post("/api/businesses", json={
        "name": "Sri Lakshmi Packaging", "size": "micro", "activity": "manufacturing",
        "udyam_registered": True, "udyam_reg_date": "2026-03-01"})
    ev = evaluate(client)
    assert ev["eligibility"]["verdict"] == "uncertain"
    assert all(i["status"] == "eligibility_uncertain" for i in ev["invoices"])
    assert ev["totals"]["interest"] == "0.00"


def test_trader_not_eligible(client):
    client.post("/api/businesses", json={"name": "X", "size": "micro", "activity": "trader",
                                         "udyam_registered": True,
                                         "udyam_reg_date": "2023-01-01"})
    ev = evaluate(client)
    assert ev["eligibility"]["verdict"] == "not_eligible"
    assert ev["totals"]["principal"] == "225000.00"   # 180000 - 50000 + 95000


def test_full_flow_new_case_with_objection(client):
    r = client.post("/api/cases", json={"buyer": {"name": "Coastal Mart",
                                                  "relationship_importance": "medium"},
                                        "contract_date": "2026-07-01"})
    assert r.status_code == 201
    case_id = r.json()["id"]
    r = client.post(f"/api/cases/{case_id}/invoices", json={
        "number": "INV-200", "invoice_date": "2026-07-05", "amount": "50000",
        "delivery_date": "2026-07-06", "objection_date": "2026-07-10"})
    assert r.status_code == 201
    ev = evaluate(client, case=case_id)
    assert ev["invoices"][0]["status"] == "disputed"
    assert ev["totals"]["interest"] == "0.00"
    case = client.get(f"/api/cases/{case_id}").json()
    assert len(case["evidence"]) == 7


def test_missing_delivery_date(client):
    case_id = client.post("/api/cases", json={"buyer": {"name": "B"}}).json()["id"]
    client.post(f"/api/cases/{case_id}/invoices", json={
        "number": "A1", "invoice_date": "2026-08-01", "amount": "1000"})
    ev = evaluate(client, case=case_id)
    assert ev["invoices"][0]["status"] == "missing_inputs"


def test_evaluate_without_invoices_conflict(client):
    case_id = client.post("/api/cases", json={"buyer": {"name": "B"}}).json()["id"]
    assert client.post(f"/api/cases/{case_id}/evaluate", json={}).status_code == 409


@pytest.mark.parametrize("body,field", [
    ({"number": "X", "invoice_date": "2099-01-01", "amount": "10"}, "invoice_date"),
    ({"number": "X", "invoice_date": "2026-01-01", "amount": "-5"}, "amount"),
    ({"number": "X", "invoice_date": "2026-01-01", "amount": "10",
      "delivery_date": "2026-01-10", "objection_date": "2026-01-05"}, "body"),
])
def test_invoice_validation(client, body, field):
    r = client.post(f"/api/cases/{CASE}/invoices", json=body)
    assert r.status_code == 422
    assert r.json()["field"] == field
    assert r.json()["message"]


def test_duplicate_invoice_number(client):
    r = client.post(f"/api/cases/{CASE}/invoices", json={
        "number": "INV-114", "invoice_date": "2026-03-08", "amount": "10"})
    assert r.status_code == 409


def test_payment_rules(client):
    assert client.post(f"/api/invoices/{INV114}/payments",
                       json={"paid_on": "2026-07-01", "amount": "999999"}).status_code == 422
    assert client.post(f"/api/invoices/{INV114}/payments",
                       json={"paid_on": "2026-01-01", "amount": "10"}).status_code == 422
    assert client.post(f"/api/invoices/{INV114}/payments",
                       json={"paid_on": "2026-07-01", "amount": "10000"}).status_code == 201


def test_gstin_validation(client):
    ok = client.post("/api/cases", json={"buyer": {"name": "G", "gstin": "27AAPFU0939F1ZV"}})
    bad = client.post("/api/cases", json={"buyer": {"name": "G", "gstin": "27AAPFU0939F1ZA"}})
    assert ok.status_code == 201 and bad.status_code == 422


def test_other_business_cannot_see_case(client):
    assert client.get(f"/api/cases/{CASE}", headers=OTHER).status_code == 404
    assert client.post(f"/api/cases/{CASE}/evaluate", json={}, headers=OTHER).status_code == 404


def test_allocation_toggle(client):
    # INV-114's payment falls mid-period, so principal-first is Rs 5.98 lower overall.
    a = evaluate(client)["totals"]
    client.patch(f"/api/cases/{CASE}", json={"allocation": "principal_first"})
    b = evaluate(client)
    assert b["allocation"] == "principal_first"
    assert a["total"] == "246072.61" and b["totals"]["total"] == "246066.63"
    assert a["principal"] != b["totals"]["principal"]


def test_evidence_and_case_list(client):
    r = client.put(f"/api/cases/{CASE}/evidence/acceptance_reply", json={"status": "have"})
    assert r.json()["status"] == "have"
    assert client.put(f"/api/cases/{CASE}/evidence/selfie",
                      json={"status": "have"}).status_code == 404
    cases = client.get("/api/cases").json()
    assert cases[0]["buyer_name"] == "Kaveri Foods Pvt Ltd"
    assert cases[0]["bucket"] == "overdue_interest_accruing"


def test_sim_message(client):
    first = client.post("/api/sim/message", json={"session": "t1", "text": "hi"}).json()
    assert len(first["replies"]) >= 2
    second = client.post("/api/sim/message", json={"session": "t1", "text": "hello"}).json()
    assert second["replies"] == ["Received: hello"]


# ---------------------------------------------------------------- payment totals
def test_cumulative_payments_capped_at_amount_owed(client):
    # INV-114 owes Rs 1,37,340.60 on 1 Jul 2026 after the earlier Rs 50,000.
    ok = client.post(f"/api/invoices/{INV114}/payments",
                     json={"paid_on": "2026-07-01", "amount": "100000"})
    assert ok.status_code == 201
    over = client.post(f"/api/invoices/{INV114}/payments",
                       json={"paid_on": "2026-07-02", "amount": "100000"})
    assert over.status_code == 422
    assert "owed" in over.json()["detail"]


def test_payment_can_cover_interest_not_just_principal(client):
    # 137340.60 owed on 1 Jul: more than the Rs 1,30,000 unpaid principal, still allowed.
    r = client.post(f"/api/invoices/{INV114}/payments",
                    json={"paid_on": "2026-07-01", "amount": "137340.60"})
    assert r.status_code == 201
    r = client.post(f"/api/invoices/{INV114}/payments",
                    json={"paid_on": "2026-07-01", "amount": "0.01"})
    assert r.status_code == 422


def test_duplicate_payment_needs_confirmation(client):
    body = {"paid_on": "2026-07-01", "amount": "10000"}
    assert client.post(f"/api/invoices/{INV114}/payments", json=body).status_code == 201
    assert client.post(f"/api/invoices/{INV114}/payments", json=body).status_code == 409
    assert client.post(f"/api/invoices/{INV114}/payments?confirm_duplicate=true",
                       json=body).status_code == 201


def test_ineligible_case_payment_capped_at_principal(client):
    client.post("/api/businesses", json={"name": "X", "size": "medium",
                                         "activity": "manufacturing"})
    r = client.post(f"/api/invoices/{INV114}/payments",
                    json={"paid_on": "2026-07-01", "amount": "130000.01"})
    assert r.status_code == 422


# ---------------------------------------------------------------- authentication
import time

import jwt as pyjwt

from app.config import Settings

SECRET = "test-secret-at-least-32-characters-long"
OWNER = "aaaaaaaa-0000-0000-0000-000000000001"
STRANGER = "bbbbbbbb-0000-0000-0000-000000000002"
BUYER = "cccccccc-0000-0000-0000-000000000003"
ADVISER_PENDING = "dddddddd-0000-0000-0000-000000000004"
ADVISER_OK = "eeeeeeee-0000-0000-0000-000000000005"
NO_PROFILE = "ffffffff-0000-0000-0000-000000000006"
PROFILES = [(OWNER, "supplier", "approved"), (STRANGER, "supplier", "approved"),
            (BUYER, "buyer", "approved"), (ADVISER_PENDING, "adviser", "pending"),
            (ADVISER_OK, "adviser", "approved")]


def token(sub, secret=SECRET, exp_in=3600):
    return pyjwt.encode({"sub": sub, "aud": "authenticated",
                         "exp": int(time.time()) + exp_in}, secret, algorithm="HS256")


@pytest.fixture
def secure_client():
    store = MemoryStore(seed=True)
    store.update("businesses", "11111111-1111-1111-1111-111111111111", {"owner_id": OWNER})
    for uid, role, status in PROFILES:   # as the sign-up trigger in migration 003 would create
        store.insert("profiles", {"id": uid, "role": role, "approval_status": status})
    settings = Settings(store="memory", auth_mode="supabase", supabase_url=None,
                        supabase_service_key=None, supabase_jwt_secret=SECRET,
                        cors_origins=[], demo_business_id="11111111-1111-1111-1111-111111111111")
    return TestClient(create_app(settings, store))


def bearer(t):
    return {"Authorization": f"Bearer {t}"}


def test_no_token_rejected(secure_client):
    assert secure_client.get(f"/api/cases/{CASE}").status_code == 401


def test_bad_signature_and_expired_rejected(secure_client):
    forged = token(OWNER, secret="some-other-secret-at-least-32-chars")
    assert secure_client.get(f"/api/cases/{CASE}", headers=bearer(forged)).status_code == 401
    old = token(OWNER, exp_in=-10)
    r = secure_client.get(f"/api/cases/{CASE}", headers=bearer(old))
    assert r.status_code == 401 and "expired" in r.json()["detail"]


def test_owner_can_read_and_header_is_ignored(secure_client):
    h = bearer(token(OWNER))
    assert secure_client.get(f"/api/cases/{CASE}", headers=h).status_code == 200
    h_stranger = {**bearer(token(STRANGER)),
                  "X-Business-Id": "11111111-1111-1111-1111-111111111111"}
    assert secure_client.get(f"/api/cases/{CASE}", headers=h_stranger).status_code == 404


def test_new_user_sets_up_profile_then_owns_only_their_case(secure_client):
    h = bearer(token(STRANGER))
    assert secure_client.get("/api/businesses/me", headers=h).status_code == 404
    b = secure_client.post("/api/businesses", json={"name": "New Co", "size": "small",
                                                    "activity": "services"}, headers=h)
    assert b.status_code == 200 and b.json()["owner_id"] == STRANGER
    c = secure_client.post("/api/cases", json={"buyer": {"name": "Buyer"}}, headers=h)
    assert c.status_code == 201
    cases = secure_client.get("/api/cases", headers=h).json()
    assert [x["id"] for x in cases] == [c.json()["id"]]
    assert secure_client.get(f"/api/cases/{c.json()['id']}",
                             headers=bearer(token(OWNER))).status_code == 404


@pytest.mark.parametrize("who", [BUYER, ADVISER_OK, ADVISER_PENDING])
def test_non_suppliers_cannot_touch_business_data(secure_client, who):
    h = bearer(token(who))
    for method, path, body in [("get", f"/api/cases/{CASE}", None), ("get", "/api/cases", None),
                               ("get", "/api/invoices", None), ("get", "/api/businesses/me", None),
                               ("post", "/api/businesses", {"name": "X", "size": "micro",
                                                            "activity": "services"}),
                               ("post", "/api/cases", {"buyer": {"name": "B"}})]:
        r = getattr(secure_client, method)(path, headers=h, **({"json": body} if body else {}))
        assert r.status_code == 403, (who, path, r.status_code)


def test_buyer_and_approved_adviser_can_use_calculator(secure_client):
    body = {"amount": "100000", "delivery_date": "2026-06-01", "as_of": "2026-10-25"}
    for who in (BUYER, ADVISER_OK, OWNER):
        h = bearer(token(who))
        assert secure_client.post("/api/calculate", json=body, headers=h).status_code == 200
        assert secure_client.get("/api/rates", headers=h).status_code == 200
        assert secure_client.post("/api/legal/ask", json={"question": "When must I be paid?"}, headers=h).status_code == 200


def test_pending_adviser_is_refused_everywhere(secure_client):
    h = bearer(token(ADVISER_PENDING))
    r = secure_client.get("/api/rates", headers=h)
    assert r.status_code == 403 and "approval" in r.json()["detail"]
    assert secure_client.post("/api/legal/ask", json={"question": "When must I be paid?"}, headers=h).status_code == 403


def test_valid_token_without_profile_is_refused(secure_client):
    r = secure_client.get("/api/rates", headers=bearer(token(NO_PROFILE)))
    assert r.status_code == 403 and "profile" in r.json()["detail"]


def test_supabase_store_requires_real_auth(monkeypatch):
    from app.config import get_settings
    monkeypatch.setenv("STORE", "supabase")
    monkeypatch.setenv("AUTH_MODE", "demo")
    with pytest.raises(RuntimeError):
        get_settings()


# ---------------------------------------------------------------- recovery copilot
def test_demo_story_broken_promise_changes_next_action(client):
    ev = evaluate(client)
    assert ev["next_action"]["action"] == "nudge"
    assert ev["readiness"]["odr_ready"] is True
    assert all(f["severity"] == "info" for f in ev["findings"])

    # Owner pastes the buyer's message from 20 Oct; app proposes values, saves nothing.
    ex = client.post(f"/api/cases/{CASE}/promises/extract",
                     json={"text": "Sir, will pay 50k by 23/10 sure", "said_on": "2026-10-20"})
    c = ex.json()
    assert c["amount"] == "50000.00" and c["due_date"] == "2026-10-23" and not c["missing"]
    assert client.get(f"/api/cases/{CASE}/promises").json() == []

    # Owner confirms -> saved; 23 Oct passes with no payment -> broken -> firm reminder.
    r = client.post(f"/api/cases/{CASE}/promises", json={
        "made_on": c["made_on"], "due_date": c["due_date"], "amount": c["amount"],
        "source_text": c["source_text"]})
    assert r.status_code == 201
    ev = evaluate(client)
    assert ev["promises"][0]["status"] == "broken"
    assert ev["next_action"]["action"] == "firm"
    assert any("broken" in x for x in ev["next_action"]["reasons"])
    assert f"promise:{ev['promises'][0]['promise_id']}" in ev["next_action"]["based_on"]


def test_promise_pending_then_kept(client):
    client.post(f"/api/cases/{CASE}/promises", json={
        "made_on": "2026-10-20", "due_date": "2026-10-30", "amount": "50000"})
    assert evaluate(client)["next_action"]["action"] == "await_promise"
    client.post(f"/api/invoices/{INV114}/payments", json={"paid_on": "2026-10-22",
                                                          "amount": "50000"})
    ev = evaluate(client)
    assert ev["promises"][0]["status"] == "kept"
    assert ev["next_action"]["action"] == "nudge"


def test_dispute_and_mismatch_take_priority(client):
    client.patch(f"/api/cases/{CASE}", json={"po_amount": "200000"})
    ev = evaluate(client)
    assert ev["next_action"]["action"] == "fix_mismatch"
    assert any(f["id"] == "po_amount_exceeded" for f in ev["findings"])
    client.patch(f"/api/cases/{CASE}", json={"dispute_reason": "quality"})
    assert evaluate(client)["next_action"]["action"] == "resolve_dispute"


def test_followups_drive_escalation_to_odr(client):
    for step, sent in ((1, "2026-08-01"), (2, "2026-09-01"), (3, "2026-10-01")):
        r = client.post(f"/api/cases/{CASE}/followups", json={"step": step, "sent_on": sent})
        assert r.status_code == 201
    ev = evaluate(client)
    assert ev["next_action"]["action"] == "prepare_odr"
    assert client.get(f"/api/cases/{CASE}").json()["ladder_step"] == 3
    # Buyer replies to the demand -> stay at formal demand level, not ODR.
    fu = [f for f in ev["followups"] if f["step"] == 3][0]
    client.patch(f"/api/followups/{fu['id']}", json={"reply_received": True})
    assert evaluate(client)["next_action"]["action"] == "demand"


def test_odr_blocked_until_documents_ready(client):
    client.put(f"/api/cases/{CASE}/evidence/udyam_cert", json={"status": "missing"})
    client.post(f"/api/cases/{CASE}/followups", json={"step": 3, "sent_on": "2026-10-01"})
    ev = evaluate(client)
    assert ev["next_action"]["action"] == "collect_evidence"
    assert ev["readiness"]["missing"] == ["udyam_cert"]


def test_uncertain_eligibility_caps_recommendation(client):
    client.post("/api/businesses", json={"name": "Sri Lakshmi Packaging", "size": "micro",
                                         "activity": "manufacturing", "udyam_registered": True,
                                         "udyam_reg_date": "2026-03-01"})
    client.post(f"/api/cases/{CASE}/followups", json={"step": 3, "sent_on": "2026-10-01"})
    na = evaluate(client)["next_action"]
    assert na["action"] == "firm" and "legally unsettled" in na["caution"]


@pytest.mark.parametrize("body", [
    {"made_on": "2026-10-20", "due_date": "2026-10-10", "amount": "100"},
    {"made_on": "2099-01-01", "due_date": "2099-01-02", "amount": "100"},
    {"made_on": "2026-10-20", "due_date": "2026-10-30", "amount": "0"},
])
def test_promise_validation(client, body):
    assert client.post(f"/api/cases/{CASE}/promises", json=body).status_code == 422


def test_extract_reports_missing_fields(client):
    c = client.post(f"/api/cases/{CASE}/promises/extract",
                    json={"text": "accounts is checking, will revert", "said_on": "2026-10-20"}
                    ).json()
    assert set(c["missing"]) == {"amount", "due_date"}


# ---------------------------------------------------------------- authz on every endpoint
FU_ID = "77777777-7777-7777-7777-777777777777"
MS1 = "55555555-5555-5555-5555-555555555551"
MS2 = "55555555-5555-5555-5555-555555555552"
NOTE_ID = "66666666-6666-6666-6666-666666666666"
ENDPOINTS = [
    ("get", "/api/businesses/me", None),
    ("get", "/api/cases", None),
    ("post", "/api/cases", {"buyer": {"name": "X"}}),
    ("get", f"/api/cases/{CASE}", None),
    ("patch", f"/api/cases/{CASE}", {"status": "active"}),
    ("post", f"/api/cases/{CASE}/invoices", {"number": "Z", "invoice_date": "2026-03-01",
                                             "amount": "10"}),
    ("post", f"/api/invoices/{INV114}/payments", {"paid_on": "2026-07-01", "amount": "10"}),
    ("put", f"/api/cases/{CASE}/evidence/po", {"status": "have"}),
    ("post", f"/api/cases/{CASE}/evaluate", {}),
    ("get", f"/api/cases/{CASE}/settlement", None),
    ("post", f"/api/cases/{CASE}/promises/extract", {"text": "50k Friday"}),
    ("post", f"/api/cases/{CASE}/promises", {"made_on": "2026-10-20", "due_date": "2026-10-30",
                                             "amount": "10"}),
    ("get", f"/api/cases/{CASE}/promises", None),
    ("post", f"/api/cases/{CASE}/followups", {"step": 1, "sent_on": "2026-10-01"}),
    ("patch", f"/api/followups/{FU_ID}", {"reply_received": True}),
    ("post", f"/api/cases/{CASE}/drafts", {"kind": "nudge"}),
    ("get", "/api/invoices", None),
    ("get", f"/api/invoices/{INV114}", None),
    ("patch", f"/api/invoices/{INV114}", {"agreed_due_date": "2026-03-30"}),
    ("post", "/api/calculate", {"amount": "1000", "delivery_date": "2026-01-01"}),
    ("get", "/api/rates", None),
    ("post", "/api/legal/ask", {"question": "When must the buyer pay?"}),
    ("get", "/api/legal/status", None),
    ("post", "/api/sim/message", {"session": "s", "text": "hi"}),
    ("get", f"/api/cases/{CASE}/milestones", None),
    ("post", f"/api/cases/{CASE}/milestones", {"title": "M3", "due_date": "2026-11-01", "amount": "10"}),
    ("patch", f"/api/milestones/{MS1}", {"title": "Renamed"}),
    ("get", f"/api/invoices/{INV114}/notes", None),
    ("post", f"/api/invoices/{INV114}/notes", {"body": "Called accounts"}),
    ("delete", f"/api/notes/{NOTE_ID}", None),
    ("delete", f"/api/milestones/{MS2}", None),
]


@pytest.fixture
def secure_with_followup(secure_client):
    secure_client.app.state.store.tables["followups"].append(
        {"id": FU_ID, "case_id": CASE, "step": 1, "sent_on": "2026-10-01",
         "reply_received": False})
    secure_client.app.state.store.tables["invoice_notes"].append(
        {"id": NOTE_ID, "invoice_id": INV114, "body": "x", "created_at": "2026-10-01T00:00:00+00:00"})
    return secure_client


@pytest.mark.parametrize("method,path,body", ENDPOINTS)
def test_every_endpoint_requires_login(secure_with_followup, method, path, body):
    kw = {"json": body} if body is not None else {}
    assert getattr(secure_with_followup, method)(path, **kw).status_code == 401


@pytest.mark.parametrize("method,path,body",
                         [e for e in ENDPOINTS if "/cases/" in e[1] or "/invoices/" in e[1]
                          or "/followups/" in e[1] or "/milestones/" in e[1] or "/notes/" in e[1]])
def test_other_user_cannot_touch_this_case(secure_with_followup, method, path, body):
    h = bearer(token(STRANGER))
    secure_with_followup.post("/api/businesses", json={"name": "Other Co"}, headers=h)
    kw = {"json": body} if body is not None else {}
    r = getattr(secure_with_followup, method)(path, headers=h, **kw)
    assert r.status_code == 404, (path, r.status_code, r.text)


def test_owner_reaches_every_endpoint(secure_with_followup):
    h = bearer(token(OWNER))
    secure_with_followup.post(f"/api/cases/{CASE}/evaluate", json={}, headers=h)
    for method, path, body in ENDPOINTS:
        kw = {"json": body} if body is not None else {}
        r = getattr(secure_with_followup, method)(path, headers=h, **kw)
        assert r.status_code in (200, 201), (path, r.status_code, r.text)


# ---------------------------------------------------------------- drafts
import re


def draft(client, kind):
    return client.post(f"/api/cases/{CASE}/drafts", json={"kind": kind})


def test_draft_needs_evaluate_first(client):
    assert draft(client, "nudge").status_code == 409


def test_nudge_and_firm_use_snapshot_figures(client):
    evaluate(client)
    nudge = draft(client, "nudge").json()
    assert "Rs 2,25,000.00" in nudge["body"] and "INV-114 and INV-131" in nudge["body"]
    assert "MSMED" not in nudge["body"] and nudge["generated_by"] == "template"
    firm = draft(client, "firm").json()["body"]
    assert "Rs 15,573.07" in firm and "Rs 2,46,072.61" in firm and "9 Nov 2026" in firm


def test_firm_cites_broken_promise(client):
    client.post(f"/api/cases/{CASE}/promises", json={
        "made_on": "2026-10-20", "due_date": "2026-10-23", "amount": "50000"})
    evaluate(client)
    assert "Rs 50,000.00 by 23 Oct 2026" in draft(client, "firm").json()["body"]


def test_demand_lists_invoices_and_sections(client):
    evaluate(client)
    d = draft(client, "demand").json()
    assert "Sections 15 and 16" in d["body"]
    assert "INV-114: due by 25 Mar 2026, outstanding Rs 1,44,734.20" in d["body"]
    assert d["caution"]


def test_every_amount_in_a_draft_comes_from_the_calculation(client):
    client.post(f"/api/cases/{CASE}/promises", json={
        "made_on": "2026-10-20", "due_date": "2026-10-23", "amount": "50000"})
    ev = evaluate(client)
    allowed = {ev["totals"]["interest"], ev["totals"]["total"], "225000.00", "50000.00"}
    allowed |= {i["interest"]["total_outstanding"] for i in ev["invoices"]}
    for kind in ("acceptance_confirm", "nudge", "firm", "demand"):
        body = draft(client, kind).json()["body"]
        for amt in re.findall(r"Rs ([\d,]+\.\d{2})", body):
            assert amt.replace(",", "") in allowed, (kind, amt)


def test_no_legal_demand_when_eligibility_unsettled(client):
    client.post("/api/businesses", json={"name": "Sri Lakshmi Packaging", "size": "micro",
                                         "activity": "manufacturing", "udyam_registered": True,
                                         "udyam_reg_date": "2026-03-01"})
    evaluate(client)
    assert draft(client, "demand").status_code == 422
    firm = draft(client, "firm").json()["body"]
    assert "MSMED" not in firm and "Rs 2,25,000.00" in firm


# ---------------------------------------------------------------- invoices, edits, calculator
INV131 = "44444444-4444-4444-4444-444444444442"


def test_invoice_list_statuses(client):
    rows = {r["number"]: r for r in client.get("/api/invoices?as_of=2026-10-25").json()}
    a, b = rows["INV-114"], rows["INV-131"]
    assert a["status"] == "overdue" and a["partially_paid"] and a["paid"] == "50000.00"
    assert a["unpaid"] == "130000.00" and a["days_overdue"] == 214
    assert a["last_day_to_pay"] == "2026-03-25" and a["statutory_total"] == "144734.20"
    assert b["status"] == "overdue" and not b["partially_paid"] and b["days_overdue"] == 144
    assert a["buyer_name"] == "Kaveri Foods Pvt Ltd"


def test_invoice_status_not_due_and_due_soon(client):
    r = client.get("/api/invoices?as_of=2026-03-12").json()
    assert {x["number"]: x["status"] for x in r}["INV-114"] == "not_due"
    r = client.get("/api/invoices?as_of=2026-03-20").json()
    x = {x["number"]: x for x in r}["INV-114"]
    assert x["status"] == "due_soon" and x["days_left"] == 5


def test_invoice_detail(client):
    d = client.get(f"/api/invoices/{INV114}").json()
    assert d["number"] == "INV-114" and len(d["payments"]) == 1
    assert d["buyer"]["name"] == "Kaveri Foods Pvt Ltd" and d["case"]["id"] == CASE


def test_patch_invoice_and_revalidate(client):
    r = client.patch(f"/api/invoices/{INV114}", json={"agreed_due_date": "2026-04-05"})
    assert r.status_code == 200 and r.json()["agreed_due_date"] == "2026-04-05"
    ev = evaluate(client)
    assert ev["invoices"][0]["due"]["last_day_to_pay"] == "2026-04-05"
    assert client.patch(f"/api/invoices/{INV114}", json={"amount": "40000"}).status_code == 422
    assert client.patch(f"/api/invoices/{INV114}",
                        json={"objection_date": "2026-03-01"}).status_code == 422
    assert client.patch(f"/api/invoices/{INV114}", json={"number": "INV-131"}).status_code == 409
    r = client.patch(f"/api/invoices/{INV114}", json={"clear": ["agreed_due_date"]})
    assert r.json()["agreed_due_date"] is None


def test_delete_payment_and_invoice(client):
    pay = client.get(f"/api/invoices/{INV114}").json()["payments"][0]
    assert client.delete(f"/api/payments/{pay['id']}").status_code == 200
    assert client.get(f"/api/invoices/{INV114}").json()["payments"] == []
    assert client.delete(f"/api/invoices/{INV131}").status_code == 200
    assert client.get(f"/api/invoices/{INV131}").status_code == 404
    assert len(evaluate(client)["invoices"]) == 1


def test_delete_requires_ownership(secure_client):
    h = bearer(token(STRANGER))
    secure_client.post("/api/businesses", json={"name": "Other"}, headers=h)
    assert secure_client.delete(f"/api/invoices/{INV114}", headers=h).status_code == 404
    assert secure_client.delete("/api/payments/55555555-5555-5555-5555-555555555551",
                                headers=h).status_code == 404
    assert secure_client.delete(f"/api/invoices/{INV114}").status_code == 401


def test_calculator_matches_case_engine(client):
    r = client.post("/api/calculate", json={
        "amount": "180000", "delivery_date": "2026-03-10", "as_of": "2026-10-25",
        "payments": [{"paid_on": "2026-06-01", "amount": "50000"}]}).json()
    assert r["status"] == "computed" and r["due"]["interest_start"] == "2026-03-26"
    assert r["interest"]["total_outstanding"] == "144734.20"


def test_calculator_disputed_and_validation(client):
    r = client.post("/api/calculate", json={"amount": "1000", "delivery_date": "2026-05-01",
                                            "objection_date": "2026-05-05"}).json()
    assert r["status"] == "disputed" and r["interest"] is None
    assert client.post("/api/calculate", json={"amount": "1000", "delivery_date": "2026-05-01",
                                               "as_of": "2026-06-01", "payments": [
        {"paid_on": "2026-07-01", "amount": "10"}]}).status_code == 422
    r = client.post("/api/calculate", json={"amount": "1000", "delivery_date": "2025-06-01",
                                            "as_of": "2025-09-01"}).json()
    assert r["status"] == "rate_unavailable"


def test_rates_have_sources(client):
    rows = client.get("/api/rates").json()
    assert rows[-1]["bank_rate_pct"] == "5.75" and rows[-1]["statutory_rate_pct"] == "17.25"
    assert all(r["source"].startswith("https://") for r in rows)


def test_new_case_has_defaults(client):
    c = client.post("/api/cases", json={"buyer": {"name": "B"}}).json()
    assert c["dispute_reason"] == "none" and c["po_amount"] is None
    assert client.get(f"/api/cases/{c['id']}").json()["dispute_reason"] == "none"


# ---------------------------------------------------------------- profile, milestones, notes
def test_profile_details_save_without_wiping_other_fields(client):
    r = client.post("/api/businesses", json={"name": "Sri Lakshmi Packaging", "products": ["Boxes", " Boxes ", "Liners"],
                                             "team": [{"name": "Asha", "role": "Accounts", "email": "ASHA@x.in"}]})
    assert r.status_code == 200
    b = r.json()
    assert b["products"] == ["Boxes", "Liners"] and b["team"][0]["email"] == "asha@x.in"
    assert b["phone"] == "+910000000001" and b["udyam_no"] == "UDYAM-KR-00-0000000"   # untouched
    assert b["gstin"] == "29ABCDE1234F1ZW"


@pytest.mark.parametrize("body,field", [
    ({"gstin": "29ABCDE1234F1ZX"}, "gstin"), ({"pan": "ABCD1234F"}, "pan"),
    ({"email": "not-an-email"}, "email"), ({"documents": {"passport": "have"}}, "documents"),
    ({"products": ["x" * 61]}, "products"), ({"team": [{"name": "A", "role": "B", "email": "bad"}]}, "team"),
])
def test_profile_detail_validation(client, body, field):
    r = client.post("/api/businesses", json={"name": "Sri Lakshmi Packaging", **body})
    assert r.status_code == 422 and field in r.text


def test_demo_milestones_add_up_to_the_po(client):
    ms = client.get(f"/api/cases/{CASE}/milestones").json()
    assert [m["title"][:6] for m in ms] == ["First ", "Second"]
    assert sum(Decimal(m["amount"]) for m in ms) == Decimal("275000")


def test_milestone_crud_and_invoice_must_belong_to_contract(client):
    other = client.post("/api/cases", json={"buyer": {"name": "Other buyer"}}).json()
    inv = client.post(f"/api/cases/{other['id']}/invoices",
                      json={"number": "O-1", "invoice_date": "2026-09-01", "amount": "500"}).json()
    r = client.post(f"/api/cases/{CASE}/milestones",
                    json={"title": "Bad link", "due_date": "2026-11-01", "amount": "10", "invoice_id": inv["id"]})
    assert r.status_code == 422
    m = client.post(f"/api/cases/{CASE}/milestones", json={"title": "Third delivery", "due_date": "2026-11-15",
                                                           "amount": "25000"}).json()
    assert client.patch(f"/api/milestones/{m['id']}", json={"invoice_id": INV114}).json()["invoice_id"] == INV114
    assert client.patch(f"/api/milestones/{m['id']}", json={"invoice_id": inv["id"]}).status_code == 422
    assert client.delete(f"/api/milestones/{m['id']}").status_code == 200
    assert client.post(f"/api/cases/{CASE}/milestones", json={"title": "x", "due_date": "2026-11-01",
                                                              "amount": "0"}).status_code == 422


def test_notes_newest_first_and_cleaned_up_with_invoice(client):
    a = client.post(f"/api/invoices/{INV114}/notes", json={"body": "Called accounts team"}).json()
    b = client.post(f"/api/invoices/{INV114}/notes", json={"body": "  Promised to check  "}).json()
    assert b["body"] == "Promised to check"
    assert [n["id"] for n in client.get(f"/api/invoices/{INV114}/notes").json()] == [b["id"], a["id"]]
    assert client.post(f"/api/invoices/{INV114}/notes", json={"body": "   "}).status_code == 422
    assert client.delete(f"/api/notes/{a['id']}").status_code == 200
    client.delete(f"/api/invoices/{INV114}")
    store = client.app.state.store
    assert store.select("invoice_notes", invoice_id=INV114) == []
    assert store.get("milestones", MS1)["invoice_id"] is None   # milestone kept, link removed

# ---------------------------------------------------------------- payment blockers
def test_payment_blockers_crud_and_draft(client):
    # 1. Create blocker
    res = client.post(f"/api/cases/{CASE}/blockers", json={
        "reason": "po_missing",
        "source": "buyer_said",
        "note": "Accounts team asked for PO number",
        "invoice_id": INV114,
    })
    assert res.status_code == 201, res.text
    blk = res.json()
    assert blk["reason"] == "po_missing"
    assert blk["source"] == "buyer_said"
    assert blk["reported_on"] is not None

    # 2. List blockers
    list_res = client.get(f"/api/cases/{CASE}/blockers")
    assert list_res.status_code == 200
    ids = [b["id"] for b in list_res.json()]
    assert blk["id"] in ids

    # 3. Patch blocker
    patch_res = client.patch(f"/api/blockers/{blk['id']}", json={
        "resolved_on": "2026-10-25",
        "note": "PO number supplied and acknowledged",
    })
    assert patch_res.status_code == 200
    assert patch_res.json()["resolved_on"] == "2026-10-25"
    assert patch_res.json()["note"] == "PO number supplied and acknowledged"

    # 4. Draft generation for blocker
    evaluate(client)
    draft_res = client.post(f"/api/cases/{CASE}/drafts", json={
        "kind": "fix_blocker_po"
    })
    assert draft_res.status_code == 201
    draft = draft_res.json()
    assert "Purchase Order number" in draft["body"]

    # 5. Delete blocker
    del_res = client.delete(f"/api/blockers/{blk['id']}")
    assert del_res.status_code == 200
    assert client.delete(f"/api/blockers/{blk['id']}").status_code == 404



# ---------------------------------------------------------------- A2 partial disputes
def _partial_invoice(client, disputed="30000", objection="2026-07-08"):
    r = client.post(f"/api/cases/{CASE}/invoices", json={
        "number": "INV-PD-1", "invoice_date": "2026-07-01", "amount": "100000",
        "delivery_date": "2026-07-02", "objection_date": objection, "disputed_amount": disputed})
    assert r.status_code == 201, r.text
    return r.json()["id"]


def test_partial_dispute_splits_the_invoice(client):
    _partial_invoice(client)
    ev = evaluate(client)
    inv = next(i for i in ev["invoices"] if i["number"] == "INV-PD-1")
    assert inv["status"] == "partly_disputed"
    assert inv["disputed_outstanding"] == "30000.00"
    assert inv["due"]["last_day_to_pay"] == "2026-07-17"          # undisputed part: delivery + 15
    assert Decimal(inv["interest"]["interest_outstanding"]) > 0     # interest runs on the 70,000
    assert Decimal(inv["undisputed_outstanding"]) > Decimal("70000")
    assert "A9" in " ".join(inv["due"]["warnings"])


def test_partial_dispute_next_step_and_drafts_leave_out_disputed_part(client):
    _partial_invoice(client)
    ev = evaluate(client)
    na = ev["next_action"]
    assert na["action"] == "chase_undisputed" and na["rule"] == "R1a-partial-dispute"
    total = Decimal(ev["totals"]["total"])
    for kind in ("nudge", "firm", "demand"):
        body = draft(client, kind).json()["body"]
        assert "Rs 30,000.00 on INV-PD-1" in body, kind
    firm = draft(client, "firm").json()["body"]
    from app.drafts import _inr
    assert _inr(total - Decimal("30000")) in firm                  # Indian grouping, e.g. Rs 3,19,282.05


def test_whole_invoice_dispute_still_blocks(client):
    client.post(f"/api/cases/{CASE}/invoices", json={
        "number": "INV-WD-1", "invoice_date": "2026-07-01", "amount": "50000",
        "delivery_date": "2026-07-02", "objection_date": "2026-07-08"})
    assert evaluate(client)["next_action"]["action"] == "resolve_dispute"


@pytest.mark.parametrize("body,msg", [
    ({"disputed_amount": "150000", "objection_date": "2026-07-08"}, "more than the invoice"),
    ({"disputed_amount": "1000"}, "needs the date"),
])
def test_disputed_amount_validation(client, body, msg):
    r = client.post(f"/api/cases/{CASE}/invoices", json={
        "number": "INV-PD-X", "invoice_date": "2026-07-01", "amount": "100000",
        "delivery_date": "2026-07-02", **body})
    assert r.status_code == 422 and msg in r.text


def test_resolving_objection_ends_the_split(client):
    inv_id = _partial_invoice(client)
    r = client.patch(f"/api/invoices/{inv_id}", json={"objection_removed_date": "2026-07-20"})
    assert r.status_code == 200
    inv = next(i for i in evaluate(client)["invoices"] if i["number"] == "INV-PD-1")
    assert inv["status"] == "computed" and inv["due"]["last_day_to_pay"] == "2026-08-04"


# ---------------------------------------------------------------- C4 confirmation links
INV114 = "44444444-4444-4444-4444-444444444441"


def _link(client, inv=INV114):
    r = client.post(f"/api/invoices/{inv}/confirmation-links")
    assert r.status_code == 201, r.text
    return r.json()["path"].split("/confirm/")[1]


def test_confirmation_link_public_view_shows_only_basics(client):
    tok = _link(client)
    v = client.get(f"/api/public/confirm/{tok}", headers={"X-Business-Id": ""}).json()
    assert v["invoice_number"] == "INV-114" and v["supplier_name"] == "Sri Lakshmi Packaging"
    assert set(v) == {"supplier_name", "buyer_name", "invoice_number", "invoice_date", "amount",
                      "delivery_date", "expired", "answered", "response", "answered_at"}
    listed = client.get(f"/api/invoices/{INV114}/confirmation-links").json()
    assert listed and "token_hash" not in listed[0]


def test_buyer_confirms_receipt_records_written_acceptance(client):
    tok = _link(client)
    r = client.post(f"/api/public/confirm/{tok}", json={"response": "received_ok", "name": "Anand, Stores"})
    assert r.status_code == 200
    case = client.get(f"/api/cases/{CASE}").json()
    assert {e["kind"]: e["status"] for e in case["evidence"]}["acceptance_reply"] == "have"
    notes = client.get(f"/api/invoices/{INV114}/notes").json()
    assert any("confirmed receipt" in n["body"] for n in notes)
    again = client.post(f"/api/public/confirm/{tok}", json={"response": "received_ok", "name": "X Y"})
    assert again.status_code == 409                          # one time only


def test_buyer_raises_issue_creates_documented_blocker(client):
    tok = _link(client)
    r = client.post(f"/api/public/confirm/{tok}", json={"response": "issue", "name": "QC team",
                                                        "note": "12 cartons crushed"})
    assert r.status_code == 200 and r.json()["within_objection_window"] is False   # delivered 10 Mar
    blockers = client.app.state.store.select("payment_blockers", invoice_id=INV114)
    assert any(b["source"] == "documented" and "12 cartons crushed" in b["note"] for b in blockers)
    assert client.post(f"/api/public/confirm/{_link(client)}",
                       json={"response": "issue", "name": "QC team"}).status_code == 422   # needs a note


def test_invalid_and_expired_links(client):
    assert client.get("/api/public/confirm/not-a-real-token-xxxxxxxxxx").status_code == 404
    tok = _link(client)
    store = client.app.state.store
    link = store.select("confirmation_links", invoice_id=INV114)[0]
    store.update("confirmation_links", link["id"], {"expires_at": "2020-01-01T00:00:00+00:00"})
    assert client.get(f"/api/public/confirm/{tok}").json()["expired"] is True
    assert client.post(f"/api/public/confirm/{tok}",
                       json={"response": "received_ok", "name": "Late Person"}).status_code == 410


def test_other_business_cannot_create_link(secure_client):
    r = secure_client.post(f"/api/invoices/{INV114}/confirmation-links", headers=bearer(token(STRANGER)))
    assert r.status_code == 404


# ---------------------------------------------------------------- cash flow
def test_cash_flow_totals_and_chase_order(client):
    d = client.get("/api/cashflow?as_of=2026-10-25").json()
    rows = client.get("/api/invoices?as_of=2026-10-25").json()
    overdue = [r for r in rows if r["status"] == "overdue"]
    assert d["totals"]["overdue_invoices"] == len(overdue)
    assert Decimal(d["totals"]["owed_now"]) == sum(Decimal(r["statutory_total"] or r["unpaid"]) for r in overdue)
    assert sum(Decimal(a["amount"]) for a in d["overdue_by_age"]) == Decimal(d["totals"]["owed_now"])
    assert len(d["weeks"]) == 8 and d["weeks"][0]["week_start"] == "2026-10-19"
    first = d["chase_first"][0]
    assert first["buyer_name"] == "Kaveri Foods Pvt Ltd" and "214 days overdue" in first["reasons"]
    assert all(c["next_action_id"] not in ("close_case", "wait_until_due") for c in d["chase_first"])
    assert "not a forecast" in d["note"]


def test_cash_flow_is_owner_only(secure_client):
    assert secure_client.get("/api/cashflow", headers=bearer(token(BUYER))).status_code == 403


# ---------------------------------------------------------------- B1 e-invoice QR
import json as _json

from cryptography.hazmat.primitives import serialization as _ser
from cryptography.hazmat.primitives.asymmetric import rsa as _rsa

_PORTAL_KEY = _rsa.generate_private_key(public_exponent=65537, key_size=2048)   # stands in for NIC's key
_PORTAL_PUB = _PORTAL_KEY.public_key().public_bytes(
    _ser.Encoding.PEM, _ser.PublicFormat.SubjectPublicKeyInfo).decode()
IRN = "a" * 63 + "1"


def _qr(key=_PORTAL_KEY, **over):
    data = {"SellerGstin": "29ABCDE1234F1ZW", "BuyerGstin": "29AABCK3419Q1Z1", "DocNo": "INV-114",
            "DocTyp": "INV", "DocDt": "08/03/2026", "TotInvVal": 180000, "ItemCnt": 2,
            "MainHsnCode": "4819", "Irn": IRN, "IrnDt": "2026-03-08 11:20:00", **over}
    return pyjwt.encode({"data": _json.dumps(data), "iss": "NIC"}, key, algorithm="RS256")


def test_qr_matching_invoice_looks_right(client):
    r = client.post("/api/documents/qr", json={"text": _qr(), "invoice_id": INV114}).json()
    assert r["verdict"] == "looks_right" and r["signature_verified"] is False
    assert r["fields"]["doc_date"] == "2026-03-08" and r["fields"]["total"] == "180000.00"
    assert {c["check"]: c["status"] for c in r["checks"]}["Total invoice value"] == "match"
    assert r["can_save_irn"] is True


def test_qr_mismatches_are_flagged(client):
    r = client.post("/api/documents/qr", json={"text": _qr(TotInvVal=181000, DocNo="INV-115"),
                                               "invoice_id": INV114}).json()
    st = {c["check"]: c["status"] for c in r["checks"]}
    assert r["verdict"] == "check_this" and st["Total invoice value"] == "mismatch"
    assert st["Invoice number"] == "mismatch" and r["can_save_irn"] is False


def test_qr_signature_checked_when_key_configured(client, monkeypatch):
    monkeypatch.setenv("EINVOICE_PUBLIC_KEY", _PORTAL_PUB)
    ok = client.post("/api/documents/qr", json={"text": _qr(), "invoice_id": INV114}).json()
    assert ok["signature_verified"] is True
    forged = _qr(key=_rsa.generate_private_key(public_exponent=65537, key_size=2048))
    r = client.post("/api/documents/qr", json={"text": forged, "invoice_id": INV114})
    assert r.status_code == 422 and "signature does not match" in r.json()["detail"]


def test_qr_rejects_text_that_is_not_an_einvoice(client):
    r = client.post("/api/documents/qr", json={"text": "https://example.com/some/ordinary/qr/link"})
    assert r.status_code == 422 and "not an e-invoice" in r.json()["detail"]


def test_save_irn_then_invoice_shows_it_and_duplicates_are_refused(client):
    assert client.patch(f"/api/invoices/{INV114}", json={"irn": IRN}).status_code == 200
    assert client.get(f"/api/invoices/{INV114}").json()["irn"] == IRN
    again = client.post("/api/documents/qr", json={"text": _qr(), "invoice_id": INV114}).json()
    assert again["can_save_irn"] is False                     # already saved on this invoice
    other = "44444444-4444-4444-4444-444444444442"
    dup = client.post("/api/documents/qr", json={"text": _qr(DocNo="INV-131", TotInvVal=95000,
                                                             DocDt="02/05/2026"), "invoice_id": other}).json()
    assert dup["verdict"] == "check_this" and any(c["check"] == "IRN already used" for c in dup["checks"])
    assert client.patch(f"/api/invoices/{INV114}", json={"irn": "not-an-irn"}).status_code == 422


def test_credit_note_qr_is_flagged(client):
    r = client.post("/api/documents/qr", json={"text": _qr(DocTyp="CRN"), "invoice_id": INV114}).json()
    assert any(c["check"] == "Document type" and "credit note" in c["detail"] for c in r["checks"])
