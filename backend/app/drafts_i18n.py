"""C3: Kannada and Hindi versions of the four main follow-up letters.

Fixed templates, like the English ones: every amount, date, invoice number and section is
filled in by code, never written by AI. The wording was prepared without a native-speaker
review, so each draft carries a note asking the owner to have it checked before sending.
Amounts use the rupee sign with Indian grouping; dates are written as DD-MM-YYYY so no month
names need translating. Act and section numbers stay in Latin script, as on official papers.
"""
from __future__ import annotations

from datetime import date
from decimal import Decimal

LANGS = ("kn", "hi")
LANG_NAME = {"en": "English", "kn": "Kannada", "hi": "Hindi"}
LOCALIZED_KINDS = ("acceptance_confirm", "nudge", "firm", "demand")

REVIEW_NOTE = {
    "kn": "This Kannada text is a fixed template that has not yet been checked by a native speaker. "
          "Read it through, or ask someone fluent to, before sending.",
    "hi": "This Hindi text is a fixed template that has not yet been checked by a native speaker. "
          "Read it through, or ask someone fluent to, before sending.",
}
DEMAND_NOTE = {
    "kn": " For a formal demand, also send the English version; keep this as a courtesy copy.",
    "hi": " For a formal demand, also send the English version; keep this as a courtesy copy.",
}


def rupees(x) -> str:
    """246072.61 -> ₹2,46,072.61"""
    from .drafts import _inr
    return _inr(x).replace("Rs ", "₹")


def num_date(s) -> str:
    d = s if isinstance(s, date) else date.fromisoformat(str(s)[:10])
    return d.strftime("%d-%m-%Y")


def join_numbers(numbers: list[str], lang: str) -> str:
    if len(numbers) <= 2:
        return {"kn": " ಮತ್ತು ", "hi": " और "}[lang].join(numbers)
    return ", ".join(numbers)


T = {
    "kn": {
        "acceptance_confirm": (
            "ನಮಸ್ಕಾರ {buyer} ತಂಡ,\n\n{numbers} ಇನ್‌ವಾಯ್ಸ್‌ಗೆ ಸಂಬಂಧಿಸಿದ ಸರಕು ವಿತರಣೆಯನ್ನು ಖಚಿತಪಡಿಸಲು ಈ ಸಂದೇಶ. "
            "ಸರಕುಗಳು ಉತ್ತಮ ಸ್ಥಿತಿಯಲ್ಲಿ ತಲುಪಿವೆ ಎಂದು ದಯವಿಟ್ಟು ಉತ್ತರಿಸಿ ಖಚಿತಪಡಿಸುವಿರಾ? "
            "ಇದು ನಮ್ಮಿಬ್ಬರ ದಾಖಲೆಗಳನ್ನು ಸರಿಯಾಗಿಡಲು ಸಹಾಯವಾಗುತ್ತದೆ.\n\nಧನ್ಯವಾದಗಳು,\n{business}"),
        "nudge": (
            "ನಮಸ್ಕಾರ {buyer} ತಂಡ, ತಾವು ಕ್ಷೇಮವಾಗಿದ್ದೀರಿ ಎಂದು ಭಾವಿಸುತ್ತೇವೆ.\n\n"
            "{numbers} ಇನ್‌ವಾಯ್ಸ್‌ನಲ್ಲಿ {unpaid} ಇನ್ನೂ ಬಾಕಿ ಇದೆ ಎಂದು ನೆನಪಿಸುತ್ತಿದ್ದೇವೆ.{hold} "
            "ಪಾವತಿಯನ್ನು ಯಾವಾಗ ನಿರೀಕ್ಷಿಸಬಹುದು ಎಂದು ದಯವಿಟ್ಟು ತಿಳಿಸಿ.\n\nಧನ್ಯವಾದಗಳು,\n{business}"),
        "firm": (
            "ನಮಸ್ಕಾರ {buyer} ತಂಡ,\n\n{numbers} ಇನ್‌ವಾಯ್ಸ್‌ಗಳ ಪಾವತಿ ಗಡುವು ಮುಗಿದಿದೆ.{promise}{interest}{hold}{tax}\n\n"
            "ದಯವಿಟ್ಟು {amount} ಮೊತ್ತವನ್ನು {pay_by} ರೊಳಗೆ ಪಾವತಿಸಿ. ಇನ್‌ವಾಯ್ಸ್‌ಗಳ ಬಗ್ಗೆ ಯಾವುದೇ ಸಮಸ್ಯೆ ಇದ್ದರೆ, "
            "ಅದನ್ನು ಬಗೆಹರಿಸಲು ದಯವಿಟ್ಟು ನಮಗೆ ತಿಳಿಸಿ.\n\nವಂದನೆಗಳು,\n{business}"),
        "demand": (
            "ಮಾನ್ಯರೇ,\n\nವಿಷಯ: ಸೂಕ್ಷ್ಮ, ಸಣ್ಣ ಮತ್ತು ಮಧ್ಯಮ ಉದ್ಯಮಗಳ ಅಭಿವೃದ್ಧಿ ಕಾಯ್ದೆ, 2006 (MSMED Act) "
            "ಸೆಕ್ಷನ್ 15 ಮತ್ತು 16ರ ಅಡಿಯಲ್ಲಿ ಬಾಕಿ ಪಾವತಿ\n\n"
            "{business} ನೀಡಿದ ಕೆಳಗಿನ ಇನ್‌ವಾಯ್ಸ್‌ಗಳು ಸೆಕ್ಷನ್ 15ರಲ್ಲಿ ಅನುಮತಿಸಿದ ಅವಧಿ ಮೀರಿದರೂ ಪಾವತಿಯಾಗಿಲ್ಲ:\n{lines}\n\n"
            "{as_of} ರಂತೆ ಬಾಕಿ ಮೊತ್ತ {total}; ಇದರಲ್ಲಿ ಸೆಕ್ಷನ್ 16ರ ಅಡಿಯ ಚಕ್ರಬಡ್ಡಿ {interest_amt} ಸೇರಿದೆ.{hold} "
            "ತಿಂಗಳುವಾರು ವಿವರಪಟ್ಟಿಯನ್ನು ಲಗತ್ತಿಸಲಾಗಿದೆ.\n\nದಯವಿಟ್ಟು {pay_by} ರೊಳಗೆ ಪಾವತಿಸಿ. "
            "ನಮ್ಮ ವ್ಯವಹಾರ ಸಂಬಂಧವನ್ನು ನಾವು ಗೌರವಿಸುತ್ತೇವೆ ಮತ್ತು ಇದನ್ನು ನೇರವಾಗಿ ಬಗೆಹರಿಸಿಕೊಳ್ಳಲು ಬಯಸುತ್ತೇವೆ.\n\n"
            "ತಮ್ಮ ವಿಶ್ವಾಸಿ,\n{business}"),
        "hold": " ಇದರಲ್ಲಿ {nums} ಮೇಲಿನ {held} ಸೇರಿಲ್ಲ; ಅದನ್ನು ನಿಮ್ಮೊಂದಿಗೆ ಪ್ರತ್ಯೇಕವಾಗಿ ಬಗೆಹರಿಸುತ್ತಿದ್ದೇವೆ.",
        "promise": " {date} ರೊಳಗೆ {amt} ಪಾವತಿಸುವುದಾಗಿ ನೀವು ತಿಳಿಸಿದ್ದಿರಿ; ಆ ಮೊತ್ತ ಇನ್ನೂ ನಮಗೆ ತಲುಪಿಲ್ಲ.",
        "interest": " MSMED ಕಾಯ್ದೆ, 2006ರ ಪ್ರಕಾರ {date} ರವರೆಗೆ {amt} ಬಡ್ಡಿ ಸೇರಿದೆ.",
        "tax": (" ಸಮಯಕ್ಕೆ ಪಾವತಿಸುವುದರಿಂದ ಆದಾಯ ತೆರಿಗೆ ಕಾಯ್ದೆ, 1961ರ ಸೆಕ್ಷನ್ 43B(h) "
                "(ಆದಾಯ ತೆರಿಗೆ ಕಾಯ್ದೆ, 2025ರ ಸೆಕ್ಷನ್ 37(2)(g)) ಅಡಿಯಲ್ಲಿ ನಿಮ್ಮ ತೆರಿಗೆ ಕಡಿತವೂ ಸುರಕ್ಷಿತವಾಗಿರುತ್ತದೆ."),
        "line": "- {num}{part}: ಪಾವತಿ ಗಡುವು {due}, ಬಾಕಿ {amt}",
        "part": " (ವಿವಾದರಹಿತ ಭಾಗ)",
    },
    "hi": {
        "acceptance_confirm": (
            "नमस्ते {buyer} टीम,\n\nयह संदेश {numbers} के माल की डिलीवरी की पुष्टि के लिए है। "
            "क्या आप कृपया जवाब देकर पुष्टि कर सकते हैं कि माल अच्छी हालत में मिल गया है? "
            "इससे हम दोनों के रिकॉर्ड सही रहेंगे।\n\nधन्यवाद,\n{business}"),
        "nudge": (
            "नमस्ते {buyer} टीम, आशा है सब कुशल है।\n\n"
            "एक छोटा सा स्मरण: {numbers} पर {unpaid} अभी भी बकाया है।{hold} "
            "कृपया बताएं कि भुगतान कब तक मिल सकता है।\n\nधन्यवाद,\n{business}"),
        "firm": (
            "नमस्ते {buyer} टीम,\n\n{numbers} की भुगतान तिथि निकल चुकी है।{promise}{interest}{hold}{tax}\n\n"
            "कृपया {pay_by} तक {amount} का भुगतान करें। यदि इनवॉइस में कोई समस्या है, "
            "तो कृपया हमें बताएं ताकि हम उसे सुलझा सकें।\n\nसादर,\n{business}"),
        "demand": (
            "महोदय/महोदया,\n\nविषय: सूक्ष्म, लघु और मध्यम उद्यम विकास अधिनियम, 2006 (MSMED Act) "
            "की धारा 15 और 16 के अंतर्गत देय भुगतान\n\n"
            "{business} के निम्नलिखित इनवॉइस धारा 15 में दी गई अवधि के बाद भी अदा नहीं किए गए हैं:\n{lines}\n\n"
            "{as_of} तक कुल देय राशि {total} है, जिसमें धारा 16 के अंतर्गत {interest_amt} चक्रवृद्धि ब्याज "
            "शामिल है।{hold} महीनेवार विवरण संलग्न है।\n\nकृपया {pay_by} तक भुगतान करें। "
            "हम अपने व्यावसायिक संबंध को महत्व देते हैं और इस मामले को सीधे सुलझाना चाहेंगे।\n\n"
            "भवदीय,\n{business}"),
        "hold": " इसमें {nums} की {held} राशि शामिल नहीं है, जिसे हम आपके साथ अलग से सुलझा रहे हैं।",
        "promise": " आपने {date} तक {amt} का भुगतान करने का वादा किया था, जो हमें अभी तक नहीं मिला है।",
        "interest": " MSMED अधिनियम, 2006 के अंतर्गत {date} तक {amt} ब्याज बन चुका है।",
        "tax": (" समय पर भुगतान से आयकर अधिनियम, 1961 की धारा 43B(h) "
                "(आयकर अधिनियम, 2025 की धारा 37(2)(g)) के अंतर्गत आपकी कर-कटौती भी सुरक्षित रहती है।"),
        "line": "- {num}{part}: भुगतान की अंतिम तिथि {due}, बकाया {amt}",
        "part": " (निर्विवाद भाग)",
    },
}


def render(kind: str, lang: str, *, buyer: str, business: str, invoice_numbers: list[str],
           unpaid: Decimal, total: Decimal, interest: Decimal, eligible: bool, as_of: str, pay_by: str,
           held: list[tuple[str, Decimal]], broken_promise: dict | None, invoices: list[dict]) -> str:
    t = T[lang]
    hold = sum((h for _, h in held), Decimal("0"))
    hold_line = t["hold"].format(nums=", ".join(n for n, _ in held), held=rupees(hold)) if hold > 0 else ""
    v = {"buyer": buyer, "business": business, "numbers": join_numbers(invoice_numbers, lang),
         "unpaid": rupees(unpaid), "hold": hold_line, "pay_by": num_date(pay_by), "as_of": num_date(as_of)}
    if kind == "firm":
        v["promise"] = (t["promise"].format(date=num_date(broken_promise["due_date"]),
                                            amt=rupees(broken_promise["amount"])) if broken_promise else "")
        v["interest"] = (t["interest"].format(date=num_date(as_of), amt=rupees(interest))
                         if eligible and interest > 0 else "")
        v["tax"] = t["tax"] if eligible else ""
        v["amount"] = rupees(total if eligible else unpaid)
    elif kind == "demand":
        v["lines"] = "\n".join(
            t["line"].format(num=i["number"], part=t["part"] if i["status"] == "partly_disputed" else "",
                             due=num_date(i["due"]["last_day_to_pay"]),
                             amt=rupees(i["interest"]["total_outstanding"]))
            for i in invoices if i["status"] in ("computed", "partly_disputed") and i.get("interest"))
        v["total"] = rupees(total)
        v["interest_amt"] = rupees(interest)
    return t[kind].format(**v)
