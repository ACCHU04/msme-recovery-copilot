import type {
  Business, CalcResult, CaseDetail, CaseSummary, Draft, DraftKind, Evaluation, EvidenceKind,
  EvidenceStatus, Followup, InvoiceDetail, InvoiceRow, PromiseCandidate, RateRow, SettlementOption,
} from "@/types/api";

import { authEnabled } from "@/lib/auth/config";

// With Supabase configured, every call goes to this site's /proxy route, which adds the
// session token from the HttpOnly cookie on the server. Otherwise: the local demo backend.
const BASE = authEnabled
  ? "/proxy"
  : (process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://127.0.0.1:8000").replace(/\/$/, "");
// Local demo only (backend AUTH_MODE=demo). Never sent when Supabase sign-in is on.
const DEMO_BUSINESS_ID = authEnabled ? "" : (process.env.NEXT_PUBLIC_DEMO_BUSINESS_ID ?? "");
const TIMEOUT_MS = 15000;

let authToken: string | null = null;
/** Call with the Supabase session access token once login is wired (backend AUTH_MODE=supabase). */
export function setAuthToken(token: string | null) {
  authToken = token;
}

export class ApiError extends Error {
  constructor(public status: number, message: string, public field?: string) {
    super(message);
  }
}

const STATUS_MESSAGES: Record<number, string> = {
  0: "Can't reach the server. Check that the backend is running.",
  401: "Sign in to continue.",
  403: "You don't have access to this.",
  404: "Not found. It may belong to another account or have been removed.",
  408: "The server took too long to respond. Try again.",
  409: "That can't be done right now.",
  422: "Some details need fixing.",
  500: "Something went wrong on the server. Try again.",
};

async function request<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  const headers: Record<string, string> = { Accept: "application/json" };
  if (init.body !== undefined) headers["Content-Type"] = "application/json";
  if (authToken) headers.Authorization = `Bearer ${authToken}`;
  else if (DEMO_BUSINESS_ID) headers["X-Business-Id"] = DEMO_BUSINESS_ID;

  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, {
      method: init.method ?? "GET",
      headers,
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
      signal: controller.signal,
      cache: "no-store",
    });
  } catch (e) {
    const aborted = e instanceof DOMException && e.name === "AbortError";
    throw new ApiError(aborted ? 408 : 0, STATUS_MESSAGES[aborted ? 408 : 0]);
  } finally {
    clearTimeout(timer);
  }

  if (res.ok) return (await res.json()) as T;
  if (res.status === 401 && authEnabled && typeof window !== "undefined") {
    const next = encodeURIComponent(window.location.pathname + window.location.search);
    window.location.assign(`/login?expired=1&next=${next}`);
  }

  let message = STATUS_MESSAGES[res.status] ?? STATUS_MESSAGES[500];
  let field: string | undefined;
  try {
    const data = await res.json();
    if (typeof data?.detail === "string") message = data.detail;
    else if (typeof data?.message === "string") {
      message = data.message;
      field = data.field;
    }
  } catch {
    /* non-JSON error body: keep the generic message */
  }
  if (res.status >= 500) message = STATUS_MESSAGES[500];
  throw new ApiError(res.status, message, field);
}

export const api = {
  health: () => request<{ ok: boolean; store: string; engine_version: string }>("/api/health"),

  getBusiness: () => request<Business>("/api/businesses/me"),
  saveBusiness: (body: Partial<Business>) =>
    request<Business>("/api/businesses", { method: "POST", body }),

  listCases: () => request<CaseSummary[]>("/api/cases"),
  getCase: (id: string) => request<CaseDetail>(`/api/cases/${id}`),
  createCase: (body: { buyer: Record<string, unknown>; contract_date?: string | null }) =>
    request<CaseSummary>("/api/cases", { method: "POST", body }),
  patchCase: (id: string, body: Record<string, unknown>) =>
    request<CaseSummary>(`/api/cases/${id}`, { method: "PATCH", body }),

  addInvoice: (caseId: string, body: Record<string, unknown>) =>
    request<{ id: string }>(`/api/cases/${caseId}/invoices`, { method: "POST", body }),
  addPayment: (invoiceId: string, body: { paid_on: string; amount: string }, confirmDuplicate = false) =>
    request<{ id: string }>(
      `/api/invoices/${invoiceId}/payments${confirmDuplicate ? "?confirm_duplicate=true" : ""}`,
      { method: "POST", body },
    ),
  setEvidence: (caseId: string, kind: EvidenceKind, status: EvidenceStatus) =>
    request(`/api/cases/${caseId}/evidence/${kind}`, { method: "PUT", body: { status } }),

  evaluate: (caseId: string, asOf?: string) =>
    request<Evaluation>(`/api/cases/${caseId}/evaluate`, {
      method: "POST",
      body: asOf ? { as_of: asOf } : {},
    }),
  settlement: (caseId: string) =>
    request<{ options: SettlementOption[]; as_of: string; note: string }>(
      `/api/cases/${caseId}/settlement`),

  extractPromise: (caseId: string, text: string, saidOn?: string) =>
    request<PromiseCandidate>(`/api/cases/${caseId}/promises/extract`, {
      method: "POST",
      body: { text, ...(saidOn ? { said_on: saidOn } : {}) },
    }),
  addPromise: (caseId: string, body: { made_on: string; due_date: string; amount: string; source_text?: string }) =>
    request(`/api/cases/${caseId}/promises`, { method: "POST", body }),

  addFollowup: (caseId: string, body: { step: number; sent_on: string; reply_received?: boolean }) =>
    request<Followup>(`/api/cases/${caseId}/followups`, { method: "POST", body }),
  setFollowupReply: (id: string, reply_received: boolean) =>
    request<Followup>(`/api/followups/${id}`, { method: "PATCH", body: { reply_received } }),

  listInvoices: (asOf?: string) => request<InvoiceRow[]>(`/api/invoices${asOf ? `?as_of=${asOf}` : ""}`),
  getInvoice: (id: string) => request<InvoiceDetail>(`/api/invoices/${id}`),
  patchInvoice: (id: string, body: Record<string, unknown>) =>
    request(`/api/invoices/${id}`, { method: "PATCH", body }),
  deleteInvoice: (id: string) => request(`/api/invoices/${id}`, { method: "DELETE" }),
  deletePayment: (id: string) => request(`/api/payments/${id}`, { method: "DELETE" }),
  calculate: (body: Record<string, unknown>) =>
    request<CalcResult>("/api/calculate", { method: "POST", body }),
  rates: () => request<RateRow[]>("/api/rates"),

  createDraft: (caseId: string, kind: DraftKind) =>
    request<Draft>(`/api/cases/${caseId}/drafts`, { method: "POST", body: { kind } }),
};
