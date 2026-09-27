import { describe, expect, it } from "vitest";

import { getSupabaseServerUrl } from "@/lib/supabase/server-url";

describe("getSupabaseServerUrl", () => {
  it("prefers the private server URL for container-side requests", () => {
    expect(
      getSupabaseServerUrl({
        NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:55431",
        SUPABASE_SERVER_URL: "http://host.docker.internal:55431",
      }),
    ).toBe("http://host.docker.internal:55431");
  });

  it("falls back to the public URL outside the container", () => {
    expect(
      getSupabaseServerUrl({
        NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:55431",
      }),
    ).toBe("http://127.0.0.1:55431");
  });

  it("ignores whitespace-only server URLs", () => {
    expect(
      getSupabaseServerUrl({
        NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:55431",
        SUPABASE_SERVER_URL: "   ",
      }),
    ).toBe("http://127.0.0.1:55431");
  });
});
