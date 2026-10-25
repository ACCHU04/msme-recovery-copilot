"use client";

import { Share2, Trash2, UserCheck, ShieldCheck } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Button, Card } from "@/components/ui";
import { api } from "@/lib/api";
import type { AdviserProfile, CaseShare } from "@/types/api";

export function ShareWithAdviserCard({ caseId }: { caseId: string }) {
  const [shares, setShares] = useState<CaseShare[]>([]);
  const [advisers, setAdvisers] = useState<AdviserProfile[]>([]);
  const [selectedAdviser, setSelectedAdviser] = useState("");
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const [sh, adv] = await Promise.all([
        api.getCaseShares(caseId),
        api.getAdvisers(),
      ]);
      setShares(sh);
      setAdvisers(adv);
      if (adv.length > 0 && !selectedAdviser) {
        setSelectedAdviser(adv[0].id);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load advisers");
    } finally {
      setLoading(false);
    }
  }, [caseId, selectedAdviser]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleShare = async () => {
    if (!selectedAdviser) return;
    try {
      setSubmitting(true);
      await api.addCaseShare(caseId, selectedAdviser);
      await loadData();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to share case");
    } finally {
      setSubmitting(false);
    }
  };

  const handleUnshare = async (shareId: string) => {
    try {
      setSubmitting(true);
      setError(null);
      setShares((prev) => prev.filter((s) => s.id !== shareId));
      await api.deleteCaseShare(caseId, shareId);
      await loadData();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to remove share");
      await loadData();
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Card title="Share with an adviser">
      <div className="space-y-4">
        <p className="text-xs text-slate-600">
          Share this case with an approved CA or legal professional for independent review and Facilitation Council readiness.
        </p>

        {loading ? (
          <p className="text-xs text-slate-500">Loading advisers...</p>
        ) : error ? (
          <p className="text-xs text-red-600">{error}</p>
        ) : (
          <>
            {shares.length > 0 ? (
              <div className="space-y-2">
                <p className="text-xs font-semibold text-slate-700">Currently shared with:</p>
                <div className="space-y-1.5">
                  {shares.map((s) => (
                    <div
                      key={s.id}
                      className="flex items-center justify-between rounded-lg border border-slate-200 bg-slate-50 p-2.5 text-xs"
                    >
                      <div className="flex items-center gap-2">
                        <UserCheck size={16} className="text-emerald-600 shrink-0" aria-hidden />
                        <div>
                          <p className="font-medium text-slate-900">{s.adviser_name}</p>
                          <p className="text-slate-500">{s.adviser_email}</p>
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => handleUnshare(s.id)}
                        disabled={submitting}
                        title="Remove share"
                        className="rounded p-1 text-slate-400 hover:bg-slate-200 hover:text-red-600"
                      >
                        <Trash2 size={14} aria-hidden />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <p className="text-xs text-slate-500">Not shared with any adviser yet.</p>
            )}

            {advisers.length > 0 && (
              <div className="pt-2 border-t border-slate-100 space-y-2">
                <label htmlFor="adviser-select" className="text-xs font-medium text-slate-700 block">
                  Select approved adviser:
                </label>
                <div className="flex gap-2">
                  <select
                    id="adviser-select"
                    value={selectedAdviser}
                    onChange={(e) => setSelectedAdviser(e.target.value)}
                    className="flex-1 rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs"
                  >
                    {advisers.map((adv) => (
                      <option key={adv.id} value={adv.id}>
                        {adv.full_name} ({adv.qualifications})
                      </option>
                    ))}
                  </select>
                  <Button
                    onClick={handleShare}
                    disabled={submitting || !selectedAdviser}
                    className="text-xs py-1.5 px-3"
                  >
                    <Share2 size={14} className="mr-1 inline" aria-hidden /> Share
                  </Button>
                </div>
                <p className="flex items-center gap-1 text-[11px] text-slate-500">
                  <ShieldCheck size={12} className="text-emerald-600" aria-hidden /> Read-only access to case records and calculations.
                </p>
              </div>
            )}
          </>
        )}
      </div>
    </Card>
  );
}
