import { describe, expect, it } from "vitest";
import { describeSource, formatDate, formatINR, shortId, totalsConsistent } from "@/lib/format";

describe("formatINR", () => {
  it("uses Indian grouping and two decimals", () => {
    expect(formatINR("246072.61")).toBe("₹2,46,072.61");
    expect(formatINR("95000.00")).toBe("₹95,000.00");
    expect(formatINR(0)).toBe("₹0.00");
  });
  it("shows a dash for missing or bad values instead of a fake number", () => {
    expect(formatINR(null)).toBe("—");
    expect(formatINR("")).toBe("—");
    expect(formatINR("abc")).toBe("—");
  });
});

describe("formatDate", () => {
  it("formats ISO dates without timezone shifts", () => {
    expect(formatDate("2026-02-20")).toBe("20 Feb 2026");
    expect(formatDate("2026-10-07")).toBe("7 Oct 2026");
    expect(formatDate(null)).toBe("—");
  });
});

describe("helpers", () => {
  it("shortens ids", () => expect(shortId("33333333-3333-3333-3333-333333333333")).toBe("33333333"));
  it("describes finding sources in words", () => {
    expect(describeSource("evidence:delivery_proof")).toBe("Delivery proof");
    expect(describeSource("invoice:INV-114.amount")).toBe("INV-114 amount");
    expect(describeSource("case.po_amount")).toBe("case.po_amount");
    expect(describeSource("followup:2026-10-10")).toBe("Follow-up sent 10 Oct 2026");
  });
  it("flags totals that don't add up", () => {
    expect(totalsConsistent({ principal: "230499.54", interest: "15573.07", total: "246072.61" })).toBe(true);
    expect(totalsConsistent({ principal: "230499.54", interest: "15573.07", total: "246072.60" })).toBe(false);
  });
});
