This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Tests

End-to-end and visual regression tests use [Playwright](https://playwright.dev). The test floor is small on purpose — one onboarding spec — and grows as features ship.

```bash
# Run all tests (boots `next dev` automatically)
npm run test:e2e

# Update visual snapshots after an intentional UI change
npm run test:e2e:update

# Run a single spec
npx playwright test tests/e2e/welcome.spec.ts
```

Specs live under `tests/e2e/`. Visual snapshot baselines are committed alongside the spec under `tests/e2e/welcome.spec.ts-snapshots/`. Snapshots are pinned to Chromium at 1280×800 to keep them deterministic across machines.

If a snapshot fails on a non-Linux dev machine due to font / OS rendering differences, regenerate locally with `npm run test:e2e:update` and commit the updated baseline.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
