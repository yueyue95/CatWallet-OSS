import { Suspense } from "react";

import { AppShell } from "@/components/dashboard/app-shell";
import { getUserContext } from "@/lib/finance/transactions";
import { CatWalletSummary } from "@/components/dashboard/catwallet-summary";
import { getCatWalletDashboardData } from "@/lib/finance/catwallet";

type DashboardPageProps = {
  searchParams?: Promise<{
    month?: string | string[];
  }>;
};

function DashboardContentFallback() {
  return (
    <div aria-label="Loading dashboard" className="space-y-4 lg:space-y-6">
      <div className="h-84 animate-pulse rounded-xl border border-border bg-card/70 lg:h-81.5" />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4 lg:gap-4">
        {Array.from({ length: 4 }, (_, index) => (
          <div
            key={index}
            className="h-33 animate-pulse rounded-xl border border-border bg-card/70"
          />
        ))}
      </div>
    </div>
  );
}

async function DashboardContent({
  selectedMonth,
  userContext,
}: {
  selectedMonth?: string;
  userContext: Awaited<ReturnType<typeof getUserContext>>;
}) {
  const dashboardMonth = resolveDashboardMonth(selectedMonth);
  const catWalletData = await getCatWalletDashboardData(
    dashboardMonth,
    userContext,
  );

  return <CatWalletSummary data={catWalletData} />;
}

function resolveDashboardMonth(value?: string) {
  if (value && /^\d{4}-\d{2}$/.test(value)) return value;
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

export default async function DashboardPage({
  searchParams,
}: DashboardPageProps) {
  const resolvedSearchParams = await searchParams;
  const selectedMonth = Array.isArray(resolvedSearchParams?.month)
    ? resolvedSearchParams.month[0]
    : resolvedSearchParams?.month;
  const userContext = await getUserContext();

  return (
    <AppShell userContext={userContext}>
      <Suspense fallback={<DashboardContentFallback />}>
        <DashboardContent
          selectedMonth={selectedMonth}
          userContext={userContext}
        />
      </Suspense>
    </AppShell>
  );
}
