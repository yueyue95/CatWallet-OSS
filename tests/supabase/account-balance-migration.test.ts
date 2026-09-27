import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve(
    process.cwd(),
    "supabase/migrations/20260920090000_account_balance_entries.sql",
  ),
  "utf8",
)
  .toLowerCase()
  .replace(/\s+/g, " ")
  .trim();

describe("account balance migration", () => {
  it("adds an additive balance ledger with one opening balance per account", () => {
    expect(migration).toContain(
      "create table if not exists public.account_balance_entries",
    );
    expect(migration).toContain(
      "create unique index if not exists account_balance_entries_one_opening_idx on public.account_balance_entries (user_id, payment_method_id) where entry_type = 'opening_balance';",
    );
    expect(migration).toContain(
      "references public.payment_methods (id) on delete restrict",
    );
    expect(migration).toContain(
      "add column if not exists balance_tracking_enabled boolean not null default false",
    );
    expect(migration).toContain(
      "type in ('pix', 'debit', 'credit', 'cash', 'bank', 'boleto', 'other', 'ewallet')",
    );
  });

  it("enforces ownership, exact cents, and operation-specific RLS", () => {
    expect(migration).toContain(
      "alter table public.account_balance_entries force row level security;",
    );
    expect(migration).toContain("for select");
    expect(migration).toContain("for insert");
    expect(migration).toContain("for update");
    expect(migration).toContain("for delete");
    expect(migration).toContain("(select auth.uid()) = user_id");
    expect(migration).toContain("amount = round(amount, 2)");
    expect(migration).not.toMatch(/truncate|drop table|delete\s+from/);
  });
});

const cleanupMigration = readFileSync(
  resolve(
    process.cwd(),
    "supabase/migrations/20260921100000_payment_method_cleanup.sql",
  ),
  "utf8",
)
  .toLowerCase()
  .replace(/\s+/g, " ")
  .trim();

describe("payment method cleanup migration", () => {
  it("uses an invoker RPC with owner-scoped atomic cleanup", () => {
    expect(cleanupMigration).toContain(
      "create or replace function public.delete_payment_method_if_empty",
    );
    expect(cleanupMigration).toContain("security invoker");
    expect(cleanupMigration).toContain("select auth.uid()");
    expect(cleanupMigration).toContain("deleted_at is null");
    expect(cleanupMigration).toContain("deleted_at is not null");
    expect(cleanupMigration).toContain(
      "delete from public.account_balance_entries",
    );
    expect(cleanupMigration).toContain("delete from public.payment_methods");
    expect(cleanupMigration).toContain(
      "grant execute on function public.delete_payment_method_if_empty(uuid) to authenticated",
    );
    expect(cleanupMigration).not.toContain("security definer");
    expect(cleanupMigration).not.toMatch(/truncate|drop table/);
  });
});
