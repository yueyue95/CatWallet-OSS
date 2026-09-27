"use client";

import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { useI18n } from "@/lib/i18n";

type DailyExpenseInput = {
  date: string;
  amount: number;
};

type DailyExpensesSplineChartProps = {
  readonly expensesOverTime: DailyExpenseInput[];
  readonly selectedMonth?: string;
};

type DailyChartItem = {
  day: number;
  label: string;
  amount: number;
};

function getMonthKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function getDaysInMonth(monthKey: string) {
  const [year, month] = monthKey.split("-").map(Number);

  return new Date(year, month, 0).getDate();
}

function getChartEndDay(selectedMonth: string) {
  const today = new Date();
  const currentMonth = getMonthKey(today);

  if (selectedMonth === currentMonth) {
    return today.getDate();
  }

  if (selectedMonth < currentMonth) {
    return getDaysInMonth(selectedMonth);
  }

  return 0;
}

function buildDailyChartData(
  expensesOverTime: DailyExpenseInput[],
  monthKey: string,
  endDay: number,
): DailyChartItem[] {
  const expensesByDay = expensesOverTime.reduce<Record<number, number>>(
    (accumulator, expense) => {
      if (!expense.date.startsWith(monthKey)) {
        return accumulator;
      }

      const day = new Date(`${expense.date}T00:00:00`).getDate();

      accumulator[day] = (accumulator[day] ?? 0) + expense.amount;

      return accumulator;
    },
    {},
  );

  return Array.from({ length: endDay }, (_, index) => {
    const day = index + 1;
    const amount = expensesByDay[day] ?? 0;

    return {
      day,
      label: String(day).padStart(2, "0"),
      amount,
    };
  });
}

type DailyExpensesAreaChartProps = {
  readonly chartData: DailyChartItem[];
  readonly formatCurrency: (value: number) => string;
  readonly t: (key: string) => string;
};

function DailyExpensesGradientDef() {
  return (
    <defs>
      <linearGradient id="dailyExpensesFill" x1="0" y1="0" x2="0" y2="1">
        <stop offset="5%" stopColor="currentColor" stopOpacity={0.28} />
        <stop offset="95%" stopColor="currentColor" stopOpacity={0.02} />
      </linearGradient>
    </defs>
  );
}

const DAILY_EXPENSES_TOOLTIP_CONTENT_STYLE = {
  borderRadius: "0.75rem",
  border: "1px solid hsl(var(--border))",
  background: "hsl(var(--card))",
  color: "hsl(var(--card-foreground))",
} as const;

function createDailyTooltipFormatter(
  formatCurrency: (value: number) => string,
  t: (key: string) => string,
) {
  return (value: unknown) => [formatCurrency(Number(value)), t("common.spent")];
}

function createDailyLabelFormatter(t: (key: string) => string) {
  return (label: unknown) => `${t("dashboard.dailyExpenses.day")} ${label}`;
}

function DailyExpensesAreaChart({
  chartData,
  formatCurrency,
  t,
}: DailyExpensesAreaChartProps) {
  const tooltipFormatter = createDailyTooltipFormatter(formatCurrency, t);
  const labelFormatter = createDailyLabelFormatter(t);

  return (
    <ResponsiveContainer width="100%" height="100%">
      <AreaChart
        data={chartData}
        margin={{ top: 8, right: 12, left: 0, bottom: 0 }}
      >
        <DailyExpensesGradientDef />

        <CartesianGrid strokeDasharray="3 3" className="stroke-border" />

        <XAxis
          dataKey="label"
          tickLine={false}
          axisLine={false}
          tickMargin={8}
          className="text-xs"
        />

        <YAxis
          tickLine={false}
          axisLine={false}
          tickMargin={8}
          width={72}
          className="text-xs"
          tickFormatter={(value) => formatCurrency(Number(value))}
        />

        <Tooltip
          cursor={{ strokeDasharray: "3 3" }}
          formatter={tooltipFormatter}
          labelFormatter={labelFormatter}
          contentStyle={DAILY_EXPENSES_TOOLTIP_CONTENT_STYLE}
        />

        <Area
          type="monotone"
          dataKey="amount"
          stroke="currentColor"
          strokeWidth={2.5}
          fill="url(#dailyExpensesFill)"
          dot={false}
          activeDot={{ r: 5 }}
          className="text-primary"
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}

type DailyExpensesSummaryFooterProps = {
  readonly endDay: number;
  readonly formatCurrency: (value: number) => string;
  readonly t: (key: string) => string;
  readonly totalSpent: number;
};

function DailyExpensesSummaryFooter({
  endDay,
  formatCurrency,
  t,
  totalSpent,
}: DailyExpensesSummaryFooterProps) {
  return (
    <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
      <div className="rounded-lg border border-border bg-muted/30 p-3">
        <p className="text-xs text-muted-foreground">
          {t("dashboard.dailyExpenses.spentSoFar")}
        </p>
        <p className="font-semibold">{formatCurrency(totalSpent)}</p>
      </div>

      <div className="rounded-lg border border-border bg-muted/30 p-3">
        <p className="text-xs text-muted-foreground">
          {t("dashboard.dailyExpenses.daysShown")}
        </p>
        <p className="font-semibold">{endDay}</p>
      </div>
    </div>
  );
}

export function DailyExpensesSplineChart({
  expensesOverTime,
  selectedMonth,
}: DailyExpensesSplineChartProps) {
  const { formatCurrency, t } = useI18n();
  const fallbackMonth = getMonthKey(new Date());
  const monthKey = selectedMonth ?? fallbackMonth;
  const endDay = getChartEndDay(monthKey);
  const chartData = buildDailyChartData(expensesOverTime, monthKey, endDay);
  const totalSpent = chartData.reduce((total, item) => total + item.amount, 0);
  const averagePerDay = endDay > 0 ? totalSpent / endDay : 0;

  return (
    <Card className="h-full">
      <CardHeader>
        <div className="flex items-start justify-between gap-4">
          <div>
            <CardTitle>{t("dashboard.dailyExpenses.title")}</CardTitle>
            <CardDescription>
              {t("dashboard.dailyExpenses.description")}
            </CardDescription>
          </div>

          <div className="text-right">
            <p className="text-xs text-muted-foreground">
              {t("dashboard.dailyExpenses.averagePerDay")}
            </p>
            <p className="text-sm font-semibold">
              {formatCurrency(averagePerDay)}
            </p>
          </div>
        </div>
      </CardHeader>

      <CardContent>
        <div className="h-72">
          <DailyExpensesAreaChart
            chartData={chartData}
            formatCurrency={formatCurrency}
            t={t}
          />
        </div>

        <DailyExpensesSummaryFooter
          endDay={endDay}
          formatCurrency={formatCurrency}
          t={t}
          totalSpent={totalSpent}
        />
      </CardContent>
    </Card>
  );
}
