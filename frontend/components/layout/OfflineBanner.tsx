"use client";

import { WifiOff } from "lucide-react";
import { useEffect, useState } from "react";

/** Tells the user when the device is offline, instead of requests failing silently. */
export function OfflineBanner() {
  const [offline, setOffline] = useState(false);
  useEffect(() => {
    const update = () => setOffline(!navigator.onLine);
    update();
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => { window.removeEventListener("online", update); window.removeEventListener("offline", update); };
  }, []);
  if (!offline) return null;
  return (
    <div role="status" className="mb-4 flex items-center gap-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
      <WifiOff size={16} aria-hidden /> You are offline. Figures may be out of date, and changes won&apos;t save until you reconnect.
    </div>
  );
}
