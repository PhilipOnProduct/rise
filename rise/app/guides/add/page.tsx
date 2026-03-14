"use client";

import { useState } from "react";
import { CATEGORIES, CATEGORY_LABELS, type Category } from "@/lib/guides";

export default function AddGuidePage() {
  const [form, setForm] = useState({
    name: "",
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

  if (submitted) {
    const citySlug = form.city.toLowerCase().trim();
    return (
      <main className="flex min-h-screen flex-col items-center justify-center bg-gradient-to-b from-blue-50 to-white px-8">
        <div className="w-full max-w-lg bg-white rounded-2xl border border-blue-100 shadow-sm p-10 text-center">
          <div className="text-5xl mb-4">🙌</div>
          <h1 className="text-2xl font-bold text-blue-900 mb-2">Thanks, {form.name}!</h1>
          <p className="text-gray-500 mb-6">Your tip for <span className="font-medium text-gray-800">{form.city}</span> has been added.</p>
          <div className="flex flex-col gap-3">
            <a
              href={`/guides/${citySlug}`}
              className="rounded-full bg-blue-600 px-6 py-3 text-white font-semibold hover:bg-blue-700 transition-colors"
            >
              See all {form.city} tips
            </a>
            <button
              onClick={() => { setSubmitted(false); setForm({ name: "", city: "", category: "", title: "", description: "" }); }}
              className="rounded-full border border-gray-200 px-6 py-3 text-gray-600 font-medium hover:bg-gray-50 transition-colors"
            >
              Add another tip
            </button>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-gradient-to-b from-blue-50 to-white px-8 py-16">
      <div className="w-full max-w-lg bg-white rounded-2xl border border-blue-100 shadow-sm p-10">

        <h1 className="text-3xl font-bold text-blue-900 mb-2">Share a local tip</h1>
        <p className="text-gray-500 mb-8">Help fellow travelers discover the best your city has to offer.</p>

        <form className="flex flex-col gap-5" onSubmit={handleSubmit}>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Your name</label>
              <input
                type="text"
                placeholder="e.g. Sofia"
                value={form.name}
                onChange={(e) => set("name", e.target.value)}
                required
                className="w-full rounded-lg border border-gray-200 px-4 py-3 text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">City</label>
              <input
                type="text"
                placeholder="e.g. Amsterdam"
                value={form.city}
                onChange={(e) => set("city", e.target.value)}
                required
                className="w-full rounded-lg border border-gray-200 px-4 py-3 text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Category</label>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {CATEGORIES.map((cat) => {
                const { label, icon } = CATEGORY_LABELS[cat];
                const selected = form.category === cat;
                return (
                  <button
                    key={cat}
                    type="button"
                    onClick={() => set("category", cat)}
                    className={`flex items-center gap-2 rounded-xl border px-3 py-2.5 text-sm font-medium transition-colors ${
                      selected
                        ? "border-blue-500 bg-blue-50 text-blue-700"
                        : "border-gray-200 text-gray-700 hover:border-blue-400 hover:bg-blue-50"
                    }`}
                  >
                    <span>{icon}</span>
                    <span>{label}</span>
                  </button>
                );
              })}
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Tip title</label>
            <input
              type="text"
              placeholder="e.g. Best stroopwafels in the Jordaan"
              value={form.title}
              onChange={(e) => set("title", e.target.value)}
              required
              className="w-full rounded-lg border border-gray-200 px-4 py-3 text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
            <textarea
              placeholder="Tell travelers what makes this special, where exactly to go, and any practical details…"
              value={form.description}
              onChange={(e) => set("description", e.target.value)}
              required
              rows={4}
              className="w-full rounded-lg border border-gray-200 px-4 py-3 text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
            />
          </div>

          {error && (
            <p className="text-sm text-red-600">{error}</p>
          )}

          <button
            type="submit"
            disabled={loading || !form.category}
            className="w-full rounded-full bg-blue-600 py-4 text-white font-semibold text-lg hover:bg-blue-700 transition-colors disabled:opacity-60"
          >
            {loading ? "Submitting…" : "Share tip"}
          </button>

        </form>
      </div>
    </main>
  );
}
