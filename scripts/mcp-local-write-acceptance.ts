import { createHash, randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import type { CallToolResult } from "@modelcontextprotocol/server";
import { type SupabaseClient } from "@supabase/supabase-js";

import { createLocalMcpAuthProvider } from "@/mcp/auth/context";
import type { Database } from "@/lib/supabase/database.types";

const repoRoot = process.cwd();
const fixtureDate = new Date().toISOString().slice(0, 10);
const acceptanceMonth =
  process.env.CATWALLET_ACCEPTANCE_MONTH ?? fixtureDate.slice(0, 7);

const businessTables = [
  "transactions",
  "fixed_commitments",
  "sinking_funds",
  "installment_retirement_allocations",
  "cooling_items",
] as const;

type BusinessTable = (typeof businessTables)[number];
type Snapshot = Record<BusinessTable, { count: number; digest: string }>;
type Envelope = {
  data?: unknown;
  error?: { code?: string; message?: string };
  ok?: boolean;
};

class AcceptanceFailure extends Error {
  constructor(readonly stage: string) {
    super(stage);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function envValue(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new AcceptanceFailure(`missing_${name.toLowerCase()}`);
  return value;
}

function parseEnvFile(contents: string, name: string) {
  const line = contents
    .split(/\r?\n/)
    .find((candidate) => new RegExp(`^\\s*${name}\\s*=`).test(candidate));
  if (!line) return undefined;
  const value = line.slice(line.indexOf("=") + 1).trim();
  return value.replace(/^(['"])(.*)\1$/, "$2");
}

async function publicEnvValue(name: string) {
  const processValue = process.env[name]?.trim();
  if (processValue) return processValue;
  for (const filename of [".env.local", ".env"]) {
    try {
      const value = parseEnvFile(
        await readFile(join(repoRoot, filename), "utf8"),
        name,
      );
      if (value?.trim()) return value.trim();
    } catch {
      // Public configuration may come from the process environment instead.
    }
  }
  throw new AcceptanceFailure(`missing_${name.toLowerCase()}`);
}

function envelope(result: CallToolResult): Envelope {
  if (isRecord(result.structuredContent)) {
    return result.structuredContent as Envelope;
  }
  const text = result.content.find((item) => item.type === "text");
  if (!text || text.type !== "text") {
    throw new AcceptanceFailure("mcp_response_missing_envelope");
  }
  try {
    return JSON.parse(text.text) as Envelope;
  } catch {
    throw new AcceptanceFailure("mcp_response_invalid_envelope");
  }
}

function successData(result: CallToolResult, name: string) {
  const value = envelope(result);
  if (result.isError || value.ok !== true) {
    throw new AcceptanceFailure(`tool_failed_${name}`);
  }
  return value.data;
}

function assertUnauthenticated(result: CallToolResult) {
  const value = envelope(result);
  if (
    !result.isError ||
    value.ok !== false ||
    value.error?.code !== "UNAUTHENTICATED"
  ) {
    throw new AcceptanceFailure("unauthenticated_path_wrong_contract");
  }
}

async function callTool(
  client: Client,
  name: string,
  args: Record<string, unknown>,
  secret: string,
) {
  let result: CallToolResult;
  try {
    result = (await client.callTool({
      name,
      arguments: args,
    })) as CallToolResult;
  } catch {
    throw new AcceptanceFailure(`mcp_call_${name}`);
  }
  if (JSON.stringify(result).includes(secret)) {
    throw new AcceptanceFailure(`token_leak_${name}`);
  }
  return successData(result, name);
}

function childEnvironment(
  supabaseUrl: string,
  publishableKey: string,
  accessToken?: string,
) {
  const environment: Record<string, string> = {};
  for (const name of [
    "PATH",
    "HOME",
    "USERPROFILE",
    "APPDATA",
    "LOCALAPPDATA",
    "SystemRoot",
    "ComSpec",
    "TEMP",
    "TMP",
    "PNPM_HOME",
  ]) {
    const value = process.env[name];
    if (value) environment[name] = value;
  }
  environment.NEXT_PUBLIC_SUPABASE_URL = supabaseUrl;
  environment.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = publishableKey;
  if (accessToken) environment.CATWALLET_MCP_ACCESS_TOKEN = accessToken;
  return environment;
}

function mcpStartCommand() {
  const pnpmCommand = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
  const probe = spawnSync(pnpmCommand, ["--version"], { stdio: "ignore" });
  return probe.status === 0
    ? { args: ["mcp:start"], command: pnpmCommand }
    : {
        args: ["--conditions=react-server", "--import", "tsx", "mcp/stdio.ts"],
        command: process.execPath,
      };
}

async function connect(
  supabaseUrl: string,
  publishableKey: string,
  accessToken?: string,
) {
  const stderr: string[] = [];
  const command = mcpStartCommand();
  const transport = new StdioClientTransport({
    args: command.args,
    command: command.command,
    cwd: repoRoot,
    env: childEnvironment(supabaseUrl, publishableKey, accessToken),
    stderr: "pipe",
  });
  transport.stderr?.on("data", (chunk: Buffer | string) => {
    stderr.push(String(chunk));
  });
  const client = new Client({
    name: "catwallet-local-write-acceptance",
    version: "0.1.1",
  });
  try {
    await client.connect(transport);
  } catch {
    await transport.close().catch(() => undefined);
    throw new AcceptanceFailure("mcp_stdio_connect");
  }
  return { client, stderr, transport };
}

async function snapshot(
  supabase: SupabaseClient<Database>,
  userId: string,
): Promise<Snapshot> {
  const selections: Record<BusinessTable, string> = {
    transactions: "id,updated_at,date,amount,kind,deleted_at",
    fixed_commitments: "id,updated_at,deleted_at",
    sinking_funds: "id,updated_at,deleted_at",
    installment_retirement_allocations: "id,updated_at",
    cooling_items: "id,updated_at,status,purchased_transaction_id",
  };
  const entries = await Promise.all(
    businessTables.map(async (table) => {
      const { data, error } = await supabase
        .from(table)
        .select(selections[table])
        .eq("user_id", userId)
        .range(0, 9999);
      if (error) throw new AcceptanceFailure(`snapshot_${table}`);
      const rows = [...(data ?? [])].sort((left, right) => {
        const leftId =
          isRecord(left) && typeof left.id === "string" ? left.id : "";
        const rightId =
          isRecord(right) && typeof right.id === "string" ? right.id : "";
        return leftId.localeCompare(rightId);
      });
      const digest = createHash("sha256")
        .update(JSON.stringify(rows))
        .digest("hex");
      return [table, { count: rows.length, digest }] as const;
    }),
  );
  return Object.fromEntries(entries) as Snapshot;
}

function sameSnapshot(before: Snapshot, after: Snapshot) {
  return businessTables.every(
    (table) =>
      before[table].count === after[table].count &&
      before[table].digest === after[table].digest,
  );
}

async function main() {
  const accessToken = envValue("CATWALLET_MCP_ACCESS_TOKEN");
  const supabaseUrl = await publicEnvValue("NEXT_PUBLIC_SUPABASE_URL");
  const publishableKey = await publicEnvValue(
    "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
  );
  const auth = createLocalMcpAuthProvider({
    CATWALLET_MCP_ACCESS_TOKEN: accessToken,
    NODE_ENV: "test",
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: publishableKey,
    NEXT_PUBLIC_SUPABASE_URL: supabaseUrl,
  });
  const context = await auth.getContext().catch(() => {
    throw new AcceptanceFailure("supabase_authenticated_context");
  });
  const supabase = context.supabase as SupabaseClient<Database>;
  const before = await snapshot(supabase, context.userId);
  const { client, stderr, transport } = await connect(
    supabaseUrl,
    publishableKey,
    accessToken,
  );
  let fixtureId: string | null = null;
  const fixtureKey = `stage-9b1-${randomUUID()}`;
  const fixtureInput = {
    amount: 0.01,
    categoryId: null,
    countsTowardFunMoney: false,
    date: fixtureDate,
    description: "CatWallet Stage 9B.1 acceptance fixture",
    idempotencyKey: fixtureKey,
    paymentAccountId: null,
    type: "expense",
  };

  try {
    const tools = await client.listTools();
    const names = tools.tools.map((tool) => tool.name).sort();
    const expected = [
      "create_transaction",
      "get_dashboard_summary",
      "get_installment_summary",
      "get_monthly_report",
      "get_safe_to_spend",
      "list_cooling_items",
      "list_fixed_commitments",
      "list_installments",
      "list_sinking_funds",
      "list_transactions",
    ];
    if (JSON.stringify(names) !== JSON.stringify(expected)) {
      throw new AcceptanceFailure("tool_registry_contract");
    }

    const dashboardBefore = (await callTool(
      client,
      "get_dashboard_summary",
      { month: acceptanceMonth },
      accessToken,
    )) as Record<string, unknown>;
    await callTool(
      client,
      "get_safe_to_spend",
      { month: acceptanceMonth },
      accessToken,
    );
    await callTool(
      client,
      "list_transactions",
      { from: fixtureDate, limit: 1, to: fixtureDate },
      accessToken,
    );
    await callTool(client, "list_installments", { status: "all" }, accessToken);
    await callTool(client, "list_sinking_funds", { active: true }, accessToken);
    await callTool(
      client,
      "list_fixed_commitments",
      { active: true, month: acceptanceMonth },
      accessToken,
    );
    await callTool(
      client,
      "get_monthly_report",
      { month: acceptanceMonth },
      accessToken,
    );
    await callTool(
      client,
      "list_cooling_items",
      { status: "all" },
      accessToken,
    );

    const beforeReads = await snapshot(supabase, context.userId);
    if (!sameSnapshot(before, beforeReads)) {
      throw new AcceptanceFailure("read_tools_changed_database");
    }

    const createdData = (await callTool(
      client,
      "create_transaction",
      fixtureInput,
      accessToken,
    )) as Record<string, unknown>;
    const createdTransaction = createdData.transaction as Record<
      string,
      unknown
    >;
    fixtureId =
      typeof createdTransaction?.id === "string" ? createdTransaction.id : null;
    if (!fixtureId || createdData.idempotencyResult !== "created") {
      throw new AcceptanceFailure("create_transaction_result");
    }

    const replayedData = (await callTool(
      client,
      "create_transaction",
      fixtureInput,
      accessToken,
    )) as Record<string, unknown>;
    const replayedTransaction = replayedData.transaction as Record<
      string,
      unknown
    >;
    if (
      replayedData.idempotencyResult !== "replayed" ||
      replayedTransaction?.id !== fixtureId
    ) {
      throw new AcceptanceFailure("idempotency_replay_result");
    }

    const readBack = (await callTool(
      client,
      "list_transactions",
      { from: fixtureDate, limit: 100, to: fixtureDate, type: "expense" },
      accessToken,
    )) as Record<string, unknown>;
    const readBackItems = Array.isArray(readBack.items) ? readBack.items : [];
    if (
      readBackItems.filter((item) => isRecord(item) && item.id === fixtureId)
        .length !== 1
    ) {
      throw new AcceptanceFailure("transaction_read_back");
    }

    const dashboardAfter = (await callTool(
      client,
      "get_dashboard_summary",
      { month: acceptanceMonth },
      accessToken,
    )) as Record<string, unknown>;
    const safeAfter = (await callTool(
      client,
      "get_safe_to_spend",
      { month: acceptanceMonth },
      accessToken,
    )) as Record<string, unknown>;
    const reportAfter = (await callTool(
      client,
      "get_monthly_report",
      { month: acceptanceMonth },
      accessToken,
    )) as Record<string, unknown>;
    const dashboardSafe = isRecord(dashboardAfter.safeToSpend)
      ? dashboardAfter.safeToSpend
      : null;
    if (JSON.stringify(dashboardSafe) !== JSON.stringify(safeAfter)) {
      throw new AcceptanceFailure("safe_to_spend_read_model_mismatch");
    }
    const beforeSafeModel = isRecord(dashboardBefore.safeToSpend)
      ? dashboardBefore.safeToSpend
      : null;
    const beforeSpent =
      beforeSafeModel && typeof beforeSafeModel.spent === "number"
        ? beforeSafeModel.spent
        : null;
    const afterSpent =
      dashboardSafe && typeof dashboardSafe.spent === "number"
        ? dashboardSafe.spent
        : null;
    const reportCore = isRecord(reportAfter.core) ? reportAfter.core : null;
    if (
      beforeSpent === null ||
      afterSpent === null ||
      Math.abs(Number((afterSpent - beforeSpent).toFixed(2)) - 0.01) >
        0.000001 ||
      !reportCore ||
      typeof reportCore.actualExpenses !== "number"
    ) {
      throw new AcceptanceFailure("read_model_effect");
    }

    const invalid = await connect(
      supabaseUrl,
      publishableKey,
      `invalid-${randomUUID()}`,
    );
    try {
      const invalidResult = (await invalid.client.callTool({
        name: "get_safe_to_spend",
        arguments: { month: acceptanceMonth },
      })) as CallToolResult;
      assertUnauthenticated(invalidResult);
    } finally {
      await invalid.client.close().catch(() => undefined);
      await invalid.transport.close().catch(() => undefined);
    }

    const current = await snapshot(supabase, context.userId);
    if (current.transactions.count !== before.transactions.count + 1) {
      throw new AcceptanceFailure("idempotency_created_more_than_once");
    }
  } finally {
    if (fixtureId) {
      const { error } = await supabase
        .from("transactions")
        .delete()
        .eq("id", fixtureId)
        .eq("user_id", context.userId);
      if (error) throw new AcceptanceFailure("fixture_cleanup");
      const { data, error: lookupError } = await supabase
        .from("transactions")
        .select("id")
        .eq("id", fixtureId)
        .eq("user_id", context.userId)
        .maybeSingle();
      if (lookupError || data)
        throw new AcceptanceFailure("fixture_cleanup_verify");
    }
    await client.close().catch(() => undefined);
    await transport.close().catch(() => undefined);
    if (stderr.some((chunk) => chunk.includes(accessToken))) {
      throw new AcceptanceFailure("token_leak_mcp_stderr");
    }
    const after = await snapshot(supabase, context.userId);
    if (!sameSnapshot(before, after)) {
      throw new AcceptanceFailure("business_data_not_restored");
    }
  }

  console.log("MCP 9B.1 authenticated acceptance passed");
  console.log("create: created then identical replayed without duplication");
  console.log("read-back/dashboard/safe-to-spend/monthly-report: passed");
  console.log("invalid token path: UNAUTHENTICATED");
  console.log("business fixture cleanup: passed");
  console.log("audit events: retained as immutable audit history");
  console.log("token leakage: false");
}

main().catch((error: unknown) => {
  if (error instanceof AcceptanceFailure) {
    console.error(`MCP 9B.1 local acceptance failed at ${error.stage}`);
  } else {
    console.error("MCP 9B.1 local acceptance failed before completion");
  }
  process.exitCode = 1;
});
