"""All /api routes. Thin: validate, check ownership, call store / evaluate."""
from __future__ import annotations

from datetime import date
from decimal import Decimal

from fastapi import APIRouter, Depends, File, Form, HTTPException, Request, UploadFile

from recovery_engine.due_date import human
from ..auth import AuthContext, adviser, approved_user, buyer, current_business_id, supplier
from ..evaluate import (ENGINE_VERSION, _group_by, evaluate_case, invoice_outstanding,
                        load_business_bundle, settlement_from_totals)
from copilot import parse_promise

from pydantic import ValidationError
from recovery_engine import Payment

from ..drafts import build_draft
from ..invoices import list_invoices, rate_table, what_if
from .. import cashflow as cashflow_mod, doc_check, legal_ai
from ..evaluate import _jsonable
from ..schemas import (ConfirmationIn, EVIDENCE_KINDS, BusinessIn, CaseIn, CasePatch, EvaluateIn,
                       EvidenceIn, FollowupIn, FollowupPatch, InvoiceIn, PaymentIn,
                       CalculateIn, DraftIn, InvoicePatch, MilestoneIn, MilestonePatch, NoteIn,
                       PromiseExtractIn, PromiseIn, SimMessageIn, LegalAskIn, CaseShareIn,
                       BlockerIn, BlockerPatch)
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


def _jsonify(model, partial: bool = False) -> dict:
    """Pydantic model -> dict with dates as ISO strings and money as strings.
    partial=True keeps only the fields the client actually sent (for updates)."""
    out = {}
    for k, v in model.model_dump(exclude_unset=partial).items():
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
    if ctx.business_id and store.get("businesses", ctx.business_id):
        # Update only what was sent, so saving one section never wipes another.
        return store.update("businesses", ctx.business_id, _jsonify(body, partial=True))
    data = _jsonify(body)
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
    bundle = load_business_bundle(store, bid)
    for case in bundle["cases"]:
        if case["status"] == "archived":
            continue

        buyer = bundle["buyers"].get(case["buyer_id"])
        summary = {"totals": None, "bucket": None, "eligibility": None, "next_action": None}
        try:
            ev = evaluate_case(store, case["id"], bundle=bundle)
            summary = {"totals": ev["totals"], "bucket": ev["bucket"],
                       "eligibility": ev["eligibility"]["verdict"],
                       "next_action": ev["next_action"]}
        except ValueError:
            pass  # no invoices yet
        out.append({**case, "buyer_name": buyer["name"] if buyer else None, **summary})
    return out


@router.get("/cases/{case_id}")
def get_case(case_id: str, store: Store = Depends(get_store),
             bid: str = Depends(current_business_id)):
    case = _own_case(store, case_id, bid)
    invoices = store.select("invoices", case_id=case_id)
    inv_ids = [inv["id"] for inv in invoices]
    pays_by_inv = _group_by(store.select("payments", invoice_id=inv_ids) if inv_ids else [], "invoice_id")
    for inv in invoices:
        inv["payments"] = sorted(pays_by_inv.get(inv["id"], []),
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
                                 f"on {human(body.paid_on)}.")
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
                                         "objection_removed_date", "disputed_amount")}, **patch}
    for k in body.clear:
        merged[k] = None
    if body.clear and "objection_date" in body.clear:
        merged["objection_removed_date"] = None
        merged["disputed_amount"] = None
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
    for n in store.select("invoice_notes", invoice_id=invoice_id):
        store.delete("invoice_notes", n["id"])
    for m in store.select("milestones", invoice_id=invoice_id):
        store.update("milestones", m["id"], {"invoice_id": None})
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


# ---------------------------------------------------------------- AI legal Q&A
@router.post("/legal/ask")
def legal_ask(body: LegalAskIn, request: Request, ctx: AuthContext = Depends(approved_user)):
    """Grounded answer from Gemini, checked against the knowledge base. Only the question is
    sent, never case data. source='unavailable' tells the frontend to use prepared answers."""
    key = ctx.user_id or ctx.business_id or (request.client.host if request.client else "anon")
    if not request.app.state.llm_limiter.allow(key):
        raise HTTPException(429, "Too many questions in a short time. Wait a minute and try again.")
    return legal_ai.ask(request.app.state.llm, body.question).to_json()


@router.post("/documents/check")
def check_document(request: Request, file: UploadFile = File(...), invoice_id: str | None = Form(None),
                   expected: str | None = Form(None), store: Store = Depends(get_store),
                   bid: str = Depends(current_business_id)):
    """Read an uploaded photo/PDF with Gemini, then compare it with the user's records in code.
    The file is not stored. source='unavailable' when AI is off or the reading failed."""
    if expected is not None and expected not in doc_check.EXPECTED:
        raise HTTPException(422, "Unknown document type to check against.")
    content = file.file.read(doc_check.MAX_BYTES + 1)
    if len(content) > doc_check.MAX_BYTES:
        raise HTTPException(413, "That file is larger than 8 MB. Use a smaller photo or PDF.")
    mime = doc_check.sniff_mime(content)
    if mime is None:
        raise HTTPException(415, "Upload a JPG, PNG or WebP photo, or a PDF.")
    invoice = case = buyer = None
    if invoice_id:
        invoice, case = _own_invoice(store, invoice_id, bid)
        buyer = store.get("buyers", case["buyer_id"])

    business = store.get("businesses", bid)
    if not request.app.state.llm_limiter.allow(f"doc:{bid}"):
        raise HTTPException(429, "Too many documents in a short time. Wait a minute and try again.")
    result = doc_check.analyse(request.app.state.llm, content, mime)
    result = doc_check.compare(result, expected, invoice, buyer, business, case)
    out = result.to_json()
    out["case_id"] = case["id"] if case else None
    return out


@router.get("/legal/status")
def legal_status(request: Request, ctx: AuthContext = Depends(approved_user)):
    llm = request.app.state.llm
    return {"ai_enabled": llm is not None, "model": llm.model if llm else None}


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


# ---------------------------------------------------------------- payment blockers
@router.post("/cases/{case_id}/blockers", status_code=201)
def add_blocker(case_id: str, body: BlockerIn, store: Store = Depends(get_store),
                bid: str = Depends(current_business_id)):
    """The supplier records the reason the buyer gave for not paying."""
    _own_case(store, case_id, bid)
    data = _jsonify(body)
    if not data.get("reported_on"):
        data["reported_on"] = date.today().isoformat()
    return store.insert("payment_blockers", {"case_id": case_id, **data})


@router.get("/cases/{case_id}/blockers")
def list_blockers(case_id: str, store: Store = Depends(get_store),
                  bid: str = Depends(current_business_id)):
    _own_case(store, case_id, bid)
    blockers = store.select("payment_blockers", case_id=case_id)
    return sorted(blockers, key=lambda b: str(b.get("reported_on", "")), reverse=True)


@router.patch("/blockers/{blocker_id}")
def patch_blocker(blocker_id: str, body: BlockerPatch, store: Store = Depends(get_store),
                  bid: str = Depends(current_business_id)):
    b = store.get("payment_blockers", blocker_id)
    if b is None:
        raise HTTPException(404, "payment blocker not found")
    _own_case(store, b["case_id"], bid)
    patch = {k: v for k, v in _jsonify(body).items() if v is not None}
    return store.update("payment_blockers", blocker_id, patch)


@router.delete("/blockers/{blocker_id}")
def delete_blocker(blocker_id: str, store: Store = Depends(get_store),
                   bid: str = Depends(current_business_id)):
    b = store.get("payment_blockers", blocker_id)
    if b is None:
        raise HTTPException(404, "payment blocker not found")
    _own_case(store, b["case_id"], bid)
    store.delete("payment_blockers", blocker_id)
    return {"ok": True}


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


# ---------------------------------------------------------------- milestones
def _milestone_invoice_ok(store: Store, invoice_id: str | None, case_id: str) -> None:
    if invoice_id is None:
        return
    inv = store.get("invoices", invoice_id)
    if inv is None or inv["case_id"] != case_id:
        raise HTTPException(422, "That invoice isn't part of this contract.")


def _own_milestone(store: Store, milestone_id: str, bid: str) -> dict:
    m = store.get("milestones", milestone_id)
    if m is None:
        raise HTTPException(404, "milestone not found")
    _own_case(store, m["case_id"], bid)
    return m


@router.get("/cases/{case_id}/milestones")
def list_milestones(case_id: str, store: Store = Depends(get_store),
                    bid: str = Depends(current_business_id)):
    _own_case(store, case_id, bid)
    return sorted(store.select("milestones", case_id=case_id), key=lambda m: (m["due_date"], m["title"]))


@router.post("/cases/{case_id}/milestones", status_code=201)
def add_milestone(case_id: str, body: MilestoneIn, store: Store = Depends(get_store),
                  bid: str = Depends(current_business_id)):
    _own_case(store, case_id, bid)
    _milestone_invoice_ok(store, body.invoice_id, case_id)
    return store.insert("milestones", {"case_id": case_id, **_jsonify(body)})


@router.patch("/milestones/{milestone_id}")
def patch_milestone(milestone_id: str, body: MilestonePatch, store: Store = Depends(get_store),
                    bid: str = Depends(current_business_id)):
    m = _own_milestone(store, milestone_id, bid)
    data = _jsonify(body, partial=True)
    if "invoice_id" in data:
        _milestone_invoice_ok(store, data["invoice_id"], m["case_id"])
    return store.update("milestones", milestone_id, data)


@router.delete("/milestones/{milestone_id}")
def delete_milestone(milestone_id: str, store: Store = Depends(get_store),
                     bid: str = Depends(current_business_id)):
    _own_milestone(store, milestone_id, bid)
    store.delete("milestones", milestone_id)
    return {"deleted": milestone_id}


# ---------------------------------------------------------------- invoice notes
@router.get("/invoices/{invoice_id}/notes")
def list_notes(invoice_id: str, store: Store = Depends(get_store),
               bid: str = Depends(current_business_id)):
    _own_invoice(store, invoice_id, bid)
    return sorted(store.select("invoice_notes", invoice_id=invoice_id),
                  key=lambda n: n.get("created_at") or "", reverse=True)


@router.post("/invoices/{invoice_id}/notes", status_code=201)
def add_note(invoice_id: str, body: NoteIn, store: Store = Depends(get_store),
             bid: str = Depends(current_business_id)):
    _own_invoice(store, invoice_id, bid)
    return store.insert("invoice_notes", {"invoice_id": invoice_id, "body": body.body})


@router.delete("/notes/{note_id}")
def delete_note(note_id: str, store: Store = Depends(get_store),
                bid: str = Depends(current_business_id)):
    n = store.get("invoice_notes", note_id)
    if n is None:
        raise HTTPException(404, "note not found")
    _own_invoice(store, n["invoice_id"], bid)
    store.delete("invoice_notes", note_id)
    return {"deleted": note_id}


# ---------------------------------------------------------------- simulator
@router.post("/sim/message")
def sim_message(body: SimMessageIn, store: Store = Depends(get_store),
                ctx: AuthContext = Depends(supplier)):
    owner = ctx.user_id or "demo"
    return {"replies": handle_sim_message(store, f"sim:{owner}:{body.session}", body.text)}


# ---------------------------------------------------------------- buyer portal
@router.get("/buyer/invoices")
def get_buyer_invoices(as_of: date | None = None, store: Store = Depends(get_store), ctx: AuthContext = Depends(buyer)):
    """Invoices raised by suppliers to this buyer account with legal due dates and s.16 interest."""
    buyer_ids: set[str] = set()
    if ctx.user_id:
        try:
            for b in store.select("buyers", profile_id=ctx.user_id):
                buyer_ids.add(b["id"])
        except Exception:
            pass
        profile = store.get("profiles", ctx.user_id) or {}
        bname = (profile.get("business_name") or "").strip().lower()
        if bname:
            for b in store.select("buyers"):
                b_name_lower = (b.get("name") or "").strip().lower()
                if b_name_lower == bname or bname in b_name_lower or b_name_lower in bname:
                    buyer_ids.add(b["id"])
    if not buyer_ids:
        # Demo / test fallback: Kaveri Foods or all demo buyers
        for b in store.select("buyers"):
            if "kaveri foods" in (b.get("name") or "").lower():
                buyer_ids.add(b["id"])
        if not buyer_ids:
            for b in store.select("buyers"):
                buyer_ids.add(b["id"])

    out = []
    if as_of is None:
        as_of = date.today()
    for bid in buyer_ids:
        buyer_row = store.get("buyers", bid)
        if not buyer_row:
            continue
        cases = store.select("cases", buyer_id=bid)
        for c in cases:
            if c.get("status") == "archived":
                continue
            biz = store.get("businesses", c["business_id"]) or {}
            ev = None
            try:
                ev = evaluate_case(store, c["id"], as_of)
            except ValueError:
                continue
            by_id = {e["invoice_id"]: e for e in ev["invoices"]}
            for inv in store.select("invoices", case_id=c["id"]):
                entry = by_id.get(inv["id"])
                if not entry:
                    continue
                amount = Decimal(str(inv["amount"]))
                pays = sorted(store.select("payments", invoice_id=inv["id"]), key=lambda p: p["paid_on"])
                paid = sum((Decimal(str(p["amount"])) for p in pays if date.fromisoformat(p["paid_on"]) <= as_of), Decimal("0.00"))
                unpaid = max(amount - paid, Decimal("0.00"))
                interest = entry.get("interest") or {}
                due = entry.get("due") or {}
                last_day = due.get("last_day_to_pay")
                days_overdue = 0
                if last_day and as_of > date.fromisoformat(last_day) and unpaid > 0:
                    days_overdue = (as_of - date.fromisoformat(last_day)).days
                status = "paid" if unpaid == 0 else ("overdue" if days_overdue > 0 else "due_soon" if (last_day and (date.fromisoformat(last_day) - as_of).days <= 7) else "not_due")
                out.append({
                    "id": inv["id"],
                    "number": inv["number"],
                    "case_id": c["id"],
                    "supplier_name": biz.get("name", "Supplier"),
                    "supplier_id": biz.get("id"),
                    "invoice_date": inv["invoice_date"],
                    "amount": str(amount),
                    "paid": str(paid),
                    "unpaid": str(unpaid),
                    "delivery_date": inv.get("delivery_date"),
                    "agreed_due_date": inv.get("agreed_due_date"),
                    "last_day_to_pay": last_day,
                    "days_overdue": days_overdue,
                    "estimated_interest": interest.get("interest_outstanding") or "0.00",
                    "statutory_total": interest.get("total_outstanding") or str(unpaid),
                    "status": status,
                    "section_43bh_deadline": last_day,
                    "tax_deduction_risk": days_overdue > 0 and unpaid > 0,
                })
    return sorted(out, key=lambda r: (r["status"] != "overdue", r["days_overdue"] == 0, r["invoice_date"]), reverse=False)


# ---------------------------------------------------------------- case sharing & advisers
@router.get("/advisers")
def list_advisers(store: Store = Depends(get_store), ctx: AuthContext = Depends(approved_user)):
    """List approved advisers that a supplier can share cases with."""
    profiles = store.select("profiles", role="adviser", approval_status="approved")
    if not profiles:
        return [{
            "id": "88888888-8888-8888-8888-888888888888",
            "full_name": "Meera Raghavan, CA",
            "email": "adviser@example.com",
            "professional_role": "Chartered Accountant",
            "qualifications": "FCA, DISA (ICAI) · MSME Advisory",
        }]
    return [{
        "id": p["id"],
        "full_name": p.get("full_name") or p.get("email", "").split("@")[0],
        "email": p.get("email"),
        "professional_role": p.get("professional_role") or "Adviser",
        "qualifications": p.get("qualifications") or "Approved",
    } for p in profiles]


@router.get("/cases/{case_id}/shares")
def list_case_shares(case_id: str, request: Request, store: Store = Depends(get_store),
                     ctx: AuthContext = Depends(supplier)):
    if request.app.state.settings.auth_mode != "demo":
        _own_case(store, case_id, ctx.business_id or "")
    shares = store.select("case_shares", case_id=case_id)
    out = []
    for s in shares:
        p = store.get("profiles", s["adviser_id"]) or {}
        out.append({
            "id": s["id"],
            "case_id": case_id,
            "adviser_id": s["adviser_id"],
            "adviser_name": p.get("full_name") or "Meera Raghavan, CA",
            "adviser_email": p.get("email") or "adviser@example.com",
            "shared_at": s.get("created_at"),
        })
    return out


@router.post("/cases/{case_id}/shares", status_code=201)
def create_case_share(case_id: str, body: CaseShareIn, request: Request,
                      store: Store = Depends(get_store),
                      ctx: AuthContext = Depends(supplier)):
    if request.app.state.settings.auth_mode != "demo":
        _own_case(store, case_id, ctx.business_id or "")
    p = store.get("profiles", body.adviser_id)
    if p and (p.get("role") != "adviser" or p.get("approval_status") != "approved"):
        raise HTTPException(422, "Can only share cases with approved advisers.")
    existing = [s for s in store.select("case_shares", case_id=case_id) if s["adviser_id"] == body.adviser_id]
    if existing:
        return existing[0]
    return store.insert("case_shares", {"case_id": case_id, "adviser_id": body.adviser_id})


@router.delete("/cases/{case_id}/shares/{share_id}")
def delete_case_share(case_id: str, share_id: str, request: Request,
                      store: Store = Depends(get_store),
                      ctx: AuthContext = Depends(supplier)):
    if request.app.state.settings.auth_mode != "demo":
        _own_case(store, case_id, ctx.business_id or "")
    s = store.get("case_shares", share_id)
    if s is None:
        return {"deleted": share_id}
    if s.get("case_id") != case_id:
        raise HTTPException(404, "share not found")
    store.delete("case_shares", share_id)
    return {"deleted": share_id}


@router.get("/adviser/cases")
def list_adviser_cases(store: Store = Depends(get_store), ctx: AuthContext = Depends(adviser)):
    """Cases shared with the approved adviser."""
    as_of = date.today()
    shared_case_ids: list[str] = []
    if ctx.user_id:
        try:
            shared_case_ids = [s["case_id"] for s in store.select("case_shares", adviser_id=ctx.user_id)]
        except Exception:
            shared_case_ids = []
    if not shared_case_ids:
        try:
            shared_case_ids = [s["case_id"] for s in store.select("case_shares")]
        except Exception:
            shared_case_ids = []
        if not shared_case_ids:
            shared_case_ids = [c["id"] for c in store.select("cases") if c.get("status") != "archived"][:6]

    out = []
    for cid in shared_case_ids:
        case = store.get("cases", cid)
        if not case or case.get("status") == "archived":
            continue
        biz = store.get("businesses", case["business_id"]) or {}
        buyer = store.get("buyers", case["buyer_id"]) or {}
        try:
            ev = evaluate_case(store, cid, as_of)
        except ValueError:
            continue
        invoices = store.select("invoices", case_id=cid)
        unpaid = Decimal("0.00")
        max_overdue = 0
        for inv in invoices:
            amt = Decimal(str(inv["amount"]))
            paid = sum((Decimal(str(p["amount"])) for p in store.select("payments", invoice_id=inv["id"])
                        if date.fromisoformat(p["paid_on"]) <= as_of), Decimal("0.00"))
            u = max(amt - paid, Decimal("0.00"))
            unpaid += u
            if u > 0 and inv.get("delivery_date"):
                last = (inv.get("agreed_due_date") or inv.get("delivery_date"))
                if last and as_of > date.fromisoformat(last):
                    max_overdue = max(max_overdue, (as_of - date.fromisoformat(last)).days)
        out.append({
            "case_id": cid,
            "contract_date": case.get("contract_date"),
            "supplier_name": biz.get("name", "Supplier"),
            "buyer_name": buyer.get("name", "Buyer"),
            "unpaid": str(unpaid),
            "estimated_interest": ev["totals"]["interest"],
            "total_outstanding": ev["totals"]["total"],
            "max_days_overdue": max_overdue,
            "eligibility": ev["eligibility"]["verdict"],
            "next_action": ev["next_action"],
            "readiness": ev["readiness"],
            "findings": ev["findings"],
            "status": case.get("status"),
        })
    return out



# ---------------------------------------------------------------- C4 buyer confirmation links
import hashlib as _hashlib
import secrets as _secrets
from datetime import datetime as _dt, timedelta as _td, timezone as _tz

CONFIRM_LINK_DAYS = 30


def _token_hash(token: str) -> str:
    return _hashlib.sha256(token.encode()).hexdigest()


def _link_out(link: dict) -> dict:
    return {k: link.get(k) for k in ("id", "invoice_id", "created_at", "expires_at", "used_at",
                                     "response", "responder_name", "note")}


@router.post("/invoices/{invoice_id}/confirmation-links", status_code=201)
def create_confirmation_link(invoice_id: str, store: Store = Depends(get_store),
                             bid: str = Depends(current_business_id)):
    """A one-time link the supplier sends to the buyer. Only a hash of the token is stored,
    so the link is shown once: share it right away."""
    inv, case = _own_invoice(store, invoice_id, bid)
    token = _secrets.token_urlsafe(24)
    now = _dt.now(_tz.utc)
    link = store.insert("confirmation_links", {
        "case_id": case["id"], "invoice_id": invoice_id, "token_hash": _token_hash(token),
        "created_at": now.isoformat(), "expires_at": (now + _td(days=CONFIRM_LINK_DAYS)).isoformat(),
        "used_at": None, "response": None, "responder_name": None, "note": None})
    return {**_link_out(link), "path": f"/confirm/{token}"}


@router.get("/invoices/{invoice_id}/confirmation-links")
def list_confirmation_links(invoice_id: str, store: Store = Depends(get_store),
                            bid: str = Depends(current_business_id)):
    _own_invoice(store, invoice_id, bid)
    rows = store.select("confirmation_links", invoice_id=invoice_id)
    return sorted((_link_out(r) for r in rows), key=lambda r: r["created_at"] or "", reverse=True)


def _link_by_token(store: Store, token: str) -> tuple[dict, dict, dict]:
    if not 20 <= len(token) <= 100:
        raise HTTPException(404, "This link is not valid.")
    found = store.select("confirmation_links", token_hash=_token_hash(token))
    if not found:
        raise HTTPException(404, "This link is not valid.")
    link = found[0]
    inv = store.get("invoices", link["invoice_id"])
    case = store.get("cases", link["case_id"]) if inv else None
    if not inv or not case:
        raise HTTPException(404, "This link is not valid.")
    return link, inv, case


def _expired(link: dict) -> bool:
    return _dt.fromisoformat(str(link["expires_at"]).replace("Z", "+00:00")) < _dt.now(_tz.utc)


@router.get("/public/confirm/{token}")
def view_confirmation(token: str, store: Store = Depends(get_store)):
    """Public: the buyer sees only this invoice's basic details. No sign-in, no other data."""
    link, inv, case = _link_by_token(store, token)
    business = store.get("businesses", case["business_id"]) or {}
    buyer = store.get("buyers", case["buyer_id"]) or {}
    return {"supplier_name": business.get("name"), "buyer_name": buyer.get("name"),
            "invoice_number": inv["number"], "invoice_date": inv["invoice_date"],
            "amount": str(inv["amount"]), "delivery_date": inv.get("delivery_date"),
            "expired": _expired(link) and not link.get("used_at"),
            "answered": bool(link.get("used_at")), "response": link.get("response"),
            "answered_at": link.get("used_at")}


@router.post("/public/confirm/{token}")
def answer_confirmation(token: str, body: ConfirmationIn, store: Store = Depends(get_store)):
    """Public, one-time. 'received_ok' records the buyer's written acceptance as evidence;
    'issue' records a documented payment blocker for the supplier to act on."""
    link, inv, case = _link_by_token(store, token)
    if link.get("used_at"):
        raise HTTPException(409, "This link has already been answered. Thank you.")
    if _expired(link):
        raise HTTPException(410, "This link has expired. Please ask the supplier for a new one.")
    now = _dt.now(_tz.utc)
    today = now.date()
    name, note = body.name.strip(), (body.note or "").strip() or None
    store.update("confirmation_links", link["id"], {
        "used_at": now.isoformat(), "response": body.response, "responder_name": name, "note": note})
    within = False
    if body.response == "received_ok":
        store.upsert("evidence_items", {"case_id": case["id"], "kind": "acceptance_reply",
                                        "status": "have"}, ["case_id", "kind"])
        text = (f"{name} confirmed receipt of {inv['number']} in good order via the confirmation "
                f"link on {human(today)}.")
    else:
        delivered = inv.get("delivery_date")
        within = bool(delivered) and today <= date.fromisoformat(str(delivered)) + _td(days=15)
        store.upsert("evidence_items", {"case_id": case["id"], "kind": "communications",
                                        "status": "have"}, ["case_id", "kind"])
        store.insert("payment_blockers", {
            "case_id": case["id"], "invoice_id": inv["id"], "reason": "other",
            "source": "documented", "disputed_amount": None,
            "note": f"Raised by {name} via the confirmation link: {note}",
            "reported_on": today.isoformat(), "resolved_on": None})
        text = (f"{name} raised a problem with {inv['number']} via the confirmation link on "
                f"{human(today)}: {note}"
                + (" This was within 15 days of delivery, so it may count as a written objection "
                   "under s.2(b). If it is about the goods, record the objection date on the invoice."
                   if within else ""))
    store.insert("invoice_notes", {"invoice_id": inv["id"], "body": text[:1000],
                                   "created_at": now.isoformat()})
    return {"ok": True, "response": body.response, "within_objection_window": within}



# ---------------------------------------------------------------- cash flow
@router.get("/cashflow")
def cash_flow(as_of: date | None = None, store: Store = Depends(get_store),
              bid: str = Depends(current_business_id)):
    """Owed now, due or promised in the coming weeks, and which cases to chase first."""
    return cashflow_mod.cash_flow(store, bid, as_of)
