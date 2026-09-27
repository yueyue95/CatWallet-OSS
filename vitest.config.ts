import { fileURLToPath } from "node:url";

import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "jsdom",
    setupFiles: ["./tests/setup.ts"],
    exclude: [
      ...configDefaults.exclude,
      "e2e/**",
      "tests/integration/local-supabase.test.ts",
      "tests/integration/password-reset-pkce.test.ts",
    ],
    testTimeout: 10_000,
    coverage: {
      exclude: [
        "app/**/page.tsx",
        "app/**/layout.tsx",
        "app/**/loading.tsx",
        "app/**/error.tsx",
        "app/**/not-found.tsx",
        "app/**/opengraph-image.tsx",
        "app/robots.ts",
        "app/sitemap.ts",
        "components/dashboard/**",
        "components/ui/**",
        "lib/i18n.tsx",
        "lib/animations/**",
        "e2e/**",
        "playwright.config.ts",
        "scripts/**",
      ],
      thresholds: {
        branches: 67.9,
        functions: 71.94,
        lines: 75.44,
        statements: 74.44,
      },
    },
  },
  resolve: {
    alias: {
      "server-only": fileURLToPath(
        new URL("./tests/mocks/server-only.ts", import.meta.url),
      ),
      "@": fileURLToPath(new URL(".", import.meta.url)),
    },
  },
});
