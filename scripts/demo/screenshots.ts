import { spawn, type ChildProcess } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import {
  chromium,
  type Browser,
  type BrowserContext,
  type Page,
} from "@playwright/test";

import {
  DEMO_REFERENCE_DATE,
  DEMO_TIME_ZONE,
  screenshotTargets,
} from "@/scripts/demo/fixtures";
import { assertLocalDemoTarget } from "@/scripts/demo/local-only";

type RuntimeConfig = {
  apiUrl: string;
  publishableKey: string;
  fieldEncryptionKey: string;
  email: string;
  password: string;
};

const APP_URL = "http://127.0.0.1:3005";
const SYSTEM_CHROMIUM_PATHS = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
];
const FORBIDDEN_VISIBLE_TEXT = [
  /[a-f\d]{8}-[a-f\d]{4}-[1-5][a-f\d]{3}-[89ab][a-f\d]{3}-[a-f\d]{12}/iu,
  /(?:[A-Z]:\\|\/mnt\/|\/home\/)/u,
  /(?:service[_-]?role|bearer\s+[a-z\d._-]+)/iu,
];

async function waitForServer(
  url: string,
  process: ChildProcess,
  readLogs: () => string,
): Promise<void> {
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    if (process.exitCode !== null)
      throw new Error("Local app server exited early.");
    try {
      const response = await fetch(url, { redirect: "manual" });
      if (response.status < 500) return;
    } catch {
      // Keep polling until the local server is ready or the deadline expires.
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 250));
  }
  throw new Error(
    `Timed out waiting for the local CatWallet server. ${readLogs()}`.trim(),
  );
}

async function preparePage(
  page: Page,
  locale: "en" | "zh-CN",
): Promise<string[]> {
  const consoleErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => consoleErrors.push(error.message));

  await page.addInitScript(
    ({ selectedLocale }: { selectedLocale: "en" | "zh-CN" }) => {
      localStorage.setItem("catwallet-locale", selectedLocale);
      localStorage.setItem("catwallet-currency", "MYR");
      localStorage.setItem("catwallet-theme", "light");
    },
    { selectedLocale: locale },
  );
  await page.addInitScript(`
    (() => {
      const NativeDate = Date;
      const timestamp = new NativeDate(${JSON.stringify(DEMO_REFERENCE_DATE)}).valueOf();
      class DemoDate extends NativeDate {
        constructor(...args) {
          if (args.length === 0) super(timestamp);
          else super(...args);
        }
        static now() { return timestamp; }
        static parse(value) { return NativeDate.parse(value); }
        static UTC(...args) { return NativeDate.UTC(...args); }
      }
      window.Date = DemoDate;
    })();
  `);
  return consoleErrors;
}

async function stabilizePage(page: Page): Promise<void> {
  await page.addStyleTag({
    content: `
      *, *::before, *::after {
        animation-duration: 0s !important;
        animation-delay: 0s !important;
        transition-duration: 0s !important;
        caret-color: transparent !important;
      }
      ::-webkit-scrollbar { width: 0 !important; height: 0 !important; }
      [data-sonner-toaster] { display: none !important; }
    `,
  });
}

async function captureStableScreenshot(
  page: Page,
  output: string,
): Promise<void> {
  const deadline = Date.now() + 20_000;
  let previousHash = "";
  let stableSamples = 0;

  while (Date.now() < deadline) {
    const image = await page.screenshot({ type: "png", scale: "css" });
    const hash = createHash("sha256").update(image).digest("hex");
    stableSamples = hash === previousHash ? stableSamples + 1 : 1;
    previousHash = hash;

    if (stableSamples >= 5) {
      await writeFile(output, image);
      return;
    }

    await page.waitForTimeout(100);
  }

  throw new Error(`Screenshot did not stabilize: ${output}`);
}

async function authenticate(
  context: BrowserContext,
  runtime: RuntimeConfig,
): Promise<Awaited<ReturnType<BrowserContext["storageState"]>>> {
  const page = await context.newPage();
  await preparePage(page, "en");
  await page.goto(APP_URL, { waitUntil: "domcontentloaded" });
  await stabilizePage(page);
  await page.locator("#auth-email").fill(runtime.email);
  await page.locator("#auth-password").fill(runtime.password);
  await page.locator("form button[type='submit']").click();
  await page.waitForURL(/\/dashboard/u, { timeout: 20_000 });
  const state = await context.storageState();
  await page.close();
  return state;
}

async function captureTarget(
  browser: Browser,
  storageState: Awaited<ReturnType<BrowserContext["storageState"]>>,
  target: (typeof screenshotTargets)[number],
): Promise<void> {
  const context = await browser.newContext({
    locale: target.locale === "en" ? "en-MY" : "zh-CN",
    storageState,
    timezoneId: DEMO_TIME_ZONE,
    viewport: target.viewport,
  });
  const page = await context.newPage();
  const consoleErrors = await preparePage(page, target.locale);
  const url = new URL(target.route, APP_URL);
  url.searchParams.set("month", "2026-09");
  console.log(`Capturing ${target.locale}: ${target.route}`);
  await page.goto(url.href, { waitUntil: "domcontentloaded" });
  await page.evaluate((locale) => {
    localStorage.setItem("catwallet-locale", locale);
  }, target.locale);
  await page.reload({ waitUntil: "networkidle" });
  await stabilizePage(page);
  try {
    await page.waitForFunction(
      (expectedLocale) => document.documentElement.lang === expectedLocale,
      target.locale,
      { timeout: 10_000 },
    );
  } catch {
    const localeState = await page.evaluate(() => ({
      html: document.documentElement.lang,
      stored: localStorage.getItem("catwallet-locale"),
    }));
    throw new Error(
      `Locale did not settle on ${target.route}: expected ${target.locale}, html=${localeState.html}, stored=${localeState.stored}`,
    );
  }
  await page.evaluate(async () => document.fonts.ready);
  await page
    .locator("[data-slot='skeleton']")
    .waitFor({ state: "detached", timeout: 5_000 })
    .catch(() => undefined);
  await page
    .locator(".recharts-surface")
    .first()
    .waitFor({ state: "visible", timeout: 5_000 })
    .catch(() => undefined);

  const visibleText = await page.locator("body").innerText();
  const unsafePattern = FORBIDDEN_VISIBLE_TEXT.find((pattern) =>
    pattern.test(visibleText),
  );
  if (unsafePattern)
    throw new Error(`Private-looking text detected on ${target.route}.`);
  if (consoleErrors.length > 0) {
    throw new Error(
      `Console errors on ${target.route}: ${consoleErrors.join(" | ")}`,
    );
  }

  const output = resolve(target.relativePath);
  await captureStableScreenshot(page, output);
  await context.close();
}

async function createContactSheet(browser: Browser): Promise<void> {
  const images = await Promise.all(
    screenshotTargets.map(async (target) => ({
      label: target.relativePath.replace("docs/images/demo/", ""),
      source: `data:image/png;base64,${(
        await readFile(resolve(target.relativePath))
      ).toString("base64")}`,
    })),
  );
  const page = await browser.newPage({
    viewport: { width: 1600, height: 1000 },
  });
  await page.setContent(`<!doctype html><html><head><style>
    body{margin:0;padding:24px;background:#101312;color:#f7faf8;font:16px system-ui,sans-serif}
    h1{margin:0 0 20px;font-size:28px}.grid{display:grid;grid-template-columns:1fr 1fr;gap:20px}
    figure{margin:0;background:#1b211e;border:1px solid #33413a;border-radius:14px;padding:12px}
    img{display:block;width:100%;height:440px;object-fit:contain;border-radius:8px;background:#0b0d0e}
    figcaption{padding:10px 2px 0;color:#c9d4ce;font:13px ui-monospace,monospace}
  </style></head><body><h1>CatWallet deterministic demo screenshots</h1><div class="grid">
    ${images.map((image) => `<figure><img src="${image.source}" alt=""><figcaption>${image.label}</figcaption></figure>`).join("")}
  </div></body></html>`);
  await page.screenshot({
    path: resolve("docs/images/demo/contact-sheet.png"),
    fullPage: true,
    type: "png",
    scale: "css",
  });
  await page.close();
}

async function main(): Promise<void> {
  assertLocalDemoTarget(APP_URL);
  const runtime = JSON.parse(
    await readFile(resolve(".demo/runtime.json"), "utf8"),
  ) as RuntimeConfig;
  assertLocalDemoTarget(runtime.apiUrl);

  const nextBin = resolve("node_modules/next/dist/bin/next");
  const server = spawn(
    process.execPath,
    [nextBin, "dev", "--hostname", "127.0.0.1", "--port", "3005"],
    {
      cwd: process.cwd(),
      env: {
        ...process.env,
        CATWALLET_DEMO_NOW: DEMO_REFERENCE_DATE,
        FIELD_ENCRYPTION_KEY: runtime.fieldEncryptionKey,
        NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: runtime.publishableKey,
        NEXT_PUBLIC_SUPABASE_URL: runtime.apiUrl,
        SUPABASE_SERVER_URL: runtime.apiUrl,
        NODE_OPTIONS: `--require=${resolve("scripts/demo/fixed-date.cjs")}`,
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  let serverLogs = "";
  const appendServerLog = (chunk: Buffer) => {
    serverLogs = `${serverLogs}${chunk.toString("utf8")}`.slice(-2_000);
  };
  server.stdout?.on("data", appendServerLog);
  server.stderr?.on("data", appendServerLog);
  let browser: Browser | undefined;

  try {
    await waitForServer(APP_URL, server, () => serverLogs);
    const executablePath = SYSTEM_CHROMIUM_PATHS.find((path) =>
      existsSync(path),
    );
    browser = await chromium.launch({ executablePath, headless: true });
    const authContext = await browser.newContext({
      locale: "en-MY",
      timezoneId: DEMO_TIME_ZONE,
      viewport: { width: 1440, height: 900 },
    });
    const storageState = await authenticate(authContext, runtime);
    await authContext.close();

    for (const target of screenshotTargets) {
      await captureTarget(browser, storageState, target);
    }
    await createContactSheet(browser);
    await writeFile(resolve(".demo/screenshots.complete"), "ok\n", "utf8");
    console.log("Created ten demo screenshots and the contact sheet.");
  } finally {
    await browser?.close();
    server.kill();
  }
}

main().catch((error: unknown) => {
  console.error(
    error instanceof Error ? error.message : "Screenshot generation failed.",
  );
  process.exitCode = 1;
});
