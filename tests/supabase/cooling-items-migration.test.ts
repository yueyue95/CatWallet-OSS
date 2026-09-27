import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve(
    process.cwd(),
    "supabase/migrations/20260918153750_m_20260917100000_cooling_items.sql",
  ),
  "utf8",
)
  .toLowerCase()
  .replace(/\s+/g, " ")
  .trim();

describe("Cooling items migration", () => {
  it("defines the cooling item lifecycle and purchase link", () => {
    expect(migration).toContain(
      "create table if not exists public.cooling_items",
    );
    expect(migration).toContain("amount_cents bigint not null");
    expect(migration).toContain("added_at timestamptz not null default now()");
    expect(migration).toContain("cooling_days smallint not null default 7");
    expect(migration).toContain("status text not null default 'cooling'");
    expect(migration).toContain("purchased_transaction_id uuid");
    expect(migration).toContain(
      "foreign key (purchased_transaction_id) references public.transactions(id)",
    );
  });

  it("enforces ownership with RLS and does not add a scheduled job", () => {
    expect(migration).toContain(
      "alter table public.cooling_items enable row level security",
    );
    expect(migration).toContain("user_id = (select auth.uid())");
    expect(migration).not.toMatch(/cron|pg_cron|schedule/);
  });
});
