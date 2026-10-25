"use client";

import { useEffect } from "react";
import { AlertOctagon, RefreshCw } from "lucide-react";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[Settle45 Global Error]", error);
  }, [error]);

  return (
    <html lang="en">
      <body className="bg-slate-50 min-h-screen flex items-center justify-center p-6 font-sans antialiased text-slate-900">
        <div className="max-w-md w-full bg-white rounded-2xl shadow-sm border border-slate-200 p-8 text-center">
          <div className="w-14 h-14 bg-rose-50 text-rose-600 rounded-full flex items-center justify-center mx-auto mb-5 border border-rose-200">
            <AlertOctagon className="w-7 h-7" />
          </div>
          <h1 className="text-xl font-bold text-slate-900 mb-2">Application Error</h1>
          <p className="text-sm text-slate-600 mb-6 leading-relaxed">
            The application encountered a critical runtime error. Please reload to restore the session.
          </p>
          {error.digest && (
            <div className="mb-6 p-3 bg-slate-50 rounded-lg text-xs font-mono text-slate-500 border border-slate-200 text-left overflow-auto">
              <span className="font-semibold text-slate-700">Reference:</span> {error.digest}
            </div>
          )}
          <button
            onClick={() => reset()}
            className="inline-flex items-center justify-center gap-2 px-5 py-2.5 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors shadow-sm cursor-pointer"
          >
            <RefreshCw className="w-4 h-4" />
            Reload Application
          </button>
        </div>
      </body>
    </html>
  );
}

