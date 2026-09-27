import { randomBytes, randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";

import { createClient } from "@supabase/supabase-js";

import {
  encryptDescription,
  encryptField,
} from "@/lib/crypto/field-encryption";
import type { Database } from "@/lib/supabase/database.types";
import { demoFixtures } from "@/scripts/demo/fixtures";
import {
  assertLocalDemoTarget,
  parseSupabaseStatusEnv,
} from "@/scripts/demo/local-only";

const DEMO_EMAIL = "catwallet-demo@demo.invalid";
const RUNTIME_PATH = resolve(".demo/runtime.json");

function runSupabase(args: string[]): string {
  const executable = resolve("node_modules/supabase/dist/supabase.js");
  const result = spawnSync(process.execPath, [executable, ...args], {
    cwd: process.cwd(),
    encoding: "utf8",
    env: process.env,
  });

  if (result.status !== 0) {
    throw new Error(`Local Supabase command failed: ${args.join(" ")}`);
  }

  return result.stdout;
}

function assertResult(
  label: string,
  result: { error: { message: string } | null },
): void {
  if (result.error) throw new Error(`${label}: ${result.error.message}`);
}

async function waitForPostgrestSchema(
  supabase: ReturnType<typeof createClient<Database>>,
): Promise<void> {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const { error } = await supabase.from("profiles").select("id").limit(1);
    if (!error) return;
    if (/permission denied for table profiles/i.test(error.message)) return;
    if (!/schema cache|could not find the table/i.test(error.message)) {
      throw new Error(`Check local PostgREST schema: ${error.message}`);
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 500));
  }

  throw new Error("Local PostgREST schema did not become ready within 15s.");
}

export async function resetDemo(): Promise<void> {
  runSupabase(["db", "reset", "--local", "--yes"]);

  const status = parseSupabaseStatusEnv(
    runSupabase(["status", "--output", "env"]),
  );
  const apiUrl = status.API_URL;
  const publishableKey = status.PUBLISHABLE_KEY;
  if (!apiUrl || !publishableKey) {
    throw new Error(
      "Local Supabase status did not provide the required values.",
    );
  }
  assertLocalDemoTarget(apiUrl);

  const fieldEncryptionKey = randomBytes(32).toString("base64");
  const demoPassword = `${randomBytes(18).toString("base64url")}Aa1!`;
  process.env.FIELD_ENCRYPTION_KEY = fieldEncryptionKey;

  const supabase = createClient<Database>(apiUrl, publishableKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  await waitForPostgrestSchema(supabase);
  const signup = await supabase.auth.signUp({
    email: DEMO_EMAIL,
    password: demoPassword,
    options: {
      data: {
        full_name: "CatWallet Demo",
        terms_accepted: true,
      },
    },
  });
  if (signup.error || !signup.data.user) {
    throw new Error(`Create local demo user: ${signup.error?.message}`);
  }
  if (!signup.data.session) {
    const signin = await supabase.auth.signInWithPassword({
      email: DEMO_EMAIL,
      password: demoPassword,
    });
    if (signin.error)
      throw new Error(`Sign in local demo user: ${signin.error.message}`);
  }
  const userId = signup.data.user.id;

  assertResult(
    "Mark demo terms accepted",
    await supabase
      .from("profiles")
      .update({ terms_accepted: true })
      .eq("id", userId),
  );
  assertResult(
    "Replace default payment methods",
    await supabase.from("payment_methods").delete().eq("user_id", userId),
  );

  const accounts = await supabase
    .from("payment_methods")
    .insert(
      demoFixtures.accounts.map((account) => ({
        user_id: userId,
        name: account.name,
        type: account.type,
        credit_limit: "creditLimit" in account ? account.creditLimit : null,
        closing_day: account.type === "credit" ? 20 : null,
        due_day: account.type === "credit" ? 8 : null,
        balance_tracking_enabled: account.type === "bank",
      })),
    )
    .select("id,name");
  assertResult("Create demo accounts", accounts);
  const accountIds = new Map(
    (accounts.data ?? []).map((row) => [row.name, row.id]),
  );

  const categories = await supabase
    .from("categories")
    .select("id,name,group_type")
    .eq("user_id", userId);
  assertResult("Read demo categories", categories);
  const categoryByName = new Map(
    (categories.data ?? []).map((row) => [row.name, row.id]),
  );

  assertResult(
    "Create opening balances",
    await supabase.from("account_balance_entries").insert(
      demoFixtures.accounts
        .filter((account) => "openingBalance" in account)
        .map((account) => ({
          user_id: userId,
          payment_method_id: accountIds.get(account.name)!,
          entry_type: "opening_balance" as const,
          amount: account.openingBalance,
          effective_date: "2026-07-01",
          note: "Fictional local demo opening balance",
        })),
    ),
  );

  const everydayId = accountIds.get("Everyday Account")!;
  const visaId = accountIds.get("Demo Visa")!;
  const ordinaryTransactions = demoFixtures.transactions.map((transaction) => ({
    user_id: userId,
    date: transaction.date,
    description: encryptDescription(transaction.description),
    amount: transaction.amount,
    kind: transaction.kind,
    category_id: categoryByName.get(
      transaction.kind === "income" ? "Income" : "Debt",
    ),
    payment_method_id:
      transaction.kind === "income" ||
      transaction.description === "Rent" ||
      transaction.description === "Card Repayment"
        ? everydayId
        : visaId,
    entry_kind: "entryKind" in transaction ? transaction.entryKind : "purchase",
    related_invoice_id:
      "entryKind" in transaction
        ? `credit-card-invoice:${visaId}:2026-09`
        : null,
    notes:
      "entryKind" in transaction
        ? encryptField(`invoice_advance:credit-card-invoice:${visaId}:2026-09`)
        : null,
    counts_toward_fun_money: ["Coffee", "Books", "Weekend Trip"].includes(
      transaction.description,
    ),
  }));

  const installmentTransactions = demoFixtures.installments.flatMap(
    (plan, index) => {
      const groupId = randomUUID();
      return Array.from({ length: plan.total }, (_, itemIndex) => {
        const month = 6 + itemIndex;
        return {
          user_id: userId,
          date: `2026-${String(month).padStart(2, "0")}-${String(11 + index).padStart(2, "0")}`,
          description: encryptDescription(plan.description),
          amount: plan.amount,
          kind: "expense" as const,
          category_id: categoryByName.get("Others"),
          payment_method_id: visaId,
          installment_group_id: groupId,
          installment_number: itemIndex + 1,
          installment_total: plan.total,
          installment_amount_mode: "per_installment",
          installment_amount: plan.amount,
          installment_current_number: plan.current,
          installment_completed_at: plan.retired
            ? "2026-09-10T04:00:00.000Z"
            : null,
          counts_toward_fun_money: false,
          entry_kind: "purchase" as const,
          notes: null,
          related_invoice_id: null,
        };
      });
    },
  );

  assertResult(
    "Create demo transactions",
    await supabase
      .from("transactions")
      .insert([...ordinaryTransactions, ...installmentTransactions]),
  );

  assertResult(
    "Create demo budgets",
    await supabase.from("monthly_budgets").insert(
      ["2026-07-01", "2026-08-01", "2026-09-01"].map((month) => ({
        user_id: userId,
        month,
        income: 6480,
        needs_limit: 3250,
        wants_limit: 1296,
        savings_limit: 1934,
      })),
    ),
  );

  assertResult(
    "Create demo commitments",
    await supabase.from("fixed_commitments").insert(
      demoFixtures.commitments.map((commitment) => ({
        user_id: userId,
        name: commitment.name,
        amount: commitment.amount,
        cadence: commitment.cadence,
        start_date: "2026-07-01",
        payment_method_id: everydayId,
        category_id: categoryByName.get("Debt"),
      })),
    ),
  );

  assertResult(
    "Create demo sinking funds",
    await supabase.from("sinking_funds").insert(
      demoFixtures.sinkingFunds.map((fund) => ({
        user_id: userId,
        name: fund.name,
        current_amount: fund.currentAmount,
        monthly_target: fund.monthlyTarget,
        target_amount: fund.targetAmount,
        expected_use_date: "2027-06-01",
        emoji: "🛟",
      })),
    ),
  );

  assertResult(
    "Create demo goals",
    await supabase.from("goals").insert(
      demoFixtures.goals.map((goal) => ({
        user_id: userId,
        name: goal.name,
        current_amount: goal.currentAmount,
        target_amount: goal.targetAmount,
        deadline: goal.deadline,
        icon: "🎯",
        color: "#22C55E",
      })),
    ),
  );

  assertResult(
    "Create demo cooling items",
    await supabase.from("cooling_items").insert(
      demoFixtures.coolingItems.map((item) => ({
        user_id: userId,
        name: item.name,
        amount_cents: item.amountCents,
        cooling_days: item.coolingDays,
        added_at: "2026-09-10T04:00:00.000Z",
        status: "cooling",
      })),
    ),
  );

  await mkdir(resolve(".demo"), { recursive: true });
  await writeFile(
    RUNTIME_PATH,
    `${JSON.stringify(
      {
        apiUrl,
        publishableKey,
        fieldEncryptionKey,
        email: DEMO_EMAIL,
        password: demoPassword,
      },
      null,
      2,
    )}\n`,
    { encoding: "utf8", mode: 0o600 },
  );

  console.log("Local CatWallet demo data reset complete.");
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  resetDemo().catch((error: unknown) => {
    console.error(
      error instanceof Error ? error.message : "Demo reset failed.",
    );
    process.exitCode = 1;
  });
}
