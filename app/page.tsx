const features = [
  { title: "Personalized advice", description: "AI that knows your preferences and thinks ahead.", icon: "✈️" },
  { title: "Local guides", description: "Insider tips from people who actually live there.", icon: "🗺️" },
  { title: "Airport to hotel", description: "Compare transport options before you land.", icon: "🚕" },
  { title: "Restaurant picks", description: "The best spots, matched to your taste.", icon: "🍽️" },
];

export default function Home() {
  return (
    <main className="min-h-screen bg-[#0a0a0a] px-6 py-16 flex flex-col items-center justify-center">
      <div className="w-full max-w-3xl">

        {/* Hero */}
        <div className="mb-20">
          <p className="text-[#00D64F] font-semibold text-sm tracking-widest uppercase mb-4">Rise</p>
          <h1 className="text-6xl md:text-7xl font-extrabold tracking-tight leading-none mb-6">
            Your personal<br />travel assistant.
          </h1>
          <p className="text-gray-400 text-xl mb-10 max-w-md">
            AI-powered planning, insider tips, and smart transport — all in one place.
          </p>

          <div className="flex flex-wrap gap-3">
            <a
              href="/welcome"
              className="rounded-2xl bg-[#00D64F] text-black font-bold px-8 py-4 text-base hover:bg-[#00c248] transition-colors"
            >
              Plan my trip →
            </a>
            <a
              href="/transport"
              className="rounded-2xl border border-[#2a2a2a] text-white font-semibold px-8 py-4 text-base hover:border-[#444] transition-colors"
            >
              Airport → Hotel
            </a>
            <a
              href="/guides"
              className="rounded-2xl border border-[#2a2a2a] text-white font-semibold px-8 py-4 text-base hover:border-[#444] transition-colors"
            >
              Local guides
            </a>
          </div>
        </div>

        {/* Feature grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {features.map((f) => (
            <div key={f.title} className="rounded-2xl border border-[#1e1e1e] bg-[#111] p-6">
              <div className="text-3xl mb-4">{f.icon}</div>
              <h2 className="text-lg font-bold text-white mb-1">{f.title}</h2>
              <p className="text-gray-400 text-sm">{f.description}</p>
            </div>
          ))}
        </div>

      </div>
    </main>
  );
}
