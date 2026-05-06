const SPECIMENS = [
  {
    title: "A RELAXED SATURDAY IN LISBON",
    lines: [
      "Morning · Tile museum, then coffee in Alfama",
      "Afternoon · Tram 28, long lunch at Time Out Market",
      "Evening · Sunset at Miradouro da Senhora do Monte",
    ],
  },
  {
    title: "THREE JET-LAGGED DAYS IN TOKYO",
    lines: [
      "Day 1 · Slow walk through Yanaka, early sushi",
      "Day 2 · teamLab Planets at opening, nap, izakaya at 7pm",
      "Day 3 · Tsukiji breakfast, Shimokitazawa records",
    ],
  },
  {
    title: "A FAMILY SUNDAY IN ROME",
    lines: [
      "Morning · Villa Borghese playground, gelato",
      "Afternoon · Pizza lunch, nap at the hotel",
      "Evening · Trastevere stroll, 6:30pm dinner",
    ],
  },
] as const;

export default function SpecimenCards() {
  return (
    <div className="w-full max-w-[1024px] mx-auto grid grid-cols-1 md:grid-cols-3 gap-4 md:gap-6">
      {SPECIMENS.map((card) => (
        <article
          key={card.title}
          className="rounded-2xl p-5 text-left transition-shadow hover:shadow-sm"
          style={{
            backgroundColor: "#f0ede8",
            border: "1px solid #e8e4de",
          }}
        >
          <h3
            className="text-[11px] font-semibold uppercase mb-3"
            style={{ color: "#2a7f8f", letterSpacing: "1.5px" }}
          >
            {card.title}
          </h3>
          <ul className="space-y-1.5 list-none p-0 m-0">
            {card.lines.map((line) => (
              <li
                key={line}
                className="text-sm"
                style={{ color: "#4a6580", lineHeight: 1.5 }}
              >
                {line}
              </li>
            ))}
          </ul>
        </article>
      ))}
    </div>
  );
}
