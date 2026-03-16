"use client";

import { useState } from "react";
import { CATEGORIES, CATEGORY_LABELS, type Category } from "@/lib/guides";

export default function AddGuidePage() {
  const [form, setForm] = useState({
    name: "",
    email: "",
    city: "",
    category: "" as Category | "",
    title: "",
    description: "",
  });
  const [submitted, setSubmitted] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  function set(field: string, value: string) {
    setForm((f) => ({ ...f, [field]: value }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");

    const res = await fetch("/api/guides", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });

    if (!res.ok) {
      const { error } = await res.json();
      setError(error ?? "Something went wrong.");
      setLoading(false);
      return;
    }

    setSubmitted(true);
    setLoading(false);
  }

  const inputCls = "w-full bg-[#111] border border-[#2a2a2a] focus:border-[#00D64F] outline-none rounded-xl px-5 py-4 text-white placeholder-[#444] transition-colors text-sm";

  if (submitted) {
    return (
      <main className="min-h-screen bg-[#0a0a0a] flex items-center justify-center px-6">
        <div className="w-full max-w-md text-center">
          <div className="text-6xl mb-6">🙌</div>
          <h1 className="text-3xl font-extrabold mb-3">Thanks, {form.name}!</h1>
          <p className="text-gray-400 mb-2">Your tip for <span className="text-white font-semibold">{form.city}</span> has been added.</p>
          <p className="text-[#00D64F] text-sm font-semibold mb-10">+10 points added to your guide profile</p>
          <div className="flex flex-col gap-3">
            <a href={`/guides/${form.city.toLowerCase().trim()}`}
              className="w-full rounded-2xl bg-[#00D64F] text-black font-bold py-4 text-base hover:bg-[#00c248] transition-colors">
              See all {form.city} tips →
            </a>
            <button
              onClick={() => { setSubmitted(false); setForm({ name: "", email: "", city: "", category: "", title: "", description: "" }); }}
              className="w-full rounded-2xl border border-[#2a2a2a] text-white font-semibold py-4 text-base hover:border-[#444] transition-colors">
              Add another tip
            </button>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-[#0a0a0a] px-6 py-14">
      <div className="max-w-lg mx-auto">

        <a href="/guides" className="text-gray-600 text-sm hover:text-gray-400 transition-colors mb-8 inline-block">← Local guides</a>

        <div className="mb-10">
          <h1 className="text-4xl font-extrabold tracking-tight mb-2">Share a local tip</h1>
          <p className="text-gray-400">Help fellow travelers discover the best your city has to offer.</p>
        </div>

        <form className="flex flex-col gap-6" onSubmit={handleSubmit}>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-bold text-gray-500 uppercase tracking-widest mb-3">Your name</label>
              <input type="text" placeholder="e.g. Sofia" value={form.name}
                onChange={(e) => set("name", e.target.value)} required className={inputCls} />
            </div>
            <div>
              <label className="block text-xs font-bold text-gray-500 uppercase tracking-widest mb-3">City</label>
              <input type="text" placeholder="e.g. Amsterdam" value={form.city}
                onChange={(e) => set("city", e.target.value)} required className={inputCls} />
            </div>
          </div>

          <div>
            <label className="block text-xs font-bold text-gray-500 uppercase tracking-widest mb-3">Email</label>
            <input type="email" placeholder="you@example.com" value={form.email}
              onChange={(e) => set("email", e.target.value)} required className={inputCls} />
            <p className="text-xs text-gray-600 mt-2">Used to track your guide profile and points.</p>
          </div>

          <div>
            <label className="block text-xs font-bold text-gray-500 uppercase tracking-widest mb-3">Category</label>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {CATEGORIES.map((cat) => {
                const { label, icon } = CATEGORY_LABELS[cat];
                const selected = form.category === cat;
                return (
                  <button key={cat} type="button" onClick={() => set("category", cat)}
                    className={`flex items-center gap-2 rounded-xl border px-3 py-3 text-sm font-medium transition-colors ${
                      selected ? "border-[#00D64F] bg-[#00D64F]/10 text-white" : "border-[#2a2a2a] text-gray-400 hover:border-[#3a3a3a] hover:text-white"
                    }`}>
                    <span>{icon}</span><span>{label}</span>
                  </button>
                );
              })}
            </div>
          </div>

          <div>
            <label className="block text-xs font-bold text-gray-500 uppercase tracking-widest mb-3">Tip title</label>
            <input type="text" placeholder="e.g. Best stroopwafels in the Jordaan" value={form.title}
              onChange={(e) => set("title", e.target.value)} required className={inputCls} />
          </div>

          <div>
            <label className="block text-xs font-bold text-gray-500 uppercase tracking-widest mb-3">Description</label>
            <textarea placeholder="Tell travelers what makes this special…" value={form.description}
              onChange={(e) => set("description", e.target.value)} required rows={4}
              className={`${inputCls} resize-none`} />
          </div>

          {error && <p className="text-sm text-red-400">{error}</p>}

          <button type="submit" disabled={loading || !form.category}
            className="w-full rounded-2xl bg-[#00D64F] text-black font-bold py-5 text-lg hover:bg-[#00c248] transition-colors disabled:opacity-40">
            {loading ? "Submitting…" : "Share tip →"}
          </button>

        </form>
      </div>
    </main>
  );
}
