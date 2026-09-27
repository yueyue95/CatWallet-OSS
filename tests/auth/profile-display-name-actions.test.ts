import { beforeEach, describe, expect, it, vi } from "vitest";

const { createClient } = vi.hoisted(() => ({ createClient: vi.fn() }));
const { encryptField } = vi.hoisted(() => ({ encryptField: vi.fn() }));
const { revalidatePath } = vi.hoisted(() => ({ revalidatePath: vi.fn() }));

vi.mock("@/lib/supabase/server", () => ({ createClient }));
vi.mock("@/lib/crypto/field-encryption", () => ({ encryptField }));
vi.mock("next/cache", () => ({ revalidatePath }));

import { updateDisplayNameAction } from "@/app/settings/actions";

function mockSupabase(user: { id: string } | null, error: Error | null = null) {
  const eq = vi.fn().mockResolvedValue({ error });
  const update = vi.fn(() => ({ eq }));
  const from = vi.fn(() => ({ update }));

  return {
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user } }) },
    from,
    update,
    eq,
  };
}

describe("updateDisplayNameAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    encryptField.mockImplementation((value: string) => `encrypted:${value}`);
  });

  it("trims Unicode name parts and updates only the authenticated profile", async () => {
    const supabase = mockSupabase({ id: "user-1" });
    createClient.mockResolvedValue(supabase);

    await updateDisplayNameAction({
      firstName: "  林小猫  ",
      lastName: "  钱包  ",
    });

    expect(supabase.update).toHaveBeenCalledWith({
      name: "encrypted:林小猫 钱包",
    });
    expect(supabase.eq).toHaveBeenCalledWith("id", "user-1");
    expect(revalidatePath).toHaveBeenCalledWith("/settings");
    expect(revalidatePath).toHaveBeenCalledWith("/dashboard");
  });

  it("rejects an empty first name, control characters, and oversized names", async () => {
    const supabase = mockSupabase({ id: "user-1" });
    createClient.mockResolvedValue(supabase);

    await expect(
      updateDisplayNameAction({ firstName: "   ", lastName: "姓" }),
    ).rejects.toThrow();
    await expect(
      updateDisplayNameAction({ firstName: "名\n姓", lastName: "姓" }),
    ).rejects.toThrow();
    await expect(
      updateDisplayNameAction({ firstName: "a".repeat(81), lastName: "姓" }),
    ).rejects.toThrow();
    expect(supabase.update).not.toHaveBeenCalled();
  });

  it("rejects unauthenticated requests without attempting a profile update", async () => {
    const supabase = mockSupabase(null);
    createClient.mockResolvedValue(supabase);

    await expect(
      updateDisplayNameAction({ firstName: "林小猫", lastName: "" }),
    ).rejects.toThrow();
    expect(supabase.from).not.toHaveBeenCalled();
  });
});
