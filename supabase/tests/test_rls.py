"""Row level security and role rules for migration 003, run against a real Postgres.

    TEST_DATABASE_URL=postgresql://postgres@127.0.0.1:54329/postgres python -m pytest supabase/tests -q

Creates a throwaway database, applies supabase_stub.sql then migrations 001-003, and acts
as signed-in users the way PostgREST does (SET ROLE authenticated + request.jwt.claims).
Skipped when TEST_DATABASE_URL is not set.
"""
from __future__ import annotations

import json
import os
import uuid
from pathlib import Path

import pytest

psycopg = pytest.importorskip("psycopg")
from psycopg import errors  # noqa: E402

ADMIN_URL = os.getenv("TEST_DATABASE_URL")
pytestmark = pytest.mark.skipif(not ADMIN_URL, reason="TEST_DATABASE_URL not set")

ROOT = Path(__file__).resolve().parents[1]
DB = "ls03_rls_test"


@pytest.fixture(scope="module")
def url():
    with psycopg.connect(ADMIN_URL, autocommit=True) as c:
        c.execute(f"drop database if exists {DB} with (force)")
        c.execute(f"create database {DB} encoding 'UTF8' template template0")
    test_url = ADMIN_URL.rsplit("/", 1)[0] + "/" + DB
    with psycopg.connect(test_url, autocommit=True) as c:
        for f in ["tests/supabase_stub.sql", "migrations/001_init.sql",
                  "migrations/002_copilot.sql", "migrations/003_auth_roles.sql",
                  "migrations/004_profile_notes_milestones.sql",
                  "migrations/005_buyer_links_case_shares.sql",
                  "migrations/006_indexes_and_constraints.sql", "seed.sql"]:
            c.execute((ROOT / f).read_text())
    yield test_url
    with psycopg.connect(ADMIN_URL, autocommit=True) as c:
        c.execute(f"drop database if exists {DB} with (force)")


def signup(url, requested_role, **meta):
    """What Supabase Auth does on sign-up: insert into auth.users with the form's metadata."""
    uid = uuid.uuid4()
    meta = {"full_name": "Test User", "requested_role": requested_role, **meta}
    with psycopg.connect(url, autocommit=True) as c:
        c.execute("insert into auth.users (id, email, raw_user_meta_data) values (%s, %s, %s)",
                  (uid, f"{uid.hex[:8]}@example.com", json.dumps(meta)))
    return str(uid)


def as_user(url, uid):
    """A connection that behaves like a PostgREST request from this signed-in user."""
    c = psycopg.connect(url)
    c.execute("set role authenticated")
    c.execute("select set_config('request.jwt.claims', %s, false)",
              (json.dumps({"sub": uid, "role": "authenticated"}),))
    return c


def as_anon(url):
    c = psycopg.connect(url)
    c.execute("set role anon")
    return c


def profile(url, uid):
    with psycopg.connect(url) as c:
        return c.execute("select role, approval_status, requested_role, mobile_number, udyam_number "
                         "from profiles where id = %s", (uid,)).fetchone()


def make_admin(url, uid):
    """The documented bootstrap: the project owner runs this in the SQL editor."""
    with psycopg.connect(url, autocommit=True) as c:
        c.execute("update profiles set role = 'admin', approval_status = 'approved' where id = %s", (uid,))


# ------------------------------------------------------------------ sign-up mapping

def test_supplier_and_buyer_are_approved(url):
    assert profile(url, signup(url, "supplier"))[:2] == ("supplier", "approved")
    assert profile(url, signup(url, "buyer"))[:2] == ("buyer", "approved")


def test_adviser_starts_pending(url):
    assert profile(url, signup(url, "adviser", professional_role="CA"))[:2] == ("adviser", "pending")


@pytest.mark.parametrize("asked", ["admin", "ADMIN", "superuser", ""])
def test_cannot_register_as_admin_or_unknown_role(url, asked):
    role, status, requested, *_ = profile(url, signup(url, asked))
    assert (role, status, requested) == ("supplier", "approved", "supplier")


def test_bad_optional_fields_are_dropped_not_fatal(url):
    uid = signup(url, "supplier", mobile_number="12345", udyam_number="nope")
    assert profile(url, uid)[3:] == (None, None)
    uid = signup(url, "supplier", mobile_number="+919876543210", udyam_number="udyam-ka-01-1234567")
    assert profile(url, uid)[3:] == ("+919876543210", "UDYAM-KA-01-1234567")


# ------------------------------------------------------------------ reading

def test_users_see_only_their_own_profile(url):
    a, b = signup(url, "supplier"), signup(url, "buyer")
    with as_user(url, a) as c:
        rows = c.execute("select id from profiles").fetchall()
    assert [str(r[0]) for r in rows] == [a]
    with as_user(url, b) as c:
        assert c.execute("select count(*) from profiles where id = %s", (a,)).fetchone()[0] == 0


def test_anon_cannot_read_profiles(url):
    signup(url, "supplier")
    with as_anon(url) as c, pytest.raises(errors.InsufficientPrivilege):
        c.execute("select * from profiles")


# ------------------------------------------------------------------ writing

def test_user_can_edit_own_contact_fields(url):
    a = signup(url, "supplier")
    with as_user(url, a) as c:
        c.execute("update profiles set full_name = 'New Name', business_name = 'X' where id = %s", (a,))
        c.commit()
    with psycopg.connect(url) as c:
        assert c.execute("select full_name from profiles where id = %s", (a,)).fetchone()[0] == "New Name"


@pytest.mark.parametrize("column,value", [
    ("role", "admin"), ("approval_status", "approved"), ("requested_role", "adviser"),
    ("email", "x@evil.test"), ("id", str(uuid.uuid4())),
])
def test_user_cannot_change_privileged_columns(url, column, value):
    a = signup(url, "adviser", professional_role="CA")
    with as_user(url, a) as c, pytest.raises(errors.InsufficientPrivilege):
        c.execute(f"update profiles set {column} = %s where id = %s", (value, a))
    assert profile(url, a)[:2] == ("adviser", "pending")


def test_guard_trigger_holds_even_if_grants_are_widened(url):
    """If someone later grants UPDATE on every column by mistake, the trigger still refuses."""
    a = signup(url, "buyer")
    with psycopg.connect(url) as c:
        c.execute("grant update on profiles to authenticated")
        c.execute("set role authenticated")
        c.execute("select set_config('request.jwt.claims', %s, true)", (json.dumps({"sub": a}),))
        with pytest.raises(errors.InsufficientPrivilege, match="administrator"):
            c.execute("update profiles set role = 'admin' where id = %s", (a,))
        c.rollback()   # also rolls back the grant
    assert profile(url, a)[0] == "buyer"


def test_user_cannot_edit_someone_else(url):
    a, b = signup(url, "supplier"), signup(url, "supplier")
    with as_user(url, a) as c:
        cur = c.execute("update profiles set full_name = 'Hacked' where id = %s", (b,))
        assert cur.rowcount == 0
        c.commit()


def test_user_cannot_insert_or_delete_profiles(url):
    a = signup(url, "supplier")
    with as_user(url, a) as c, pytest.raises(errors.InsufficientPrivilege):
        c.execute("insert into profiles (id, email, full_name, role, approval_status, requested_role) "
                  "values (%s, 'x@y.z', 'Fake', 'admin', 'approved', 'supplier')", (str(uuid.uuid4()),))
    with as_user(url, a) as c, pytest.raises(errors.InsufficientPrivilege):
        c.execute("delete from profiles where id = %s", (a,))


# ------------------------------------------------------------------ adviser approval

@pytest.mark.parametrize("caller_role", ["supplier", "buyer", "adviser"])
def test_only_admin_can_review_advisers(url, caller_role):
    target = signup(url, "adviser", professional_role="Lawyer")
    caller = signup(url, caller_role, professional_role="CA")
    with as_user(url, caller) as c, pytest.raises(errors.InsufficientPrivilege):
        c.execute("select review_adviser(%s, 'approved')", (target,))
    assert profile(url, target)[1] == "pending"


def test_admin_approves_adviser_with_audit_row(url):
    admin, target = signup(url, "supplier"), signup(url, "adviser", professional_role="CA")
    make_admin(url, admin)
    with as_user(url, admin) as c:
        assert c.execute("select count(*) from profiles").fetchone()[0] > 2   # admin sees all
        c.execute("select review_adviser(%s, 'approved', 'Checked ICAI number')", (target,))
        c.commit()
    assert profile(url, target)[:2] == ("adviser", "approved")
    with as_user(url, target) as c:
        assert c.execute("select decision, note from adviser_reviews").fetchall() == [
            ("approved", "Checked ICAI number")]
        assert c.execute("select app_role()").fetchone()[0] == "adviser"


def test_admin_cannot_use_review_to_promote_non_advisers(url):
    admin, buyer = signup(url, "supplier"), signup(url, "buyer")
    make_admin(url, admin)
    with as_user(url, admin) as c, pytest.raises(errors.NoDataFound):
        c.execute("select review_adviser(%s, 'approved')", (buyer,))


def test_pending_adviser_has_no_effective_role(url):
    a = signup(url, "adviser", professional_role="CA")
    with as_user(url, a) as c:
        assert c.execute("select app_role(), is_admin()").fetchone() == (None, False)


def test_users_cannot_write_review_log_directly(url):
    a = signup(url, "adviser", professional_role="CA")
    with as_user(url, a) as c, pytest.raises(errors.InsufficientPrivilege):
        c.execute("insert into adviser_reviews (adviser_id, decided_by, decision) values (%s, %s, 'approved')", (a, a))


# ------------------------------------------------------------------ business data

def test_only_approved_suppliers_can_create_a_business(url):
    supplier, buyer = signup(url, "supplier"), signup(url, "buyer")
    with as_user(url, supplier) as c:
        c.execute("insert into businesses (owner_id, name) values (%s, 'Mine')", (supplier,))
        c.commit()
    with as_user(url, buyer) as c, pytest.raises(errors.InsufficientPrivilege):
        c.execute("insert into businesses (owner_id, name) values (%s, 'Not allowed')", (buyer,))


def test_users_cannot_see_other_businesses(url):
    a, b = signup(url, "supplier"), signup(url, "supplier")
    with as_user(url, a) as c:
        c.execute("insert into businesses (owner_id, name) values (%s, 'A Ltd')", (a,))
        c.commit()
    with as_user(url, b) as c:
        assert c.execute("select count(*) from businesses where owner_id = %s", (a,)).fetchone()[0] == 0


# ------------------------------------------------------------------ 004: milestones and notes

def _supplier_with_case(url):
    """A supplier who owns a business with one case and one invoice."""
    uid = signup(url, "supplier")
    with as_user(url, uid) as c:
        b = c.execute("insert into businesses (owner_id, name) values (%s, 'Mine') returning id", (uid,)).fetchone()[0]
        buyer = c.execute("insert into buyers (business_id, name) values (%s, 'B') returning id", (b,)).fetchone()[0]
        case = c.execute("insert into cases (business_id, buyer_id) values (%s, %s) returning id", (b, buyer)).fetchone()[0]
        inv = c.execute("insert into invoices (case_id, number, invoice_date, amount) values (%s, 'I-1', '2026-09-01', 100) "
                        "returning id", (case,)).fetchone()[0]
        c.commit()
    return uid, case, inv


def test_owner_manages_milestones_and_notes(url):
    uid, case, inv = _supplier_with_case(url)
    with as_user(url, uid) as c:
        c.execute("insert into milestones (case_id, title, due_date, amount, invoice_id) values (%s, 'M1', '2026-11-01', 50, %s)", (case, inv))
        c.execute("insert into invoice_notes (invoice_id, body) values (%s, 'Called')", (inv,))
        c.commit()
        assert c.execute("select count(*) from milestones").fetchone()[0] == 1
        assert c.execute("select count(*) from invoice_notes").fetchone()[0] == 1


def test_others_cannot_see_or_add_milestones_and_notes(url):
    uid, case, inv = _supplier_with_case(url)
    other = signup(url, "supplier")
    with as_user(url, uid) as c:
        c.execute("insert into invoice_notes (invoice_id, body) values (%s, 'Private')", (inv,))
        c.commit()
    with as_user(url, other) as c:
        assert c.execute("select count(*) from invoice_notes where invoice_id = %s", (inv,)).fetchone()[0] == 0
        with pytest.raises(errors.InsufficientPrivilege):
            c.execute("insert into milestones (case_id, title, due_date, amount) values (%s, 'X', '2026-11-01', 1)", (case,))


def test_seeded_demo_milestones_match_the_po(url):
    with psycopg.connect(url) as c:
        total, po = c.execute("select sum(m.amount), max(cs.po_amount) from milestones m join cases cs on cs.id = m.case_id "
                              "where m.case_id = '33333333-3333-3333-3333-333333333333'").fetchone()
    assert total == po == 275000


def _approve(url, uid):
    with psycopg.connect(url, autocommit=True) as c:
        c.execute("update profiles set approval_status = 'approved' where id = %s", (uid,))


def test_case_sharing_with_advisers(url):
    uid, case, _ = _supplier_with_case(url)
    adviser = signup(url, "adviser")
    pending = signup(url, "adviser")
    stranger = signup(url, "supplier")
    _approve(url, adviser)
    with as_user(url, uid) as c:   # pending advisers cannot be shared with
        with pytest.raises(errors.InsufficientPrivilege):
            c.execute("insert into case_shares (case_id, adviser_id) values (%s, %s)", (case, pending))
    with as_user(url, uid) as c:
        c.execute("insert into case_shares (case_id, adviser_id) values (%s, %s)", (case, adviser))
        c.commit()
    with as_user(url, adviser) as c:
        assert c.execute("select count(*) from case_shares where case_id = %s", (case,)).fetchone()[0] == 1
        with pytest.raises(errors.InsufficientPrivilege):   # an adviser cannot share cases
            c.execute("insert into case_shares (case_id, adviser_id) values (%s, %s)", (case, adviser))
    with as_user(url, stranger) as c:
        assert c.execute("select count(*) from case_shares").fetchone()[0] == 0
        with pytest.raises(errors.InsufficientPrivilege):
            c.execute("insert into case_shares (case_id, adviser_id) values (%s, %s)", (case, adviser))


def test_duplicate_invoice_number_refused_by_database(url):
    with psycopg.connect(url) as c:
        with pytest.raises(errors.UniqueViolation):
            c.execute("insert into invoices (case_id, number, invoice_date, amount) values "
                      "('33333333-3333-3333-3333-333333333333', 'INV-114', '2026-03-08', 1)")
