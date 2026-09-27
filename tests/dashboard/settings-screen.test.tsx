import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { SettingsScreen } from "@/components/dashboard/settings-screen";

const { refresh } = vi.hoisted(() => ({ refresh: vi.fn() }));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh }),
}));

vi.mock("@/components/theme-toggle", () => ({
  ThemeToggle: () => <button type="button">Toggle theme</button>,
}));

vi.mock("@/lib/i18n", () => ({
  useI18n: () => ({
    currency: "MYR",
    formatDate: (value: string) => value,
    locale: "zh-CN",
    setCurrency: vi.fn(),
    setLocale: vi.fn(),
    t: (key: string) =>
      ({
        "screen.settings.title": "设置",
        "screen.settings.description": "管理你的账户和偏好设置",
        "screen.settings.profile": "个人资料",
        "screen.settings.profileDescription": "管理你的个人信息",
        "screen.settings.firstName": "名字",
        "screen.settings.lastName": "姓氏",
        "screen.settings.email": "邮箱",
        "screen.settings.saveProfile": "保存资料",
        "screen.settings.savingProfile": "正在保存…",
        "screen.settings.profileSaved": "资料已保存",
        "screen.settings.profileSaveError": "资料保存失败，请重试。",
        "settings.createdAt": "账户创建时间",
        "settings.notAvailable": "暂无",
      })[key] ?? key,
  }),
}));

const profile = {
  avatarUrl: null,
  createdAt: "2026-09-19T00:00:00Z",
  email: "cat@example.test",
  firstName: "林小猫",
  fullName: "林小猫 钱包",
  lastName: "钱包",
};

describe("SettingsScreen profile display name", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("lets the user edit both name parts and refreshes the shell after saving", async () => {
    const user = userEvent.setup();
    const saveProfile = vi.fn().mockResolvedValue(undefined);

    render(<SettingsScreen profile={profile} saveProfile={saveProfile} />);

    const firstName = screen.getByLabelText("名字");
    const lastName = screen.getByLabelText("姓氏");
    await user.clear(firstName);
    await user.type(firstName, "小猫");
    await user.clear(lastName);
    await user.type(lastName, "新名字");
    await user.click(screen.getByRole("button", { name: "保存资料" }));

    expect(saveProfile).toHaveBeenCalledWith({
      firstName: "小猫",
      lastName: "新名字",
    });
    expect(refresh).toHaveBeenCalledOnce();
    expect(await screen.findByRole("status")).toHaveTextContent("资料已保存");
    expect(screen.getByText("小猫 新名字")).toBeInTheDocument();
    expect(screen.getByLabelText("邮箱")).toHaveAttribute("readonly");
  });

  it("shows a failure state when the profile action rejects", async () => {
    const user = userEvent.setup();
    const saveProfile = vi.fn().mockRejectedValue(new Error("failed"));

    render(<SettingsScreen profile={profile} saveProfile={saveProfile} />);

    await user.click(screen.getByRole("button", { name: "保存资料" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "资料保存失败，请重试。",
    );
    expect(refresh).not.toHaveBeenCalled();
  });
});
