import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const migrationPath = resolve(
  process.cwd(),
  "supabase/migrations/20260918153651_m_011_catwallet_finance_models.sql",
);

const migration = readFileSync(migrationPath, "utf8")
  .toLowerCase()
  .replace(/\s+/g, " ")
  .trim();

describe("CatWallet finance migration", () => {
  it("uses partial unique indexes for nullable retirement allocation targets", () => {
    expect(migration).not.toContain(
      "unique (user_id, installment_group_id, target_type, target_id)",
    );

    expect(migration).toContain(
      "create unique index if not exists installment_retirement_allocations_target_idx on public.installment_retirement_allocations (user_id, installment_group_id, target_type, target_id) where target_type <> 'savings';",
    );
    expect(migration).toContain(
      "create unique index if not exists installment_retirement_allocations_savings_idx on public.installment_retirement_allocations (user_id, installment_group_id) where target_type = 'savings';",
    );
  });

  it("keeps the savings target constrained to a null target_id", () => {
    expect(migration).toContain(
      "(target_type = 'savings' and target_id is null)",
    );
    expect(migration).toContain(
      "(target_type in ('category', 'sinking_fund') and target_id is not null)",
    );
  });
});

const malaysiaDefaultsMigrationPath = resolve(
  process.cwd(),
  "supabase/migrations/20260918153700_m_20260916080748_catwallet_malaysia_payment_defaults.sql",
);

const installmentAmountModesMigrationPath = resolve(
  process.cwd(),
  "supabase/migrations/20260918153725_m_20260916120000_installment_amount_modes.sql",
);

const installmentAmountModesMigration = readFileSync(
  installmentAmountModesMigrationPath,
  "utf8",
)
  .toLowerCase()
  .replace(/\s+/g, " ")
  .trim();

describe("Installment amount modes migration", () => {
  it("adds explicit mode, entered amount, and current period metadata", () => {
    expect(installmentAmountModesMigration).toContain(
      "add column if not exists installment_amount_mode text",
    );
    expect(installmentAmountModesMigration).toContain(
      "add column if not exists installment_amount numeric",
    );
    expect(installmentAmountModesMigration).toContain(
      "add column if not exists installment_current_number integer",
    );
  });

  it("marks existing grouped transactions as total mode without resetting data", () => {
    expect(installmentAmountModesMigration).toContain(
      "set installment_amount_mode = 'total'",
    );
    expect(installmentAmountModesMigration).toContain(
      "sum(abs(amount)) as total_amount",
    );
    expect(installmentAmountModesMigration).not.toMatch(
      /truncate|drop table|delete\s+from/,
    );
  });
});

const funMoneyTransactionsMigrationPath = resolve(
  process.cwd(),
  "supabase/migrations/20260918153739_m_20260916130000_fun_money_transaction_flag.sql",
);

const funMoneyTransactionsMigration = readFileSync(
  funMoneyTransactionsMigrationPath,
  "utf8",
)
  .toLowerCase()
  .replace(/\s+/g, " ")
  .trim();

describe("Fun money transaction flag migration", () => {
  it("adds an explicit false-by-default flag and indexes active rows", () => {
    expect(funMoneyTransactionsMigration).toContain(
      "add column if not exists counts_toward_fun_money boolean not null default false",
    );
    expect(funMoneyTransactionsMigration).toContain(
      "create index if not exists transactions_fun_money_month_idx",
    );
    expect(funMoneyTransactionsMigration).toContain(
      "where counts_toward_fun_money = true and deleted_at is null",
    );
  });

  it("prevents non-expense rows from being marked as fun money", () => {
    expect(funMoneyTransactionsMigration).toContain(
      "check (kind = 'expense' or counts_toward_fun_money = false)",
    );
  });
});

const malaysiaDefaultsMigration = readFileSync(
  malaysiaDefaultsMigrationPath,
  "utf8",
)
  .toLowerCase()
  .replace(/\s+/g, " ")
  .trim();

describe("Malaysia payment defaults migration", () => {
  it("keeps Pix out of new-user defaults without touching existing rows", () => {
    expect(malaysiaDefaultsMigration).toContain(
      "create or replace function private.handle_new_user()",
    );
    expect(malaysiaDefaultsMigration).not.toContain("(new.id, 'pix'");
    expect(malaysiaDefaultsMigration).toContain(
      "(new.id, 'cash', 'cash', null)",
    );
    expect(malaysiaDefaultsMigration).toContain(
      "(new.id, 'bank', 'bank', null)",
    );
    expect(malaysiaDefaultsMigration).toContain(
      "(new.id, 'credit card', 'credit', 0)",
    );
    expect(malaysiaDefaultsMigration).toContain(
      "(new.id, 'debit card', 'debit', null)",
    );
    expect(malaysiaDefaultsMigration).not.toMatch(
      /delete\s+from\s+public\.payment_methods/,
    );
  });
});
