"use server";

import { revalidatePath } from "next/cache";
import { setMonthlyAvailableIncome } from "@/lib/finance/catwallet";

export async function saveMonthlyAvailableIncomeAction(
  month: string,
  amount: number,
) {
  await setMonthlyAvailableIncome({ month, amount });
  revalidatePath("/dashboard");
}
