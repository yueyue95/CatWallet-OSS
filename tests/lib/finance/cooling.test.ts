import { describe, expect, it } from "vitest";

import {
  getCoolingRemainingMs,
  getEffectiveCoolingStatus,
  type CoolingItem,
} from "@/lib/finance/cooling-model";

const addedAt = "2026-09-17T00:00:00.000Z";

function item(overrides: Partial<CoolingItem> = {}): CoolingItem {
  return {
    addedAt,
    amountCents: 80_000,
    coolingDays: 7,
    createdAt: addedAt,
    id: "cooling-item-1",
    name: "Canon 打印机",
    notes: null,
    purchasedTransactionId: null,
    status: "cooling",
    updatedAt: addedAt,
    url: null,
    ...overrides,
  };
}

describe("cooling item status", () => {
  it("keeps an item cooling and exposes the live remaining time", () => {
    const now = new Date("2026-09-18T12:00:00.000Z");

    expect(getEffectiveCoolingStatus(item(), now)).toBe("cooling");
    expect(getCoolingRemainingMs(item(), now)).toBe(5.5 * 24 * 60 * 60 * 1000);
  });

  it("becomes ready after coolingDays without a scheduled database update", () => {
    const now = new Date("2026-09-24T00:00:00.000Z");

    expect(getEffectiveCoolingStatus(item(), now)).toBe("ready");
    expect(getCoolingRemainingMs(item(), now)).toBe(0);
  });

  it("does not rewrite abandoned or purchased states", () => {
    const now = new Date("2026-09-30T00:00:00.000Z");

    expect(getEffectiveCoolingStatus(item({ status: "abandoned" }), now)).toBe(
      "abandoned",
    );
    expect(
      getEffectiveCoolingStatus(
        item({ status: "purchased", purchasedTransactionId: "tx-1" }),
        now,
      ),
    ).toBe("purchased");
  });
});
