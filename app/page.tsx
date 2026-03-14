type Feature = {
  title: string;
  description: string;
  icon: string;
};

const features: Feature[] = [
  {
    title: "Personal travel advice",
    description: "AI that knows your preferences and thinks along with you.",
    icon: "✈️",
  },
  {
    title: "Local guides",
    description: "Insider tips from people who live there.",
    icon: "🗺️",
  },
  {
    title: "Smart bookings",
    description: "From airport to hotel — we take care of it.",
    icon: "🏨",
  },
  {
    title: "Restaurant tips",
    description: "The best spots, tailored to your taste.",
    icon: "🍽️",
  },
];

export default function Home() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-gradient-to-b from-blue-50 to-white px-8">
      
      {/* Hero */}
      <div className="text-center mb-20">
        <h1 className="text-6xl font-bold text-blue-900 mb-4">Rise</h1>
        <p className="text-2xl text-blue-500 mb-8">Your personal travel concierge</p>

        <a href="/profile" className="rounded-full bg-blue-600 px-8 py-4 text-white font-semibold text-lg hover:bg-blue-700 transition-colors">
          Create your travel profile
        </a>
      </div>

      {/* Features */}
      <div className="grid grid-cols-1 gap-8 sm:grid-cols-2 lg:grid-cols-4 max-w-5xl">
        {features.map((feature: Feature) => (
          <div key={feature.title} className="rounded-xl border border-blue-100 bg-white p-6 shadow-sm">
            <div className="text-4xl mb-4">{feature.icon}</div>
            <h2 className="text-lg font-semibold text-gray-900 mb-2">{feature.title}</h2>
            <p className="text-gray-500">{feature.description}</p>
          </div>
        ))}
      </div>

    </main>
  );
}