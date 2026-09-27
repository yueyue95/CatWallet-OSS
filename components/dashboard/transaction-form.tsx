"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { format, isValid, parse } from "date-fns";
import { Calendar, Check, FileText, Plus, Tag } from "lucide-react";
import { toast } from "sonner";

import { NewCategoryDialog } from "@/components/dashboard/new-category-dialog";
import { CompactInput } from "@/components/dashboard/form-inputs/compact-input";
import { CompactSelect } from "@/components/dashboard/form-inputs/compact-select";
import { CompactTextarea } from "@/components/dashboard/form-inputs/compact-textarea";
import { CurrencyInput } from "@/components/dashboard/form-inputs/currency-input";
import { withSelectedMonth } from "@/components/dashboard/month-route";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  type CreateCategoryInput,
  type TransactionFormCategory,
  type TransactionFormPaymentMethod,
  type CreatePaymentMethodInput,
} from "@/lib/finance/transactions";
import { NewPaymentMethodDialog } from "@/components/dashboard/new-payment-method-dialog";
import { useI18n } from "@/lib/i18n";
import {
  getLastTransactionCategory,
  getLastTransactionPaymentMethod,
  rememberLastTransactionCategory,
  rememberLastTransactionPaymentMethod,
} from "@/lib/finance/transaction-preferences";
import type { CreateTransactionResult } from "@/lib/finance/transaction-result";
import type { CoolingItem } from "@/lib/finance/cooling-model";

export interface TransactionFormData {
  type: "income" | "expense" | "saving";
  date: string;
  amount: number;
  category: string;
  paymentMethod: string;
  installmentCount: number;
  installmentAmountMode: "per_installment" | "total";
  currentInstallment: number;
  countsTowardFunMoney: boolean;
  description: string;
  notes?: string;
}

type TransactionFormProps = {
  readonly categories: TransactionFormCategory[];
  readonly createCategoryAction?: (data: CreateCategoryInput) => Promise<void>;
  readonly createPaymentMethodAction?: (
    data: CreatePaymentMethodInput,
  ) => Promise<void>;
  readonly onSubmit: (
    data: TransactionFormData & {
      coolingItemId?: string;
      idempotencyKey: string;
    },
  ) => Promise<CreateTransactionResult>;
  readonly onSuccess?: () => void;
  readonly paymentMethods: TransactionFormPaymentMethod[];
  readonly coolingItem?: Pick<CoolingItem, "amountCents" | "id" | "name">;
  readonly successRedirect?: string;
};

function getCategoryChipClass(group: string | undefined, isSelected: boolean) {
  if (!isSelected)
    return "border-border/40 text-foreground/70 hover:border-border/60 hover:bg-foreground/5";
  switch (group) {
    case "needs":
      return "border-blue-500/40 bg-blue-500/15 text-blue-400";
    case "wants":
      return "border-yellow-400/40 bg-yellow-400/15 text-yellow-500 dark:text-yellow-400";
    case "savings":
      return "border-green-500/40 bg-green-500/15 text-green-400";
    case "income":
      return "border-positive/40 bg-positive/15 text-positive";
    default:
      return "border-foreground/30 bg-foreground/10 text-foreground";
  }
}

function getAmountColorClass(type: TransactionFormData["type"]) {
  switch (type) {
    case "expense":
      return "text-red-400";
    case "income":
      return "text-green-400";
    default:
      return "text-blue-400";
  }
}

function parseDateValue(dateValue: string) {
  return parse(dateValue, "dd/MM/yyyy", new Date());
}

function toDateInputValue(dateValue: string) {
  const parsedDate = parseDateValue(dateValue);
  return isValid(parsedDate) ? format(parsedDate, "yyyy-MM-dd") : "";
}

function fromDateInputValue(dateValue: string) {
  const parsedDate = parse(dateValue, "yyyy-MM-dd", new Date());
  return isValid(parsedDate) ? format(parsedDate, "dd/MM/yyyy") : "";
}

function getSubmitButtonClasses(type: TransactionFormData["type"]) {
  if (type === "expense") {
    return "bg-linear-to-r from-rose-300 to-orange-300 hover:from-rose-400 hover:to-orange-400 text-rose-900";
  }
  if (type === "saving") {
    return "bg-linear-to-r from-blue-300 to-violet-300 hover:from-blue-400 hover:to-violet-400 text-blue-900";
  }
  return "bg-linear-to-r from-emerald-300 to-blue-300 hover:from-emerald-400 hover:to-blue-400 text-emerald-900";
}

function useBaseCategoryGroups(categories: TransactionFormCategory[]) {
  const expenseCategories = useMemo(
    () =>
      categories.filter(
        (category) => category.id !== "none" && category.group !== "income",
      ),
    [categories],
  );
  const incomeCategory = useMemo(
    () => categories.find((category) => category.group === "income"),
    [categories],
  );
  const savingsCategories = useMemo(
    () => expenseCategories.filter((category) => category.group === "savings"),
    [expenseCategories],
  );
  const fallbackExpenseCategoryId = expenseCategories[0]?.id ?? "none";
  const fallbackSavingsCategoryId =
    savingsCategories[0]?.id ?? fallbackExpenseCategoryId;

  return {
    expenseCategories,
    incomeCategory,
    savingsCategories,
    fallbackExpenseCategoryId,
    fallbackSavingsCategoryId,
  };
}

function useTransactionFormCategoryData({
  categories,
  t,
}: {
  categories: TransactionFormCategory[];
  t: (key: string) => string;
}) {
  const {
    expenseCategories,
    incomeCategory,
    savingsCategories,
    fallbackExpenseCategoryId,
    fallbackSavingsCategoryId,
  } = useBaseCategoryGroups(categories);

  const incomeCategoryOption = useMemo(
    () => ({
      value: incomeCategory?.id ?? "none",
      label: t(incomeCategory?.label ?? "data.category.receipts"),
      icon: incomeCategory?.icon ?? "💼",
      group: "income" as const,
    }),
    [incomeCategory, t],
  );

  const categoryOptions = useMemo(
    () =>
      [...expenseCategories]
        .sort(compareCategoriesByGroupOrder)
        .map((category) => ({
          value: category.id,
          label: t(category.label),
          group: category.group,
          icon: category.icon,
        })),
    [expenseCategories, t],
  );
  const savingsCategoryOptions = useMemo(
    () =>
      savingsCategories.map((category) => ({
        value: category.id,
        label: t(category.label),
        group: category.group,
        icon: category.icon,
      })),
    [savingsCategories, t],
  );
  const expenseOnlyCategoryOptions = useMemo(
    () => categoryOptions.filter((opt) => opt.group !== "savings"),
    [categoryOptions],
  );

  return {
    expenseCategories,
    incomeCategoryId: incomeCategoryOption.value,
    incomeCategoryOption,
    savingsCategories,
    fallbackExpenseCategoryId,
    fallbackSavingsCategoryId,
    categoryOptions,
    savingsCategoryOptions,
    expenseOnlyCategoryOptions,
  };
}

const TRANSACTION_CATEGORY_GROUP_ORDER = { needs: 0, wants: 1, savings: 2 };

function compareCategoriesByGroupOrder(
  left: { group: string },
  right: { group: string },
) {
  const order = TRANSACTION_CATEGORY_GROUP_ORDER as Record<string, number>;
  return order[left.group] - order[right.group];
}

function canUseInstallments(
  paymentMethod: TransactionFormPaymentMethod | undefined,
  label: string,
) {
  return (
    paymentMethod?.type === "credit" ||
    paymentMethod?.type === "boleto" ||
    label.includes("boleto")
  );
}

function useTransactionFormTypeSyncEffect({
  setFormData,
  expenseCategories,
  savingsCategories,
  fallbackExpenseCategoryId,
  fallbackSavingsCategoryId,
  incomeCategoryId,
  paymentMethods,
}: {
  setFormData: React.Dispatch<React.SetStateAction<TransactionFormData>>;
  expenseCategories: TransactionFormCategory[];
  savingsCategories: TransactionFormCategory[];
  fallbackExpenseCategoryId: string;
  fallbackSavingsCategoryId: string;
  incomeCategoryId: string;
  paymentMethods: TransactionFormPaymentMethod[];
}) {
  useEffect(() => {
    setFormData((currentFormData) => {
      let category: string;
      if (currentFormData.type === "income") {
        category = incomeCategoryId;
      } else if (currentFormData.type === "saving") {
        category = savingsCategories.some(
          (c) => c.id === currentFormData.category,
        )
          ? currentFormData.category
          : fallbackSavingsCategoryId;
      } else {
        category = expenseCategories.some(
          (c) => c.id === currentFormData.category,
        )
          ? currentFormData.category
          : fallbackExpenseCategoryId;
      }

      return {
        ...currentFormData,
        category,
        paymentMethod:
          currentFormData.paymentMethod !== "none"
            ? currentFormData.paymentMethod
            : (paymentMethods[0]?.id ?? "none"),
      };
    });
  }, [
    expenseCategories,
    fallbackExpenseCategoryId,
    fallbackSavingsCategoryId,
    incomeCategoryId,
    paymentMethods,
    savingsCategories,
    setFormData,
  ]);
}

function validateTransactionForm(
  formData: TransactionFormData,
  t: (key: string) => string,
) {
  const newErrors: Partial<Record<keyof TransactionFormData, string>> = {};
  const parsedDate = parseDateValue(formData.date);

  if (!formData.date || !isValid(parsedDate))
    newErrors.date = t("common.required");
  const amountError = getTransactionAmountError(formData, t);
  if (amountError) newErrors.amount = amountError;
  if (
    formData.currentInstallment < 1 ||
    formData.currentInstallment > formData.installmentCount
  ) {
    newErrors.currentInstallment = t("transaction.currentInstallmentError");
  }
  if (!formData.category || formData.category === "none")
    newErrors.category = t("common.required");
  if (!formData.paymentMethod || formData.paymentMethod === "none") {
    newErrors.paymentMethod = t("common.required");
  }

  return newErrors;
}

function getTransactionAmountError(
  formData: TransactionFormData,
  t: (key: string) => string,
) {
  if (formData.amount <= 0) return t("common.required");
  if (hasInvalidTotalInstallmentAmount(formData)) {
    return t("transaction.totalInstallmentMinimum");
  }
  return "";
}

function hasInvalidTotalInstallmentAmount(formData: TransactionFormData) {
  return (
    formData.installmentAmountMode === "total" &&
    formData.installmentCount > 1 &&
    Math.round(formData.amount * 100) < formData.installmentCount
  );
}

type TransactionFormSubmitHandlersParams = {
  formData: TransactionFormData;
  setFormData: React.Dispatch<React.SetStateAction<TransactionFormData>>;
  setErrors: React.Dispatch<
    React.SetStateAction<Partial<Record<keyof TransactionFormData, string>>>
  >;
  today: string;
  fallbackExpenseCategoryId: string;
  paymentMethods: TransactionFormPaymentMethod[];
  onSubmit: TransactionFormProps["onSubmit"];
  onSuccess?: () => void;
  successRedirect?: string;
  setIsLoading: (value: boolean) => void;
  router: ReturnType<typeof useRouter>;
  t: (key: string) => string;
  coolingItemId?: string;
};

async function requestTransaction({
  formData,
  idempotencyKey,
  onSubmit,
  t,
  coolingItemId,
}: Pick<
  TransactionFormSubmitHandlersParams,
  "coolingItemId" | "formData" | "onSubmit" | "t"
> & {
  idempotencyKey: string;
}) {
  try {
    return await onSubmit({
      ...formData,
      description:
        formData.description.trim() || t("transaction.defaultDescription"),
      ...(coolingItemId ? { coolingItemId } : {}),
      idempotencyKey,
    });
  } catch (error) {
    console.error(
      JSON.stringify({
        event: "ACTION_RETURN_FAIL",
        error_code: error instanceof Error ? error.name : "UnknownError",
        error_message: "Transaction creation failed",
      }),
    );
    toast.error(t("transaction.recordError"));
    return null;
  }
}

function completeTransaction({
  result,
  resetForm,
  onSuccess,
  router,
  successRedirect,
  t,
}: {
  result: CreateTransactionResult;
  resetForm: () => void;
  onSuccess?: () => void;
  router: ReturnType<typeof useRouter>;
  successRedirect?: string;
  t: (key: string) => string;
}) {
  let hasWarning = Boolean(result.warnings?.length);
  try {
    resetForm();
    onSuccess?.();
    if (successRedirect) router.push(successRedirect);
    else router.refresh();
    console.info(JSON.stringify({ event: "POST_PROCESS_SUCCESS" }));
  } catch (error) {
    hasWarning = true;
    console.warn(
      JSON.stringify({
        event: "POST_PROCESS_FAIL",
        error_code: error instanceof Error ? error.name : "UnknownError",
        error_message: "Client post-processing failed",
      }),
    );
  }
  if (hasWarning) toast.warning(t("transaction.recordWarning"));
  else toast.success(t("transaction.recordSuccess"));
}

function createResetTransactionFormData({
  today,
  fallbackExpenseCategoryId,
  paymentMethods,
}: Pick<
  TransactionFormSubmitHandlersParams,
  "today" | "fallbackExpenseCategoryId" | "paymentMethods"
>): TransactionFormData {
  return {
    type: "expense",
    date: today,
    amount: 0,
    category: getLastTransactionCategory() ?? fallbackExpenseCategoryId,
    paymentMethod:
      getLastTransactionPaymentMethod() ?? paymentMethods[0]?.id ?? "none",
    installmentCount: 1,
    installmentAmountMode: "per_installment",
    currentInstallment: 1,
    countsTowardFunMoney: false,
    description: "",
    notes: "",
  };
}

function useTransactionFormSubmitHandlers(
  params: TransactionFormSubmitHandlersParams,
) {
  const {
    formData,
    setErrors,
    onSubmit,
    setIsLoading,
    router,
    t,
    onSuccess,
    successRedirect,
    coolingItemId,
  } = params;
  const submitInFlightRef = useRef(false);
  const idempotencyKeyRef = useRef(crypto.randomUUID());
  const resetForm = () =>
    params.setFormData(createResetTransactionFormData(params));

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (submitInFlightRef.current) return;
    const newErrors = validateTransactionForm(formData, t);
    setErrors(newErrors);
    if (Object.keys(newErrors).length > 0) return;

    submitInFlightRef.current = true;
    setIsLoading(true);
    try {
      const result = await requestTransaction({
        formData,
        idempotencyKey: idempotencyKeyRef.current,
        onSubmit,
        coolingItemId,
        t,
      });
      if (!result) return;
      completeTransaction({
        result,
        resetForm,
        onSuccess,
        router,
        successRedirect,
        t,
      });
      idempotencyKeyRef.current = crypto.randomUUID();
    } finally {
      submitInFlightRef.current = false;
      setIsLoading(false);
    }
  };

  return { handleSubmit };
}

function usePaymentMethodInstallmentEligibility({
  formData,
  setFormData,
  paymentMethods,
  t,
}: {
  formData: TransactionFormData;
  setFormData: React.Dispatch<React.SetStateAction<TransactionFormData>>;
  paymentMethods: TransactionFormPaymentMethod[];
  t: (key: string) => string;
}) {
  const selectedPaymentMethod = paymentMethods.find(
    (pm) => pm.id === formData.paymentMethod,
  );
  const selectedPaymentMethodLabel = selectedPaymentMethod
    ? t(selectedPaymentMethod.label).toLowerCase()
    : "";
  const canInstallment =
    formData.type === "expense" &&
    canUseInstallments(selectedPaymentMethod, selectedPaymentMethodLabel);

  const handlePaymentMethodChange = (value: string) => {
    const nextPaymentMethod = paymentMethods.find((pm) => pm.id === value);
    const nextPaymentMethodLabel = nextPaymentMethod
      ? t(nextPaymentMethod.label).toLowerCase()
      : "";
    const nextCanInstallment = canUseInstallments(
      nextPaymentMethod,
      nextPaymentMethodLabel,
    );

    setFormData({
      ...formData,
      installmentCount: nextCanInstallment ? formData.installmentCount : 1,
      installmentAmountMode: nextCanInstallment
        ? formData.installmentAmountMode
        : "per_installment",
      currentInstallment: nextCanInstallment ? formData.currentInstallment : 1,
      paymentMethod: value,
    });
  };

  return { canInstallment, handlePaymentMethodChange };
}

const INSTALLMENT_COUNTS = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 24];

const SECTION_LABEL_CLASS =
  "mb-2.5 block text-xs font-medium uppercase tracking-widest text-muted-foreground";
const CHIP_BASE_CLASS =
  "flex items-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-medium transition-all duration-200 cursor-pointer max-w-full";
const CHIP_ADD_ACTION_CLASS =
  "border-dashed border-border/40 text-foreground/50 hover:border-border/60 hover:text-foreground/70";

function getInstallmentOptions(t: (key: string) => string) {
  return [
    { value: "1", label: t("transaction.installmentOption.full") },
    ...INSTALLMENT_COUNTS.map((count) => ({
      value: String(count),
      label: `${count}x`,
    })),
  ];
}

function getDisplayedCategoryOptions({
  type,
  expenseOnlyCategoryOptions,
  incomeCategoryOption,
  savingsCategoryOptions,
  categoryOptions,
}: {
  type: TransactionFormData["type"];
  expenseOnlyCategoryOptions: ReturnType<
    typeof useTransactionFormCategoryData
  >["expenseOnlyCategoryOptions"];
  incomeCategoryOption: ReturnType<
    typeof useTransactionFormCategoryData
  >["incomeCategoryOption"];
  savingsCategoryOptions: ReturnType<
    typeof useTransactionFormCategoryData
  >["savingsCategoryOptions"];
  categoryOptions: ReturnType<
    typeof useTransactionFormCategoryData
  >["categoryOptions"];
}) {
  if (type === "income") return [incomeCategoryOption];
  if (type === "saving")
    return savingsCategoryOptions.length > 0
      ? savingsCategoryOptions
      : categoryOptions;
  return expenseOnlyCategoryOptions;
}

type TransactionFormFieldProps = {
  readonly formData: TransactionFormData;
  readonly setFormData: React.Dispatch<
    React.SetStateAction<TransactionFormData>
  >;
};

type TransactionTypeSelectorProps = TransactionFormFieldProps & {
  readonly expenseCategories: TransactionFormCategory[];
  readonly fallbackExpenseCategoryId: string;
  readonly incomeCategoryId: string;
  readonly fallbackSavingsCategoryId: string;
  readonly t: (key: string) => string;
};

const TRANSACTION_TYPE_ACTIVE_CLASS: Record<
  TransactionFormData["type"],
  string
> = {
  expense: "bg-red-500/20 border border-red-500/40 text-red-400 shadow-sm",
  income: "bg-green-500/20 border border-green-500/40 text-green-400 shadow-sm",
  saving: "bg-blue-500/20 border border-blue-500/40 text-blue-400 shadow-sm",
};

function getTransactionTypeButtonConfigs({
  formData,
  expenseCategories,
  fallbackExpenseCategoryId,
  incomeCategoryId,
  fallbackSavingsCategoryId,
}: Omit<TransactionTypeSelectorProps, "setFormData" | "t">) {
  return [
    {
      type: "expense" as const,
      labelKey: "transaction.typeExpense",
      category: expenseCategories.some((c) => c.id === formData.category)
        ? formData.category
        : fallbackExpenseCategoryId,
      installmentCount: formData.installmentCount,
    },
    {
      type: "income" as const,
      labelKey: "transaction.typeIncome",
      category: incomeCategoryId,
      installmentCount: 1,
      installmentAmountMode: "per_installment",
      currentInstallment: 1,
    },
    {
      type: "saving" as const,
      labelKey: "transaction.typeSaving",
      category: fallbackSavingsCategoryId,
      installmentCount: 1,
    },
  ];
}

function TransactionTypeSelector(props: TransactionTypeSelectorProps) {
  const { formData, setFormData, t } = props;
  const buttonConfigs = getTransactionTypeButtonConfigs(props);

  return (
    <div className="flex w-full gap-1 rounded-lg border border-border/40 bg-muted/20 p-1">
      {buttonConfigs.map((config) => (
        <button
          key={config.type}
          type="button"
          className={`flex-1 rounded-md py-1.5 text-xs font-medium transition-all duration-200 ${
            formData.type === config.type
              ? TRANSACTION_TYPE_ACTIVE_CLASS[config.type]
              : "text-foreground/60 hover:text-foreground/80"
          }`}
          onClick={() =>
            setFormData({
              ...formData,
              category: config.category,
              installmentCount: config.installmentCount,
              installmentAmountMode:
                config.type === "expense"
                  ? formData.installmentAmountMode
                  : "per_installment",
              currentInstallment:
                config.type === "expense" ? formData.currentInstallment : 1,
              countsTowardFunMoney:
                config.type === "expense"
                  ? formData.countsTowardFunMoney
                  : false,
              type: config.type,
            })
          }
        >
          {t(config.labelKey)}
        </button>
      ))}
    </div>
  );
}

type TransactionAmountSectionProps = TransactionFormFieldProps & {
  readonly error: string | undefined;
  readonly t: (key: string) => string;
  readonly currencySymbol: string;
};

function TransactionAmountSection({
  formData,
  setFormData,
  error,
  t,
  currencySymbol,
}: TransactionAmountSectionProps) {
  return (
    <div className="rounded-xl border border-border/40 bg-card px-4 py-5">
      <p className="mb-3 text-center text-sm text-muted-foreground">
        {t(
          formData.installmentAmountMode === "total" &&
            formData.installmentCount > 1
            ? "transaction.totalAmount"
            : "transaction.amount",
        )}
      </p>
      <div className="flex items-center justify-center align-middle gap-1.5 mx-2">
        <span
          className={`text-md font-semibold pt-1.5 ${getAmountColorClass(formData.type)}`}
        >
          {currencySymbol}
        </span>
        <CurrencyInput
          id="amount"
          label={t("transaction.amount")}
          labelClassName="sr-only"
          className="max-w-[80%] min-w-fit"
          value={formData.amount}
          onValueChange={(amount) => setFormData({ ...formData, amount })}
          inputClassName="w-fill border-0 bg-transparent p-0 text-center !text-3xl font-bold tabular-nums shadow-none placeholder:text-foreground/25 focus-visible:ring-0"
        />
      </div>
      {error && (
        <p className="mt-2 text-center text-xs text-destructive">{error}</p>
      )}
    </div>
  );
}

type TransactionCategoryChipsProps = TransactionFormFieldProps & {
  readonly displayedCategoryOptions: ReturnType<
    typeof getDisplayedCategoryOptions
  >;
  readonly createCategoryAction?: (data: CreateCategoryInput) => Promise<void>;
  readonly setIsCategoryDialogOpen: (open: boolean) => void;
  readonly router: ReturnType<typeof useRouter>;
  readonly searchParams: ReturnType<typeof useSearchParams>;
  readonly t: (key: string) => string;
  readonly error?: string;
};

function TransactionCategoryChips({
  formData,
  setFormData,
  displayedCategoryOptions,
  createCategoryAction,
  setIsCategoryDialogOpen,
  router,
  searchParams,
  t,
  error,
}: TransactionCategoryChipsProps) {
  return (
    <div>
      <span className={SECTION_LABEL_CLASS}>{t("transaction.category")}</span>
      <div className="flex flex-wrap gap-2 min-w-0 max-w-full">
        {displayedCategoryOptions.map((option) => {
          const isSelected = formData.category === option.value;
          return (
            <button
              key={option.value}
              type="button"
              onClick={() =>
                setFormData({ ...formData, category: option.value })
              }
              className={`${CHIP_BASE_CLASS} ${getCategoryChipClass(option.group, isSelected)}`}
            >
              {option.icon && (
                <span className="text-sm leading-none">{option.icon}</span>
              )}
              <span>{option.label}</span>
            </button>
          );
        })}
        {formData.type === "expense" && (
          <button
            type="button"
            onClick={
              createCategoryAction
                ? () => setIsCategoryDialogOpen(true)
                : () =>
                    router.push(withSelectedMonth("/categories", searchParams))
            }
            className={`${CHIP_BASE_CLASS} ${CHIP_ADD_ACTION_CLASS}`}
          >
            <Plus className="h-3 w-3" />
            {t("transaction.addCategory")}
          </button>
        )}
      </div>
      {error && <p className="mt-1.5 text-xs text-destructive">{error}</p>}
    </div>
  );
}

type TransactionPaymentMethodChipsProps = {
  readonly formData: TransactionFormData;
  readonly paymentMethods: TransactionFormPaymentMethod[];
  readonly handlePaymentMethodChange: (value: string) => void;
  readonly error: string | undefined;
  readonly createPaymentMethodAction?: (
    data: CreatePaymentMethodInput,
  ) => Promise<void>;
  readonly setIsPaymentDialogOpen: (open: boolean) => void;
  readonly router: ReturnType<typeof useRouter>;
  readonly searchParams: ReturnType<typeof useSearchParams>;
  readonly t: (key: string) => string;
};

function TransactionPaymentMethodChips({
  formData,
  paymentMethods,
  handlePaymentMethodChange,
  error,
  createPaymentMethodAction,
  setIsPaymentDialogOpen,
  router,
  searchParams,
  t,
}: TransactionPaymentMethodChipsProps) {
  return (
    <div>
      <span className={SECTION_LABEL_CLASS}>
        {t("transaction.paymentMethod")}
      </span>
      <div className="flex flex-wrap gap-2 min-w-0 max-w-full">
        {paymentMethods.map((pm) => (
          <button
            key={pm.id}
            type="button"
            onClick={() => handlePaymentMethodChange(pm.id)}
            className={`${CHIP_BASE_CLASS} ${
              formData.paymentMethod === pm.id
                ? "border-green-500 bg-green-500/20 text-green-400 font-semibold"
                : "border-border/40 text-foreground/70 hover:border-border/60 hover:bg-foreground/5"
            }`}
          >
            {t(pm.label)}
          </button>
        ))}
        <button
          type="button"
          onClick={() =>
            createPaymentMethodAction
              ? setIsPaymentDialogOpen(true)
              : router.push(withSelectedMonth("/payments", searchParams))
          }
          className={`${CHIP_BASE_CLASS} ${CHIP_ADD_ACTION_CLASS}`}
        >
          <Plus className="h-3 w-3" />
          {t("transaction.addPaymentMethod")}
        </button>
      </div>
      {error && <p className="mt-1.5 text-xs text-destructive">{error}</p>}
    </div>
  );
}

type TransactionDateAndInstallmentsProps = TransactionFormFieldProps & {
  readonly error: string | undefined;
  readonly currentError?: string;
  readonly canInstallment: boolean;
  readonly installmentOptions: ReturnType<typeof getInstallmentOptions>;
  readonly todayDateInputValue: string;
  readonly t: (key: string) => string;
};

function TransactionDateAndInstallments({
  formData,
  setFormData,
  error,
  currentError,
  canInstallment,
  installmentOptions,
  todayDateInputValue,
  t,
}: TransactionDateAndInstallmentsProps) {
  return (
    <div className="grid gap-5 lg:grid-cols-2 lg:gap-6 min-w-0">
      <CompactInput
        label={t("transaction.date")}
        id="date"
        type="date"
        inputMode="text"
        placeholder="dd/MM/yyyy"
        value={toDateInputValue(formData.date) || todayDateInputValue}
        onChange={(event) =>
          setFormData({
            ...formData,
            date: fromDateInputValue(event.target.value),
          })
        }
        icon={<Calendar className="w-4 h-4" />}
        error={error}
        inputClassName="w-full max-w-full min-w-0 appearance-none overflow-hidden pr-3 text-left [&::-webkit-calendar-picker-indicator]:shrink-0 [&::-webkit-date-and-time-value]:min-w-0 [&::-webkit-date-and-time-value]:overflow-hidden [&::-webkit-date-and-time-value]:text-left"
      />
      {canInstallment ? (
        <div className="grid gap-5 lg:col-span-2 lg:grid-cols-3">
          {formData.installmentCount > 1 ? (
            <CompactSelect
              label={t("transaction.installmentAmountMode")}
              id="installment-amount-mode"
              value={formData.installmentAmountMode}
              onChange={(value) =>
                setFormData({
                  ...formData,
                  installmentAmountMode: value as "per_installment" | "total",
                })
              }
              options={[
                {
                  value: "per_installment",
                  label: t("transaction.installmentMode.perInstallment"),
                },
                {
                  value: "total",
                  label: t("transaction.installmentMode.total"),
                },
              ]}
            />
          ) : null}
          <CompactSelect
            label={t("transaction.installmentFrequency")}
            id="installment"
            value={formData.installmentCount.toString()}
            onChange={(value) =>
              setFormData({
                ...formData,
                installmentCount: Number.parseInt(value, 10),
                currentInstallment: Math.min(
                  formData.currentInstallment,
                  Number.parseInt(value, 10),
                ),
              })
            }
            options={installmentOptions}
          />
          {formData.installmentCount > 1 ? (
            <CompactInput
              label={t("transaction.currentInstallment")}
              id="current-installment"
              type="number"
              value={formData.currentInstallment}
              min="1"
              max={String(formData.installmentCount)}
              inputMode="numeric"
              onChange={(event) =>
                setFormData({
                  ...formData,
                  currentInstallment: Number.parseInt(event.target.value, 10),
                })
              }
              error={currentError}
            />
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

type TransactionSubmitButtonProps = {
  readonly isLoading: boolean;
  readonly type: TransactionFormData["type"];
  readonly t: (key: string) => string;
};

function TransactionSubmitButton({
  isLoading,
  type,
  t,
}: TransactionSubmitButtonProps) {
  return (
    <Button
      type="submit"
      disabled={isLoading}
      className={`
        w-full h-11 font-semibold text-sm
        ${getSubmitButtonClasses(type)}
        shadow-lg hover:shadow-xl
        transition-all duration-300 active:scale-95
        disabled:opacity-50 disabled:cursor-not-allowed
        flex items-center justify-center gap-2
      `}
    >
      {isLoading ? (
        <>
          <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
          {t("transaction.saving")}
        </>
      ) : (
        <>
          <Check className="w-4 h-4" />
          {t("transaction.save")}
        </>
      )}
    </Button>
  );
}

type TransactionFormDialogsProps = {
  readonly createCategoryAction?: (data: CreateCategoryInput) => Promise<void>;
  readonly isCategoryDialogOpen: boolean;
  readonly setIsCategoryDialogOpen: (open: boolean) => void;
  readonly createPaymentMethodAction?: (
    data: CreatePaymentMethodInput,
  ) => Promise<void>;
  readonly isPaymentDialogOpen: boolean;
  readonly setIsPaymentDialogOpen: (open: boolean) => void;
};

function TransactionFormDialogs({
  createCategoryAction,
  isCategoryDialogOpen,
  setIsCategoryDialogOpen,
  createPaymentMethodAction,
  isPaymentDialogOpen,
  setIsPaymentDialogOpen,
}: TransactionFormDialogsProps) {
  return (
    <>
      {createCategoryAction ? (
        <NewCategoryDialog
          createCategoryAction={createCategoryAction}
          open={isCategoryDialogOpen}
          onOpenChange={setIsCategoryDialogOpen}
        />
      ) : null}

      {createPaymentMethodAction ? (
        <NewPaymentMethodDialog
          createPaymentMethodAction={createPaymentMethodAction}
          open={isPaymentDialogOpen}
          onOpenChange={setIsPaymentDialogOpen}
          onCreated={() => setIsPaymentDialogOpen(false)}
        />
      ) : null}
    </>
  );
}

function getTodayValues() {
  return {
    today: format(new Date(), "dd/MM/yyyy"),
    todayDateInputValue: format(new Date(), "yyyy-MM-dd"),
  };
}

function useTransactionFormUiState() {
  const [isCategoryDialogOpen, setIsCategoryDialogOpen] = useState(false);
  const [isPaymentDialogOpen, setIsPaymentDialogOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  return {
    isCategoryDialogOpen,
    setIsCategoryDialogOpen,
    isPaymentDialogOpen,
    setIsPaymentDialogOpen,
    isLoading,
    setIsLoading,
  };
}

function useTransactionFormBaseState({
  categories,
  paymentMethods,
  coolingItem,
}: Pick<
  TransactionFormProps,
  "categories" | "coolingItem" | "paymentMethods"
>) {
  const { currencySymbol, t } = useI18n();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { today, todayDateInputValue } = getTodayValues();

  const [errors, setErrors] = useState<
    Partial<Record<keyof TransactionFormData, string>>
  >({});
  const defaultCategory =
    categories.find(
      (category) =>
        category.id === getLastTransactionCategory() &&
        category.id !== "none" &&
        category.group !== "income",
    )?.id ??
    categories.find(
      (category) => category.id !== "none" && category.group !== "income",
    )?.id ??
    "none";
  const defaultPaymentMethod =
    paymentMethods.find(
      (paymentMethod) => paymentMethod.id === getLastTransactionPaymentMethod(),
    )?.id ??
    paymentMethods[0]?.id ??
    "none";
  const [formData, setFormData] = useState<TransactionFormData>({
    type: "expense",
    date: today,
    amount: coolingItem ? coolingItem.amountCents / 100 : 0,
    category: defaultCategory,
    paymentMethod: defaultPaymentMethod,
    installmentCount: 1,
    installmentAmountMode: "per_installment",
    currentInstallment: 1,
    countsTowardFunMoney: coolingItem
      ? false
      : searchParams.get("funMoney") === "1",
    description: coolingItem?.name ?? "",
    notes: "",
  });
  const uiState = useTransactionFormUiState();
  const categoryData = useTransactionFormCategoryData({ categories, t });

  useEffect(() => {
    if (formData.type === "expense") {
      rememberLastTransactionCategory(formData.category);
    }
    rememberLastTransactionPaymentMethod(formData.paymentMethod);
  }, [formData.category, formData.paymentMethod, formData.type]);

  const displayedCategoryOptions = getDisplayedCategoryOptions({
    type: formData.type,
    expenseOnlyCategoryOptions: categoryData.expenseOnlyCategoryOptions,
    incomeCategoryOption: categoryData.incomeCategoryOption,
    savingsCategoryOptions: categoryData.savingsCategoryOptions,
    categoryOptions: categoryData.categoryOptions,
  });

  return {
    currencySymbol,
    t,
    router,
    searchParams,
    today,
    todayDateInputValue,
    errors,
    setErrors,
    formData,
    setFormData,
    ...uiState,
    ...categoryData,
    displayedCategoryOptions,
  };
}

type TransactionFormBaseState = ReturnType<typeof useTransactionFormBaseState>;

function useTransactionFormHandlers({
  base,
  paymentMethods,
  onSubmit,
  onSuccess,
  successRedirect,
  coolingItemId,
}: {
  base: TransactionFormBaseState;
  paymentMethods: TransactionFormPaymentMethod[];
  onSubmit: TransactionFormProps["onSubmit"];
  onSuccess?: TransactionFormProps["onSuccess"];
  successRedirect?: TransactionFormProps["successRedirect"];
  coolingItemId?: string;
}) {
  const {
    formData,
    setFormData,
    setErrors,
    today,
    fallbackExpenseCategoryId,
    t,
    router,
    setIsLoading,
  } = base;

  useTransactionFormTypeSyncEffect({
    setFormData,
    expenseCategories: base.expenseCategories,
    savingsCategories: base.savingsCategories,
    fallbackExpenseCategoryId,
    fallbackSavingsCategoryId: base.fallbackSavingsCategoryId,
    incomeCategoryId: base.incomeCategoryId,
    paymentMethods,
  });

  const { handleSubmit } = useTransactionFormSubmitHandlers({
    formData,
    setFormData,
    setErrors,
    today,
    fallbackExpenseCategoryId,
    paymentMethods,
    onSubmit,
    setIsLoading,
    router,
    t,
    onSuccess,
    successRedirect,
    coolingItemId,
  });

  const { canInstallment, handlePaymentMethodChange } =
    usePaymentMethodInstallmentEligibility({
      formData,
      setFormData,
      paymentMethods,
      t,
    });

  return {
    handleSubmit,
    canInstallment,
    handlePaymentMethodChange,
    installmentOptions: getInstallmentOptions(t),
  };
}

function useTransactionFormState({
  categories,
  paymentMethods,
  onSubmit,
  onSuccess,
  successRedirect,
  coolingItem,
}: Pick<
  TransactionFormProps,
  | "categories"
  | "coolingItem"
  | "onSubmit"
  | "onSuccess"
  | "paymentMethods"
  | "successRedirect"
>) {
  const base = useTransactionFormBaseState({
    categories,
    coolingItem,
    paymentMethods,
  });
  const handlers = useTransactionFormHandlers({
    base,
    paymentMethods,
    onSubmit,
    onSuccess,
    successRedirect,
    coolingItemId: coolingItem?.id,
  });

  return { ...base, ...handlers, paymentMethods };
}

type TransactionFormState = ReturnType<typeof useTransactionFormState>;

function TransactionDescriptionAndNotesFields({
  formData,
  setFormData,
  errors,
  t,
}: TransactionFormFieldProps & {
  readonly errors: Partial<Record<keyof TransactionFormData, string>>;
  readonly t: (key: string) => string;
}) {
  return (
    <>
      <CompactInput
        label={t("transaction.description")}
        id="description"
        type="text"
        inputMode="text"
        placeholder={t("transaction.descriptionPlaceholder")}
        value={formData.description}
        onChange={(event) =>
          setFormData({ ...formData, description: event.target.value })
        }
        icon={<Tag className="w-4 h-4" />}
        error={errors.description}
      />
      <CompactTextarea
        label={t("transaction.notes")}
        id="notes"
        value={formData.notes || ""}
        onChange={(event) =>
          setFormData({ ...formData, notes: event.target.value })
        }
        placeholder={t("transaction.notesPlaceholder")}
        icon={<FileText className="w-4 h-4" />}
      />
    </>
  );
}

function TransactionFormView(
  props: TransactionFormProps & TransactionFormState,
) {
  const {
    formData,
    setFormData,
    errors,
    handleSubmit,
    isLoading,
    t,
    displayedCategoryOptions,
  } = props;

  return (
    <div className="w-full min-w-0">
      <form onSubmit={handleSubmit} className="flex flex-col gap-5 min-w-0">
        <TransactionTypeSelector {...props} />
        <TransactionAmountSection {...props} error={errors.amount} />

        <div className="grid grid-cols-1 gap-5 lg:grid-cols-2 lg:gap-x-6 lg:gap-y-5 min-w-0">
          <div className="flex flex-col gap-5 min-w-0">
            <TransactionCategoryChips
              {...props}
              displayedCategoryOptions={displayedCategoryOptions}
              error={errors.category}
            />
          </div>

          <div className="flex flex-col gap-5 min-w-0">
            <TransactionPaymentMethodChips
              {...props}
              error={errors.paymentMethod}
            />
            {formData.type === "expense" ? (
              <label
                className="flex items-center gap-2 text-sm text-foreground/80"
                htmlFor="counts-toward-fun-money"
              >
                <Checkbox
                  id="counts-toward-fun-money"
                  checked={formData.countsTowardFunMoney}
                  onCheckedChange={(checked) =>
                    setFormData({
                      ...formData,
                      countsTowardFunMoney: checked === true,
                    })
                  }
                />
                <span>{t("transaction.countsTowardFunMoney")}</span>
              </label>
            ) : null}
            <TransactionDateAndInstallments
              {...props}
              error={errors.date}
              currentError={errors.currentInstallment}
            />
            <details className="rounded-xl border border-border/40 bg-card/40 p-4">
              <summary className="cursor-pointer text-sm font-medium text-foreground">
                {t("transaction.moreOptions")}
              </summary>
              <div className="mt-4 flex flex-col gap-5">
                <TransactionDescriptionAndNotesFields
                  formData={formData}
                  setFormData={setFormData}
                  errors={errors}
                  t={t}
                />
              </div>
            </details>
          </div>
        </div>

        <TransactionSubmitButton
          isLoading={isLoading}
          type={formData.type}
          t={t}
        />
      </form>

      <TransactionFormDialogs {...props} />
    </div>
  );
}

export function TransactionForm(props: TransactionFormProps) {
  const state = useTransactionFormState(props);
  return <TransactionFormView {...props} {...state} />;
}
