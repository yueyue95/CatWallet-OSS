# Deterministic local demo

CatWallet's demo tooling exists for documentation, visual review, and local development. It never needs a hosted Supabase project.

## Safety model

- Only `localhost` and `127.0.0.1` Supabase endpoints are accepted.
- `supabase db reset --local --yes` is invoked before seeding.
- No `.env.local`, Vercel environment, service-role key, or remote Auth user is read.
- The generated runtime configuration is stored under ignored `.demo/` and contains only local, short-lived values.
- The reference date is fixed at 2026-09-15, the time zone is `Asia/Kuala_Lumpur`, and all visible data is fictional.

## Commands

```bash
pnpm exec supabase start
pnpm demo:reset
pnpm demo:screenshots
```

`demo:reset` creates the fictional Everyday Account, Demo Savings, Demo Visa, income, expenses, a repayment scenario, installments, fixed commitments, a budget, a sinking fund, a goal, and a cooling-list item.

`demo:screenshots` resets again, launches CatWallet on loopback, signs in through the real UI, checks browser console errors and visible text, and captures English and Simplified Chinese desktop/mobile screenshots. It also creates `docs/images/demo/contact-sheet.png` for visual review.

Do not reuse demo credentials outside the disposable local stack. Stop the stack with `pnpm exec supabase stop` when finished.
