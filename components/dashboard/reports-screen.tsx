"use client";

import { useMemo } from "react";

import {
  Download,
  FileSpreadsheet,
  FileText,
  TrendingDown,
  TrendingUp,
} from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { PageHeader } from "@/components/dashboard/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { type MonthlyReport } from "@/lib/finance/monthly-report";
import { type ReportsData } from "@/lib/finance/transactions";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";

type ReportsScreenProps = {
  monthlyReport: MonthlyReport;
  reportsData: ReportsData;
};

function getPercentageChange(current: number, previous: number) {
  if (previous === 0) return null;
  return ((current - previous) / previous) * 100;
}

function csvEscape(value: string | number | null) {
  const text = value == null ? "" : String(value);
  return `"${text.replaceAll('"', '""')}"`;
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function getFallbackMonth(reportsData: ReportsData) {
  return {
    expenses: 0,
    grossSavings: 0,
    income: 0,
    month: reportsData.selectedMonth,
    monthKey: "screen.reports.month",
    netWorth: 0,
    year: "",
  };
}

function useReportsScreenData(
  reportsData: ReportsData,
  t: (key: string) => string,
) {
  const monthlyReports = reportsData.monthlyReports;
  const currentMonth = monthlyReports[0] ?? getFallbackMonth(reportsData);
  const previousMonth = monthlyReports[1] ?? currentMonth;
  const incomeChange = getPercentageChange(
    currentMonth.income,
    previousMonth.income,
  );
  const expenseChange = getPercentageChange(
    currentMonth.expenses,
    previousMonth.expenses,
  );
  const savingsChange = getPercentageChange(
    currentMonth.grossSavings,
    previousMonth.grossSavings,
  );

  const incomeVsExpensesData = useMemo(
    () =>
      monthlyReports
        .map((report) => ({
          expenses: report.expenses,
          income: report.income,
          month: t(report.monthKey),
        }))
        .reverse(),
    [monthlyReports, t],
  );

  const netWorthData = useMemo(
    () =>
      monthlyReports
        .map((report) => ({
          month: t(report.monthKey),
          netWorth: report.netWorth,
        }))
        .reverse(),
    [monthlyReports, t],
  );

  return {
    monthlyReports,
    currentMonth,
    previousMonth,
    incomeChange,
    expenseChange,
    savingsChange,
    incomeVsExpensesData,
    netWorthData,
  };
}

export function buildTransactionsCsvRows(
  reportsData: ReportsData,
  t: (key: string) => string,
) {
  return [
    [
      "Data real",
      "Mês de compra",
      "Período do extrato",
      "Vencimento do extrato",
      "Tipo de registro",
      "Mês do relatório",
      "Descrição",
      "Categoria",
      "Forma de pagamento",
      "Valor do registro",
    ],
    ...reportsData.transactions.map((transaction) => [
      transaction.date,
      transaction.purchaseMonth ?? "",
      transaction.statementPeriod ?? "",
      transaction.statementDueDate ?? "",
      t(`screen.reports.entryKind.${transaction.entryKind}`),
      transaction.financialMonth,
      t(transaction.description),
      t(transaction.category),
      transaction.paymentMethod ? t(transaction.paymentMethod) : "",
      transaction.amount.toFixed(2),
    ]),
  ];
}

function downloadTransactionsCsv(
  reportsData: ReportsData,
  t: (key: string) => string,
) {
  const rows = buildTransactionsCsvRows(reportsData, t);
  const csv = rows.map((row) => row.map(csvEscape).join(",")).join("\n");
  const blob = new Blob([`\uFEFF${csv}`], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `catwallet-report-${reportsData.selectedMonth}.csv`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function buildPdfTransactionSections(
  transactions: ReportsData["transactions"],
  {
    formatCurrency,
    formatDate,
    t,
  }: {
    formatCurrency: (value: number) => string;
    formatDate: (value: string) => string;
    t: (key: string) => string;
  },
) {
  const formatTransactionLine = (
    transaction: ReportsData["transactions"][number],
  ) =>
    [
      formatDate(transaction.date),
      t(`screen.reports.entryKind.${transaction.entryKind}`),
      transaction.purchaseMonth ?? "-",
      transaction.financialMonth,
      t(transaction.description),
      t(transaction.category),
      transaction.paymentMethod ? t(transaction.paymentMethod) : "-",
      formatCurrency(transaction.amount),
    ].join(" | ");
  const expenseLines = transactions
    .filter(
      (transaction) =>
        transaction.type === "expense" && transaction.entryKind !== "repayment",
    )
    .map(formatTransactionLine);
  const settlementLines = transactions
    .filter((transaction) => transaction.entryKind === "repayment")
    .map(formatTransactionLine);

  return { expenseLines, settlementLines };
}

export function buildPdfReportText({
  reportsData,
  monthlyReports,
  formatCurrency,
  formatDate,
  t,
}: {
  reportsData: ReportsData;
  monthlyReports: ReportsData["monthlyReports"];
  formatCurrency: (value: number) => string;
  formatDate: (value: string) => string;
  t: (key: string) => string;
}) {
  const { expenseLines, settlementLines } = buildPdfTransactionSections(
    reportsData.transactions,
    { formatCurrency, formatDate, t },
  );
  const summaryLines = monthlyReports.map((report) =>
    [
      `${t(report.monthKey)} ${report.year}`,
      `${t("common.income")}: ${formatCurrency(report.income)}`,
      `${t("common.expense")}: ${formatCurrency(report.expenses)}`,
      `${t("screen.reports.longTermSavings")}: ${formatCurrency(report.grossSavings)}`,
      `${t("screen.reports.netWorth")}: ${formatCurrency(report.netWorth)}`,
    ].join(" | "),
  );

  return [
    `CatWallet - ${t("screen.reports.title")}`,
    "",
    t("screen.reports.breakdown"),
    ...summaryLines,
    "",
    t("screen.reports.allExpenses"),
    ...(expenseLines.length ? expenseLines : [t("screen.reports.noExpenses")]),
    "",
    t("screen.reports.accountSettlements"),
    ...(settlementLines.length
      ? settlementLines
      : [t("screen.reports.noSettlements")]),
  ].join("\n");
}

function printPdfReport({
  reportsData,
  monthlyReports,
  formatCurrency,
  formatDate,
  t,
}: {
  reportsData: ReportsData;
  monthlyReports: ReportsData["monthlyReports"];
  formatCurrency: (value: number) => string;
  formatDate: (value: string) => string;
  t: (key: string) => string;
}) {
  const reportText = buildPdfReportText({
    reportsData,
    monthlyReports,
    formatCurrency,
    formatDate,
    t,
  });
  const printWindow = window.open("", "_blank");

  if (!printWindow) return;

  printWindow.document.write(`
      <html>
        <head>
          <title>CatWallet - ${escapeHtml(t("screen.reports.title"))}</title>
          <style>
            body { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; padding: 32px; color: #111; }
            pre { white-space: pre-wrap; line-height: 1.5; font-size: 12px; }
          </style>
        </head>
        <body>
          <pre>${escapeHtml(reportText)}</pre>
          <script>window.onload = () => window.print()</script>
        </body>
      </html>
    `);
  printWindow.document.close();
}

function useReportsScreenActions({
  reportsData,
  monthlyReports,
  formatCurrency,
  formatDate,
  t,
}: {
  reportsData: ReportsData;
  monthlyReports: ReportsData["monthlyReports"];
  formatCurrency: (value: number) => string;
  formatDate: (value: string) => string;
  t: (key: string) => string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  function handlePeriodChange(period: string) {
    const params = new URLSearchParams(searchParams.toString());
    params.set("period", period);
    router.push(`${pathname}?${params.toString()}`);
  }

  return {
    handlePeriodChange,
    downloadCsv: () => downloadTransactionsCsv(reportsData, t),
    printPdfReport: () =>
      printPdfReport({
        reportsData,
        monthlyReports,
        formatCurrency,
        formatDate,
        t,
      }),
  };
}

function ReportsToolbarActions({
  periodMonths,
  onPeriodChange,
  onExportPdf,
  onExportCsv,
  t,
}: {
  periodMonths: number;
  onPeriodChange: (period: string) => void;
  onExportPdf: () => void;
  onExportCsv: () => void;
  t: (key: string) => string;
}) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <Select value={String(periodMonths)} onValueChange={onPeriodChange}>
        <SelectTrigger className="w-40">
          <SelectValue placeholder={t("screen.reports.period")} />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="1">{t("screen.reports.lastMonth")}</SelectItem>
          <SelectItem value="3">
            {t("screen.reports.lastThreeMonths")}
          </SelectItem>
          <SelectItem value="6">{t("screen.reports.lastSixMonths")}</SelectItem>
          <SelectItem value="12">{t("screen.reports.lastYear")}</SelectItem>
        </SelectContent>
      </Select>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" className="gap-2">
            <Download className="size-4" />
            {t("screen.reports.export")}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={onExportPdf}>
            <FileText className="size-4" />
            {t("screen.reports.exportPdf")}
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={onExportCsv}>
            <FileSpreadsheet className="size-4" />
            {t("screen.reports.exportCsv")}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

function buildReportsSummaryCards({
  currentMonth,
  previousMonth,
  incomeChange,
  expenseChange,
  savingsChange,
  t,
}: {
  currentMonth: ReportsData["monthlyReports"][number];
  previousMonth: ReportsData["monthlyReports"][number];
  incomeChange: number | null;
  expenseChange: number | null;
  savingsChange: number | null;
  t: (key: string) => string;
}) {
  return [
    [
      t("dashboard.summary.totalIncome"),
      currentMonth.income,
      previousMonth.income,
      incomeChange,
      currentMonth.income >= previousMonth.income,
    ] as const,
    [
      t("dashboard.summary.totalExpenses"),
      currentMonth.expenses,
      previousMonth.expenses,
      expenseChange,
      currentMonth.expenses <= previousMonth.expenses,
    ] as const,
    [
      t("screen.reports.longTermSavings"),
      currentMonth.grossSavings,
      previousMonth.grossSavings,
      savingsChange,
      currentMonth.grossSavings >= previousMonth.grossSavings,
    ] as const,
  ];
}

function ReportsChangeCards({
  currentMonth,
  previousMonth,
  incomeChange,
  expenseChange,
  savingsChange,
  formatCurrency,
  t,
}: {
  currentMonth: ReportsData["monthlyReports"][number];
  previousMonth: ReportsData["monthlyReports"][number];
  incomeChange: number | null;
  expenseChange: number | null;
  savingsChange: number | null;
  formatCurrency: (value: number) => string;
  t: (key: string) => string;
}) {
  const cards = buildReportsSummaryCards({
    currentMonth,
    previousMonth,
    incomeChange,
    expenseChange,
    savingsChange,
    t,
  });

  return (
    <>
      {cards.map(([label, value, previous, change, positive]) => {
        let changeColor = "text-muted-foreground";
        let changeIcon = null;
        if (change !== null) {
          changeColor = positive ? "text-income" : "text-destructive";
          changeIcon = positive ? (
            <TrendingUp className="size-3" />
          ) : (
            <TrendingDown className="size-3" />
          );
        }
        let changeLabel: string;
        if (change === null) {
          changeLabel = `${t("screen.reports.lastMonthWasZero")} ${formatCurrency(previous)}`;
        } else {
          const directionKey =
            change < 0
              ? "screen.reports.decreasedBy"
              : "screen.reports.increasedBy";
          const percentage = Number(Math.abs(change).toFixed(1));
          changeLabel = `${t(directionKey)} ${percentage}% ${t("screen.reports.vsLastMonth")}`;
        }
        return (
          <Card key={label} className="border-border bg-card card-shadow">
            <CardContent className="p-5">
              <p className="text-sm text-muted-foreground">{label}</p>
              <p className="mt-1 text-2xl font-bold text-foreground">
                {formatCurrency(value)}
              </p>
              <div
                className={cn(
                  "mt-1 flex items-center gap-1 text-xs",
                  changeColor,
                )}
              >
                {changeIcon}
                {changeLabel}
              </div>
            </CardContent>
          </Card>
        );
      })}
    </>
  );
}

function NetWorthCard({
  currentMonth,
  previousMonth,
  formatCurrency,
  t,
}: {
  currentMonth: ReportsData["monthlyReports"][number];
  previousMonth: ReportsData["monthlyReports"][number];
  formatCurrency: (value: number) => string;
  t: (key: string) => string;
}) {
  return (
    <Card className="border-border bg-card card-shadow">
      <CardContent className="p-5">
        <p className="text-sm text-muted-foreground">
          {t("screen.reports.netWorth")}
        </p>
        <p
          className={cn(
            "mt-1 text-2xl font-bold",
            currentMonth.netWorth < 0 ? "text-destructive" : "text-income",
          )}
        >
          {formatCurrency(currentMonth.netWorth)}
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          {formatCurrency(currentMonth.netWorth - previousMonth.netWorth)}{" "}
          {t("screen.reports.thisMonth")}
        </p>
      </CardContent>
    </Card>
  );
}

function ReportsSummaryCards(props: {
  currentMonth: ReportsData["monthlyReports"][number];
  previousMonth: ReportsData["monthlyReports"][number];
  incomeChange: number | null;
  expenseChange: number | null;
  savingsChange: number | null;
  formatCurrency: (value: number) => string;
  t: (key: string) => string;
}) {
  return (
    <div className="mb-6 grid grid-cols-1 gap-4 md:grid-cols-4">
      <ReportsChangeCards {...props} />
      <NetWorthCard {...props} />
    </div>
  );
}

function IncomeVsExpensesChartCard({
  data,
  formatCurrency,
  t,
}: {
  data: ReturnType<typeof useReportsScreenData>["incomeVsExpensesData"];
  formatCurrency: (value: number) => string;
  t: (key: string) => string;
}) {
  return (
    <Card className="border-border bg-card card-shadow">
      <CardHeader>
        <CardTitle className="text-lg">
          {t("screen.reports.incomeVsExpenses")}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="h-72 min-h-0 min-w-0">
          <ResponsiveContainer
            width="100%"
            height="100%"
            minWidth={0}
            minHeight={0}
            initialDimension={{ width: 1, height: 288 }}
          >
            <BarChart data={data}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
              <XAxis
                dataKey="month"
                stroke="var(--muted-foreground)"
                fontSize={12}
              />
              <YAxis
                stroke="var(--muted-foreground)"
                fontSize={12}
                tickFormatter={(value) =>
                  formatCurrency(Number(value)).replace(/([,.]00|,00)$/, "")
                }
              />
              <Tooltip
                formatter={(value) => [formatCurrency(Number(value ?? 0)), ""]}
              />
              <Legend />
              <Bar
                dataKey="income"
                name={t("common.income")}
                fill="var(--income)"
                radius={[4, 4, 0, 0]}
                isAnimationActive
                animationBegin={0}
                animationDuration={500}
                animationEasing="ease-out"
              />
              <Bar
                dataKey="expenses"
                name={t("common.expense")}
                fill="var(--expense)"
                radius={[4, 4, 0, 0]}
                isAnimationActive
                animationBegin={100}
                animationDuration={500}
                animationEasing="ease-out"
              />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  );
}

function NetWorthChartCard({
  data,
  formatCurrency,
  t,
}: {
  data: ReturnType<typeof useReportsScreenData>["netWorthData"];
  formatCurrency: (value: number) => string;
  t: (key: string) => string;
}) {
  const chartColor =
    (data.at(-1)?.netWorth ?? 0) < 0 ? "var(--destructive)" : "var(--primary)";
  return (
    <Card className="border-border bg-card card-shadow">
      <CardHeader>
        <CardTitle className="text-lg">
          {t("screen.reports.netWorthTrend")}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="h-72 min-h-0 min-w-0">
          <ResponsiveContainer
            width="100%"
            height="100%"
            minWidth={0}
            minHeight={0}
            initialDimension={{ width: 1, height: 288 }}
          >
            <AreaChart data={data}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
              <XAxis
                dataKey="month"
                stroke="var(--muted-foreground)"
                fontSize={12}
              />
              <YAxis
                stroke="var(--muted-foreground)"
                fontSize={12}
                tickFormatter={(value) =>
                  formatCurrency(Number(value)).replace(/([,.]00|,00)$/, "")
                }
              />
              <Tooltip
                formatter={(value) => [
                  formatCurrency(Number(value ?? 0)),
                  t("screen.reports.netWorth"),
                ]}
              />
              <defs>
                <linearGradient id="colorNetWorth" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor={chartColor} stopOpacity={0.3} />
                  <stop offset="95%" stopColor={chartColor} stopOpacity={0} />
                </linearGradient>
              </defs>
              <Area
                type="monotone"
                dataKey="netWorth"
                stroke={chartColor}
                strokeWidth={2}
                fill="url(#colorNetWorth)"
                isAnimationActive
                animationBegin={0}
                animationDuration={800}
                animationEasing="ease-in-out"
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  );
}

function MonthlyBreakdownRow({
  report,
  formatCurrency,
  t,
}: {
  report: ReportsData["monthlyReports"][number];
  formatCurrency: (value: number) => string;
  t: (key: string) => string;
}) {
  return (
    <tr className="border-b border-border last:border-0 hover:bg-accent/50">
      <td className="p-4 font-medium text-foreground">
        {t(report.monthKey)} {report.year}
      </td>
      <td className="p-4 text-right text-income">
        {formatCurrency(report.income)}
      </td>
      <td className="p-4 text-right text-expense">
        {formatCurrency(report.expenses)}
      </td>
      <td className="p-4 text-right text-savings">
        {formatCurrency(report.grossSavings)}
      </td>
      <td className="p-4 text-right font-semibold text-foreground">
        {formatCurrency(report.netWorth)}
      </td>
    </tr>
  );
}

function MonthlyBreakdownTable({
  monthlyReports,
  formatCurrency,
  t,
}: {
  monthlyReports: ReportsData["monthlyReports"];
  formatCurrency: (value: number) => string;
  t: (key: string) => string;
}) {
  const headings = [
    t("screen.reports.month"),
    t("common.income"),
    t("common.expense"),
    t("screen.reports.longTermSavings"),
    t("screen.reports.netWorth"),
  ];

  return (
    <Card className="border-border bg-card card-shadow">
      <CardHeader>
        <CardTitle className="text-lg">
          {t("screen.reports.breakdown")}
        </CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-border">
                {headings.map((heading, index) => (
                  <th
                    key={heading}
                    className={cn(
                      "p-4 text-sm font-medium text-muted-foreground",
                      index === 0 ? "text-left" : "text-right",
                    )}
                  >
                    {heading}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {monthlyReports.map((report) => (
                <MonthlyBreakdownRow
                  key={report.month}
                  report={report}
                  formatCurrency={formatCurrency}
                  t={t}
                />
              ))}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}

function ReportMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border/70 bg-background/60 p-4">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 text-xl font-semibold text-foreground">{value}</p>
    </div>
  );
}

function MonthlyReportExpenseList({
  items,
  formatCurrency,
  formatDate,
  t,
  emptyKey,
}: {
  items: MonthlyReport["topExpenses"];
  formatCurrency: (value: number) => string;
  formatDate: (value: string) => string;
  t: (key: string) => string;
  emptyKey: string;
}) {
  if (!items.length) {
    return <p className="text-sm text-muted-foreground">{t(emptyKey)}</p>;
  }

  return (
    <div className="space-y-3">
      {items.map((item) => (
        <div
          key={item.id}
          className="flex items-start justify-between gap-4 text-sm"
        >
          <div className="min-w-0">
            <p className="truncate font-medium text-foreground">
              {t(item.description)}
            </p>
            <p className="truncate text-xs text-muted-foreground">
              {t(item.category)} · {formatDate(item.date)}
            </p>
          </div>
          <span className="shrink-0 font-medium text-expense">
            {formatCurrency(item.amount)}
          </span>
        </div>
      ))}
    </div>
  );
}

function getAllocationTargetLabel(
  targetType: MonthlyReport["installments"]["active"][number]["allocations"][number]["targetType"],
  t: (key: string) => string,
) {
  if (targetType === "savings") return t("catwallet.longTermSavings");
  if (targetType === "sinking_fund") return t("catwallet.sinkingFunds");
  return t("common.category");
}

function InstallmentReportList({
  items,
  formatCurrency,
  t,
  emptyKey,
}: {
  items: MonthlyReport["installments"]["active"];
  formatCurrency: (value: number) => string;
  t: (key: string) => string;
  emptyKey: string;
}) {
  if (!items.length) {
    return <p className="text-sm text-muted-foreground">{t(emptyKey)}</p>;
  }

  return (
    <div className="space-y-3">
      {items.map((item) => (
        <div
          key={item.groupId}
          className="rounded-lg border border-border/70 p-3"
        >
          <div className="flex items-start justify-between gap-3">
            <p className="font-medium text-foreground">{t(item.name)}</p>
            <span className="text-sm text-muted-foreground">
              {formatCurrency(item.monthlyAmount)} / {t("catwallet.monthly")}
            </span>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            {t("retirement.progress")}: {item.currentInstallment} /{" "}
            {item.totalInstallments}
          </p>
          {item.allocations.length ? (
            <div className="mt-2 space-y-1 text-xs text-muted-foreground">
              <p>{t("retirement.summary")}</p>
              {item.allocations.map((allocation) => (
                <p key={allocation.id}>
                  {formatCurrency(allocation.monthlyAmount)} →{" "}
                  {getAllocationTargetLabel(allocation.targetType, t)}
                </p>
              ))}
            </div>
          ) : null}
        </div>
      ))}
    </div>
  );
}

function MonthlyCatWalletReport({
  report,
  formatCurrency,
  formatDate,
  t,
}: {
  report: MonthlyReport;
  formatCurrency: (value: number) => string;
  formatDate: (value: string, options?: Intl.DateTimeFormatOptions) => string;
  t: (key: string) => string;
}) {
  const monthLabel = formatDate(`${report.month}-01`, {
    year: "numeric",
    month: "long",
  });

  return (
    <section
      className="mb-6 space-y-6"
      aria-labelledby="monthly-catwallet-report-title"
    >
      <div>
        <h2
          id="monthly-catwallet-report-title"
          className="text-xl font-semibold text-foreground"
        >
          {t("screen.reports.monthlyCatWalletTitle")}
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">{monthLabel}</p>
      </div>

      <Card className="border-border bg-card card-shadow">
        <CardHeader>
          <CardTitle>{t("screen.reports.monthlyCoreSummary")}</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <ReportMetric
            label={t("screen.reports.incomeMetric")}
            value={formatCurrency(report.core.income)}
          />
          <ReportMetric
            label={t("screen.reports.actualExpensesMetric")}
            value={formatCurrency(report.core.actualExpenses)}
          />
          <ReportMetric
            label={t("screen.reports.longTermSavingsMetric")}
            value={formatCurrency(report.core.longTermSavings)}
          />
          <ReportMetric
            label={t("screen.reports.sinkingFundReserveMetric")}
            value={formatCurrency(report.core.sinkingFundReserve)}
          />
          <ReportMetric
            label={t("screen.reports.fixedCommitmentsMetric")}
            value={formatCurrency(report.core.fixedCommitments)}
          />
          <ReportMetric
            label={t("screen.reports.monthEndSafeToSpend")}
            value={formatCurrency(report.core.safeToSpend)}
          />
          <ReportMetric
            label={t("screen.reports.netBalanceMetric")}
            value={formatCurrency(report.core.netBalance)}
          />
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card className="border-border bg-card card-shadow">
          <CardHeader>
            <CardTitle>{t("screen.reports.whereMoneyWent")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {report.spendingByCategory.length ? (
              report.spendingByCategory.map((item) => (
                <div
                  key={item.key}
                  className="flex items-center justify-between gap-4 text-sm"
                >
                  <span className="truncate text-muted-foreground">
                    {t(item.key)}{" "}
                    <span className="text-xs">({item.count})</span>
                  </span>
                  <span className="font-medium text-foreground">
                    {formatCurrency(item.amount)}
                  </span>
                </div>
              ))
            ) : (
              <p className="text-sm text-muted-foreground">
                {t("screen.reports.emptyMonth")}
              </p>
            )}
            <div className="border-t border-border pt-3 text-sm">
              <div className="flex justify-between">
                <span>{t("screen.reports.fixedCommitmentSpending")}</span>
                <span>
                  {formatCurrency(report.specialSpending.fixedCommitments)}
                </span>
              </div>
              <div className="mt-2 flex justify-between">
                <span>{t("screen.reports.funMoneySpending")}</span>
                <span>{formatCurrency(report.specialSpending.funMoney)}</span>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="border-border bg-card card-shadow">
          <CardHeader>
            <CardTitle>{t("screen.reports.funMoneySection")}</CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-2 gap-3">
            <ReportMetric
              label={t("screen.reports.funMoneyBudget")}
              value={formatCurrency(report.core.funMoney.budget)}
            />
            <ReportMetric
              label={t("screen.reports.funMoneySpent")}
              value={formatCurrency(report.core.funMoney.spent)}
            />
            <ReportMetric
              label={t("screen.reports.funMoneyRemaining")}
              value={formatCurrency(report.core.funMoney.remaining)}
            />
            <ReportMetric
              label={t("screen.reports.funMoneyUsage")}
              value={`${report.core.funMoney.percentage.toFixed(2)}%`}
            />
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card className="border-border bg-card card-shadow">
          <CardHeader>
            <CardTitle>{t("screen.reports.topExpenses")}</CardTitle>
          </CardHeader>
          <CardContent>
            <MonthlyReportExpenseList
              emptyKey="screen.reports.emptyMonth"
              items={report.topExpenses}
              formatCurrency={formatCurrency}
              formatDate={formatDate}
              t={t}
            />
          </CardContent>
        </Card>
        <Card className="border-border bg-card card-shadow">
          <CardHeader>
            <CardTitle>{t("screen.reports.largeOneTimeExpenses")}</CardTitle>
          </CardHeader>
          <CardContent>
            <MonthlyReportExpenseList
              emptyKey="screen.reports.noLargeExpenses"
              items={report.largeOneTimeExpenses}
              formatCurrency={formatCurrency}
              formatDate={formatDate}
              t={t}
            />
          </CardContent>
        </Card>
      </div>

      <Card className="border-border bg-card card-shadow">
        <CardHeader>
          <CardTitle>{t("screen.reports.installmentMonster")}</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          <div>
            <h3 className="mb-3 text-sm font-medium text-muted-foreground">
              {t("screen.reports.installmentsActive")}
            </h3>
            <InstallmentReportList
              items={report.installments.active}
              formatCurrency={formatCurrency}
              t={t}
              emptyKey="screen.reports.noInstallments"
            />
          </div>
          <div>
            <h3 className="mb-3 text-sm font-medium text-muted-foreground">
              {t("screen.reports.installmentsEndingThisMonth")}
            </h3>
            <InstallmentReportList
              items={report.installments.endingThisMonth}
              formatCurrency={formatCurrency}
              t={t}
              emptyKey="screen.reports.noInstallments"
            />
          </div>
          <div>
            <h3 className="mb-3 text-sm font-medium text-muted-foreground">
              {t("screen.reports.installmentsEndingNextMonth")}
            </h3>
            <InstallmentReportList
              items={report.installments.endingNextMonth}
              formatCurrency={formatCurrency}
              t={t}
              emptyKey="screen.reports.noInstallments"
            />
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card className="border-border bg-card card-shadow">
          <CardHeader>
            <CardTitle>{t("screen.reports.sinkingFundsSection")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {report.sinkingFunds.length ? (
              report.sinkingFunds.map((fund) => (
                <div
                  key={fund.id}
                  className="flex items-center justify-between gap-4 text-sm"
                >
                  <span className="truncate">
                    {fund.emoji} {fund.name}
                  </span>
                  <span className="text-right text-muted-foreground">
                    {t("catwallet.currentAmount")}{" "}
                    {formatCurrency(fund.currentAmount)} ·{" "}
                    {t("screen.reports.sinkingFundPlannedIncrease")}{" "}
                    {formatCurrency(fund.monthlyIncrease)}
                    {fund.progress == null
                      ? ""
                      : ` · ${fund.progress.toFixed(0)}%`}
                  </span>
                </div>
              ))
            ) : (
              <p className="text-sm text-muted-foreground">
                {t("screen.reports.noSinkingFunds")}
              </p>
            )}
          </CardContent>
        </Card>
        <Card className="border-border bg-card card-shadow">
          <CardHeader>
            <CardTitle>{t("screen.reports.coolingSection")}</CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-2 gap-3">
            <ReportMetric
              label={t("screen.reports.coolingAdded")}
              value={String(report.cooling.addedCount)}
            />
            <ReportMetric
              label={t("screen.reports.coolingPurchased")}
              value={String(report.cooling.purchasedCount)}
            />
            <ReportMetric
              label={t("screen.reports.coolingAbandoned")}
              value={String(report.cooling.abandonedCount)}
            />
            <ReportMetric
              label={t("screen.reports.coolingAbandonedAmount")}
              value={formatCurrency(report.cooling.abandonedAmount)}
            />
          </CardContent>
        </Card>
      </div>
    </section>
  );
}

export function ReportsScreen({
  monthlyReport,
  reportsData,
}: ReportsScreenProps) {
  const { formatCurrency, formatDate, t } = useI18n();
  const {
    monthlyReports,
    currentMonth,
    previousMonth,
    incomeChange,
    expenseChange,
    savingsChange,
    incomeVsExpensesData,
    netWorthData,
  } = useReportsScreenData(reportsData, t);
  const {
    handlePeriodChange,
    downloadCsv,
    printPdfReport: onPrintPdfReport,
  } = useReportsScreenActions({
    reportsData,
    monthlyReports,
    formatCurrency,
    formatDate,
    t,
  });

  return (
    <>
      <PageHeader
        title={t("screen.reports.title")}
        description={t("screen.reports.description")}
        actions={
          <ReportsToolbarActions
            periodMonths={reportsData.periodMonths}
            onPeriodChange={handlePeriodChange}
            onExportPdf={onPrintPdfReport}
            onExportCsv={downloadCsv}
            t={t}
          />
        }
      />

      <ReportsSummaryCards
        currentMonth={currentMonth}
        previousMonth={previousMonth}
        incomeChange={incomeChange}
        expenseChange={expenseChange}
        savingsChange={savingsChange}
        formatCurrency={formatCurrency}
        t={t}
      />

      <MonthlyCatWalletReport
        report={monthlyReport}
        formatCurrency={formatCurrency}
        formatDate={formatDate}
        t={t}
      />

      <div className="mb-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
        <IncomeVsExpensesChartCard
          data={incomeVsExpensesData}
          formatCurrency={formatCurrency}
          t={t}
        />
        <NetWorthChartCard
          data={netWorthData}
          formatCurrency={formatCurrency}
          t={t}
        />
      </div>

      <MonthlyBreakdownTable
        monthlyReports={monthlyReports}
        formatCurrency={formatCurrency}
        t={t}
      />
    </>
  );
}
