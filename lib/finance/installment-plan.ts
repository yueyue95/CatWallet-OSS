export type InstallmentAmountMode = "per_installment" | "total";

export type InstallmentPlanInput = {
  amount: number;
  amountMode: InstallmentAmountMode;
  currentInstallment: number;
  installmentCount: number;
};

export type InstallmentPlan = {
  amountMode: InstallmentAmountMode;
  currentInstallment: number;
  installmentAmount: number;
  installmentAmounts: number[];
  remainingAmount: number;
  remainingInstallments: number;
  totalAmount: number;
};

export type ActiveInstallmentOccurrence = {
  amount: number;
  dueDate: string;
  installmentNumber: number;
  status: "planned" | "posted";
};

export type ActiveInstallmentScheduleInput = InstallmentPlanInput & {
  currentOccurrenceDate: string;
};

function toCents(value: number, label: string) {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${label} must be greater than zero.`);
  }
  const normalized = value.toFixed(2);
  const [whole, fraction] = normalized.split(".");
  return Number.parseInt(whole, 10) * 100 + Number.parseInt(fraction, 10);
}

function fromCents(value: number) {
  return value / 100;
}

function buildInstallmentAmountsCents(
  enteredCents: number,
  amountMode: InstallmentAmountMode,
  installmentCount: number,
) {
  if (amountMode === "per_installment") {
    return Array.from({ length: installmentCount }, () => enteredCents);
  }
  if (amountMode !== "total") {
    throw new Error("Installment amount mode is invalid.");
  }

  const regularCents = Math.floor(enteredCents / installmentCount);
  if (regularCents < 1) {
    throw new Error("Amount is below the minimum per installment.");
  }
  return [
    ...Array.from({ length: installmentCount - 1 }, () => regularCents),
    enteredCents - regularCents * (installmentCount - 1),
  ];
}

export function buildInstallmentPlan({
  amount,
  amountMode,
  currentInstallment,
  installmentCount,
}: InstallmentPlanInput): InstallmentPlan {
  if (!Number.isInteger(installmentCount) || installmentCount < 1) {
    throw new Error("Installment count is invalid.");
  }
  if (
    !Number.isInteger(currentInstallment) ||
    currentInstallment < 1 ||
    currentInstallment > installmentCount
  ) {
    throw new Error("Current installment is invalid.");
  }

  const enteredCents = toCents(amount, "Amount");
  const installmentAmountsCents = buildInstallmentAmountsCents(
    enteredCents,
    amountMode,
    installmentCount,
  );

  const totalCents = installmentAmountsCents.reduce(
    (sum, installment) => sum + installment,
    0,
  );
  const remainingCents = installmentAmountsCents
    .slice(currentInstallment)
    .reduce((sum, installment) => sum + installment, 0);

  return {
    amountMode,
    currentInstallment,
    installmentAmount: fromCents(installmentAmountsCents[0]),
    installmentAmounts: installmentAmountsCents.map(fromCents),
    remainingAmount: fromCents(remainingCents),
    remainingInstallments: installmentCount - currentInstallment,
    totalAmount: fromCents(totalCents),
  };
}

function addMonthsClamped(isoDate: string, offset: number) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate);
  if (!match) throw new Error("Current occurrence date is invalid.");

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const source = new Date(Date.UTC(year, month - 1, day));
  if (
    source.getUTCFullYear() !== year ||
    source.getUTCMonth() !== month - 1 ||
    source.getUTCDate() !== day
  ) {
    throw new Error("Current occurrence date is invalid.");
  }

  const targetMonth = month - 1 + offset;
  const targetYear = year + Math.floor(targetMonth / 12);
  const normalizedMonth = ((targetMonth % 12) + 12) % 12;
  const lastDay = new Date(
    Date.UTC(targetYear, normalizedMonth + 1, 0),
  ).getUTCDate();
  return new Date(Date.UTC(targetYear, normalizedMonth, Math.min(day, lastDay)))
    .toISOString()
    .slice(0, 10);
}

export function buildActiveInstallmentSchedule({
  currentOccurrenceDate,
  ...input
}: ActiveInstallmentScheduleInput): ActiveInstallmentOccurrence[] {
  const plan = buildInstallmentPlan(input);

  return plan.installmentAmounts
    .slice(plan.currentInstallment - 1)
    .map((amount, index) => ({
      amount,
      dueDate: addMonthsClamped(currentOccurrenceDate, index),
      installmentNumber: plan.currentInstallment + index,
      status: index === 0 ? "posted" : "planned",
    }));
}
