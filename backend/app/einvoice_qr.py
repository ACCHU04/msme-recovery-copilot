"""B1: read the signed QR code printed on a GST e-invoice and compare it with our records.

The QR holds a JWT issued by the Invoice Registration Portal (iss "NIC", RS256). Its payload
has a `data` field: a JSON string with SellerGstin, BuyerGstin, DocNo, DocTyp, DocDt
(DD/MM/YYYY), TotInvVal, ItemCnt, MainHsnCode and Irn (IrnDt when present).

Decoding is exact and needs no AI. The signature is verified only when the portal's public
key is configured (EINVOICE_PUBLIC_KEY, PEM); otherwise the result says it was not verified.
"""
from __future__ import annotations

import base64
import json
import os
import re
from dataclasses import asdict, dataclass, field
from datetime import date, datetime
from decimal import Decimal, InvalidOperation

import jwt

from recovery_engine.due_date import human

from .drafts import _inr
from .schemas import GSTIN_RE, gstin_checksum_ok

IRN_RE = re.compile(r"^[0-9a-f]{64}$")


class QRError(ValueError):
    """The text is not a readable e-invoice QR code."""


@dataclass
class QRFields:
    seller_gstin: str | None
    buyer_gstin: str | None
    doc_no: str | None
    doc_type: str | None
    doc_date: str | None          # ISO date
    total: str | None
    item_count: int | None
    main_hsn: str | None
    irn: str | None
    irn_date: str | None
    issuer: str | None


@dataclass
class QRCheck:
    check: str
    status: str                   # match | mismatch | warning | not_comparable
    detail: str


@dataclass
class QRResult:
    fields: QRFields
    signature_verified: bool
    signature_note: str
    checks: list[QRCheck] = field(default_factory=list)
    verdict: str = "not_compared"  # looks_right | check_this | not_compared

    def to_json(self) -> dict:
        return asdict(self)


def _b64(part: str) -> bytes:
    return base64.urlsafe_b64decode(part + "=" * (-len(part) % 4))


def _date(s) -> str | None:
    if not s:
        return None
    s = str(s).strip()
    for fmt in ("%d/%m/%Y", "%d-%m-%Y", "%Y-%m-%d", "%d/%m/%Y %H:%M:%S", "%Y-%m-%d %H:%M:%S"):
        try:
            return datetime.strptime(s, fmt).date().isoformat()
        except ValueError:
            continue
    return None


def _money(v) -> str | None:
    try:
        return str(Decimal(str(v)).quantize(Decimal("0.01"))) if v not in (None, "") else None
    except InvalidOperation:
        return None


def decode(text: str, public_key: str | None = None) -> tuple[QRFields, bool, str]:
    """Returns the fields, whether the signature was verified, and a note about it."""
    token = (text or "").strip()
    parts = token.split(".")
    if len(parts) != 3 or not all(parts[:2]):
        raise QRError("This is not an e-invoice QR code (expected a signed code from the GST portal).")
    try:
        header = json.loads(_b64(parts[0]))
        payload = json.loads(_b64(parts[1]))
    except (ValueError, json.JSONDecodeError) as e:
        raise QRError("The QR code could not be read as an e-invoice.") from e
    key = public_key if public_key is not None else os.getenv("EINVOICE_PUBLIC_KEY")
    verified, note = False, ("Signature not verified: the GST portal's public key is not set up "
                             "on this server. The details below are as printed on the invoice.")
    if key:
        try:
            jwt.decode(token, key, algorithms=["RS256"], options={"verify_aud": False, "verify_exp": False})
            verified, note = True, "Signature verified with the GST portal's public key."
        except jwt.PyJWTError:
            raise QRError("The QR code's signature does not match the GST portal's key. "
                          "The code may have been altered; do not rely on it.")
    if header.get("alg") not in (None, "RS256"):
        note += " (Unexpected signing method in the code.)"
    data = payload.get("data", payload)
    if isinstance(data, str):
        try:
            data = json.loads(data)
        except json.JSONDecodeError as e:
            raise QRError("The QR code's invoice data could not be read.") from e
    if not isinstance(data, dict) or not (data.get("Irn") or data.get("DocNo")):
        raise QRError("This QR code does not contain e-invoice details.")
    irn = str(data.get("Irn") or "").strip().lower() or None
    try:
        items = int(data["ItemCnt"]) if data.get("ItemCnt") not in (None, "") else None
    except (TypeError, ValueError):
        items = None
    return QRFields(
        seller_gstin=(str(data.get("SellerGstin") or "").strip().upper() or None),
        buyer_gstin=(str(data.get("BuyerGstin") or "").strip().upper() or None),
        doc_no=(str(data.get("DocNo") or "").strip() or None),
        doc_type=(str(data.get("DocTyp") or "").strip() or None),
        doc_date=_date(data.get("DocDt")),
        total=_money(data.get("TotInvVal")),
        item_count=items,
        main_hsn=(str(data.get("MainHsnCode") or "").strip() or None),
        irn=irn, irn_date=_date(data.get("IrnDt")),
        issuer=payload.get("iss"),
    ), verified, note


def _norm(s: str | None) -> str:
    return re.sub(r"[\s/_-]+", "", (s or "").upper())


def compare(fields: QRFields, invoice: dict | None, business: dict | None, buyer: dict | None) -> list[QRCheck]:
    out: list[QRCheck] = []
    for label, g in (("Seller GSTIN", fields.seller_gstin), ("Buyer GSTIN", fields.buyer_gstin)):
        if g and not (GSTIN_RE.match(g) and gstin_checksum_ok(g)):
            out.append(QRCheck(f"{label} format", "mismatch", f"{g} is not a valid GSTIN (check digit fails)."))
    if fields.irn and not IRN_RE.match(fields.irn):
        out.append(QRCheck("IRN format", "warning", "The IRN is not the usual 64-character code."))
    if fields.doc_type and fields.doc_type.upper() not in ("INV", "CRN", "DBN"):
        out.append(QRCheck("Document type", "warning", f"Document type is {fields.doc_type}."))
    elif fields.doc_type and fields.doc_type.upper() != "INV":
        out.append(QRCheck("Document type", "warning",
                           f"This is a {'credit' if fields.doc_type.upper() == 'CRN' else 'debit'} note, not an invoice."))
    if invoice is None:
        return out
    if fields.doc_no:
        ok = _norm(fields.doc_no) == _norm(invoice.get("number"))
        out.append(QRCheck("Invoice number", "match" if ok else "mismatch",
                           f"QR: {fields.doc_no}; your record: {invoice.get('number')}."))
    if fields.doc_date:
        ok = fields.doc_date == str(invoice.get("invoice_date"))
        out.append(QRCheck("Invoice date", "match" if ok else "mismatch",
                           f"QR: {human(date.fromisoformat(fields.doc_date))}; your record: "
                           f"{human(date.fromisoformat(str(invoice.get('invoice_date'))))}."))
    if fields.total:
        ok = Decimal(fields.total) == Decimal(str(invoice.get("amount")))
        out.append(QRCheck("Total invoice value", "match" if ok else "mismatch",
                           f"QR: {_inr(fields.total)}; your record: {_inr(invoice.get('amount'))}."))
    mine = (business or {}).get("gstin")
    if fields.seller_gstin:
        out.append(QRCheck("Seller GSTIN is yours",
                           "not_comparable" if not mine else ("match" if mine.upper() == fields.seller_gstin else "mismatch"),
                           f"QR: {fields.seller_gstin}; your profile: {mine or 'no GSTIN saved'}."))
    theirs = (buyer or {}).get("gstin")
    if fields.buyer_gstin:
        out.append(QRCheck("Buyer GSTIN", "not_comparable" if not theirs
                           else ("match" if theirs.upper() == fields.buyer_gstin else "mismatch"),
                           f"QR: {fields.buyer_gstin}; buyer record: {theirs or 'no GSTIN saved'}."))
    return out


def analyse(text: str, invoice: dict | None, business: dict | None, buyer: dict | None,
            public_key: str | None = None) -> QRResult:
    fields, verified, note = decode(text, public_key)
    checks = compare(fields, invoice, business, buyer)
    if invoice is None:
        verdict = "not_compared"
    elif any(c.status == "mismatch" for c in checks):
        verdict = "check_this"
    else:
        verdict = "looks_right"
    return QRResult(fields, verified, note, checks, verdict)


def today_iso() -> str:
    return date.today().isoformat()
