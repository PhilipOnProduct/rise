export default function Profiel() {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center bg-gradient-to-b from-blue-50 to-white px-8">
        <div className="w-full max-w-lg bg-white rounded-2xl border border-blue-100 shadow-sm p-10">
          
          <h1 className="text-3xl font-bold text-blue-900 mb-2">Jouw reisprofiel</h1>
          <p className="text-gray-500 mb-8">Rise gebruikt dit om je persoonlijk advies te geven.</p>
  
          <form className="flex flex-col gap-6">
            
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Naam</label>
              <input
                type="text"
                placeholder="Jouw naam"
                className="w-full rounded-lg border border-gray-200 px-4 py-3 text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
  
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Wat voor reiziger ben je?</label>
              <select className="w-full rounded-lg border border-gray-200 px-4 py-3 text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500">
                <option>Avonturier — off the beaten track</option>
                <option>Comfortreiziger — goede hotels en restaurants</option>
                <option>Cultureel — musea, geschiedenis, architectuur</option>
                <option>Foodie — eten staat centraal</option>
                <option>Ontspanner — zon, strand, niets doen</option>
              </select>
            </div>
  
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Reisbestemming</label>
              <input
                type="text"
                placeholder="Waar ga je naartoe?"
                className="w-full rounded-lg border border-gray-200 px-4 py-3 text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Vertrekdatum</label>
                <input
                  type="date"
                  className="w-full rounded-lg border border-gray-200 px-4 py-3 text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Terugkeerdatum</label>
                <input
                  type="date"
                  className="w-full rounded-lg border border-gray-200 px-4 py-3 text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Reisgezelschap</label>
              <select className="w-full rounded-lg border border-gray-200 px-4 py-3 text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500">
                <option>Solo</option>
                <option>Stel</option>
                <option>Gezin met kinderen</option>
                <option>Vriendengroep</option>
                <option>Zakenreis</option>
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Budget</label>
              <div className="grid grid-cols-3 gap-3">
                {[
                  { value: "budget", label: "Budget", sub: "< €100/dag" },
                  { value: "midden", label: "Midden", sub: "€100–250/dag" },
                  { value: "luxe", label: "Luxe", sub: "> €250/dag" },
                ].map(({ value, label, sub }) => (
                  <label key={value} className="flex flex-col items-center gap-1 cursor-pointer rounded-xl border border-gray-200 p-4 hover:border-blue-400 hover:bg-blue-50 transition-colors has-[:checked]:border-blue-500 has-[:checked]:bg-blue-50">
                    <input type="radio" name="budget" value={value} className="sr-only" />
                    <span className="font-semibold text-gray-900">{label}</span>
                    <span className="text-xs text-gray-500">{sub}</span>
                  </label>
                ))}
              </div>
            </div>

            <button
              type="submit"
              className="w-full rounded-full bg-blue-600 py-4 text-white font-semibold text-lg hover:bg-blue-700 transition-colors"
            >
              Sla profiel op
            </button>
  
          </form>
        </div>
      </main>
    );
  }