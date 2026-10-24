"""All /api routes. Thin: validate, check ownership, call store / evaluate."""
from __future__ import annotations

from datetime import date
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException, Request

from ..auth import AuthContext, approved_user, current_business_id, supplier
from ..evaluate import ENGINE_VERSION, evaluate_case, invoice_outstanding, settlement_from_totals
from copilot import parse_promise

from pydantic import ValidationError
from recovery_engine import Payment

from ..drafts import build_draft
from ..invoices import list_invoices, rate_table, what_if
from ..evaluate import _jsonable
from ..schemas import (EVIDENCE_KINDS, BusinessIn, CaseIn, CasePatch, EvaluateIn,
                       EvidenceIn, FollowupIn, FollowupPatch, InvoiceIn, PaymentIn,
                       CalculateIn, DraftIn, InvoicePatch, PromiseExtractIn, PromiseIn,
                       SimMessageIn)
from ..sim import handle_sim_message
from ..store import Store

router = APIRouter(prefix="/api")


def get_store(request: Request) -> Store:
    return request.app.state.store


def _own_case(store: Store, case_id: str, business_id: str) -> dict:
    case = store.get("cases", case_id)
    if case is None or case["business_id"] != business_id:
        raise HTTPException(404, "case not found")
    return case


def _jsonify(model) -> dict:
    """Pydantic model -> dict with dates as ISO strings and money as strings."""
    out = {}
    for k, v in model.model_dump().items():
        if isinstance(v, date):
            v = v.isoformat()
        elif isinstance(v, Decimal):
            v = str(v)
        out[k] = v
    return out


@router.get("/health")
def health(request: Request):
    return {"ok": True, "store": request.app.state.settings.store,
            "engine_version": ENGINE_VERSION}


# ---------------------------------------------------------------- businesses
@router.get("/businesses/me")
def get_business(store: Store = Depends(get_store), bid: str = Depends(current_business_id)):
    b = store.get("businesses", bid)
    if b is None:
        raise HTTPException(404, "business profile not set up yet")
    return b


@router.post("/businesses")
def upsert_business(body: BusinessIn, store: Store = Depends(get_store),
                    ctx: AuthContext = Depends(supplier)):
    data = _jsonify(body)
    if ctx.business_id and store.get("businesses", ctx.business_id):
        return store.update("businesses", ctx.business_id, data)
    row = {**data, "owner_id": ctx.user_id}
    if ctx.business_id:                   # demo mode: keep the requested id
        row["id"] = ctx.business_id
    return store.insert("businesses", row)


# ---------------------------------------------------------------- cases
@router.post("/cases", status_code=201)
def create_case(body: CaseIn, store: Store = Depends(get_store),
                bid: str = Depends(current_business_id)):
    if store.get("businesses", bid) is None:
        raise HTTPException(409, "set up the business profile first")
    buyer = store.insert("buyers", {"business_id": bid, **_jsonify(body.buyer)})
    case = store.insert("cases", {
        "business_id": bid, "buyer_id": buyer["id"],
        "contract_date": body.contract_date.isoformat() if body.contract_date else None,
        "status": "draft", "ladder_step": 0, "allocation": "interest_first",
        "po_amount": None, "dispute_reason": "none"})
    for kind in EVIDENCE_KINDS:
        store.upsert("evidence_items", {"case_id": case["id"], "kind": kind,
                                        "status": "unknown"}, ["case_id", "kind"])
    return {**case, "buyer": buyer}


@router.get("/cases")
def list_cases(store: Store = Depends(get_store), bid: str = Depends(current_business_id)):
    """Case list for the ageing board: live totals and bucket per case."""
    out = []
    for case in store.select("cases", business_id=bid):
        if case["status"] == "archived":
            continue
        buyer = store.get("buyers", case["buyer_id"])
        summary = {"totals": None, "bucket": None, "eligibility": None}
        try:
            ev = evaluate_case(store, case["id"])
            summary = {"totals": ev["totals"], "bucket": ev["bucket"],
                       "eligibility": ev["eligibility"]["verdict"]}
        except ValueError:
            pass  # no invoices yet
        out.append({**case, "buyer_name": buyer["name"] if buyer else None, **summary})
    return out


@router.get("/cases/{case_id}")
def get_case(case_id: str, store: Store = Depends(get_store),
             bid: str = Depends(current_business_id)):
    case = _own_case(store, case_id, bid)
    invoices = store.select("invoices", case_id=case_id)
    for inv in invoices:
        inv["payments"] = sorted(store.select("payments", invoice_id=inv["id"]),
                                 key=lambda p: p["paid_on"])
    evidence = store.select("evidence_items", case_id=case_id)
    return {**case, "buyer": store.get("buyers", case["buyer_id"]),
            "invoices": sorted(invoices, key=lambda r: r["invoice_date"]),
            "evidence": sorted(evidence, key=lambda e: EVIDENCE_KINDS.index(e["kind"]))}


@router.patch("/cases/{case_id}")
def patch_case(case_id: str, body: CasePatch, store: Store = Depends(get_store),
               bid: str = Depends(current_business_id)):
    _own_case(store, case_id, bid)
    patch = {k: v for k, v in _jsonify(body).items() if v is not None}
    return store.update("cases", case_id, patch)


# ---------------------------------------------------------------- invoices, payments
@router.post("/cases/{case_id}/invoices", status_code=201)
def add_invoice(case_id: str, body: InvoiceIn, store: Store = Depends(get_store),
                bid: str = Depends(current_business_id)):
    _own_case(store, case_id, bid)
    if any(i["number"] == body.number for i in store.select("invoices", case_id=case_id)):
        raise HTTPException(409, f"invoice {body.number} already exists in this case")
    return store.insert("invoices", {"case_id": case_id, **_jsonify(body)})


@router.post("/invoices/{invoice_id}/payments", status_code=201)
def add_payment(invoice_id: str, body: PaymentIn, confirm_duplicate: bool = False,
                store: Store = Depends(get_store), bid: str = Depends(current_business_id)):
    """Rules: not before the invoice date; not more than everything owed on this invoice
    on that day (principal + statutory interest where computable), counting all earlier
    payments; an identical payment (same date and amount) needs confirm_duplicate=true.
    Refunds and reversals are out of scope: delete the wrong payment row instead."""
    inv = store.get("invoices", invoice_id)
    if inv is None:
        raise HTTPException(404, "invoice not found")
    _own_case(store, inv["case_id"], bid)
    if body.paid_on < date.fromisoformat(inv["invoice_date"]):
        raise HTTPException(422, "Payment date is before the invoice date.")
    existing = store.select("payments", invoice_id=invoice_id)
    same = [p for p in existing if p["paid_on"] == body.paid_on.isoformat()
            and Decimal(str(p["amount"])) == body.amount]
    if same and not confirm_duplicate:
        raise HTTPException(409, "A payment with the same date and amount is already "
                                 "recorded. Resend with confirm_duplicate=true if it is a "
                                 "second payment.")
    owed = invoice_outstanding(store, inv, body.paid_on)
    if body.amount > owed:
        raise HTTPException(422, f"Payment is more than the Rs {owed} owed on this invoice "
                                 f"on {body.paid_on.isoformat()}.")
    return store.insert("payments", {"invoice_id": invoice_id, **_jsonify(body)})


@router.get("/invoices")
def get_invoices(as_of: date | None = None, store: Store = Depends(get_store),
                 bid: str = Depends(current_business_id)):
    """Every invoice across the business with payment status and engine figures."""
    return list_invoices(store, bid, as_of)


def _own_invoice(store: Store, invoice_id: str, bid: str) -> tuple[dict, dict]:
    inv = store.get("invoices", invoice_id)
    if inv is None:
        raise HTTPException(404, "invoice not found")
    return inv, _own_case(store, inv["case_id"], bid)


@router.get("/invoices/{invoice_id}")
def get_invoice(invoice_id: str, store: Store = Depends(get_store),
                bid: str = Depends(current_business_id)):
    inv, case = _own_invoice(store, invoice_id, bid)
    inv["payments"] = sorted(store.select("payments", invoice_id=invoice_id),
                             key=lambda p: p["paid_on"])
    return {**inv, "buyer": store.get("buyers", case["buyer_id"]),
            "case": {k: case.get(k) for k in ("id", "contract_date", "po_amount", "status",
                                                "dispute_reason")}}


@router.patch("/invoices/{invoice_id}")
def patch_invoice(invoice_id: str, body: InvoicePatch, store: Store = Depends(get_store),
                  bid: str = Depends(current_business_id)):
    """Correct an invoice. The merged record is re-validated with the same rules as a new
    invoice; the amount cannot drop below payments already recorded."""
    inv, case = _own_invoice(store, invoice_id, bid)
    patch = {k: v for k, v in _jsonify(body).items() if v is not None and k != "clear"}
    merged = {**{k: inv.get(k) for k in ("number", "invoice_date", "amount", "delivery_date",
                                         "agreed_due_date", "objection_date",
                                         "objection_removed_date")}, **patch}
    for k in body.clear:
        merged[k] = None
    if body.clear and "objection_date" in body.clear:
        merged["objection_removed_date"] = None
    try:
        InvoiceIn(**merged)
    except ValidationError as e:
        err = e.errors()[0]
        raise HTTPException(422, err["msg"].removeprefix("Value error, "))
    if merged["number"] != inv["number"] and any(
            i["number"] == merged["number"] for i in store.select("invoices", case_id=case["id"])):
        raise HTTPException(409, f"invoice {merged['number']} already exists in this case")
    paid = sum((Decimal(str(p["amount"])) for p in store.select("payments", invoice_id=invoice_id)),
               Decimal(0))
    if Decimal(str(merged["amount"])) < paid:
        raise HTTPException(422, f"Amount cannot be less than the Rs {paid} already recorded as paid.")
    return store.update("invoices", invoice_id, {k: merged[k] for k in merged})


@router.delete("/invoices/{invoice_id}")
def delete_invoice(invoice_id: str, store: Store = Depends(get_store),
                   bid: str = Depends(current_business_id)):
    _own_invoice(store, invoice_id, bid)
    for p in store.select("payments", invoice_id=invoice_id):
        store.delete("payments", p["id"])
    store.delete("invoices", invoice_id)
    return {"deleted": invoice_id}


@router.delete("/payments/{payment_id}")
def delete_payment(payment_id: str, store: Store = Depends(get_store),
                   bid: str = Depends(current_business_id)):
    pay = store.get("payments", payment_id)
    if pay is None:
        raise HTTPException(404, "payment not found")
    _own_invoice(store, pay["invoice_id"], bid)
    store.delete("payments", payment_id)
    return {"deleted": payment_id}


@router.post("/calculate")
def calculate(body: CalculateIn, ctx: AuthContext = Depends(approved_user)):
    """What-if calculator: same engine, no saved case, eligibility not checked."""
    return what_if(body.amount, body.delivery_date, body.agreed_due_date, body.objection_date,
                   body.objection_removed_date,
                   [Payment(p.paid_on, p.amount) for p in body.payments],
                   body.as_of or date.today(), body.allocation)


@router.get("/rates")
def rates(ctx: AuthContext = Depends(approved_user)):
    """Verified RBI Bank Rate rows used for s.16 interest, with sources."""
    return rate_table()


# ---------------------------------------------------------------- evidence
@router.put("/cases/{case_id}/evidence/{kind}")
def set_evidence(case_id: str, kind: str, body: EvidenceIn, store: Store = Depends(get_store),
                 bid: str = Depends(current_business_id)):
    _own_case(store, case_id, bid)
    if kind not in EVIDENCE_KINDS:
        raise HTTPException(404, f"unknown evidence kind; use one of {', '.join(EVIDENCE_KINDS)}")
    return store.upsert("evidence_items", {"case_id": case_id, "kind": kind,
                                           "status": body.status}, ["case_id", "kind"])


# ---------------------------------------------------------------- evaluate, settlement
@router.post("/cases/{case_id}/evaluate")
def evaluate(case_id: str, body: EvaluateIn | None = None, store: Store = Depends(get_store),
             bid: str = Depends(current_business_id)):
    _own_case(store, case_id, bid)
    as_of = (body.as_of if body else None) or date.today()
    try:
        result = evaluate_case(store, case_id, as_of)
    except ValueError as e:
        raise HTTPException(409, str(e))
    snap = store.insert("calculations", {
        "case_id": case_id, "as_of": result["as_of"], "engine_version": ENGINE_VERSION,
        "inputs": get_case(case_id, store, bid), "outputs": result})
    return {"calculation_id": snap["id"], **result}


@router.get("/cases/{case_id}/settlement")
def settlement(case_id: str, store: Store = Depends(get_store),
               bid: str = Depends(current_business_id)):
    _own_case(store, case_id, bid)
    calcs = sorted(store.select("calculations", case_id=case_id),
                   key=lambda c: c.get("created_at", ""))
    if not calcs:
        raise HTTPException(409, "run evaluate first")
    latest = calcs[-1]["outputs"]
    return {"calculation_id": calcs[-1]["id"], "as_of": latest["as_of"],
            "note": "Commercial options for the owner to consider. Not legal advice.",
            "options": settlement_from_totals(latest["totals"])}


# ---------------------------------------------------------------- promises
@router.post("/cases/{case_id}/promises/extract")
def extract_promise(case_id: str, body: PromiseExtractIn, store: Store = Depends(get_store),
                    bid: str = Depends(current_business_id)):
    """Reads a pasted buyer message and proposes amount and date. Saves nothing: the
    frontend shows these for the owner to confirm or correct, then calls POST /promises.
    P3: an LLM extractor can run first; keep this rule-based parser as the fallback."""
    _own_case(store, case_id, bid)
    said_on = body.said_on or date.today()
    c = parse_promise(body.text, said_on)
    missing = [k for k, v in (("amount", c.amount), ("due_date", c.due_date)) if v is None]
    return {**_jsonable(c), "made_on": said_on.isoformat(), "source_text": body.text,
            "missing": missing, "extractor": "rules"}


@router.post("/cases/{case_id}/promises", status_code=201)
def add_promise(case_id: str, body: PromiseIn, store: Store = Depends(get_store),
                bid: str = Depends(current_business_id)):
    _own_case(store, case_id, bid)
    return store.insert("promises", {"case_id": case_id, **_jsonify(body)})


@router.get("/cases/{case_id}/promises")
def list_promises(case_id: str, store: Store = Depends(get_store),
                  bid: str = Depends(current_business_id)):
    _own_case(store, case_id, bid)
    return sorted(store.select("promises", case_id=case_id), key=lambda p: p["due_date"])


# ---------------------------------------------------------------- follow-ups
@router.post("/cases/{case_id}/followups", status_code=201)
def add_followup(case_id: str, body: FollowupIn, store: Store = Depends(get_store),
                 bid: str = Depends(current_business_id)):
    """The owner records that they sent a ladder message themselves (we never send)."""
    case = _own_case(store, case_id, bid)
    row = store.insert("followups", {"case_id": case_id, **_jsonify(body)})
    if body.step > (case.get("ladder_step") or 0):
        store.update("cases", case_id, {"ladder_step": body.step, "status": "active"})
    return row


@router.patch("/followups/{followup_id}")
def patch_followup(followup_id: str, body: FollowupPatch, store: Store = Depends(get_store),
                   bid: str = Depends(current_business_id)):
    fu = store.get("followups", followup_id)
    if fu is None:
        raise HTTPException(404, "follow-up not found")
    _own_case(store, fu["case_id"], bid)
    return store.update("followups", followup_id, {"reply_received": body.reply_received})


# ---------------------------------------------------------------- drafts
@router.post("/cases/{case_id}/drafts", status_code=201)
def create_draft(case_id: str, body: DraftIn, store: Store = Depends(get_store),
                 bid: str = Depends(current_business_id)):
    """Template draft from the latest calculation. Nothing is sent; the owner edits,
    copies and sends it, then logs it with POST /followups."""
    case = _own_case(store, case_id, bid)
    calcs = sorted(store.select("calculations", case_id=case_id),
                   key=lambda c: c.get("created_at", ""))
    if not calcs:
        raise HTTPException(409, "Run evaluate first so the draft uses current figures.")
    calc = calcs[-1]
    business = store.get("businesses", case["business_id"]) or {}
    buyer = store.get("buyers", case["buyer_id"]) or {}
    as_of = calc["outputs"]["as_of"]
    unpaid = Decimal(0)
    for inv in store.select("invoices", case_id=case_id):
        paid = sum((Decimal(str(p["amount"])) for p in store.select("payments", invoice_id=inv["id"])
                    if p["paid_on"] <= as_of), Decimal(0))
        unpaid += max(Decimal(str(inv["amount"])) - paid, Decimal(0))
    try:
        draft = build_draft(body.kind, calc["outputs"], business.get("name", "Your business"),
                            buyer.get("name", "Buyer"), unpaid)
    except ValueError as e:
        raise HTTPException(422, str(e))
    row = store.insert("drafts", {"case_id": case_id, "calculation_id": calc["id"],
                                  "kind": draft["kind"], "lang": draft["lang"],
                                  "body": draft["body"]})
    return {**draft, "id": row["id"], "calculation_id": calc["id"]}


# ---------------------------------------------------------------- simulator
@router.post("/sim/message")
def sim_message(body: SimMessageIn, store: Store = Depends(get_store),
                ctx: AuthContext = Depends(supplier)):
    owner = ctx.user_id or "demo"
    return {"replies": handle_sim_message(store, f"sim:{owner}:{body.session}", body.text)}
