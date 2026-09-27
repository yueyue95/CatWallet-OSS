export type CoolingItemStatus = "cooling" | "ready" | "abandoned" | "purchased";

export type CoolingItem = {
  addedAt: string;
  amountCents: number;
  coolingDays: number;
  createdAt: string;
  id: string;
  name: string;
  notes: string | null;
  purchasedTransactionId: string | null;
  status: CoolingItemStatus;
  updatedAt: string;
  url: string | null;
};

export type CoolingItemInput = {
  amountCents: number;
  coolingDays?: number;
  id?: string;
  name: string;
  notes?: string | null;
  url?: string | null;
};

export function getCoolingReleaseAt(
  item: Pick<CoolingItem, "addedAt" | "coolingDays">,
) {
  return new Date(
    Date.parse(item.addedAt) + item.coolingDays * 24 * 60 * 60 * 1000,
  );
}

export function getCoolingRemainingMs(
  item: Pick<CoolingItem, "addedAt" | "coolingDays" | "status">,
  now = new Date(),
) {
  if (item.status !== "cooling") return 0;
  return Math.max(0, getCoolingReleaseAt(item).getTime() - now.getTime());
}

export function getEffectiveCoolingStatus(
  item: Pick<CoolingItem, "addedAt" | "coolingDays" | "status">,
  now = new Date(),
): CoolingItemStatus {
  if (
    item.status === "cooling" &&
    getCoolingReleaseAt(item).getTime() <= now.getTime()
  ) {
    return "ready";
  }

  return item.status;
}
