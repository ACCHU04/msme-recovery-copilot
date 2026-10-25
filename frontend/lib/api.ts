import type {
  AdviserCase, AdviserProfile, BuyerInvoice, CaseShare,
  Business, CalcResult, CaseDetail, CaseSummary, Draft, DraftKind, Evaluation, EvidenceKind,
  EvidenceStatus, Followup, InvoiceDetail, InvoiceNote, InvoiceRow, DocumentCheck, LegalAnswer, Milestone, PromiseCandidate, RateRow, SettlementOption,
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

interface CacheEntry {
  data: unknown;
  expiresAt: number;
}

const CACHE_TTL_MS = 30000;
const cache = new Map<string, CacheEntry>();
const inFlight = new Map<string, Promise<unknown>>();

export function clearApiCache() {
  cache.clear();
  inFlight.clear();
}

async function request<T>(path: string, init: { method?: string; body?: unknown; timeoutMs?: number } = {}): Promise<T> {
  const method = (init.method ?? "GET").toUpperCase();
  const isGet = method === "GET";
  const cacheKey = `${authToken ?? DEMO_BUSINESS_ID}:${path}`;

  if (isGet) {
    const hit = cache.get(cacheKey);
    if (hit && hit.expiresAt > Date.now()) {
      return hit.data as T;
    }
    const pending = inFlight.get(cacheKey);
    if (pending) {
      return pending as Promise<T>;
    }
  }

  const exec = async (): Promise<T> => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), init.timeoutMs ?? TIMEOUT_MS);
    const headers: Record<string, string> = { Accept: "application/json" };
    const isForm = typeof FormData !== "undefined" && init.body instanceof FormData;
    if (init.body !== undefined && !isForm) headers["Content-Type"] = "application/json";
    if (authToken) headers.Authorization = `Bearer ${authToken}`;
    else if (DEMO_BUSINESS_ID) headers["X-Business-Id"] = DEMO_BUSINESS_ID;

    let res: Response;
    try {
      res = await fetch(`${BASE}${path}`, {
        method,
        headers,
        body: init.body === undefined ? undefined : isForm ? (init.body as FormData) : JSON.stringify(init.body),
        signal: controller.signal,
        cache: "no-store",
      });
    } catch (e) {
      const aborted = e instanceof DOMException && e.name === "AbortError";
      throw new ApiError(aborted ? 408 : 0, STATUS_MESSAGES[aborted ? 408 : 0]);
    } finally {
      clearTimeout(timer);
    }

    if (res.ok) {
      const data = (await res.json()) as T;
      if (isGet) {
        cache.set(cacheKey, { data, expiresAt: Date.now() + CACHE_TTL_MS });
      } else {
        clearApiCache();
      }
      return data;
    }

    if (!isGet) {
      clearApiCache();
    }

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
  };

  if (isGet) {
    const p = exec().finally(() => {
      inFlight.delete(cacheKey);
    });
    inFlight.set(cacheKey, p);
    return p;
  }

  return exec();
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

  listMilestones: (caseId: string) => request<Milestone[]>(`/api/cases/${caseId}/milestones`),
  addMilestone: (caseId: string, body: { title: string; due_date: string; amount: string; invoice_id?: string | null }) =>
    request<Milestone>(`/api/cases/${caseId}/milestones`, { method: "POST", body }),
  patchMilestone: (id: string, body: Partial<Pick<Milestone, "title" | "due_date" | "amount" | "invoice_id">>) =>
    request<Milestone>(`/api/milestones/${id}`, { method: "PATCH", body }),
  deleteMilestone: (id: string) => request(`/api/milestones/${id}`, { method: "DELETE" }),

  /** Read a photo/PDF with AI and compare it with the records (nothing is stored). */
  checkDocument: (file: File, opts: { invoiceId?: string; expected?: string }) => {
    const form = new FormData();
    form.append("file", file);
    if (opts.invoiceId) form.append("invoice_id", opts.invoiceId);
    if (opts.expected) form.append("expected", opts.expected);
    return request<DocumentCheck>("/api/documents/check", { method: "POST", body: form, timeoutMs: 60000 });
  },
  legalStatus: () => request<{ ai_enabled: boolean; model: string | null }>("/api/legal/status"),
  legalAsk: (question: string) => request<LegalAnswer>("/api/legal/ask", { method: "POST", body: { question }, timeoutMs: 30000 }),

  listNotes: (invoiceId: string) => request<InvoiceNote[]>(`/api/invoices/${invoiceId}/notes`),
  addNote: (invoiceId: string, body: string) => request<InvoiceNote>(`/api/invoices/${invoiceId}/notes`, { method: "POST", body: { body } }),
  deleteNote: (id: string) => request(`/api/notes/${id}`, { method: "DELETE" }),
  calculate: (body: Record<string, unknown>) =>
    request<CalcResult>("/api/calculate", { method: "POST", body }),
  rates: () => request<RateRow[]>("/api/rates"),

  getBuyerInvoices: () => request<BuyerInvoice[]>("/api/buyer/invoices"),
  getAdvisers: () => request<AdviserProfile[]>("/api/advisers"),
  getCaseShares: (caseId: string) => request<CaseShare[]>(`/api/cases/${caseId}/shares`),
  addCaseShare: (caseId: string, adviserId: string) =>
    request<CaseShare>(`/api/cases/${caseId}/shares`, { method: "POST", body: { adviser_id: adviserId } }),
  deleteCaseShare: (caseId: string, shareId: string) =>
    request<{ deleted: string }>(`/api/cases/${caseId}/shares/${shareId}`, { method: "DELETE" }),
  getAdviserCases: () => request<AdviserCase[]>("/api/adviser/cases"),

  createDraft: (caseId: string, kind: DraftKind) =>
    request<Draft>(`/api/cases/${caseId}/drafts`, { method: "POST", body: { kind } }),
};
