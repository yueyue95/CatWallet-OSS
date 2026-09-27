import { describe, expect, it } from "vitest";

import { getSupabaseAuthStorageKey } from "@/lib/supabase/auth-storage";

describe("Supabase Auth storage key", () => {
  it("uses the public URL-derived key for both browser and server clients", () => {
    // eslint-disable-next-line sonarjs/no-clear-text-protocols -- local Supabase test origin intentionally uses HTTP
    expect(getSupabaseAuthStorageKey("http://127.0.0.1:55431")).toBe(
      "sb-127-auth-token",
    );
  });

  it("matches Supabase JS default naming for a public hostname", () => {
    expect(
      getSupabaseAuthStorageKey("https://catwallet.example.test/auth/v1"),
    ).toBe("sb-catwallet-auth-token");
  });
});
