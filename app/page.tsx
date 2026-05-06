import LandingHero from "@/app/components/LandingHero";
import SpecimenCards from "@/app/components/SpecimenCards";
import LandmarkSkyline from "@/app/components/LandmarkSkyline";

export default function Home() {
  return (
    <main
      className="min-h-screen flex flex-col"
      style={{ backgroundColor: "#f8f6f1" }}
    >
      <nav className="flex items-center justify-between px-6 sm:px-8 py-4 flex-shrink-0">
        <a
          href="/"
          className="text-xl font-extrabold tracking-tight"
          style={{ color: "#0e2a47" }}
        >
          Rise
        </a>
        <a
          href="/welcome"
          className="text-sm font-medium hover:opacity-70 transition-opacity"
          style={{ color: "#4a6580" }}
        >
          Sign in
        </a>
      </nav>

      <div className="flex-1 flex flex-col items-center justify-center gap-6 md:gap-8 px-6 pb-4">
        <LandingHero />
        <SpecimenCards />
      </div>

      <div
        className="flex items-end overflow-hidden flex-shrink-0"
        style={{ height: "clamp(64px, 20vh, 160px)" }}
      >
        <LandmarkSkyline />
      </div>
    </main>
  );
}
