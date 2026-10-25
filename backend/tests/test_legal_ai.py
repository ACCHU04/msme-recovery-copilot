"""AI legal Q&A: the model's answer is only shown if it passes every check."""
import json

import httpx
import pytest
from fastapi.testclient import TestClient

from app.config import get_settings
from app.legal_ai import GeminiClient, RateLimiter, ask, check_answer
from app.main import create_app
from app.store import MemoryStore


def reply(obj) -> str:
    return json.dumps(obj)


GOOD = {"in_scope": True, "citations": ["s15", "s2b"],
        "answer": "If nothing was agreed in writing, the buyer must pay within 15 days of accepting the goods. "
                  "An agreed period can never be more than 45 days (Section 15)."}


# ------------------------------------------------------------------ checks

def test_good_answer_passes_with_citation_labels():
    r = check_answer(reply(GOOD), "When must the buyer pay?")
    assert r.source == "ai"
    assert [c["id"] for c in r.citations] == ["s15", "s2b"]
    assert r.citations[0]["label"] == "MSMED Act s.15"


@pytest.mark.parametrize("bad,reason", [
    ({**GOOD, "citations": ["s15", "s99"]}, "unknown citation"),
    ({**GOOD, "citations": []}, "no citations"),
    ({**GOOD, "answer": "Under Section 21 the buyer pays in 15 days."}, "unknown section"),
    ({**GOOD, "answer": "The buyer must pay within 30 days."}, "numbers not in sources"),
    ({**GOOD, "answer": "Interest is 18% a year."}, "numbers not in sources"),
    ({**GOOD, "answer": "You are owed Rs 2,46,072 plus interest."}, "numbers not in sources"),
    ({**GOOD, "answer": "x" * 1600}, "too long"),
    ({"answer": "hi", "citations": ["s15"]}, "bad fields"),
])
def test_bad_answers_are_rejected(bad, reason):
    r = check_answer(reply(bad), "When must the buyer pay?")
    assert r.source == "unavailable" and reason in r.reason


def test_not_json_is_rejected_and_code_fences_are_tolerated():
    assert check_answer("Sure! The buyer pays in 15 days.", "q").source == "unavailable"
    assert check_answer("```json\n" + reply(GOOD) + "\n```", "q").source == "ai"


def test_out_of_scope():
    assert check_answer(reply({"in_scope": False, "answer": "", "citations": []}), "best biryani?").source == "out_of_scope"


def test_numbers_from_the_question_are_allowed():
    ans = {**GOOD, "answer": "A 90-day term does not extend the 45-day limit (Section 15)."}
    assert check_answer(reply(ans), "My contract says 90 days?").source == "ai"


def test_rates_allowed_only_when_rates_entry_cited():
    ans = {"in_scope": True, "citations": ["s16"], "answer": "The rate is 17.25% a year."}
    assert check_answer(reply(ans), "rate?").source == "unavailable"
    ans["citations"] = ["s16", "rates"]
    assert check_answer(reply(ans), "rate?").source == "ai"


def test_tax_rule_sections_are_known():
    ans = {"in_scope": True, "citations": ["it43bh"],
           "answer": "Under Section 43B(h), now Section 37(2)(g) of the 2025 Act, the buyer deducts only when it pays."}
    assert check_answer(reply(ans), "tax?").source == "ai"


# ------------------------------------------------------------------ client

def gemini_transport(payload: str | None = None, status: int = 200, seen: list | None = None):
    def handler(req: httpx.Request) -> httpx.Response:
        if seen is not None:
            seen.append(req)
        if status != 200:
            return httpx.Response(status, json={"error": {"message": "quota"}})
        return httpx.Response(200, json={"candidates": [{"content": {"parts": [{"text": payload}]}}]})
    return httpx.MockTransport(handler)


def test_client_sends_only_the_question_with_key_header():
    seen = []
    c = GeminiClient("test-key", "gemini-3.8-flash", transport=gemini_transport(reply(GOOD), seen=seen))
    r = ask(c, "When must the buyer pay?")
    assert r.source == "ai" and r.model == "gemini-3.8-flash"
    req = seen[0]
    assert req.headers["x-goog-api-key"] == "test-key" and "key=" not in str(req.url)
    assert "models/gemini-3.8-flash:generateContent" in str(req.url)
    body = json.loads(req.content)
    assert body["contents"] == [{"role": "user", "parts": [{"text": "When must the buyer pay?"}]}]
    assert body["generationConfig"]["responseMimeType"] == "application/json"
    assert "SOURCES" in body["systemInstruction"]["parts"][0]["text"]


@pytest.mark.parametrize("transport", [gemini_transport(status=429), gemini_transport(status=500),
                                       gemini_transport("not json at all")])
def test_failures_become_unavailable(transport):
    assert ask(GeminiClient("k", "m", transport=transport), "q?").source == "unavailable"


def test_no_key_means_unavailable():
    assert ask(None, "q?").source == "unavailable"


def test_rate_limiter():
    rl = RateLimiter(per_minute=2, per_day=3)
    assert rl.allow("u", 0) and rl.allow("u", 1) and not rl.allow("u", 2)
    assert rl.allow("u", 120) and not rl.allow("u", 240)       # per-day cap reached
    assert rl.allow("other", 0)


# ------------------------------------------------------------------ endpoint

@pytest.fixture
def api():
    app = create_app(get_settings(), MemoryStore(seed=True))
    return TestClient(app)


def test_endpoint_without_key_tells_frontend_to_fall_back(api):
    assert api.get("/api/legal/status").json() == {"ai_enabled": False, "model": None}
    r = api.post("/api/legal/ask", json={"question": "When must the buyer pay?"})
    assert r.status_code == 200 and r.json()["source"] == "unavailable"


def test_endpoint_returns_checked_ai_answer(api):
    api.app.state.llm = GeminiClient("k", "gemini-3.8-flash", transport=gemini_transport(reply(GOOD)))
    j = api.post("/api/legal/ask", json={"question": "  When must   the buyer pay?  "}).json()
    assert j["source"] == "ai" and j["model"] == "gemini-3.8-flash" and len(j["citations"]) == 2


def test_endpoint_hides_unchecked_answer(api):
    bad = reply({**GOOD, "answer": "Pay within 60 days under Section 99."})
    api.app.state.llm = GeminiClient("k", "m", transport=gemini_transport(bad))
    j = api.post("/api/legal/ask", json={"question": "When?"}).json()
    assert j == {"source": "unavailable", "answer": "", "citations": [], "model": None}


@pytest.mark.parametrize("q", ["", "  ", "x" * 501])
def test_question_validation(api, q):
    assert api.post("/api/legal/ask", json={"question": q}).status_code == 422


def test_endpoint_rate_limited(api):
    api.app.state.llm_limiter = RateLimiter(per_minute=1)
    assert api.post("/api/legal/ask", json={"question": "When must I be paid?"}).status_code == 200
    assert api.post("/api/legal/ask", json={"question": "When must I be paid?"}).status_code == 429
