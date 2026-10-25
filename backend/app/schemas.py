"""Request bodies, with the validation rules from the plan's testing checklist."""
from __future__ import annotations

import re
from datetime import date
from decimal import Decimal
from typing import Literal

from pydantic import BaseModel, Field, field_validator, model_validator

GSTIN_RE = re.compile(r"^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$")
UDYAM_RE = re.compile(r"^UDYAM-[A-Z]{2}-\d{2}-\d{7}$")
PAN_RE = re.compile(r"^[A-Z]{5}[0-9]{4}[A-Z]$")
EMAIL_RE = re.compile(r"^[^\s@]+@[^\s@]+\.[^\s@]{2,}$")
BUSINESS_DOC_KINDS = ("udyam_certificate", "gst_certificate", "pan_card", "address_proof", "bank_details")
GSTIN_CHARS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ"


def gstin_checksum_ok(gstin: str) -> bool:
    """Standard GSTIN check-digit (base-36, alternating weights). Format check only;
    this does not confirm the GSTIN is registered."""
    total = 0
    for i, ch in enumerate(gstin[:14]):
        product = GSTIN_CHARS.index(ch) * (2 if i % 2 else 1)
        total += product // 36 + product % 36
    return GSTIN_CHARS[(36 - total % 36) % 36] == gstin[14]


def _not_future(v: date | None, field: str) -> date | None:
    if v is not None and v > date.today():
        raise ValueError(f"{field} cannot be in the future")
    return v


class TeamMemberIn(BaseModel):
    """A person listed on the profile for reference. Listing someone gives them no access."""
    name: str = Field(min_length=1, max_length=100)
    role: str = Field(min_length=1, max_length=50)
    email: str | None = Field(default=None, max_length=254)

    @field_validator("email")
    @classmethod
    def email_ok(cls, v: str | None) -> str | None:
        if v and not EMAIL_RE.match(v.strip()):
            raise ValueError("Enter a valid email address")
        return v.strip().lower() if v else None


class BusinessIn(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    phone: str | None = None
    udyam_no: str | None = None
    size: Literal["micro", "small", "medium"] | None = None
    activity: Literal["manufacturing", "services", "trader"] | None = None
    udyam_registered: bool | None = None
    udyam_reg_date: date | None = None
    preferred_lang: Literal["en", "kn"] = "en"
    # Profile details (shown on the Business Profile page; none affect eligibility)
    description: str | None = Field(default=None, max_length=500)
    email: str | None = Field(default=None, max_length=254)
    address: str | None = Field(default=None, max_length=300)
    website: str | None = Field(default=None, max_length=200)
    gstin: str | None = None
    pan: str | None = None
    established_year: int | None = Field(default=None, ge=1900, le=2100)
    products: list[str] = Field(default_factory=list, max_length=20)
    team: list[TeamMemberIn] = Field(default_factory=list, max_length=10)
    documents: dict[str, Literal["have", "missing", "unknown"]] = Field(default_factory=dict)

    @field_validator("email")
    @classmethod
    def business_email_ok(cls, v: str | None) -> str | None:
        if v and not EMAIL_RE.match(v.strip()):
            raise ValueError("Enter a valid email address")
        return v.strip().lower() if v else None

    @field_validator("gstin")
    @classmethod
    def business_gstin_ok(cls, v: str | None) -> str | None:
        if not v:
            return None
        v = v.strip().upper()
        if not GSTIN_RE.match(v) or not gstin_checksum_ok(v):
            raise ValueError("GSTIN format or check digit is invalid")
        return v

    @field_validator("pan")
    @classmethod
    def pan_ok(cls, v: str | None) -> str | None:
        if not v:
            return None
        v = v.strip().upper()
        if not PAN_RE.match(v):
            raise ValueError("PAN should look like ABCDE1234F")
        return v

    @field_validator("products")
    @classmethod
    def products_ok(cls, v: list[str]) -> list[str]:
        out = [x.strip() for x in v if x.strip()]
        if any(len(x) > 60 for x in out):
            raise ValueError("Keep each product or service under 60 characters")
        return list(dict.fromkeys(out))

    @field_validator("documents")
    @classmethod
    def docs_ok(cls, v: dict) -> dict:
        bad = [k for k in v if k not in BUSINESS_DOC_KINDS]
        if bad:
            raise ValueError(f"Unknown document type: {', '.join(bad)}")
        return v

    @field_validator("udyam_no")
    @classmethod
    def udyam_format(cls, v: str | None) -> str | None:
        if v and not UDYAM_RE.match(v.strip().upper()):
            raise ValueError("Udyam number should look like UDYAM-KR-00-0000000")
        return v.strip().upper() if v else v

    @field_validator("udyam_reg_date")
    @classmethod
    def reg_not_future(cls, v):
        return _not_future(v, "udyam_reg_date")


class BuyerIn(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    gstin: str | None = None
    is_cpse: bool = False
    relationship_importance: Literal["low", "medium", "high"] | None = None

    @field_validator("gstin")
    @classmethod
    def gstin_format(cls, v: str | None) -> str | None:
        if not v:
            return v
        v = v.strip().upper()
        if not GSTIN_RE.match(v) or not gstin_checksum_ok(v):
            raise ValueError("GSTIN format or check digit is invalid")
        return v


class CaseIn(BaseModel):
    buyer: BuyerIn
    contract_date: date | None = None

    @field_validator("contract_date")
    @classmethod
    def contract_not_future(cls, v):
        return _not_future(v, "contract_date")


class CasePatch(BaseModel):
    contract_date: date | None = None
    po_amount: Decimal | None = Field(default=None, gt=0, max_digits=14, decimal_places=2)
    dispute_reason: Literal["none", "quality", "quantity", "other"] | None = None
    status: Literal["draft", "active", "settled", "archived"] | None = None
    ladder_step: int | None = Field(default=None, ge=0, le=4)
    allocation: Literal["interest_first", "principal_first"] | None = None


class InvoiceIn(BaseModel):
    number: str = Field(min_length=1, max_length=50)
    invoice_date: date
    amount: Decimal = Field(gt=0, max_digits=14, decimal_places=2)
    delivery_date: date | None = None
    agreed_due_date: date | None = None
    objection_date: date | None = None
    objection_removed_date: date | None = None

    @field_validator("invoice_date", "delivery_date", "objection_date", "objection_removed_date")
    @classmethod
    def dates_not_future(cls, v, info):
        return _not_future(v, info.field_name)

    @model_validator(mode="after")
    def dates_make_sense(self):
        if self.objection_date and self.delivery_date and self.objection_date < self.delivery_date:
            raise ValueError("objection_date cannot be before delivery_date")
        if self.objection_removed_date and not self.objection_date:
            raise ValueError("objection_removed_date needs an objection_date")
        if (self.objection_removed_date and self.objection_date
                and self.objection_removed_date < self.objection_date):
            raise ValueError("objection_removed_date cannot be before objection_date")
        return self


class PaymentIn(BaseModel):
    paid_on: date
    amount: Decimal = Field(gt=0, max_digits=14, decimal_places=2)

    @field_validator("paid_on")
    @classmethod
    def paid_not_future(cls, v):
        return _not_future(v, "paid_on")


class PromiseExtractIn(BaseModel):
    text: str = Field(min_length=1, max_length=1000)
    said_on: date | None = None          # defaults to today

    @field_validator("said_on")
    @classmethod
    def said_not_future(cls, v):
        return _not_future(v, "said_on")


class PromiseIn(BaseModel):
    """Saved only after the owner confirms the extracted values."""
    made_on: date
    due_date: date
    amount: Decimal = Field(gt=0, max_digits=14, decimal_places=2)
    source_text: str | None = Field(default=None, max_length=1000)

    @field_validator("made_on")
    @classmethod
    def made_not_future(cls, v):
        return _not_future(v, "made_on")

    @model_validator(mode="after")
    def due_after_made(self):
        if self.due_date < self.made_on:
            raise ValueError("due_date cannot be before made_on")
        return self


class FollowupIn(BaseModel):
    step: int = Field(ge=1, le=3)        # 1 nudge, 2 firm, 3 formal demand
    sent_on: date
    reply_received: bool = False
    note: str | None = Field(default=None, max_length=500)

    @field_validator("sent_on")
    @classmethod
    def sent_not_future(cls, v):
        return _not_future(v, "sent_on")


class FollowupPatch(BaseModel):
    reply_received: bool


class InvoicePatch(BaseModel):
    number: str | None = Field(default=None, min_length=1, max_length=50)
    invoice_date: date | None = None
    amount: Decimal | None = Field(default=None, gt=0, max_digits=14, decimal_places=2)
    delivery_date: date | None = None
    agreed_due_date: date | None = None
    objection_date: date | None = None
    objection_removed_date: date | None = None
    clear: list[Literal["delivery_date", "agreed_due_date", "objection_date",
                        "objection_removed_date"]] = []

    @field_validator("invoice_date", "delivery_date", "objection_date", "objection_removed_date")
    @classmethod
    def patch_not_future(cls, v, info):
        return _not_future(v, info.field_name)


class CalcPaymentIn(BaseModel):
    paid_on: date
    amount: Decimal = Field(gt=0, max_digits=14, decimal_places=2)


class CalculateIn(BaseModel):
    amount: Decimal = Field(gt=0, max_digits=14, decimal_places=2)
    delivery_date: date
    agreed_due_date: date | None = None
    objection_date: date | None = None
    objection_removed_date: date | None = None
    payments: list[CalcPaymentIn] = Field(default_factory=list, max_length=50)
    as_of: date | None = None
    allocation: Literal["interest_first", "principal_first"] = "interest_first"

    @model_validator(mode="after")
    def calc_dates(self):
        if self.objection_date and self.objection_date < self.delivery_date:
            raise ValueError("objection_date cannot be before delivery_date")
        if self.objection_removed_date and not self.objection_date:
            raise ValueError("objection_removed_date needs an objection_date")
        as_of = self.as_of or date.today()
        if any(p.paid_on > as_of for p in self.payments):
            raise ValueError("payments cannot be after the valuation date")
        return self


class DraftIn(BaseModel):
    kind: Literal[
        "acceptance_confirm", "nudge", "firm", "demand",
        "fix_blocker_po", "fix_blocker_grn", "fix_blocker_amount", "resolve_dispute", "fix_blocker"
    ]
    lang: Literal["en"] = "en"


class EvidenceIn(BaseModel):
    status: Literal["have", "missing", "unknown"]


class EvaluateIn(BaseModel):
    as_of: date | None = None


class SimMessageIn(BaseModel):
    session: str = Field(min_length=1, max_length=100)
    text: str = Field(max_length=2000)


EVIDENCE_KINDS = ("po", "invoice", "delivery_proof", "acceptance_reply",
                  "ledger", "communications", "udyam_cert")


class MilestoneIn(BaseModel):
    """A planned delivery or payment stage of a purchase order."""
    title: str = Field(min_length=1, max_length=120)
    due_date: date
    amount: Decimal = Field(gt=0, max_digits=14, decimal_places=2)
    invoice_id: str | None = None


class MilestonePatch(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=120)
    due_date: date | None = None
    amount: Decimal | None = Field(default=None, gt=0, max_digits=14, decimal_places=2)
    invoice_id: str | None = None


class NoteIn(BaseModel):
    body: str = Field(min_length=1, max_length=1000)

    @field_validator("body")
    @classmethod
    def not_blank(cls, v: str) -> str:
        if not v.strip():
            raise ValueError("Write something in the note")
        return v.strip()


class LegalAskIn(BaseModel):
    question: str = Field(min_length=3, max_length=500)

    @field_validator("question")
    @classmethod
    def trimmed(cls, v: str) -> str:
        v = " ".join(v.split())
        if len(v) < 3:
            raise ValueError("Type a question")
        return v


class CaseShareIn(BaseModel):
    adviser_id: str = Field(min_length=1)

# ---------------------------------------------------------------- payment blockers
BLOCKER_REASONS = (
    "po_missing", "grn_not_entered", "amount_mismatch",
    "quality_dispute", "waiting_approval", "other",
)
BLOCKER_SOURCES = ("buyer_said", "documented", "not_verified")


class BlockerIn(BaseModel):
    reason: Literal[
        "po_missing", "grn_not_entered", "amount_mismatch",
        "quality_dispute", "waiting_approval", "other"
    ]
    source: Literal["buyer_said", "documented", "not_verified"] = "not_verified"
    invoice_id: str | None = None
    disputed_amount: Decimal | None = Field(default=None, ge=0)
    note: str | None = Field(default=None, max_length=1000)
    reported_on: date | None = None
    resolved_on: date | None = None

    @field_validator("note")
    @classmethod
    def note_not_blank(cls, v: str | None) -> str | None:
        if v is not None:
            v = v.strip()
            if not v:
                return None
        return v


class BlockerPatch(BaseModel):
    reason: Literal[
        "po_missing", "grn_not_entered", "amount_mismatch",
        "quality_dispute", "waiting_approval", "other"
    ] | None = None
    source: Literal["buyer_said", "documented", "not_verified"] | None = None
    invoice_id: str | None = None
    disputed_amount: Decimal | None = None
    note: str | None = Field(default=None, max_length=1000)
    reported_on: date | None = None
    resolved_on: date | None = None
