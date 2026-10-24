"use client";

import { Plus } from "lucide-react";
import Link from "next/link";
import { RecentCasesTable } from "@/components/dashboard";
import { Card, ErrorState, EstimateNote, LoadingState } from "@/components/ui";
import { api } from "@/lib/api";
import { useAsync } from "@/lib/useAsync";

export default function CasesPage() {
  const { data, error, loading, reload } = useAsync(() => api.listCases(), []);
  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div><h1 className="text-3xl font-bold">Recovery cases</h1><p className="mt-1 text-slate-600">One case per buyer and order: what is owed, the legal position and the next step.</p></div>
        <Link href="/cases/new" className="inline-flex items-center gap-2 rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700">
          <Plus size={16} aria-hidden /> Add case
        </Link>
      </div>
      {loading && <LoadingState label="Loading cases" />}
      {error && <ErrorState message={error} onRetry={reload} />}
      {data && <Card><RecentCasesTable cases={data} /></Card>}
      <EstimateNote />
    </div>
  );
}
