import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const configPath = resolve(process.cwd(), "supabase/config.toml");
const config = readFileSync(configPath, "utf8");

describe("local Supabase Auth redirect configuration", () => {
  it("allows the local hostname used by the CatWallet browser", () => {
    expect(config).toContain('external_url = "http://127.0.0.1:56431/auth/v1"');
    expect(config).toContain('site_url = "http://127.0.0.1:3000"');
    expect(config).toContain('"http://127.0.0.1:3000/**"');
    expect(config).toContain('"http://127.0.0.1:3000/auth/callback"');
    expect(config).toContain('"http://127.0.0.1:3000/auth/update-password"');
    expect(config).toContain('"http://localhost:3000/**"');
    expect(config).toContain('"http://localhost:3000/auth/callback"');
    expect(config).toContain('"http://localhost:3000/auth/update-password"');
  });
});
