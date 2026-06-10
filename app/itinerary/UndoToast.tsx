"use client";

import { useEffect, useState } from "react";
import { UNDO_TIMEOUT_MS } from "./itinerary-constants";

// ── UndoToast ─────────────────────────────────────────────────────────────────

export function UndoToast({ activityName, onUndo, onDismiss }: { activityName: string; onUndo: () => void; onDismiss: () => void }) {
  const [progress, setProgress] = useState(100);

  useEffect(() => {
    const start = Date.now();
    const interval = setInterval(() => {
      const elapsed = Date.now() - start;
      const pct = Math.max(0, 100 - (elapsed / UNDO_TIMEOUT_MS) * 100);
      setProgress(pct);
      if (pct <= 0) clearInterval(interval);
    }, 50);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 bg-[#0e2a47] text-white rounded-2xl shadow-lg px-5 py-3 flex items-center gap-3 min-w-[280px] max-w-[400px] animate-[fadeSlideUp_0.2s_ease-out]">
      <span className="text-sm flex-1 truncate">Removed &ldquo;{activityName}&rdquo;</span>
      <button
        onClick={onUndo}
        className="text-sm font-bold text-[#5ec4d4] hover:text-white transition-colors flex-shrink-0"
      >
        Undo
      </button>
      <button
        onClick={onDismiss}
        className="text-white/50 hover:text-white transition-colors text-xs flex-shrink-0"
        aria-label="Dismiss"
      >
        ×
      </button>
      {/* Progress bar */}
      <div className="absolute bottom-0 left-0 right-0 h-0.5 rounded-b-2xl overflow-hidden">
        <div
          className="h-full bg-[#5ec4d4] transition-none"
          style={{ width: `${progress}%` }}
        />
      </div>
    </div>
  );
}
