import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

import {
  formatCurrency,
  getCurrencySymbol,
  getStoredCurrency,
  isSupportedCurrency,
  setStoredCurrency,
} from "@/lib/i18n/currency";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("isSupportedCurrency", () => {
  it("returns true for BRL, USD, EUR, and MYR", () => {
    expect(isSupportedCurrency("BRL")).toBe(true);
    expect(isSupportedCurrency("USD")).toBe(true);
    expect(isSupportedCurrency("EUR")).toBe(true);
    expect(isSupportedCurrency("MYR")).toBe(true);
  });

  it("returns false for unsupported values", () => {
    expect(isSupportedCurrency("GBP")).toBe(false);
    expect(isSupportedCurrency("JPY")).toBe(false);
    expect(isSupportedCurrency(undefined)).toBe(false);
    expect(isSupportedCurrency(null)).toBe(false);
    expect(isSupportedCurrency("")).toBe(false);
  });
});

describe("getStoredCurrency / setStoredCurrency (SSR - no window)", () => {
  let savedWindow: Window & typeof globalThis;

  beforeEach(() => {
    savedWindow = globalThis.window;
    globalThis.window = undefined as unknown as Window & typeof globalThis;
  });

  afterEach(() => {
    globalThis.window = savedWindow;
  });

  it("returns default currency when window is undefined", () => {
    expect(getStoredCurrency()).toBe("MYR");
  });

  it("does not throw when setting currency without window", () => {
    expect(() => setStoredCurrency("BRL")).not.toThrow();
  });
});

describe("getStoredCurrency / setStoredCurrency (browser)", () => {
  beforeEach(() => {
    const store: Record<string, string> = {};
    vi.stubGlobal("window", {
      localStorage: {
        getItem: (key: string) => store[key] ?? null,
        setItem: (key: string, value: string) => {
          store[key] = value;
        },
      },
    });
  });

  it("defaults to MYR when nothing is stored", () => {
    expect(getStoredCurrency()).toBe("MYR");
  });

  it("reads and writes stored currency", () => {
    setStoredCurrency("BRL");
    expect(getStoredCurrency()).toBe("BRL");
    setStoredCurrency("EUR");
    expect(getStoredCurrency()).toBe("EUR");
  });

  it("falls back to MYR when stored value is unsupported", () => {
    const store: Record<string, string> = { "catwallet-currency": "GBP" };
    vi.stubGlobal("window", {
      localStorage: {
        getItem: (key: string) => store[key] ?? null,
        setItem: (key: string, value: string) => {
          store[key] = value;
        },
      },
    });
    expect(getStoredCurrency()).toBe("MYR");
  });

  it("handles localStorage throwing on read", () => {
    vi.stubGlobal("window", {
      localStorage: {
        getItem: () => {
          throw new Error("denied");
        },
        setItem: () => {
          throw new Error("denied");
        },
      },
    });
    expect(getStoredCurrency()).toBe("MYR");
  });

  it("handles localStorage throwing on write", () => {
    vi.stubGlobal("window", {
      localStorage: {
        getItem: () => null,
        setItem: () => {
          throw new Error("denied");
        },
      },
    });
    expect(() => setStoredCurrency("BRL")).not.toThrow();
  });
});

describe("formatCurrency", () => {
  it("resolves the MYR symbol from the same currency configuration", () => {
    expect(getCurrencySymbol("MYR", "zh-CN")).toBe("RM");
  });

  it("formats BRL with Brazilian locale", () => {
    const result = formatCurrency(2883.03, "pt-BR", "BRL");
    expect(result).toContain("R$");
  });

  it("formats USD with US locale", () => {
    const result = formatCurrency(1234.5, "en", "USD");
    expect(result).toContain("$");
  });

  it("formats EUR with English locale", () => {
    const result = formatCurrency(99.9, "en", "EUR");
    expect(result).toContain("€");
  });

  it("formats MYR with Simplified Chinese locale", () => {
    const result = formatCurrency(1234.5, "zh-CN", "MYR");
    expect(result.replaceAll("\u00a0", " ")).toBe("RM 1,234.50");
  });

  it("formats zero", () => {
    const result = formatCurrency(0, "en", "USD");
    expect(result).toContain("0");
  });

  it("formats negative amounts", () => {
    const result = formatCurrency(-500, "en", "USD");
    expect(result).toContain("-");
  });
});
