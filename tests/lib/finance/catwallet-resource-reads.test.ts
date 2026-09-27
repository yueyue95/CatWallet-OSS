import { describe, expect, it, vi } from "vitest";

import {
  listFixedCommitments,
  listSinkingFunds,
} from "@/lib/finance/catwallet";
import type { AuthenticatedUserContext } from "@/lib/finance/transactions";

const USER_ID = "11111111-1111-4111-8111-111111111111";

function context(row: Record<string, unknown>) {
  const query = {
    eq: vi.fn(),
    is: vi.fn(),
    order: vi.fn(),
    select: vi.fn(),
    then: (resolve: (value: unknown) => void) =>
      Promise.resolve({ data: [row], error: null }).then(resolve),
  };
  for (const method of ["eq", "is", "order", "select"] as const) {
    query[method].mockReturnValue(query);
  }
  const ctx = {
    supabase: { from: vi.fn(() => query) },
    userId: USER_ID,
  } as unknown as AuthenticatedUserContext;
  return { ctx, query };
}

describe("archived finance resource reads", () => {
  it("can read an archived fixed commitment without changing the default active query", async () => {
    const { ctx, query } = context({
      amount: 0.14,
      cadence: "monthly",
      categories: null,
      category_id: null,
      custom_interval_months: null,
      deleted_at: "2026-09-25T00:00:00Z",
      end_date: null,
      id: "commitment-id",
      include_in_safe_to_spend: true,
      is_enabled: false,
      name: "Archived",
      payment_method_id: null,
      payment_methods: null,
      start_date: "2026-10-01",
    });

    expect(
      await listFixedCommitments(ctx, { includeArchived: true }),
    ).toMatchObject([
      {
        archivedAt: "2026-09-25T00:00:00Z",
        id: "commitment-id",
        isEnabled: false,
      },
    ]);
    expect(query.is).not.toHaveBeenCalledWith("deleted_at", null);
  });

  it("can read an archived sinking fund", async () => {
    const { ctx, query } = context({
      current_amount: 0,
      deleted_at: "2026-09-25T00:00:00Z",
      emoji: "🐱",
      expected_use_date: null,
      id: "fund-id",
      is_enabled: false,
      monthly_target: 0,
      name: "Archived",
      notes: null,
      target_amount: null,
    });

    expect(
      await listSinkingFunds(ctx, { includeArchived: true }),
    ).toMatchObject([
      { archivedAt: "2026-09-25T00:00:00Z", id: "fund-id", isEnabled: false },
    ]);
    expect(query.is).not.toHaveBeenCalledWith("deleted_at", null);
  });
});
