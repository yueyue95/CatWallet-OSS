import "server-only";

import {
  getUserContext,
  type AuthenticatedUserContext,
} from "@/lib/finance/transactions";

import {
  getEffectiveCoolingStatus,
  type CoolingItem,
  type CoolingItemInput,
  type CoolingItemStatus,
} from "@/lib/finance/cooling-model";

export {
  getCoolingReleaseAt,
  getCoolingRemainingMs,
} from "@/lib/finance/cooling-model";
export type {
  CoolingItem,
  CoolingItemStatus,
} from "@/lib/finance/cooling-model";

export type { CoolingItemInput } from "@/lib/finance/cooling-model";

type CoolingItemRow = {
  added_at: string;
  amount_cents: number | string;
  cooling_days: number | string;
  created_at: string;
  id: string;
  name: string;
  notes: string | null;
  purchased_transaction_id: string | null;
  status: CoolingItemStatus;
  updated_at: string;
  url: string | null;
};

function normalizeName(value: string) {
  const name = value.trim();
  if (!name || name.length > 160) throw new Error("Name is invalid.");
  return name;
}

function normalizeAmountCents(value: number) {
  if (!Number.isInteger(value) || value <= 0 || value > 100_000_000_000) {
    throw new Error("Amount is invalid.");
  }
  return value;
}

function normalizeCoolingDays(value: number | undefined) {
  const days = value ?? 7;
  if (!Number.isInteger(days) || days < 0 || days > 3650) {
    throw new Error("Cooling days are invalid.");
  }
  return days;
}

function normalizeUrl(value: string | null | undefined) {
  if (!value?.trim()) return null;
  const url = value.trim();
  if (url.length > 2048) throw new Error("URL is invalid.");
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      throw new Error("URL is invalid.");
    }
  } catch {
    throw new Error("URL is invalid.");
  }
  return url;
}

function mapCoolingItem(row: CoolingItemRow): CoolingItem {
  return {
    addedAt: row.added_at,
    amountCents: Number(row.amount_cents),
    coolingDays: Number(row.cooling_days),
    createdAt: row.created_at,
    id: row.id,
    name: row.name,
    notes: row.notes,
    purchasedTransactionId: row.purchased_transaction_id,
    status: row.status,
    updatedAt: row.updated_at,
    url: row.url,
  };
}

function effectiveItem(item: CoolingItem, now = new Date()): CoolingItem {
  return { ...item, status: getEffectiveCoolingStatus(item, now) };
}

async function resolveContext(
  userContext?: AuthenticatedUserContext,
): Promise<AuthenticatedUserContext> {
  return userContext ?? (await getUserContext());
}

const coolingItemSelect =
  "id, name, amount_cents, added_at, cooling_days, notes, url, status, purchased_transaction_id, created_at, updated_at";

export async function listCoolingItems(
  userContext?: AuthenticatedUserContext,
  now = new Date(),
) {
  const ctx = await resolveContext(userContext);
  const { data, error } = await ctx.supabase
    .from("cooling_items")
    .select(coolingItemSelect)
    .eq("user_id", ctx.userId)
    .order("created_at", { ascending: false });

  if (error) throw new Error(`Unable to load cooling items: ${error.message}`);
  return ((data ?? []) as unknown as CoolingItemRow[]).map((row) =>
    effectiveItem(mapCoolingItem(row), now),
  );
}

export async function getCoolingItem(
  id: string,
  userContext?: AuthenticatedUserContext,
  now = new Date(),
) {
  const ctx = await resolveContext(userContext);
  const { data, error } = await ctx.supabase
    .from("cooling_items")
    .select(coolingItemSelect)
    .eq("id", id)
    .eq("user_id", ctx.userId)
    .maybeSingle();

  if (error) throw new Error(`Unable to load cooling item: ${error.message}`);
  return data
    ? effectiveItem(mapCoolingItem(data as unknown as CoolingItemRow), now)
    : null;
}

export async function createCoolingItem(
  input: CoolingItemInput,
  userContext?: AuthenticatedUserContext,
) {
  const ctx = await resolveContext(userContext);
  const payload = {
    amount_cents: normalizeAmountCents(input.amountCents),
    cooling_days: normalizeCoolingDays(input.coolingDays),
    ...(input.id ? { id: input.id } : {}),
    name: normalizeName(input.name),
    notes: input.notes?.trim() || null,
    status: "cooling" as const,
    url: normalizeUrl(input.url),
    user_id: ctx.userId,
  };
  const { data, error } = await ctx.supabase
    .from("cooling_items")
    .insert(payload)
    .select(coolingItemSelect)
    .single();

  if (error) throw new Error(`Unable to create cooling item: ${error.message}`);
  return mapCoolingItem(data as unknown as CoolingItemRow);
}

export async function updateCoolingItem(
  id: string,
  input: CoolingItemInput,
  userContext?: AuthenticatedUserContext,
) {
  const ctx = await resolveContext(userContext);
  const payload = {
    amount_cents: normalizeAmountCents(input.amountCents),
    cooling_days: normalizeCoolingDays(input.coolingDays),
    name: normalizeName(input.name),
    notes: input.notes?.trim() || null,
    url: normalizeUrl(input.url),
  };
  const { data, error } = await ctx.supabase
    .from("cooling_items")
    .update(payload)
    .eq("id", id)
    .eq("user_id", ctx.userId)
    .in("status", ["cooling", "ready"])
    .is("purchased_transaction_id", null)
    .select(coolingItemSelect)
    .maybeSingle();
  if (error) throw new Error(`Unable to update cooling item: ${error.message}`);
  if (!data) throw new Error("Cooling item not found or already completed.");
  return mapCoolingItem(data as unknown as CoolingItemRow);
}

export async function deleteCoolingItem(
  id: string,
  userContext?: AuthenticatedUserContext,
) {
  const ctx = await resolveContext(userContext);
  const { data, error } = await ctx.supabase
    .from("cooling_items")
    .delete()
    .eq("id", id)
    .eq("user_id", ctx.userId)
    .in("status", ["cooling", "ready"])
    .is("purchased_transaction_id", null)
    .select("id")
    .maybeSingle();
  if (error) throw new Error(`Unable to delete cooling item: ${error.message}`);
  if (!data) throw new Error("Cooling item cannot be deleted after an action.");
}

export async function abandonCoolingItem(
  id: string,
  userContext?: AuthenticatedUserContext,
) {
  const ctx = await resolveContext(userContext);
  const { data, error } = await ctx.supabase
    .from("cooling_items")
    .update({ status: "abandoned" })
    .eq("id", id)
    .eq("user_id", ctx.userId)
    .in("status", ["cooling", "ready"])
    .select(coolingItemSelect)
    .maybeSingle();

  if (error)
    throw new Error(`Unable to abandon cooling item: ${error.message}`);
  if (!data) throw new Error("Cooling item is no longer available.");
  return mapCoolingItem(data as unknown as CoolingItemRow);
}

export async function markCoolingItemPurchased(
  id: string,
  transactionId: string,
  userContext?: AuthenticatedUserContext,
) {
  const ctx = await resolveContext(userContext);
  const existing = await getCoolingItem(id, ctx);
  if (!existing) throw new Error("Cooling item was not found.");
  if (
    existing.status === "purchased" &&
    existing.purchasedTransactionId === transactionId
  ) {
    return existing;
  }
  if (existing.status === "abandoned") {
    throw new Error("Abandoned cooling item cannot be purchased.");
  }
  if (existing.status === "purchased") {
    throw new Error("Cooling item is already purchased.");
  }

  const { data: transaction, error: transactionError } = await ctx.supabase
    .from("transactions")
    .select("id")
    .eq("id", transactionId)
    .eq("user_id", ctx.userId)
    .is("deleted_at", null)
    .maybeSingle();
  if (transactionError) {
    throw new Error(
      `Unable to validate purchased transaction: ${transactionError.message}`,
    );
  }
  if (!transaction) throw new Error("Purchased transaction is invalid.");

  const { data, error } = await ctx.supabase
    .from("cooling_items")
    .update({
      purchased_transaction_id: transactionId,
      status: "purchased",
    })
    .eq("id", id)
    .eq("user_id", ctx.userId)
    .in("status", ["cooling", "ready"])
    .select(coolingItemSelect)
    .maybeSingle();

  if (error)
    throw new Error(`Unable to link purchased cooling item: ${error.message}`);
  if (!data) {
    const latest = await getCoolingItem(id, ctx);
    if (
      latest?.status === "purchased" &&
      latest.purchasedTransactionId === transactionId
    ) {
      return latest;
    }
    throw new Error("Cooling item was already changed.");
  }
  return mapCoolingItem(data as unknown as CoolingItemRow);
}
