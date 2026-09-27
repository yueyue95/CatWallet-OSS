"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import {
  abandonCoolingItem,
  createCoolingItem,
  type CoolingItemInput,
} from "@/lib/finance/cooling";

const uuidSchema = z.string().uuid();
const nameSchema = z.string().trim().min(1).max(160);
const notesSchema = z.string().trim().max(500).nullable().optional();
const urlSchema = z.string().trim().url().max(2048).nullable().optional();

const coolingItemSchema = z
  .object({
    amountCents: z.number().int().positive().max(100_000_000_000),
    coolingDays: z.number().int().min(0).max(3650).optional(),
    name: nameSchema,
    notes: notesSchema,
    url: urlSchema,
  })
  .strict();

export async function createCoolingItemAction(data: CoolingItemInput) {
  const parsed = coolingItemSchema.parse(data);
  await createCoolingItem(parsed);
  revalidatePath("/cooling");
}

export async function abandonCoolingItemAction(id: string) {
  await abandonCoolingItem(uuidSchema.parse(id));
  revalidatePath("/cooling");
}
