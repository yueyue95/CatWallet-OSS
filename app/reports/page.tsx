import { AppShell } from "@/components/dashboard/app-shell";
import { ReportsScreen } from "@/components/dashboard/reports-screen";
import { getMonthlyReport } from "@/lib/finance/monthly-report";
import { getReportsData, getUserContext } from "@/lib/finance/transactions";

type ReportsPageProps = {
  searchParams?: Promise<{
    month?: string | string[];
    period?: string | string[];
  }>;
};

export default async function ReportsPage({ searchParams }: ReportsPageProps) {
  const resolvedSearchParams = await searchParams;
  const selectedMonth = Array.isArray(resolvedSearchParams?.month)
    ? resolvedSearchParams.month[0]
    : resolvedSearchParams?.month;
  const selectedPeriod = Array.isArray(resolvedSearchParams?.period)
    ? resolvedSearchParams.period[0]
    : resolvedSearchParams?.period;
  const reportMonth = selectedMonth?.match(/^\d{4}-\d{2}$/)
    ? selectedMonth
    : `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, "0")}`;
  const userContext = await getUserContext();
  const [reportsData, monthlyReport] = await Promise.all([
    getReportsData(selectedMonth, Number(selectedPeriod)),
    getMonthlyReport(userContext.userId, reportMonth, userContext),
  ]);

  return (
    <AppShell userContext={userContext}>
      <ReportsScreen monthlyReport={monthlyReport} reportsData={reportsData} />
    </AppShell>
  );
}
