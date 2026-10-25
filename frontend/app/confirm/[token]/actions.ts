"use server";

// The buyer's answer goes straight from this server to the backend: no account, no browser
// access to the API. The token travels only between the buyer's browser and this server.
import { redirect } from "next/navigation";

const BACKEND = (process.env.BACKEND_URL ?? process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://127.0.0.1:8000").replace(/\/$/, "");

export async function answerConfirmation(token: string, fd: FormData) {
  const response = fd.get("response") === "issue" ? "issue" : "received_ok";
  const name = String(fd.get("name") ?? "").trim().slice(0, 100);
  const note = String(fd.get("note") ?? "").trim().slice(0, 1000);
  const base = `/confirm/${encodeURIComponent(token)}`;
  let status = "done";
  let message = "";
  try {
    const r = await fetch(`${BACKEND}/api/public/confirm/${encodeURIComponent(token)}`, {
      method: "POST", headers: { "Content-Type": "application/json" }, cache: "no-store",
      body: JSON.stringify({ response, name, note: note || null }),
      signal: AbortSignal.timeout(15000),
    });
    if (!r.ok) {
      status = "error";
      const data = await r.json().catch(() => null);
      message = typeof data?.detail === "string" ? data.detail
        : typeof data?.message === "string" ? data.message : "Something went wrong. Please try again.";
    }
  } catch {
    status = "error";
    message = "We couldn't reach the server. Please try again in a minute.";
  }
  redirect(`${base}?${new URLSearchParams(status === "done" ? { done: response } : { error: message })}`);
}
