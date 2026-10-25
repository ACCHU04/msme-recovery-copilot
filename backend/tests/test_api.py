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


def test_pending_adviser_is_refused_everywhere(secure_client):
    h = bearer(token(ADVISER_PENDING))
    r = secure_client.get("/api/rates", headers=h)
    assert r.status_code == 403 and "approval" in r.json()["detail"]


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
