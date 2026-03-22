const FEATURE_PILLS = [
  "Personalised itinerary",
  "Local insider tips",
  "Smart transport advice",
];

function LandmarkSkyline() {
  return (
    <svg
      viewBox="0 0 1200 160"
      preserveAspectRatio="xMidYMax slice"
      className="w-full block"
      style={{ height: 140 }}
      xmlns="http://www.w3.org/2000/svg"
    >
      {/* Sky wash */}
      <rect width="1200" height="160" fill="#e8e2d8" />

      {/* Fade into page bg at top */}
      <defs>
        <linearGradient id="skyFade" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#f8f6f1" />
          <stop offset="40%" stopColor="#f8f6f1" stopOpacity="0" />
        </linearGradient>
      </defs>
      <rect width="1200" height="160" fill="url(#skyFade)" />

      {/* Ground */}
      <rect y="145" width="1200" height="15" fill="#d8ccb8" />

      {/* Colosseum */}
      <g transform="translate(30, 75)">
        <rect x="0" y="20" width="70" height="50" rx="2" fill="#c8a882" />
        <path d="M8,20 A27,25 0 0,1 62,20" fill="#c8a882" stroke="#b89872" strokeWidth="1" />
        <rect x="12" y="35" width="10" height="18" rx="5" fill="#e8d4b8" />
        <rect x="30" y="35" width="10" height="18" rx="5" fill="#e8d4b8" />
        <rect x="48" y="35" width="10" height="18" rx="5" fill="#e8d4b8" />
      </g>

      {/* Eiffel Tower */}
      <g transform="translate(160, 15)">
        <polygon points="25,0 19,40 31,40" fill="#b0c4d4" />
        <polygon points="19,40 9,130 41,130 31,40" fill="#9ab4c8" />
        <rect x="20" y="37" width="10" height="3" rx="1" fill="#8aa4b8" />
        <rect x="15" y="78" width="20" height="3" rx="1" fill="#8aa4b8" />
      </g>

      {/* Skyscrapers */}
      <g transform="translate(260, 40)">
        <rect x="0" y="15" width="18" height="90" rx="1" fill="#9ab4c8" />
        <rect x="22" y="0" width="16" height="105" rx="1" fill="#b0c4d4" />
        <rect x="42" y="28" width="17" height="77" rx="1" fill="#a0b8cc" />
      </g>

      {/* Big Ben */}
      <g transform="translate(380, 20)">
        <rect x="8" y="15" width="18" height="110" rx="1" fill="#c8a882" />
        <polygon points="17,0 8,15 26,15" fill="#b89872" />
        <rect x="11" y="40" width="12" height="7" rx="1" fill="#e8d4b8" />
      </g>

      {/* Mosque dome */}
      <g transform="translate(460, 55)">
        <rect x="5" y="32" width="52" height="48" rx="2" fill="#e8d4b8" />
        <ellipse cx="31" cy="32" rx="26" ry="20" fill="#c8a882" />
        <line x1="31" y1="12" x2="31" y2="6" stroke="#b89872" strokeWidth="2" />
        <ellipse cx="31" cy="5" rx="2.5" ry="2.5" fill="#b89872" />
        <rect x="-1" y="25" width="5" height="55" rx="1" fill="#d8c8a8" />
        <rect x="58" y="25" width="5" height="55" rx="1" fill="#d8c8a8" />
      </g>

      {/* Taj Mahal */}
      <g transform="translate(580, 50)">
        <rect x="8" y="40" width="52" height="38" rx="2" fill="#e8d4b8" />
        <ellipse cx="34" cy="40" rx="22" ry="17" fill="#d8ccb8" />
        <line x1="34" y1="21" x2="34" y2="16" stroke="#c8a882" strokeWidth="1.5" />
        <ellipse cx="34" cy="15" rx="2" ry="2" fill="#c8a882" />
        <ellipse cx="15" cy="44" rx="7" ry="6" fill="#d0c4a8" />
        <ellipse cx="53" cy="44" rx="7" ry="6" fill="#d0c4a8" />
      </g>

      {/* Burj Khalifa */}
      <g transform="translate(720, 5)">
        <polygon points="13,0 7,140 19,140" fill="#9ab4c8" />
        <rect x="5" y="85" width="16" height="2.5" rx="1" fill="#8aa4b8" />
        <rect x="7" y="50" width="12" height="2" rx="1" fill="#8aa4b8" />
      </g>

      {/* Pagoda */}
      <g transform="translate(800, 38)">
        <rect x="15" y="15" width="20" height="92" rx="1" fill="#c8a882" />
        <polygon points="25,6 6,22 44,22" fill="#b89872" />
        <polygon points="25,22 9,34 41,34" fill="#c8a882" />
        <polygon points="25,38 11,48 39,48" fill="#b89872" />
        <polygon points="25,54 13,62 37,62" fill="#c8a882" />
        <line x1="25" y1="0" x2="25" y2="6" stroke="#a08060" strokeWidth="1.5" />
      </g>

      {/* Sydney Opera House */}
      <g transform="translate(920, 85)">
        <path d="M0,60 Q12,8 24,60" fill="#e8d4b8" />
        <path d="M16,60 Q28,4 40,60" fill="#d8ccb8" />
        <path d="M32,60 Q42,12 53,60" fill="#e8d4b8" />
        <rect x="-4" y="56" width="64" height="8" rx="1" fill="#c8a882" />
      </g>

      {/* Right towers */}
      <g transform="translate(1060, 30)">
        <rect x="0" y="8" width="22" height="107" rx="2" fill="#b0c4d4" />
        <rect x="26" y="24" width="17" height="91" rx="2" fill="#9ab4c8" />
        <rect x="47" y="0" width="19" height="115" rx="2" fill="#a0b8cc" />
        <rect x="70" y="40" width="15" height="75" rx="2" fill="#b0c4d4" />
      </g>
    </svg>
  );
}

export default function Home() {
  return (
    <main
      className="h-screen flex flex-col overflow-hidden"
      style={{ backgroundColor: "#f8f6f1" }}
    >
      {/* Nav */}
      <nav className="flex items-center justify-between px-8 py-6 flex-shrink-0">
        <a href="/" className="text-xl font-extrabold tracking-tight" style={{ color: "#0e2a47" }}>
          Rise
        </a>
        <a href="/welcome" className="text-sm font-medium hover:opacity-70 transition-opacity" style={{ color: "#4a6580" }}>
          Sign in
        </a>
      </nav>

      {/* Hero — visually centered between nav and illustration */}
      <div className="flex-1 flex flex-col items-center px-6 min-h-0">
        <div className="flex-[3]" />
        <div className="w-full max-w-2xl text-center">
          {/* Eyebrow */}
          <p
            className="text-[11px] font-medium uppercase mb-5"
            style={{ color: "#2a7f8f", letterSpacing: "2px" }}
          >
            AI-powered trip planning
          </p>

          {/* Headline */}
          <h1
            className="mb-5"
            style={{
              color: "#0e2a47",
              fontSize: "clamp(36px, 5vw, 56px)",
              fontWeight: 300,
              letterSpacing: "-1px",
              lineHeight: 1.15,
            }}
          >
            Your next trip,
            <br />
            thoughtfully planned.
          </h1>

          {/* Subtext */}
          <p
            className="text-lg mb-10 max-w-lg mx-auto"
            style={{ color: "#4a6580", lineHeight: 1.6 }}
          >
            Tell us where you&apos;re going. We&apos;ll build a day-by-day
            itinerary around how you actually travel.
          </p>

          {/* CTA */}
          <a
            href="/welcome"
            className="inline-block font-semibold text-base text-white px-10 py-4 hover:opacity-90 transition-opacity"
            style={{
              backgroundColor: "#1a6b7f",
              borderRadius: 50,
            }}
          >
            Plan my trip &rarr;
          </a>

          {/* Feature pills */}
          <div className="flex items-center justify-center gap-5 mt-10 flex-wrap">
            {FEATURE_PILLS.map((pill) => (
              <span
                key={pill}
                className="flex items-center gap-2 text-sm"
                style={{ color: "#6a7f8f" }}
              >
                <span
                  className="w-1.5 h-1.5 rounded-full flex-shrink-0"
                  style={{ backgroundColor: "#2a7f8f" }}
                />
                {pill}
              </span>
            ))}
          </div>
        </div>
        <div className="flex-[4]" />
      </div>

      {/* Skyline pinned to bottom */}
      <div className="flex-shrink-0">
        <LandmarkSkyline />
      </div>
    </main>
  );
}
