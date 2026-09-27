import { describe, expect, it } from "vitest";

import {
  assertLocalDemoTarget,
  parseSupabaseStatusEnv,
} from "@/scripts/demo/local-only";

describe("local demo target guard", () => {
  it.each(["http://127.0.0.1:55431", "http://localhost:55431"])(
    "accepts loopback-only targets: %s",
    (target) => {
      expect(() => assertLocalDemoTarget(target)).not.toThrow();
    },
  );

  it.each([
    "https://example.supabase.co",
    ["http", "://192.0.2.10:55431"].join(""),
    "https://demo.invalid",
  ])("rejects hosted and non-loopback targets: %s", (target) => {
    expect(() => assertLocalDemoTarget(target)).toThrow(/local loopback/i);
  });

  it("parses quoted Supabase CLI status output", () => {
    const parsed = parseSupabaseStatusEnv(
      [
        'API_URL="http://127.0.0.1:55431"',
        'PUBLISHABLE_KEY="local-placeholder"',
      ].join("\n"),
    );

    expect(parsed).toEqual({
      API_URL: "http://127.0.0.1:55431",
      PUBLISHABLE_KEY: "local-placeholder",
    });
  });
});
