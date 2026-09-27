"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import {
  createFixedCommitment,
  createSinkingFund,
  deleteFixedCommitment,
  deleteSinkingFund,
  recordFixedCommitmentPayment,
  updateFixedCommitment,
  updateSinkingFund,
  saveInstallmentRetirementAllocations,
  setFunMoneyBudget,
  type SaveInstallmentRetirementInput,
  type FunMoneyBudgetInput,
  type FixedCommitmentInput,
  type SinkingFundInput,
  type UpdateSinkingFundInput,
} from "@/lib/finance/catwallet";

const uuidSchema = z.string().uuid();
const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const monthSchema = z.string().regex(/^\d{4}-\d{2}$/);
const nameSchema = z.string().trim().min(1).max(160);
const funMoneyBudgetSchema = z
  .object({
    amount: z.number().finite().min(0).max(1_000_000_000),
    month: monthSchema,
  })
  .strict();

const fixedCommitmentSchema = z
  .object({
    amount: z.number().finite().positive().max(1_000_000_000),
    cadence: z.enum(["monthly", "yearly", "custom"]),
    categoryId: uuidSchema.nullable().optional(),
    customIntervalMonths: z
      .number()
      .int()
      .min(1)
      .max(120)
      .nullable()
      .optional(),
    endDate: dateSchema.nullable().optional(),
    includeInSafeToSpend: z.boolean().optional(),
    isEnabled: z.boolean().optional(),
    name: nameSchema,
    paymentMethodId: uuidSchema.nullable().optional(),
    startDate: dateSchema,
  })
  .strict();

const sinkingFundSchema = z
  .object({
    currentAmount: z.number().finite().min(0).optional(),
    emoji: z.string().trim().min(1).max(16),
    expectedUseDate: dateSchema.nullable().optional(),
    isEnabled: z.boolean().optional(),
    monthlyTarget: z.number().finite().min(0).max(1_000_000_000),
    name: nameSchema,
    notes: z.string().trim().max(500).nullable().optional(),
    targetAmount: z.number().finite().positive().nullable().optional(),
  })
  .strict();

const updateSinkingFundSchema = sinkingFundSchema
  .omit({ currentAmount: true })
  .extend({ id: uuidSchema })
  .strict();

const recordPaymentSchema = z
  .object({
    amount: z.number().finite().positive().max(1_000_000_000),
    commitmentId: uuidSchema,
    date: dateSchema,
    description: nameSchema,
    notes: z.string().trim().max(500).nullable().optional(),
  })
  .strict();

const allocationSchema = z
  .object({
    installmentGroupId: uuidSchema,
    isEnabled: z.boolean().optional(),
    monthlyAmount: z.number().finite().positive().max(1_000_000_000),
    notes: z.string().trim().max(500).nullable().optional(),
    startsMonth: monthSchema,
    targetId: uuidSchema.nullable().optional(),
    targetType: z.enum(["category", "sinking_fund", "savings"]),
  })
  .strict();

function revalidateCatWallet() {
  for (const path of [
    "/dashboard",
    "/commitments",
    "/sinking-funds",
    "/installments",
    "/transactions",
  ]) {
    revalidatePath(path);
  }
}

export async function createFixedCommitmentAction(data: FixedCommitmentInput) {
  await createFixedCommitment(fixedCommitmentSchema.parse(data));
  revalidateCatWallet();
}

export async function updateFixedCommitmentAction(
  data: FixedCommitmentInput & { id: string },
) {
  const parsed = fixedCommitmentSchema.extend({ id: uuidSchema }).parse(data);
  await updateFixedCommitment(parsed);
  revalidateCatWallet();
}

export async function deleteFixedCommitmentAction(id: string) {
  await deleteFixedCommitment(uuidSchema.parse(id));
  revalidateCatWallet();
}

export async function recordFixedCommitmentPaymentAction(data: {
  amount: number;
  commitmentId: string;
  date: string;
  description: string;
  notes?: string | null;
}) {
  await recordFixedCommitmentPayment(recordPaymentSchema.parse(data));
  revalidateCatWallet();
}

export async function createSinkingFundAction(data: SinkingFundInput) {
  await createSinkingFund(sinkingFundSchema.parse(data));
  revalidateCatWallet();
}

export async function updateSinkingFundAction(data: UpdateSinkingFundInput) {
  const parsed = updateSinkingFundSchema.parse(data);
  await updateSinkingFund(parsed);
  revalidateCatWallet();
}

export async function deleteSinkingFundAction(id: string) {
  await deleteSinkingFund(uuidSchema.parse(id));
  revalidateCatWallet();
}

export async function setFunMoneyBudgetAction(data: FunMoneyBudgetInput) {
  await setFunMoneyBudget(funMoneyBudgetSchema.parse(data));
  revalidateCatWallet();
  revalidatePath("/fun-money");
}

export async function saveInstallmentRetirementAllocationAction(
  data: SaveInstallmentRetirementInput,
) {
  const parsed = z
    .object({
      installmentGroupId: uuidSchema,
      startsMonth: monthSchema,
      allocations: z
        .array(
          allocationSchema.pick({
            monthlyAmount: true,
            targetType: true,
            targetId: true,
          }),
        )
        .max(100),
    })
    .strict()
    .parse(data);
  const result = await saveInstallmentRetirementAllocations(parsed);
  try {
    revalidateCatWallet();
  } catch {
    console.warn("Retirement destinations saved; revalidation failed");
  }
  return result;
}
