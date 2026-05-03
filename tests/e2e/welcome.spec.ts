import { test, expect, Route } from "@playwright/test";

/**
 * /welcome step-5 visual snapshot + duplicate-text guard.
 *
 * This test exists primarily to prevent regression of PHI-25 (duplicate body
 * text on the "Save your trip plan" screen) and to give the team a place
 * to add more onboarding-flow tests as PHI-26..PHI-29 ship.
 *
 * Strategy:
 *  - Mock the AI / DB endpoints so the test is deterministic and fast and
 *    doesn't require Anthropic API keys, Supabase, or Google Maps.
 *  - Walk through steps 0–4, then assert step 5 renders correctly.
 *  - Two assertions on step 5: a DOM-count check that the description
 *    string appears exactly once (the PHI-25 regression guard), and a
 *    visual snapshot for broader regression coverage.
 */

// 3 activities in the exact format that parseActivities() expects:
//   **Name** — Category\nDescription\n*When: timing*
const MOCK_ACTIVITIES_STREAM = [
  "**Pastéis de Belém Tasting** — Food & Dining",
  "Original home of the pastel de nata, served since 1837.",
  "*When: morning, ~45 min*",
  "",
  "**Jerónimos Monastery** — Cultural/Historic",
  "UNESCO-listed Manueline monastery next door to Pastéis de Belém.",
  "*When: morning, ~90 min*",
  "",
  "**Praia de Carcavelos** — Outdoor/Adventure",
  "The widest, flattest beach in the Lisbon region.",
  "*When: afternoon, ~3 hours*",
  "",
].join("\n");

const STEP_5_DESCRIPTION =
  "Your activity plan, transport advice, and trip summary are ready.";

test.beforeEach(async ({ page }) => {
  // Stream the mock activities text as the response body.
  await page.route("**/api/activities-stream", async (route: Route) => {
    await route.fulfill({
      status: 200,
      contentType: "text/plain; charset=utf-8",
      body: MOCK_ACTIVITIES_STREAM,
    });
  });

  // Chips endpoint returns a small fixed set so the rating UI works
  // (only relevant if the user clicks thumbs-down; thumbs-up doesn't fetch).
  await page.route("**/api/activity-chips", async (route: Route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        chips: [
          { label: "Done it before", type: "hard_exclusion" },
          { label: "Not really my thing", type: "soft_signal" },
        ],
      }),
    });
  });

  // No-op the analytics endpoint so it doesn't error.
  await page.route("**/api/activity-feedback", async (route: Route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
  });

  // Mock the partial-traveler write at step 3 advance.
  await page.route("**/api/travelers", async (route: Route) => {
    if (route.request().method() === "POST") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ id: "test-traveler-id" }),
      });
      return;
    }
    await route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
  });
});

/**
 * PHI-26 / RISE-102 — persistent trip-type confirmation label.
 *
 * Walks to step 3 and verifies the label updates correctly across the
 * four key composition cases: ambiguous 2-adult, couple-picked, solo
 * (chip section hidden), and family (chip section hidden).
 */
test("welcome step 3 shows persistent trip-type label across compositions", async ({
  page,
}) => {
  await page.goto("/welcome");

  // Walk to step 3
  await page.getByPlaceholder("e.g. Tokyo, Japan").fill("Lisbon");
  await page.getByPlaceholder("e.g. Tokyo, Japan").press("Enter");
  await page.locator('input[type="date"]').first().fill("2026-06-15");
  await page.locator('input[type="date"]').nth(1).fill("2026-06-22");
  await page.getByRole("button", { name: /Continue/i }).click();
  await page.getByRole("button", { name: /haven't booked yet/i }).click();

  const label = page.getByTestId("trip-type-label");

  // Default: 2 adults, 0 children, no chip picked → neutral prompt
  await expect(label).toHaveText("Planning a trip for two");

  // Pick Couple chip → couple's trip
  await page.getByRole("button", { name: /Couple/i }).click();
  await expect(label).toHaveText("Planning a couple's trip");

  // Pick Friend group → trip for two friends
  await page.getByRole("button", { name: /Friend group/i }).click();
  await expect(label).toHaveText("Planning a trip for two friends");

  // Decrement adults to 1 → Solo. The Trip Type chip section disappears.
  // The "Adults" label sits in the same column as the +/- stepper buttons,
  // so target by the column structure rather than by global button names.
  const adultsCol = page.locator("span").filter({ hasText: /^Adults$/ }).locator("..");
  await adultsCol.getByRole("button", { name: "−" }).click();
  await expect(label).toHaveText("Planning a solo trip");
  // Chip section should be gone (no Couple chip visible to the user)
  await expect(page.getByRole("button", { name: /Couple/i })).toHaveCount(0);

  // Bump back to 2 adults, then add 2 children
  await adultsCol.getByRole("button", { name: "+" }).click();
  const childrenCol = page.locator("span").filter({ hasText: /^Children$/ }).locator("..");
  await childrenCol.getByRole("button", { name: "+" }).click();
  await childrenCol.getByRole("button", { name: "+" }).click();

  // PHI-27: children no longer default to "Under 2". The label should
  // prompt the user to pick ages for each child.
  await expect(label).toHaveText(
    "Planning a family trip with 2 children — pick an age range for each"
  );

  // Change child 1 to 5–8, child 2 to 9–12
  const child1Row = page.locator('text="Child 1"').locator("..");
  await child1Row.getByRole("button", { name: "5–8" }).click();
  const child2Row = page.locator('text="Child 2"').locator("..");
  await child2Row.getByRole("button", { name: "9–12" }).click();

  await expect(label).toHaveText(
    "Planning a family trip with 2 children (5–8, 9–12)"
  );
});

/**
 * PHI-27 / RISE-103 — 13–17 age bucket + Continue gating + Teen-friendly chip.
 */
test("welcome step 3 supports teen ages and gates Continue on age picks", async ({
  page,
}) => {
  await page.goto("/welcome");

  // Walk to step 3
  await page.getByPlaceholder("e.g. Tokyo, Japan").fill("Lisbon");
  await page.getByPlaceholder("e.g. Tokyo, Japan").press("Enter");
  await page.locator('input[type="date"]').first().fill("2026-06-15");
  await page.locator('input[type="date"]').nth(1).fill("2026-06-22");
  await page.getByRole("button", { name: /Continue/i }).click();
  await page.getByRole("button", { name: /haven't booked yet/i }).click();

  // Add a child
  const childrenCol = page.locator("span").filter({ hasText: /^Children$/ }).locator("..");
  await childrenCol.getByRole("button", { name: "+" }).click();

  // Continue button should be disabled — no age picked yet
  const continueBtn = page.getByRole("button", { name: /^Continue/i });
  await expect(continueBtn).toBeDisabled();

  // The 13–17 bucket should exist as a fifth option
  const child1Row = page.locator('text="Child 1"').locator("..");
  await expect(child1Row.getByRole("button", { name: "13–17" })).toBeVisible();

  // Pick 13–17 → Continue still gated by trip type? family is auto-set
  // (childrenAges.length > 0) so travelCompany should already be "family".
  await child1Row.getByRole("button", { name: "13–17" }).click();

  // Label reflects teen age
  await expect(page.getByTestId("trip-type-label")).toHaveText(
    "Planning a family trip with 1 child (13–17)"
  );

  // Continue is enabled now
  await expect(continueBtn).toBeEnabled();

  // Teen-friendly chip should be in the travel-style options for family
  await expect(
    page.getByRole("button", { name: "Teen-friendly", exact: true })
  ).toBeVisible();
});

test("welcome step 5 renders with description shown exactly once", async ({ page }) => {
  await page.goto("/welcome");

  // ── Step 0: Landing — type destination, press Enter ────────────────────
  const destinationInput = page.getByPlaceholder("e.g. Tokyo, Japan");
  await destinationInput.fill("Lisbon");
  await destinationInput.press("Enter");

  // ── Step 1: Dates ─────────────────────────────────────────────────────
  // The destination input is editable here too; we leave it as-is.
  const departureInput = page.locator('input[type="date"]').first();
  const returnInput = page.locator('input[type="date"]').nth(1);
  await departureInput.fill("2026-06-15");
  await returnInput.fill("2026-06-22");
  await page.getByRole("button", { name: /Continue/i }).click();

  // ── Step 2: Hotel — click skip ────────────────────────────────────────
  await page.getByRole("button", { name: /haven't booked yet/i }).click();

  // ── Step 3: Profile — pick partner trip type (default 2 adults), one style, budget ─
  // Default adult count is 2, default children is 0 → trip type chips visible.
  await page.getByRole("button", { name: /Couple/i }).click();
  await page.getByRole("button", { name: "Cultural", exact: true }).click();
  await page.getByRole("button", { name: "Comfortable" }).click();
  await page.getByRole("button", { name: /Continue/i }).click();

  // ── Step 4: Activities — wait for cards, thumbs-up the first one ──────
  // Cards stream in via the mocked route; first card title is Pastéis de Belém.
  const firstCard = page.getByText("Pastéis de Belém Tasting", { exact: false });
  await expect(firstCard).toBeVisible({ timeout: 10_000 });

  // Find the thumbs-up button on the first card and click.
  // Buttons have title="Interested" set in the JSX.
  const interestedButtons = page.locator('button[title="Interested"]');
  await expect(interestedButtons.first()).toBeVisible();
  await interestedButtons.first().click();

  // Continue with 1 rated.
  await page.getByRole("button", { name: /Continue with/i }).click();

  // ── Step 5: Save your trip plan ───────────────────────────────────────
  // The headline confirms we're on the right step.
  await expect(
    page.getByRole("heading", { name: "Save your trip plan." })
  ).toBeVisible();

  // PHI-25 regression guard: the description string must appear EXACTLY ONCE.
  // Before the fix, this screen rendered the description twice — once via
  // the centralized subs[5] body slot, and once hardcoded as a smaller grey
  // paragraph below the Skipped activities panel.
  const descriptionMatches = await page
    .getByText(STEP_5_DESCRIPTION, { exact: false })
    .count();
  expect(descriptionMatches, "description should appear exactly once").toBe(1);

  // Broader visual regression: snapshot the step-5 viewport.
  // Maintained via `npm run test:e2e -- --update-snapshots`.
  await expect(page).toHaveScreenshot("welcome-step-5.png", {
    // Mask the date-dependent destination header if any future revision
    // includes dynamic timestamps; not currently needed but cheap to add.
    fullPage: false,
  });
});
