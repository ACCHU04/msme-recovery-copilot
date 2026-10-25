from fastapi.testclient import TestClient
from app.main import app

client = TestClient(app)


def test_get_buyer_invoices():
    r = client.get("/api/buyer/invoices")
    assert r.status_code == 200
    invoices = r.json()
    assert len(invoices) >= 3
    numbers = {inv["number"] for inv in invoices}
    assert "INV-114" in numbers
    assert "INV-131" in numbers
    assert "INV-APC-041" in numbers
    # Each row includes supplier info and overdue/interest metrics
    inv114 = next(i for i in invoices if i["number"] == "INV-114")
    assert inv114["supplier_name"] == "Sri Lakshmi Packaging"
    assert "estimated_interest" in inv114
    assert "statutory_total" in inv114
    assert "days_overdue" in inv114
    assert inv114["status"] == "overdue"


def test_list_advisers():
    r = client.get("/api/advisers")
    assert r.status_code == 200
    advs = r.json()
    assert len(advs) >= 1
    assert any(a["full_name"] == "Meera Raghavan, CA" for a in advs)


def test_adviser_cases():
    r = client.get("/api/adviser/cases")
    assert r.status_code == 200
    cases = r.json()
    assert len(cases) == 4
    # Shows amounts, next action, eligibility
    case_ids = {c["case_id"] for c in cases}
    assert "33333333-3333-3333-3333-333333333333" in case_ids
    assert "82000000-0000-4000-8000-000000000003" in case_ids
    psu = next(c for c in cases if c["case_id"] == "82000000-0000-4000-8000-000000000003")
    assert psu["total_outstanding"] == "337612.93"
    assert psu["buyer_name"] == "Bharat Heavy Electricals Auxiliaries Ltd"


def test_case_shares_crud():
    cid = "33333333-3333-3333-3333-333333333333"
    # List shares
    r = client.get(f"/api/cases/{cid}/shares")
    assert r.status_code == 200
    shares = r.json()
    assert len(shares) >= 1
    share_id = shares[0]["id"]

    # Delete share
    r = client.delete(f"/api/cases/{cid}/shares/{share_id}")
    assert r.status_code == 200
    assert r.json() == {"deleted": share_id}

    # Add share back
    r = client.post(f"/api/cases/{cid}/shares", json={"adviser_id": "88888888-8888-8888-8888-888888888888"})
    assert r.status_code in (200, 201)
