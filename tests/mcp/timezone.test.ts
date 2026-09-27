import { describe, expect, it } from "vitest";

import { addMonths, monthInTimeZone } from "@/mcp/timezone";

describe("MCP timezone contract", () => {
  it("uses the configured user timezone at a UTC month boundary", () => {
    const instant = new Date("2026-08-31T16:30:00.000Z");

    expect(monthInTimeZone(instant, "UTC")).toBe("2026-08");
    expect(monthInTimeZone(instant, "Asia/Kuala_Lumpur")).toBe("2026-09");
  });

  it("adds months without depending on the server timezone", () => {
    expect(addMonths("2026-12", 1)).toBe("2027-01");
    expect(addMonths("2026-01", -1)).toBe("2025-12");
  });

  it("rejects an invalid IANA timezone", () => {
    expect(() => monthInTimeZone(new Date(), "Mars/CatWallet")).toThrow(
      "Invalid CatWallet MCP timezone",
    );
  });
});
