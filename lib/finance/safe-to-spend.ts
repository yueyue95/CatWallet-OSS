export type SafeToSpendCadence = "monthly" | "yearly" | "custom";

export type SafeToSpendCommitment = {
  amount: number;
  cadence: SafeToSpendCadence;
  customIntervalMonths?: number | null;
  paidAmount?: number;
  includeInSafeToSpend?: boolean;
};

export type FixedCommitmentSchedule = SafeToSpendCommitment & {
  endDate?: string | null;
  id: string;
  isEnabled: boolean;
  startDate: string;
  deletedAt?: string | null;
};

export type SafeToSpendInput = {
  dataQuality?: "verified" | "partial" | "unreconciled";
  income: number;
  incomeIsForecast?: boolean;
  spent: number;
  fixedCommitments: SafeToSpendCommitment[];
  futureReserves: number;
  longTermSavings: number;
  monthlyReserve?: number;
  unpaidDueCommitments?: number;
  unprepaidDailySpent?: number;
};

export type SafeToSpendResult = {
  dataQuality: "verified" | "partial" | "unreconciled";
  income: number;
  incomeIsForecast: boolean;
  fixedCommitments: number;
  paidFixedCommitments: number;
  futureReserves: number;
  longTermSavings: number;
  monthlyReserve: number;
  spent: number;
  regularSpent: number;
  unpaidDueCommitments: number;
  unprepaidDailySpent: number;
  safeToSpend: number;
};

function finiteNonNegative(value: number | null | undefined) {
  return Number.isFinite(value) && Number(value) > 0 ? Number(value) : 0;
}

export function toMonthlyAmount(
  amount: number,
  cadence: SafeToSpendCadence,
  customIntervalMonths?: number | null,
) {
  const normalizedAmount = finiteNonNegative(amount);

  if (cadence === "yearly") return normalizedAmount / 12;
  if (cadence === "custom") {
    const interval = Number(customIntervalMonths);
    return interval > 0 && Number.isFinite(interval)
      ? normalizedAmount / interval
      : 0;
  }

  return normalizedAmount;
}

export function getFixedCommitmentsForMonth<T extends FixedCommitmentSchedule>(
  commitments: T[],
  month: string,
): T[] {
  return commitments.filter(
    (commitment) =>
      !commitment.deletedAt &&
      isFixedCommitmentInMonth(commitment, month) &&
      commitment.isEnabled &&
      commitment.includeInSafeToSpend !== false,
  );
}

export function isFixedCommitmentInMonth(
  commitment: Pick<FixedCommitmentSchedule, "startDate" | "endDate">,
  month: string,
) {
  const monthStart = `${month}-01`;
  const [year, monthNumber] = month.split("-").map(Number);
  const nextMonthDate = new Date(year, monthNumber, 1);
  const monthEnd = `${nextMonthDate.getFullYear()}-${String(
    nextMonthDate.getMonth() + 1,
  ).padStart(2, "0")}-01`;

  return (
    commitment.startDate < monthEnd &&
    (!commitment.endDate || commitment.endDate >= monthStart)
  );
}

export function calculateSafeToSpend(
  input: SafeToSpendInput,
): SafeToSpendResult {
  const income = finiteNonNegative(input.income);
  const spent = finiteNonNegative(input.spent);
  const futureReserves = finiteNonNegative(input.futureReserves);
  const longTermSavings = finiteNonNegative(input.longTermSavings);

  const totals = input.fixedCommitments.reduce(
    (result, commitment) => {
      if (commitment.includeInSafeToSpend === false) return result;

      const planned = toMonthlyAmount(
        commitment.amount,
        commitment.cadence,
        commitment.customIntervalMonths,
      );
      const paid = Math.min(finiteNonNegative(commitment.paidAmount), planned);

      result.planned += planned;
      result.paid += paid;
      return result;
    },
    { paid: 0, planned: 0 },
  );

  // A fixed commitment reserves the month's capacity whether or not it has
  // already been paid. The payment is excluded from daily spending below so
  // the same money is reserved exactly once.
  const remainingFixedCommitments = totals.planned;
  const regularSpent = Math.max(spent - totals.paid, 0);
  const useV1Formula =
    input.monthlyReserve !== undefined ||
    input.unpaidDueCommitments !== undefined ||
    input.unprepaidDailySpent !== undefined;
  const monthlyReserve =
    input.monthlyReserve === undefined
      ? futureReserves + longTermSavings
      : finiteNonNegative(input.monthlyReserve);
  const unpaidDueCommitments =
    input.unpaidDueCommitments === undefined
      ? 0
      : finiteNonNegative(input.unpaidDueCommitments);
  const unprepaidDailySpent =
    input.unprepaidDailySpent === undefined
      ? regularSpent
      : finiteNonNegative(input.unprepaidDailySpent);
  const safeToSpend = useV1Formula
    ? income -
      remainingFixedCommitments -
      unpaidDueCommitments -
      monthlyReserve -
      unprepaidDailySpent
    : income -
      remainingFixedCommitments -
      futureReserves -
      longTermSavings -
      regularSpent;

  return {
    dataQuality: input.dataQuality ?? "verified",
    fixedCommitments: remainingFixedCommitments,
    incomeIsForecast: input.incomeIsForecast ?? false,
    futureReserves,
    income,
    longTermSavings,
    monthlyReserve,
    paidFixedCommitments: totals.paid,
    regularSpent,
    safeToSpend: Number(safeToSpend.toFixed(2)),
    spent,
    unpaidDueCommitments,
    unprepaidDailySpent,
  };
}
