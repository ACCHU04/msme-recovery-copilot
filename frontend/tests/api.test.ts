import { afterEach, describe, expect, it, vi } from "vitest";

process.env.NEXT_PUBLIC_API_BASE_URL = "http://api.test";
process.env.NEXT_PUBLIC_DEMO_BUSINESS_ID = "11111111-1111-1111-1111-111111111111";
const { api, ApiError, setAuthToken } = await import("@/lib/api");

function mockFetch(status: number, body: unknown) {
  const fn = vi.fn().mockResolvedValue(new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } }));
  vi.stubGlobal("fetch", fn);
  return fn;
}

afterEach(() => {
  vi.unstubAllGlobals();
  setAuthToken(null);
});

describe("api client", () => {
  it("calls the configured base URL with the demo business header", async () => {
    const fn = mockFetch(200, []);
    await api.listCases();
    const [url, init] = fn.mock.calls[0];
    expect(url).toBe("http://api.test/api/cases");
    expect(init.headers["X-Business-Id"]).toBe("11111111-1111-1111-1111-111111111111");
    expect(init.headers.Authorization).toBeUndefined();
  });

  it("sends a bearer token instead of the demo header once logged in", async () => {
    const fn = mockFetch(200, []);
    setAuthToken("tok");
    await api.listCases();
    const init = fn.mock.calls[0][1];
    expect(init.headers.Authorization).toBe("Bearer tok");
    expect(init.headers["X-Business-Id"]).toBeUndefined();
  });

  it("returns the server's 422 message and field", async () => {
    mockFetch(422, { field: "invoice_date", message: "invoice_date cannot be in the future" });
    const err = await api.addInvoice("c", {}).catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(422);
    expect(err.field).toBe("invoice_date");
    expect(err.message).toMatch(/future/);
  });

  it("uses the detail text for 404 and 409", async () => {
    mockFetch(409, { detail: "Run evaluate first so the draft uses current figures." });
    await expect(api.createDraft("c", "nudge")).rejects.toThrow(/Run evaluate first/);
  });

  it("hides raw server errors behind a readable message", async () => {
    mockFetch(500, { detail: "Traceback: KeyError" });
    await expect(api.listCases()).rejects.toThrow("Something went wrong on the server. Try again.");
  });

  it("explains when the server can't be reached", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("fetch failed")));
    const err = await api.health().catch((e) => e);
    expect(err.status).toBe(0);
    expect(err.message).toMatch(/backend is running/);
  });

  it("sends JSON bodies for evaluate with an as-of date", async () => {
    const fn = mockFetch(200, {});
    await api.evaluate("c1", "2026-10-25");
    const [url, init] = fn.mock.calls[0];
    expect(url).toBe("http://api.test/api/cases/c1/evaluate");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toEqual({ as_of: "2026-10-25" });
  });
});
