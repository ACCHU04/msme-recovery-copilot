// End-to-end against a running backend (STORE=memory, AUTH_MODE=demo):
//   LIVE_API=http://127.0.0.1:8000 npx vitest run tests/live.test.ts
// Skipped unless LIVE_API is set.
import { describe, expect, it } from "vitest";

const LIVE = process.env.LIVE_API;
process.env.NEXT_PUBLIC_API_BASE_URL = LIVE ?? "http://unused";
process.env.NEXT_PUBLIC_DEMO_BUSINESS_ID = "11111111-1111-1111-1111-111111111111";
const { api } = await import("@/lib/api");
const CASE = "33333333-3333-3333-3333-333333333333";

describe.skipIf(!LIVE)("live user journey", () => {
  it("dashboard data: demo case listed with consistent totals", async () => {
    const cases = await api.listCases();
    const demo = cases.find((c) => c.id === CASE)!;
    expect(demo.buyer_name).toBe("Kaveri Foods Pvt Ltd");
    expect(demo.eligibility).toBe("eligible");
    const t = demo.totals!;
    expect(Math.round(Number(t.principal) * 100) + Math.round(Number(t.interest) * 100)).toBe(Math.round(Number(t.total) * 100));
  });

  it("demo story: broken promise turns a nudge into a firm reminder, draft cites it", async () => {
    let ev = await api.evaluate(CASE, "2026-10-25");
    expect(ev.totals.total).toBe("246072.61");
    const before = ev.next_action.action;
    const c = await api.extractPromise(CASE, "Sir, will pay 50k by 23/10 sure", "2026-10-20");
    expect(c.amount).toBe("50000.00");
    expect(c.due_date).toBe("2026-10-23");
    await api.addPromise(CASE, { made_on: c.made_on, due_date: c.due_date!, amount: c.amount!, source_text: c.source_text });
    ev = await api.evaluate(CASE, "2026-10-25");
    expect(before).toBe("nudge");
    expect(ev.promises.at(-1)!.status).toBe("broken");
    expect(ev.next_action.action).toBe("firm");
    const d = await api.createDraft(CASE, "firm");
    expect(d.body).toContain("Rs 50,000.00 by 23 Oct 2026");
    await api.addFollowup(CASE, { step: 2, sent_on: "2026-10-24" });
    const s = await api.settlement(CASE);
    expect(s.options).toHaveLength(3);
  });

  it("add-case flow: create, invoice, payment, evidence, evaluate", async () => {
    const c = await api.createCase({ buyer: { name: "Live Test Buyer", relationship_importance: "low" }, contract_date: "2026-06-01" });
    await api.patchCase(c.id, { po_amount: "40000", status: "active" });
    const inv = await api.addInvoice(c.id, { number: "LT-1", invoice_date: "2026-06-05", amount: "50000", delivery_date: "2026-06-06" });
    await api.addPayment(inv.id, { paid_on: "2026-07-01", amount: "10000" });
    await api.setEvidence(c.id, "delivery_proof", "have");
    const ev = await api.evaluate(c.id, "2026-10-25");
    expect(ev.findings.map((f) => f.id)).toContain("po_amount_exceeded");
    expect(ev.next_action.action).toBe("fix_mismatch");
    await expect(api.addPayment(inv.id, { paid_on: "2026-07-01", amount: "10000" })).rejects.toMatchObject({ status: 409 });
    await expect(api.addInvoice(c.id, { number: "LT-2", invoice_date: "2099-01-01", amount: "1" })).rejects.toMatchObject({ status: 422, field: "invoice_date" });
  });

  it("invoices list, invoice detail and calculator agree with the case engine", async () => {
    const rows = await api.listInvoices("2026-10-25");
    const inv = rows.find((r) => r.number === "INV-114")!;
    expect(inv.status).toBe("overdue");
    const detail = await api.getInvoice(inv.id);
    expect(detail.buyer.name).toBe("Kaveri Foods Pvt Ltd");
    const calc = await api.calculate({ amount: "180000", delivery_date: "2026-03-10", as_of: "2026-10-25",
      payments: [{ paid_on: "2026-06-01", amount: "50000" }] });
    expect(calc.interest!.total_outstanding).toBe("144734.20");
    const rates = await api.rates();
    expect(rates.at(-1)!.statutory_rate_pct).toBe("17.25");
  });
});
