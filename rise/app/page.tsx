// Een 'type' beschrijft de structuur van een object — dit ken je van VB.NET als een struct
type Feature = {
  title: string;
  description: string;
};

// Een array van Feature objecten
const features: Feature[] = [
  {
    title: "Persoonlijk reisadvies",
    description: "AI die jouw voorkeuren kent en meedenkt.",
  },
  {
    title: "Local guides",
    description: "Insider tips van mensen die er wonen.",
  },
  {
    title: "Slimme boekingen",
    description: "Van vliegveld naar hotel — wij regelen het.",
  },
  {
    title: "Hulp nodig bij het vinden en reserveren van een restaurant",
    description: "We helpen je met het vinden en reserveren van een restaurant, gebaseerd op je voorkeuren en budget.",
  },
];  

export default function Home() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-white px-8">
      <h1 className="text-5xl font-bold text-gray-900 mb-4">Rise</h1>
      <p className="text-xl text-gray-500 mb-16">Jouw persoonlijke reisconcierge</p>

      <div className="grid grid-cols-1 gap-8 sm:grid-cols-2 lg:grid-cols-4">
        {features.map((feature: Feature) => (
          <div key={feature.title} className="rounded-xl border border-gray-200 p-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-2">{feature.title}</h2>
            <p className="text-gray-500">{feature.description}</p>
          </div>
        ))}
      </div>
    </main>
  );
}