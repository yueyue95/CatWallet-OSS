"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  ArrowLeftRight,
  BarChart3,
  CreditCard,
  CalendarClock,
  Folder,
  Hourglass,
  Layers3,
  LayoutDashboard,
  MoreHorizontal,
  PiggyBank,
  PieChart,
  Settings,
  Target,
  Sparkles,
  type LucideIcon,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { withSelectedMonth } from "@/components/dashboard/month-route";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { useMobileNavVisibility } from "@/components/dashboard/mobile-nav-visibility";

const mobileNavItems = [
  { nameKey: "nav.overview", icon: LayoutDashboard, href: "/dashboard" },
  {
    nameKey: "nav.transactions",
    icon: ArrowLeftRight,
    href: "/transactions",
  },
  { nameKey: "nav.installments", icon: Layers3, href: "/installments" },
  { nameKey: "nav.sinkingFunds", icon: PiggyBank, href: "/sinking-funds" },
];

const moreNavGroups = [
  {
    labelKey: "nav.group.daily",
    items: [
      { nameKey: "nav.funMoney", icon: Sparkles, href: "/fun-money" },
      { nameKey: "nav.cooling", icon: Hourglass, href: "/cooling" },
      { nameKey: "nav.commitments", icon: CalendarClock, href: "/commitments" },
      { nameKey: "nav.goals", icon: Target, href: "/goals" },
    ],
  },
  {
    labelKey: "nav.group.accounts",
    items: [
      { nameKey: "nav.categories", icon: Folder, href: "/categories" },
      { nameKey: "nav.budgets", icon: PieChart, href: "/budgets" },
      { nameKey: "nav.payments", icon: CreditCard, href: "/payments" },
    ],
  },
  {
    labelKey: "nav.group.views",
    items: [
      { nameKey: "nav.reports", icon: BarChart3, href: "/reports" },
      { nameKey: "nav.settings", icon: Settings, href: "/settings" },
    ],
  },
];

interface MobileNavLinkProps {
  readonly item: { nameKey: string; icon: LucideIcon; href: string };
  readonly isActive: boolean;
  readonly href: string;
  readonly onTouchStart: () => void;
  readonly t: (key: string) => string;
}

function MobileNavLink({
  item,
  isActive,
  href,
  onTouchStart,
  t,
}: MobileNavLinkProps) {
  const Icon = item.icon;
  return (
    <Link
      href={href}
      prefetch
      onTouchStart={onTouchStart}
      aria-current={isActive ? "page" : undefined}
      className={cn(
        "flex min-w-0 flex-col items-center justify-center gap-1 rounded-xl px-1 py-2 text-center transition-all duration-200",
        isActive ? "text-primary" : "text-muted-foreground",
      )}
    >
      <Icon className={cn("h-5 w-5 shrink-0", isActive && "text-primary")} />
      <span className="block w-full whitespace-normal text-center text-[10px] font-medium leading-tight">
        {t(item.nameKey)}
      </span>
    </Link>
  );
}

interface MoreNavMenuProps {
  readonly pathname: string;
  readonly router: ReturnType<typeof useRouter>;
  readonly searchParams: URLSearchParams;
  readonly t: (key: string) => string;
}

function MoreNavMenu({ pathname, router, searchParams, t }: MoreNavMenuProps) {
  const isMoreActive = moreNavGroups.some((group) =>
    group.items.some((item) => item.href === pathname),
  );

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className={cn(
            "flex min-w-0 flex-col items-center justify-center gap-1 rounded-xl px-1 py-2 text-center transition-all duration-200",
            isMoreActive ? "text-primary" : "text-muted-foreground",
          )}
          aria-label={t("nav.more")}
        >
          <MoreHorizontal className="h-5 w-5 shrink-0" />
          <span className="block w-full whitespace-normal text-center text-[10px] font-medium leading-tight">
            {t("nav.more")}
          </span>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        className="mb-2 w-56 rounded-xl border-border bg-popover p-2 shadow-xl"
        side="top"
        sideOffset={10}
      >
        {moreNavGroups.map((group, index) => (
          <div key={group.labelKey}>
            {index > 0 ? <DropdownMenuSeparator /> : null}
            <DropdownMenuLabel>{t(group.labelKey)}</DropdownMenuLabel>
            {group.items.map((item) => {
              const Icon = item.icon;
              const isActive = pathname === item.href;
              const href = withSelectedMonth(item.href, searchParams);

              return (
                <DropdownMenuItem key={item.nameKey} asChild>
                  <Link
                    href={href}
                    prefetch
                    onTouchStart={() => router.prefetch(href)}
                    className={cn(
                      "flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2.5 text-sm",
                      isActive && "bg-primary/10 text-primary",
                    )}
                  >
                    <Icon className="h-4 w-4" />
                    {t(item.nameKey)}
                  </Link>
                </DropdownMenuItem>
              );
            })}
          </div>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

interface MobileQuickActionProps {
  readonly hidden: boolean;
  readonly href: string;
  readonly label: string;
  readonly onPrefetch: () => void;
}

function MobileQuickAction({
  hidden,
  href,
  label,
  onPrefetch,
}: MobileQuickActionProps) {
  if (hidden) return null;

  return (
    <Link
      href={href}
      prefetch
      onTouchStart={onPrefetch}
      aria-label={label}
      className="lg:hidden fixed bottom-[calc(4.75rem+env(safe-area-inset-bottom))] right-4 z-50 flex size-12 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg ring-4 ring-background transition-transform hover:scale-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
    >
      <span aria-hidden="true" className="text-2xl leading-none">
        +
      </span>
    </Link>
  );
}

export function MobileNav() {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { t } = useI18n();
  const { quickActionHidden } = useMobileNavVisibility();
  const isNewTransactionRoute = pathname === "/transactions/new";
  const shouldHideQuickAction = quickActionHidden || isNewTransactionRoute;
  const quickActionHref = withSelectedMonth("/transactions/new", searchParams);

  return (
    <>
      <MobileQuickAction
        hidden={shouldHideQuickAction}
        href={quickActionHref}
        label={t("nav.addTransaction")}
        onPrefetch={() => router.prefetch(quickActionHref)}
      />

      <nav className="lg:hidden fixed bottom-0 left-0 right-0 z-50 bg-card/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl border-t border-border">
        <div className="grid grid-cols-5 items-stretch px-2 py-2">
          {mobileNavItems.map((item) => {
            const isActive = pathname === item.href;
            const href = withSelectedMonth(item.href, searchParams);
            return (
              <MobileNavLink
                key={item.nameKey}
                item={item}
                isActive={isActive}
                href={href}
                onTouchStart={() => router.prefetch(href)}
                t={t}
              />
            );
          })}
          <MoreNavMenu
            pathname={pathname}
            router={router}
            searchParams={searchParams}
            t={t}
          />
        </div>
      </nav>
    </>
  );
}
