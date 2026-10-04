import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { InstallmentsScreen } from "@/components/catwallet/installments-screen";
import zhCNMessages from "@/lib/i18n/zh-CN";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/lib/i18n", () => ({
  useI18n: () => ({
    formatCurrency: (value: number) => `RM ${value.toFixed(2)}`,
    formatDate: (value: string | Date) => {
      const date =
        typeof value === "string" ? new Date(`${value}T00:00:00`) : value;
      return new Intl.DateTimeFormat("zh-CN", {
        month: "long",
        year: "numeric",
      }).format(date);
    },
    t: (key: string) => zhCNMessages[key] ?? key,
  }),
}));

const item = {
  amountMode: "total" as const,
  allocations: [],
  currentInstallment: 1,
  endDate: "2027-02-16",
  groupId: "group-a",
  name: "分期测试",
  paidAmount: 83.33,
  paidInstallments: 1,
  remainingAmount: 416.67,
  remainingInstallments: 5,
  retired: false,
  totalAmount: 500,
  totalInstallments: 6,
  monthlyAmount: 83.35,
  retirementStartsMonth: "2027-03",
};

function setup(saveAllocationAction = vi.fn().mockResolvedValue([])) {
  render(
    <InstallmentsScreen
      categories={[]}
      items={[item]}
      sinkingFunds={[]}
      saveAllocationAction={saveAllocationAction}
    />,
  );
  return saveAllocationAction;
}

describe("installment retirement editor", () => {
  it("formats installment months in Chinese and uses the concise per-period label", () => {
    render(
      <InstallmentsScreen
        categories={[]}
        items={[
          {
            ...item,
            amountMode: "per_installment",
            endDate: "2026-12-16",
            monthlyAmount: 463,
          },
        ]}
        sinkingFunds={[]}
        saveAllocationAction={vi.fn().mockResolvedValue([])}
      />,
    );

    expect(screen.getByText("每期金额")).toBeInTheDocument();
    expect(screen.getByText("2026年12月")).toBeInTheDocument();
    expect(screen.getByText("当前进度: 1/6")).toBeInTheDocument();
  });

  it("previews and deletes a completed installment group", async () => {
    const user = userEvent.setup();
    const preview = vi.fn().mockResolvedValue({
      blockers: [],
      canDelete: true,
      occurrenceCount: 2,
      planId: item.groupId,
    });
    const remove = vi.fn().mockResolvedValue(undefined);
    render(
      <InstallmentsScreen
        categories={[]}
        deleteInstallmentAction={remove}
        items={[{ ...item, retired: true }]}
        previewDeleteInstallmentAction={preview}
        restoreInstallmentAction={vi.fn()}
        saveAllocationAction={vi.fn()}
        sinkingFunds={[]}
      />,
    );

    await user.click(screen.getByRole("button", { name: "管理分期" }));
    await user.click(screen.getByRole("menuitem", { name: "删除分期" }));
    await act(async () => {});
    expect(preview).toHaveBeenCalledWith({ planId: item.groupId });
    expect(remove).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog")).toHaveTextContent("分期测试");
    expect(screen.getByRole("dialog")).toHaveTextContent("2");
    expect(screen.getByRole("dialog")).toHaveTextContent("关联交易");
    expect(screen.getByRole("dialog")).toHaveTextContent("当前卡债");
    fireEvent.click(screen.getByRole("button", { name: "确认删除" }));
    await act(async () => {});
    expect(remove).toHaveBeenCalledWith({ planId: item.groupId });
  });

  it("cancels the preview without deleting the installment group", async () => {
    const user = userEvent.setup();
    const preview = vi.fn().mockResolvedValue({
      blockers: [],
      canDelete: true,
      occurrenceCount: 2,
      planId: item.groupId,
    });
    const remove = vi.fn();
    render(
      <InstallmentsScreen
        categories={[]}
        deleteInstallmentAction={remove}
        items={[{ ...item, retired: true }]}
        previewDeleteInstallmentAction={preview}
        restoreInstallmentAction={vi.fn()}
        saveAllocationAction={vi.fn()}
        sinkingFunds={[]}
      />,
    );

    await user.click(screen.getByRole("button", { name: "管理分期" }));
    await user.click(screen.getByRole("menuitem", { name: "删除分期" }));
    await act(async () => {});
    fireEvent.click(screen.getByRole("button", { name: "取消" }));
    expect(remove).not.toHaveBeenCalled();
  });

  it("restores an archived installment group without opening its editor", async () => {
    const user = userEvent.setup();
    const restore = vi.fn().mockResolvedValue(undefined);
    render(
      <InstallmentsScreen
        categories={[]}
        deleteInstallmentAction={vi.fn()}
        items={[{ ...item, archivedAt: "2026-09-30T00:00:00Z" }]}
        previewDeleteInstallmentAction={vi.fn()}
        restoreInstallmentAction={restore}
        saveAllocationAction={vi.fn()}
        sinkingFunds={[]}
      />,
    );

    expect(
      screen.queryByRole("button", { name: "设置退休去向" }),
    ).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "管理分期" }));
    await user.click(screen.getByRole("menuitem", { name: "恢复分期" }));
    expect(screen.getByRole("dialog")).toHaveTextContent("分期测试");
    fireEvent.click(screen.getByRole("button", { name: "确认恢复" }));
    await act(async () => {});
    expect(restore).toHaveBeenCalledWith({ planId: item.groupId });
  });

  it("A/B: starts closed, opens on click and cancels without a database call", () => {
    const save = setup();
    expect(
      screen.queryByRole("button", { name: "保存退休去向" }),
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "设置退休去向" }));
    expect(
      screen.getByRole("button", { name: "保存退休去向" }),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "取消" }));
    expect(
      screen.queryByRole("button", { name: "保存退休去向" }),
    ).not.toBeInTheDocument();
    expect(save).not.toHaveBeenCalled();
  });

  it("E: prevents saving above the monthly release, not the total purchase amount", () => {
    const save = setup();
    fireEvent.click(screen.getByRole("button", { name: "设置退休去向" }));
    fireEvent.change(screen.getByLabelText("分配金额 1"), {
      target: { value: "500" },
    });
    fireEvent.click(screen.getByRole("button", { name: "保存退休去向" }));
    expect(save).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent("RM 83.35");
    fireEvent.change(screen.getByLabelText("分配金额 1"), {
      target: { value: "80" },
    });
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("C/F: saves once on synchronous double submit and collapses with a summary", async () => {
    let resolve!: (value: unknown[]) => void;
    const save = setup(
      vi.fn(
        () =>
          new Promise<unknown[]>((done) => {
            resolve = done;
          }),
      ),
    );
    fireEvent.click(screen.getByRole("button", { name: "设置退休去向" }));
    fireEvent.change(screen.getByLabelText("分配金额 1"), {
      target: { value: "80" },
    });
    const form = screen
      .getByRole("button", { name: "保存退休去向" })
      .closest("form")!;
    act(() => {
      fireEvent.submit(form);
      fireEvent.submit(form);
    });
    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith({
      installmentGroupId: "group-a",
      startsMonth: "2027-03",
      allocations: [
        { monthlyAmount: 80, targetType: "savings", targetId: null },
      ],
    });
    await act(async () => {
      resolve([
        {
          id: "a",
          installmentGroupId: "group-a",
          monthlyAmount: 80,
          targetType: "savings",
          targetId: null,
          startsMonth: "2027-03",
          isEnabled: true,
          notes: null,
        },
      ]);
    });
    expect(
      screen.getByRole("button", { name: "编辑退休去向" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "保存退休去向" }),
    ).not.toBeInTheDocument();
    expect(screen.getByText("RM 80.00 → 长期储蓄")).toBeInTheDocument();
  });

  it("shows the monthly release separately in the retirement section", async () => {
    const save = setup(
      vi.fn().mockResolvedValue([
        {
          id: "a",
          installmentGroupId: "group-a",
          monthlyAmount: 80,
          targetType: "savings",
          targetId: null,
          startsMonth: "2027-03",
          isEnabled: true,
          notes: null,
        },
      ]),
    );

    fireEvent.click(screen.getByRole("button", { name: "设置退休去向" }));
    fireEvent.change(screen.getByLabelText("分配金额 1"), {
      target: { value: "80" },
    });
    fireEvent.click(screen.getByRole("button", { name: "保存退休去向" }));

    await act(async () => {});
    expect(save).toHaveBeenCalledTimes(1);
    expect(screen.getByText("完成后每月释放 RM 83.35")).toBeInTheDocument();
  });
});
