"use client";

import { useState, useEffect, useRef } from "react";
import { supabase } from "@/lib/supabase";

// ── Types ──────────────────────────────────────────────────────────────────────

type TestCase = {
  id: string;
  name: string;
  feature: string;
  inputs: Record<string, unknown>;
  criteria: string[];
  created_at: string;
};

type EvalResult = {
  id: string;
  test_case_id: string;
  model: string;
  prompt_used: string | null;
  ai_output: string;
  human_score: number | null;
  human_notes: string | null;
  llm_score: number | null;
  llm_reasoning: string | null;
  created_at: string;
  // joined
  test_case_name?: string;
};

type CriterionResult = {
  criterion: string;
  pass: boolean;
  note: string;
};

type JudgeResponse = {
  score: number;
  reasoning: string;
  criteria_results: CriterionResult[];
};

// ── Helpers ────────────────────────────────────────────────────────────────────

function CustomSelect({
  value,
  onChange,
  options,
  placeholder = "Select…",
}: {
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
  placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  const selected = options.find((o) => o.value === value);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full bg-white border border-[#d4cfc5] rounded-xl px-4 py-3 text-sm text-left flex items-center justify-between gap-2 hover:border-[#b8b3a9] transition-colors"
      >
        <span className={selected ? "text-[#0e2a47]" : "text-[#9ca3af]"}>
          {selected ? selected.label : placeholder}
        </span>
        <svg className={`w-3.5 h-3.5 text-[#6a7f8f] transition-transform ${open ? "rotate-180" : ""}`} viewBox="0 0 16 16" fill="none">
          <path d="M4 6l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {open && (
        <div className="absolute z-20 top-full left-0 right-0 mt-1 bg-white border border-[#d4cfc5] rounded-xl shadow-lg overflow-hidden max-h-64 overflow-y-auto">
          {options.map((o) => (
            <button
              key={o.value}
              type="button"
              onClick={() => { onChange(o.value); setOpen(false); }}
              className={`w-full text-left px-4 py-2.5 text-sm transition-colors ${
                o.value === value
                  ? "bg-[#1a6b7f]/10 text-[#1a6b7f] font-semibold"
                  : "text-[#0e2a47] hover:bg-[#f0ede8]"
              }`}
            >
              {o.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function ScoreBadge({ score }: { score: number | null }) {
  if (score == null) return <span className="text-xs text-[#6a7f8f]">—</span>;
  const colors: Record<number, string> = {
    5: "bg-[#eaf4ee] text-[#2d7a4f]",
    4: "bg-[#e8f4f6] text-[#1a6b7f]",
    3: "bg-[#fef3e2] text-[#ba7517]",
    2: "bg-[#fde8e8] text-[#c0392b]",
    1: "bg-[#fde8e8] text-[#c0392b]",
  };
  return (
    <span className={`text-xs font-bold px-2.5 py-1 rounded-full ${colors[score] ?? "bg-[#f0ede8] text-[#6a7f8f]"}`}>
      {score}/5
    </span>
  );
}

function formatDate(d: string) {
  return new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

// ── Test Cases Tab ─────────────────────────────────────────────────────────────

function TestCasesTab() {
  const [cases, setCases] = useState<TestCase[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase
      .from("eval_test_cases")
      .select("*")
      .order("created_at", { ascending: true })
      .then(({ data }) => { setCases((data ?? []) as TestCase[]); setLoading(false); });
  }, []);

  if (loading) return <p className="text-sm text-[#6a7f8f] py-4">Loading…</p>;

  return (
    <div className="flex flex-col gap-3">
      {cases.map((tc) => (
        <div key={tc.id} className="bg-white border border-[#e8e4de] rounded-2xl p-5">
          <div className="flex items-center gap-2 mb-2">
            <span className="text-sm font-bold text-[#0e2a47]">{tc.name}</span>
            <span className="text-xs text-[#6a7f8f] bg-[#f0ede8] px-2 py-0.5 rounded-full">{tc.feature}</span>
          </div>
          <div className="flex flex-wrap gap-1.5 mb-2">
            {tc.criteria.map((c, i) => (
              <span key={i} className="text-xs bg-[#e8f4f6] text-[#1a6b7f] px-2.5 py-1 rounded-full">{c}</span>
            ))}
          </div>
          <p className="text-xs text-[#6a7f8f]">
            {tc.inputs.destination as string} · {tc.inputs.travelerCount as number} travelers
            {(tc.inputs.childrenAges as string[])?.length > 0 && ` · Children: ${(tc.inputs.childrenAges as string[]).join(", ")}`}
          </p>
        </div>
      ))}
    </div>
  );
}

// ── Run Evals Tab ──────────────────────────────────────────────────────────────

function RunEvalsTab() {
  const [cases, setCases] = useState<TestCase[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [running, setRunning] = useState(false);
  const [output, setOutput] = useState("");
  const [resultId, setResultId] = useState<string | null>(null);
  const [humanScore, setHumanScore] = useState<number | null>(null);
  const [humanNotes, setHumanNotes] = useState("");
  const [savingHuman, setSavingHuman] = useState(false);
  const [humanSaved, setHumanSaved] = useState(false);
  const [judging, setJudging] = useState(false);
  const [judgeResult, setJudgeResult] = useState<JudgeResponse | null>(null);

  useEffect(() => {
    supabase
      .from("eval_test_cases")
      .select("*")
      .order("created_at", { ascending: true })
      .then(({ data }) => { setCases((data ?? []) as TestCase[]); });
  }, []);

  const selected = cases.find((c) => c.id === selectedId) ?? null;

  async function handleRun() {
    const tc = cases.find((c) => c.id === selectedId);
    if (!tc) return;

    setOutput("");
    setResultId(null);
    setHumanScore(null);
    setHumanNotes("");
    setHumanSaved(false);
    setJudgeResult(null);
    setRunning(true);

    try {
      const res = await fetch("/api/itinerary/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(tc.inputs),
      });
      const data = await res.json();
      const outputStr = JSON.stringify(data, null, 2);
      setOutput(outputStr);

      // Save to eval_results
      const { data: row } = await supabase
        .from("eval_results")
        .insert({
          test_case_id: tc.id,
          model: "claude-sonnet-4-6",
          prompt_used: `itinerary/generate with inputs: ${JSON.stringify(tc.inputs)}`,
          ai_output: outputStr,
        })
        .select("id")
        .single();
      if (row) setResultId(row.id);
    } catch (err) {
      setOutput(`Error: ${err}`);
    }
    setRunning(false);
  }

  async function handleSaveHuman() {
    if (!resultId || humanScore == null) return;
    setSavingHuman(true);
    await supabase
      .from("eval_results")
      .update({ human_score: humanScore, human_notes: humanNotes || null })
      .eq("id", resultId);
    setSavingHuman(false);
    setHumanSaved(true);
  }

  async function handleJudge() {
    if (!selected || !output) return;
    setJudging(true);
    try {
      const res = await fetch("/api/evals/judge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ output, criteria: selected.criteria, testCase: selected.name }),
      });
      const data = await res.json() as JudgeResponse;
      setJudgeResult(data);

      if (resultId && data.score) {
        await supabase
          .from("eval_results")
          .update({ llm_score: data.score, llm_reasoning: data.reasoning })
          .eq("id", resultId);
      }
    } catch (err) {
      console.error("Judge error:", err);
    }
    setJudging(false);
  }

  return (
    <div className="flex flex-col gap-6">
      {/* Select + Run */}
      <div className="flex gap-3 items-end">
        <div className="flex-1">
          <label className="block text-xs font-bold text-[#6a7f8f] uppercase tracking-widest mb-2">Test case</label>
          <CustomSelect
            value={selectedId}
            onChange={setSelectedId}
            options={cases.map((c) => ({ value: c.id, label: c.name }))}
            placeholder="Select a test case…"
          />
        </div>
        <button
          onClick={handleRun}
          disabled={!selectedId || running}
          className="rounded-2xl bg-[#1a6b7f] text-white font-bold px-6 py-3 hover:bg-[#155a6b] transition-colors disabled:opacity-30 text-sm shrink-0"
        >
          {running ? "Running…" : "Run →"}
        </button>
      </div>

      {/* Criteria display */}
      {selected && (
        <div className="flex flex-wrap gap-1.5">
          {selected.criteria.map((c, i) => (
            <span key={i} className="text-xs bg-[#e8f4f6] text-[#1a6b7f] px-2.5 py-1 rounded-full">{c}</span>
          ))}
        </div>
      )}

      {/* Output */}
      {output && (
        <div>
          <p className="text-xs font-bold text-[#6a7f8f] uppercase tracking-widest mb-2">AI Output</p>
          <pre className="bg-white border border-[#e8e4de] rounded-xl p-4 text-xs text-[#0e2a47] overflow-auto max-h-80 whitespace-pre-wrap">
            {output}
          </pre>
        </div>
      )}

      {/* Human rating */}
      {output && resultId && (
        <div className="bg-white border border-[#e8e4de] rounded-2xl p-5 flex flex-col gap-3">
          <p className="text-xs font-bold text-[#6a7f8f] uppercase tracking-widest">Human rating</p>
          <div className="flex gap-2">
            {[1, 2, 3, 4, 5].map((n) => (
              <button
                key={n}
                onClick={() => { setHumanScore(n); setHumanSaved(false); }}
                className={`w-10 h-10 rounded-xl text-sm font-bold transition-colors ${
                  humanScore === n
                    ? "bg-[#1a6b7f] text-white"
                    : "bg-[#f0ede8] text-[#4a6580] hover:bg-[#e8e4de]"
                }`}
              >
                {n}
              </button>
            ))}
          </div>
          <textarea
            rows={2}
            value={humanNotes}
            onChange={(e) => { setHumanNotes(e.target.value); setHumanSaved(false); }}
            placeholder="Notes (optional)…"
            className="w-full bg-[#f8f6f1] border border-[#d4cfc5] focus:border-[#1a6b7f] outline-none rounded-xl px-4 py-3 text-[#0e2a47] placeholder-[#9ca3af] text-xs resize-none"
          />
          <div className="flex items-center gap-3">
            <button
              onClick={handleSaveHuman}
              disabled={humanScore == null || savingHuman}
              className="rounded-xl bg-[#1a6b7f] text-white font-bold px-5 py-2.5 hover:bg-[#155a6b] transition-colors disabled:opacity-30 text-xs"
            >
              {savingHuman ? "Saving…" : "Save rating"}
            </button>
            {humanSaved && <span className="text-xs text-[#1a6b7f]">Saved</span>}
          </div>
        </div>
      )}

      {/* LLM Judge */}
      {output && resultId && (
        <div className="bg-white border border-[#e8e4de] rounded-2xl p-5 flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <p className="text-xs font-bold text-[#6a7f8f] uppercase tracking-widest">LLM-as-Judge</p>
            {!judgeResult && (
              <button
                onClick={handleJudge}
                disabled={judging}
                className="rounded-xl border border-[#d4cfc5] text-[#0e2a47] font-semibold px-4 py-2 hover:border-[#b8b3a9] transition-colors text-xs disabled:opacity-40"
              >
                {judging ? "Judging…" : "Ask Claude to judge →"}
              </button>
            )}
          </div>
          {judgeResult && (
            <div className="flex flex-col gap-3">
              <div className="flex items-center gap-3">
                <ScoreBadge score={judgeResult.score} />
                <p className="text-sm text-[#0e2a47]">{judgeResult.reasoning}</p>
              </div>
              <div className="flex flex-col gap-1.5">
                {judgeResult.criteria_results?.map((cr, i) => (
                  <div key={i} className="flex items-start gap-2 text-xs">
                    <span className={cr.pass ? "text-[#2d7a4f]" : "text-[#c0392b]"}>{cr.pass ? "✓" : "✗"}</span>
                    <span className="text-[#0e2a47] font-medium">{cr.criterion}</span>
                    {cr.note && <span className="text-[#6a7f8f]">— {cr.note}</span>}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Results Tab ────────────────────────────────────────────────────────────────

function ResultsTab() {
  const [results, setResults] = useState<EvalResult[]>([]);
  const [cases, setCases] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [sortBy, setSortBy] = useState<"date" | "human" | "llm">("date");

  useEffect(() => {
    Promise.all([
      supabase.from("eval_results").select("*").order("created_at", { ascending: false }).limit(50),
      supabase.from("eval_test_cases").select("id, name"),
    ]).then(([resData, caseData]) => {
      setResults((resData.data ?? []) as EvalResult[]);
      const map: Record<string, string> = {};
      for (const c of (caseData.data ?? []) as { id: string; name: string }[]) map[c.id] = c.name;
      setCases(map);
      setLoading(false);
    });
  }, []);

  const sorted = [...results].sort((a, b) => {
    if (sortBy === "human") return (b.human_score ?? 0) - (a.human_score ?? 0);
    if (sortBy === "llm") return (b.llm_score ?? 0) - (a.llm_score ?? 0);
    return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
  });

  if (loading) return <p className="text-sm text-[#6a7f8f] py-4">Loading…</p>;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex gap-2 mb-2">
        {(["date", "human", "llm"] as const).map((s) => (
          <button
            key={s}
            onClick={() => setSortBy(s)}
            className={`text-xs font-semibold px-3 py-1.5 rounded-full border transition-colors ${
              sortBy === s
                ? "bg-[#1a6b7f] text-white border-[#1a6b7f]"
                : "bg-white text-[#6a7f8f] border-[#d4cfc5] hover:border-[#b8b3a9]"
            }`}
          >
            Sort by {s === "date" ? "Date" : s === "human" ? "Human score" : "LLM score"}
          </button>
        ))}
      </div>

      {sorted.length === 0 ? (
        <p className="text-sm text-[#6a7f8f]">No results yet — run an eval first.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs text-[#6a7f8f] uppercase tracking-widest border-b border-[#e8e4de]">
                <th className="text-left py-3 px-2">Test case</th>
                <th className="text-left py-3 px-2">Model</th>
                <th className="text-center py-3 px-2">Human</th>
                <th className="text-center py-3 px-2">LLM</th>
                <th className="text-left py-3 px-2">Date</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((r) => (
                <tr key={r.id} className="border-b border-[#f0ede8] hover:bg-[#f0ede8] transition-colors">
                  <td className="py-3 px-2 text-[#0e2a47] font-medium">{cases[r.test_case_id] ?? "Unknown"}</td>
                  <td className="py-3 px-2 text-[#6a7f8f]">{r.model}</td>
                  <td className="py-3 px-2 text-center"><ScoreBadge score={r.human_score} /></td>
                  <td className="py-3 px-2 text-center"><ScoreBadge score={r.llm_score} /></td>
                  <td className="py-3 px-2 text-[#6a7f8f] text-xs">{formatDate(r.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ── Model Comparison Tab ───────────────────────────────────────────────────────

function ModelComparisonTab() {
  const [cases, setCases] = useState<TestCase[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [modelA, setModelA] = useState("claude-sonnet-4-6");
  const [modelB, setModelB] = useState("claude-opus-4-6");
  const [running, setRunning] = useState(false);
  const [outputA, setOutputA] = useState("");
  const [outputB, setOutputB] = useState("");
  const [judgeA, setJudgeA] = useState<JudgeResponse | null>(null);
  const [judgeB, setJudgeB] = useState<JudgeResponse | null>(null);
  const [judging, setJudging] = useState(false);

  useEffect(() => {
    supabase
      .from("eval_test_cases")
      .select("*")
      .order("created_at", { ascending: true })
      .then(({ data }) => setCases((data ?? []) as TestCase[]));
  }, []);

  const selected = cases.find((c) => c.id === selectedId);
  const models = ["claude-sonnet-4-6", "claude-opus-4-6", "claude-haiku-4-5-20251001"];

  async function runModel(model: string, inputs: Record<string, unknown>): Promise<string> {
    // The itinerary/generate route uses a hardcoded model, so we pass via a special field
    // For now, both use the same route — the model comparison is about output quality from the same prompt
    const res = await fetch("/api/itinerary/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...inputs, _evalModel: model }),
    });
    return JSON.stringify(await res.json(), null, 2);
  }

  async function handleRun() {
    if (!selected) return;
    setRunning(true);
    setOutputA(""); setOutputB("");
    setJudgeA(null); setJudgeB(null);

    try {
      const [a, b] = await Promise.all([
        runModel(modelA, selected.inputs),
        runModel(modelB, selected.inputs),
      ]);
      setOutputA(a);
      setOutputB(b);

      // Save both results
      await Promise.all([
        supabase.from("eval_results").insert({
          test_case_id: selected.id,
          model: modelA,
          prompt_used: `model-comparison: ${selected.name}`,
          ai_output: a,
        }),
        supabase.from("eval_results").insert({
          test_case_id: selected.id,
          model: modelB,
          prompt_used: `model-comparison: ${selected.name}`,
          ai_output: b,
        }),
      ]);

      // Auto-judge both
      setJudging(true);
      const [jA, jB] = await Promise.all([
        fetch("/api/evals/judge", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ output: a, criteria: selected.criteria, testCase: `${selected.name} (${modelA})` }),
        }).then((r) => r.json()) as Promise<JudgeResponse>,
        fetch("/api/evals/judge", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ output: b, criteria: selected.criteria, testCase: `${selected.name} (${modelB})` }),
        }).then((r) => r.json()) as Promise<JudgeResponse>,
      ]);
      setJudgeA(jA);
      setJudgeB(jB);
      setJudging(false);
    } catch (err) {
      console.error("Comparison error:", err);
    }
    setRunning(false);
  }

  return (
    <div className="flex flex-col gap-6">
      {/* Config */}
      <div className="grid grid-cols-3 gap-3">
        <div>
          <label className="block text-xs font-bold text-[#6a7f8f] uppercase tracking-widest mb-2">Test case</label>
          <CustomSelect
            value={selectedId}
            onChange={setSelectedId}
            options={cases.map((c) => ({ value: c.id, label: c.name }))}
            placeholder="Select…"
          />
        </div>
        <div>
          <label className="block text-xs font-bold text-[#6a7f8f] uppercase tracking-widest mb-2">Model A</label>
          <CustomSelect
            value={modelA}
            onChange={setModelA}
            options={models.map((m) => ({ value: m, label: m }))}
          />
        </div>
        <div>
          <label className="block text-xs font-bold text-[#6a7f8f] uppercase tracking-widest mb-2">Model B</label>
          <CustomSelect
            value={modelB}
            onChange={setModelB}
            options={models.map((m) => ({ value: m, label: m }))}
          />
        </div>
      </div>

      <button
        onClick={handleRun}
        disabled={!selectedId || running}
        className="rounded-2xl bg-[#1a6b7f] text-white font-bold px-8 py-4 hover:bg-[#155a6b] transition-colors disabled:opacity-30 text-sm w-fit"
      >
        {running ? "Running comparison…" : "Run comparison →"}
      </button>

      {/* Win/loss summary */}
      {judgeA && judgeB && (
        <div className="bg-white border border-[#e8e4de] rounded-2xl p-5">
          <div className="flex items-center justify-between">
            <div className="text-center flex-1">
              <p className="text-xs text-[#6a7f8f] mb-1">{modelA}</p>
              <ScoreBadge score={judgeA.score} />
            </div>
            <div className="text-center px-4">
              <p className="text-sm font-bold text-[#0e2a47]">
                {judgeA.score > judgeB.score ? "← Winner" : judgeB.score > judgeA.score ? "Winner →" : "Tie"}
              </p>
            </div>
            <div className="text-center flex-1">
              <p className="text-xs text-[#6a7f8f] mb-1">{modelB}</p>
              <ScoreBadge score={judgeB.score} />
            </div>
          </div>
        </div>
      )}

      {judging && <p className="text-sm text-[#6a7f8f] italic">Judging both outputs…</p>}

      {/* Side by side */}
      {(outputA || outputB) && (
        <div className="grid grid-cols-2 gap-4">
          <div>
            <p className="text-xs font-bold text-[#6a7f8f] uppercase tracking-widest mb-2">{modelA}</p>
            <pre className="bg-white border border-[#e8e4de] rounded-xl p-4 text-xs text-[#0e2a47] overflow-auto max-h-80 whitespace-pre-wrap">
              {outputA || "Running…"}
            </pre>
            {judgeA && (
              <div className="mt-3 flex flex-col gap-2">
                <div className="flex items-center gap-2">
                  <ScoreBadge score={judgeA.score} />
                  <p className="text-xs text-[#4a6580]">{judgeA.reasoning}</p>
                </div>
                {judgeA.criteria_results?.map((cr, i) => (
                  <div key={i} className="flex items-start gap-1.5 text-xs">
                    <span className={cr.pass ? "text-[#2d7a4f]" : "text-[#c0392b]"}>{cr.pass ? "✓" : "✗"}</span>
                    <span className="text-[#6a7f8f]">{cr.criterion}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
          <div>
            <p className="text-xs font-bold text-[#6a7f8f] uppercase tracking-widest mb-2">{modelB}</p>
            <pre className="bg-white border border-[#e8e4de] rounded-xl p-4 text-xs text-[#0e2a47] overflow-auto max-h-80 whitespace-pre-wrap">
              {outputB || "Running…"}
            </pre>
            {judgeB && (
              <div className="mt-3 flex flex-col gap-2">
                <div className="flex items-center gap-2">
                  <ScoreBadge score={judgeB.score} />
                  <p className="text-xs text-[#4a6580]">{judgeB.reasoning}</p>
                </div>
                {judgeB.criteria_results?.map((cr, i) => (
                  <div key={i} className="flex items-start gap-1.5 text-xs">
                    <span className={cr.pass ? "text-[#2d7a4f]" : "text-[#c0392b]"}>{cr.pass ? "✓" : "✗"}</span>
                    <span className="text-[#6a7f8f]">{cr.criterion}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Page ───────────────────────────────────────────────────────────────────────

export default function EvalsPage() {
  const [tab, setTab] = useState<"cases" | "run" | "results" | "compare">("cases");

  const tabs = [
    { id: "cases" as const, label: "Test cases" },
    { id: "run" as const, label: "Run evals" },
    { id: "results" as const, label: "Results" },
    { id: "compare" as const, label: "Model comparison" },
  ];

  return (
    <main className="min-h-screen bg-[#f8f6f1] px-6 py-10">
      <div className="max-w-4xl mx-auto">
        <div className="mb-8">
          <h1 className="text-4xl font-extrabold tracking-tight mb-2">Evals</h1>
          <p className="text-[#4a6580]">Evaluate AI output quality across family prompt scenarios.</p>
        </div>

        {/* Tab bar */}
        <div className="flex gap-1 bg-white border border-[#e8e4de] rounded-2xl p-1 w-fit mb-10 overflow-x-auto">
          {tabs.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`px-6 py-2.5 rounded-xl text-sm font-semibold transition-colors whitespace-nowrap ${
                tab === t.id
                  ? "bg-[#1a6b7f] text-white"
                  : "text-[#4a6580] hover:text-[#0e2a47]"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {tab === "cases" && <TestCasesTab />}
        {tab === "run" && <RunEvalsTab />}
        {tab === "results" && <ResultsTab />}
        {tab === "compare" && <ModelComparisonTab />}
      </div>
    </main>
  );
}
