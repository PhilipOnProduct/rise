"use client";

// ── SuggestButton ─────────────────────────────────────────────────────────────

export function SuggestButton({ onClick, loading, label }: { onClick: () => void; loading: boolean; label: string }) {
  return (
    <button
      onClick={onClick}
      disabled={loading}
      className="text-xs font-semibold text-[#1a6b7f] hover:text-[#155a6b] transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1.5"
    >
      {loading ? (
        <>
          <span className="w-3 h-3 rounded-full border-2 border-[#1a6b7f] border-t-transparent animate-spin" />
          <span>Finding a suggestion...</span>
        </>
      ) : (
        <span>{label}</span>
      )}
    </button>
  );
}
