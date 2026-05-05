/**
 * Rise — Privacy policy
 *
 * Stub page seeded by PHI-31 Part 2. The pre-signup itinerary preview
 * (cookie-keyed anon session, 14-day TTL) requires a written disclosure
 * per the design doc and your sign-off on policy-only (no banner). This
 * page contains the minimum disclosure for that path. Replace / extend
 * with full policy text reviewed by your legal contact before launch.
 */
export const metadata = { title: "Privacy · Rise" };

export default function PrivacyPage() {
  return (
    <main className="min-h-screen bg-[#f8f6f1] px-6 py-14">
      <article className="max-w-2xl mx-auto prose prose-sm sm:prose-base prose-headings:text-[#0e2a47] prose-p:text-[#4a6580]">
        <p className="text-xs uppercase tracking-widest font-bold text-[#1a6b7f] mb-2">
          Privacy
        </p>
        <h1 className="text-3xl font-extrabold text-[#0e2a47] mb-2">
          How Rise handles your data
        </h1>
        <p className="text-sm text-[#6a7f8f] mb-6">Last updated: 2026-05-05</p>

        <h2 className="text-lg font-bold text-[#0e2a47] mt-8 mb-2">
          Trip details we collect before you create an account
        </h2>
        <p className="text-[#4a6580]">
          When you start planning a trip on Rise, we collect the trip details
          you provide — destination, dates, party composition, travel style,
          dietary or accessibility constraints, and similar preferences — so
          we can generate a personalised itinerary preview before you create
          an account.
        </p>
        <p className="text-[#4a6580] mt-3">
          This data is stored on a temporary anonymous session that is keyed
          to your browser via an HttpOnly cookie. The session is retained for
          up to 14 days and is automatically deleted if you don&apos;t create
          an account in that window. If you create an account, this data is
          migrated to your user profile.
        </p>

        <h2 className="text-lg font-bold text-[#0e2a47] mt-8 mb-2">
          What we don&apos;t do
        </h2>
        <ul className="list-disc pl-6 text-[#4a6580]">
          <li>We don&apos;t sell your trip details to third parties.</li>
          <li>We don&apos;t share your account email or trip details with
            advertising networks.</li>
          <li>We don&apos;t use your trip preferences to train models without
            your explicit opt-in.</li>
        </ul>

        <h2 className="text-lg font-bold text-[#0e2a47] mt-8 mb-2">
          Third-party processing
        </h2>
        <p className="text-[#4a6580]">
          To generate trip suggestions and itineraries we send your trip
          context (destination, dates, party, style, constraints) to:
        </p>
        <ul className="list-disc pl-6 text-[#4a6580]">
          <li>
            <strong>Anthropic</strong> — to generate activity recommendations,
            itineraries, and rationales. Subject to{" "}
            <a
              href="https://www.anthropic.com/legal/privacy"
              target="_blank"
              rel="noreferrer"
              className="text-[#1a6b7f] underline-offset-4 hover:underline"
            >
              Anthropic&apos;s privacy policy
            </a>.
          </li>
          <li>
            <strong>Google Maps Platform</strong> — to autocomplete place
            names and resolve geographic data.
          </li>
          <li>
            <strong>Supabase</strong> — to store your account, trip drafts,
            and itineraries.
          </li>
          <li>
            <strong>Vercel</strong> — to host the application.
          </li>
        </ul>

        <h2 className="text-lg font-bold text-[#0e2a47] mt-8 mb-2">
          Your rights
        </h2>
        <p className="text-[#4a6580]">
          If you have an account with Rise, you can request deletion of your
          account and all associated data at any time by contacting us. If
          you&apos;re an EU/UK resident, GDPR / UK GDPR rights apply (access,
          rectification, erasure, portability, objection). If you&apos;re a
          California resident, CCPA rights apply.
        </p>

        <h2 className="text-lg font-bold text-[#0e2a47] mt-8 mb-2">Contact</h2>
        <p className="text-[#4a6580]">
          Questions about this policy: <a
            href="mailto:privacy@philiponproduct.pm"
            className="text-[#1a6b7f] underline-offset-4 hover:underline"
          >privacy@philiponproduct.pm</a>.
        </p>

        <p className="text-xs text-[#6a7f8f] mt-12 italic">
          This is a starting policy seeded by the PHI-31 design doc. Have it
          reviewed by your legal contact before relying on it for production.
        </p>
      </article>
    </main>
  );
}
