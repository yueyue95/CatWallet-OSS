import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useEffect } from "react";

import { MobileNav } from "@/components/dashboard/mobile-nav";
import {
  MobileNavVisibilityProvider,
  useMobileNavVisibility,
} from "@/components/dashboard/mobile-nav-visibility";
import { Sidebar } from "@/components/dashboard/sidebar";
import zhCNMessages from "@/lib/i18n/zh-CN";

const navigation = {
  pathname: "/transactions",
  searchParams: new URLSearchParams("month=2026-09"),
  router: { prefetch: vi.fn() },
};

function TransactionEditorState({ open }: { open: boolean }) {
  const { setQuickActionHidden } = useMobileNavVisibility();

  useEffect(() => {
    setQuickActionHidden(open);
  }, [open, setQuickActionHidden]);

  return null;
}

vi.mock("next/navigation", () => ({
  usePathname: () => navigation.pathname,
  useRouter: () => navigation.router,
  useSearchParams: () => navigation.searchParams,
}));

vi.mock("@/lib/i18n", () => ({
  useI18n: () => ({
    t: (key: string) => zhCNMessages[key] ?? key,
  }),
}));

describe("transaction navigation", () => {
  it("keeps transaction management and add-transaction destinations separate", () => {
    render(<MobileNav />);

    expect(screen.getByRole("link", { name: "交易" })).toHaveAttribute(
      "href",
      "/transactions?month=2026-09",
    );
    expect(screen.getByRole("link", { name: "记一笔" })).toHaveAttribute(
      "href",
      "/transactions/new?month=2026-09",
    );
  });

  it("marks the transaction destination active and keeps the quick action accessible", () => {
    render(<MobileNav />);

    expect(screen.getByRole("link", { name: "交易" })).toHaveClass(
      "text-primary",
    );
    expect(screen.getByRole("link", { name: "交易" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(screen.getByRole("link", { name: "记一笔" })).toHaveClass(
      "bg-primary",
    );
    expect(screen.getByRole("link", { name: "记一笔" })).toHaveAttribute(
      "aria-label",
      "记一笔",
    );
  });

  it("hides the quick action on the new transaction form route", () => {
    navigation.pathname = "/transactions/new";

    render(<MobileNav />);

    expect(
      screen.queryByRole("link", { name: "记一笔" }),
    ).not.toBeInTheDocument();

    navigation.pathname = "/transactions";
  });

  it("hides the quick action while a transaction editor is open", async () => {
    render(
      <MobileNavVisibilityProvider>
        <TransactionEditorState open />
        <MobileNav />
      </MobileNavVisibilityProvider>,
    );

    await waitFor(() => {
      expect(
        screen.queryByRole("link", { name: "记一笔" }),
      ).not.toBeInTheDocument();
    });
  });

  it("shows both desktop first-level links with accessible names", () => {
    render(
      <Sidebar
        initials="A"
        signOutAction={vi.fn().mockResolvedValue(undefined)}
        userEmail="a@example.test"
        userName="A"
      />,
    );

    expect(screen.getByRole("link", { name: "交易" })).toHaveAttribute(
      "href",
      "/transactions?month=2026-09",
    );
    expect(screen.getByRole("link", { name: "记一笔" })).toHaveAttribute(
      "href",
      "/transactions/new?month=2026-09",
    );
  });

  it("keeps all More destinations and the wishlist route", async () => {
    render(<MobileNav />);
    fireEvent.pointerDown(screen.getByRole("button", { name: "更多" }), {
      button: 0,
      ctrlKey: false,
    });
    for (const [name, path] of [
      ["快乐钱", "/fun-money"],
      ["想买清单", "/cooling"],
      ["固定承诺", "/commitments"],
      ["目标", "/goals"],
      ["分类", "/categories"],
      ["预算", "/budgets"],
      ["支付账户", "/payments"],
      ["报告", "/reports"],
      ["设置", "/settings"],
    ]) {
      expect(await screen.findByRole("menuitem", { name })).toHaveAttribute(
        "href",
        `${path}?month=2026-09`,
      );
    }
  });
});
