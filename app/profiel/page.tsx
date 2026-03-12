"use client";

import { useState } from "react";

type Profile = {
  name: string;
  travelerType: string;
  destination: string;
  departureDate: string;
  returnDate: string;
  travelCompany: string;
  budget: string;
};

const defaultProfile: Profile = {
  name: "",
  travelerType: "Adventurer — off the beaten track",
  destination: "",
  departureDate: "",
  returnDate: "",
  travelCompany: "Solo",
  budget: "",
};

export default function ProfilePage() {
  const [profile, setProfile] = useState<Profile>(defaultProfile);
  const [saved, setSaved] = useState<Profile | null>(null);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaved({ ...profile });
  }

  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-gradient-to-b from-blue-50 to-white px-8">
      <div className="w-full max-w-lg bg-white rounded-2xl border border-blue-100 shadow-sm p-10">

        <h1 className="text-3xl font-bold text-blue-900 mb-2">Your travel profile</h1>
        <p className="text-gray-500 mb-8">Rise uses this to give you personalised advice.</p>

        <form className="flex flex-col gap-6" onSubmit={handleSubmit}>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Name</label>
            <input
              type="text"
              placeholder="Your name"
              value={profile.name}
              onChange={(e) => setProfile({ ...profile, name: e.target.value })}
              className="w-full rounded-lg border border-gray-200 px-4 py-3 text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">What kind of traveler are you?</label>
            <select
              value={profile.travelerType}
              onChange={(e) => setProfile({ ...profile, travelerType: e.target.value })}
              className="w-full rounded-lg border border-gray-200 px-4 py-3 text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option>Adventurer — off the beaten track</option>
              <option>Comfort traveler — good hotels and restaurants</option>
              <option>Cultural — museums, history, architecture</option>
              <option>Foodie — food comes first</option>
              <option>Relaxer — sun, beach, doing nothing</option>
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Destination</label>
            <input
              type="text"
              placeholder="Where are you going?"
              value={profile.destination}
              onChange={(e) => setProfile({ ...profile, destination: e.target.value })}
              className="w-full rounded-lg border border-gray-200 px-4 py-3 text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Departure date</label>
              <input
                type="date"
                value={profile.departureDate}
                onChange={(e) => setProfile({ ...profile, departureDate: e.target.value })}
                className="w-full rounded-lg border border-gray-200 px-4 py-3 text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Return date</label>
              <input
                type="date"
                value={profile.returnDate}
                onChange={(e) => setProfile({ ...profile, returnDate: e.target.value })}
                className="w-full rounded-lg border border-gray-200 px-4 py-3 text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Travel company</label>
            <select
              value={profile.travelCompany}
              onChange={(e) => setProfile({ ...profile, travelCompany: e.target.value })}
              className="w-full rounded-lg border border-gray-200 px-4 py-3 text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option>Solo</option>
              <option>Couple</option>
              <option>Family with children</option>
              <option>Group of friends</option>
              <option>Business trip</option>
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Budget</label>
            <div className="grid grid-cols-3 gap-3">
              {[
                { value: "budget", label: "Budget", sub: "< €100/day" },
                { value: "mid-range", label: "Mid-range", sub: "€100–250/day" },
                { value: "luxury", label: "Luxury", sub: "> €250/day" },
              ].map(({ value, label, sub }) => (
                <label
                  key={value}
                  className={`flex flex-col items-center gap-1 cursor-pointer rounded-xl border p-4 transition-colors ${
                    profile.budget === value
                      ? "border-blue-500 bg-blue-50"
                      : "border-gray-200 hover:border-blue-400 hover:bg-blue-50"
                  }`}
                >
                  <input
                    type="radio"
                    name="budget"
                    value={value}
                    checked={profile.budget === value}
                    onChange={(e) => setProfile({ ...profile, budget: e.target.value })}
                    className="sr-only"
                  />
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
            Save profile
          </button>

        </form>

        {saved && (
          <div className="mt-8 rounded-xl border border-green-200 bg-green-50 p-6">
            <h2 className="text-lg font-semibold text-green-800 mb-3">Profile saved!</h2>
            <dl className="flex flex-col gap-2 text-sm text-gray-700">
              <div className="flex justify-between"><dt className="font-medium">Name</dt><dd>{saved.name || "—"}</dd></div>
              <div className="flex justify-between"><dt className="font-medium">Traveler type</dt><dd>{saved.travelerType}</dd></div>
              <div className="flex justify-between"><dt className="font-medium">Destination</dt><dd>{saved.destination || "—"}</dd></div>
              <div className="flex justify-between"><dt className="font-medium">Departure date</dt><dd>{saved.departureDate || "—"}</dd></div>
              <div className="flex justify-between"><dt className="font-medium">Return date</dt><dd>{saved.returnDate || "—"}</dd></div>
              <div className="flex justify-between"><dt className="font-medium">Travel company</dt><dd>{saved.travelCompany}</dd></div>
              <div className="flex justify-between"><dt className="font-medium">Budget</dt><dd>{saved.budget || "—"}</dd></div>
            </dl>
          </div>
        )}

      </div>
    </main>
  );
}
