import { createHash, randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import type { CallToolResult } from "@modelcontextprotocol/server";
import { type SupabaseClient } from "@supabase/supabase-js";

import { createLocalMcpAuthProvider } from "@/mcp/auth/context";
import { defaultReadModels } from "@/mcp/services";
import type { Database } from "@/lib/supabase/database.types";

const repoRoot = process.cwd();
const acceptanceMonth =
  process.env.CATWALLET_ACCEPTANCE_MONTH ??
  `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, "0")}`;

const requiredReadTables = [
  "transactions",
  "fixed_commitments",
  "sinking_funds",
  "installment_retirement_allocations",
  "cooling_items",
] as const;

type ReadTable = (typeof requiredReadTables)[number];

type AcceptanceEnvironment = {
  accessToken?: string;
  publishableKey: string;
  supabaseUrl: string;
};

type Envelope = {
  data?: unknown;
  error?: { code?: string; message?: string };
  ok?: boolean;
};

type TableSnapshot = Record<ReadTable, { count: number; digest: string }>;

class AcceptanceFailure extends Error {
  constructor(readonly stage: string) {
    super(stage);
  }
}

function parseEnvFile(contents: string, name: string) {
  const line = contents
    .split(/\r?\n/)
    .find((candidate) => new RegExp(`^\\s*${name}\\s*=`).test(candidate));
  if (!line) return undefined;

  const value = line.slice(line.indexOf("=") + 1).trim();
  return value.replace(/^(['"])(.*)\1$/, "$2");
}

async function readPublicEnvironmentValue(name: string) {
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
      // The next environment source is tried without exposing file errors.
    }
  }

  throw new AcceptanceFailure(`missing_${name.toLowerCase()}`);
}

async function loadEnvironment(
  includeToken: boolean,
): Promise<AcceptanceEnvironment> {
  return {
    accessToken: includeToken
      ? process.env.CATWALLET_MCP_ACCESS_TOKEN?.trim()
      : undefined,
    publishableKey: await readPublicEnvironmentValue(
      "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
    ),
    supabaseUrl: await readPublicEnvironmentValue("NEXT_PUBLIC_SUPABASE_URL"),
  };
}

function safeChildEnvironment(environment: AcceptanceEnvironment) {
  const childEnvironment: Record<string, string> = {};
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
    if (value) childEnvironment[name] = value;
  }
  childEnvironment.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY =
    environment.publishableKey;
  childEnvironment.NEXT_PUBLIC_SUPABASE_URL = environment.supabaseUrl;
  if (environment.accessToken) {
    childEnvironment.CATWALLET_MCP_ACCESS_TOKEN = environment.accessToken;
  }
  return childEnvironment;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function getEnvelope(result: CallToolResult): Envelope {
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

function requireSuccess(result: CallToolResult, name: string) {
  const envelope = getEnvelope(result);
  if (result.isError || envelope.ok !== true) {
    throw new AcceptanceFailure(`tool_failed_${name}`);
  }
  return envelope.data;
}

function requireUnauthenticated(result: CallToolResult) {
  const envelope = getEnvelope(result);
  if (
    !result.isError ||
    envelope.ok !== false ||
    envelope.error?.code !== "UNAUTHENTICATED"
  ) {
    throw new AcceptanceFailure("unauthenticated_path_wrong_contract");
  }
}

function stableDigest(rows: unknown[]) {
  const canonical = JSON.stringify(
    [...rows].sort((left, right) => {
      const leftId =
        isRecord(left) && typeof left.id === "string" ? left.id : "";
      const rightId =
        isRecord(right) && typeof right.id === "string" ? right.id : "";
      return leftId.localeCompare(rightId);
    }),
  );
  return createHash("sha256").update(canonical).digest("hex");
}

async function snapshotDatabase(supabase: SupabaseClient<Database>) {
  const selections: Record<ReadTable, string> = {
    transactions:
      "id,updated_at,date,amount,kind,category_id,payment_method_id,fixed_commitment_id,counts_toward_fun_money,deleted_at",
    fixed_commitments:
      "id,updated_at,amount,cadence,start_date,end_date,include_in_safe_to_spend,is_enabled,deleted_at",
    sinking_funds:
      "id,updated_at,current_amount,monthly_target,target_amount,expected_use_date,is_enabled,deleted_at",
    installment_retirement_allocations:
      "id,updated_at,installment_group_id,target_type,target_id,monthly_amount,starts_month,is_enabled",
    cooling_items:
      "id,updated_at,status,purchased_transaction_id,amount_cents,added_at,cooling_days",
  };

  const entries = await Promise.all(
    requiredReadTables.map(async (table) => {
      const { data, error, count } = await supabase
        .from(table)
        .select(selections[table], { count: "exact" })
        .range(0, 9999);
      if (error) {
        throw new AcceptanceFailure(
          `database_snapshot_${table}_query_${error.code ?? "unknown"}`,
        );
      }
      if (!data || count === null || count !== data.length) {
        throw new AcceptanceFailure(`database_snapshot_${table}`);
      }
      return [table, { count, digest: stableDigest(data) }] as const;
    }),
  );
  return Object.fromEntries(entries) as TableSnapshot;
}

function assertSameSnapshot(before: TableSnapshot, after: TableSnapshot) {
  for (const table of requiredReadTables) {
    if (
      before[table].count !== after[table].count ||
      before[table].digest !== after[table].digest
    ) {
      throw new AcceptanceFailure(`database_changed_${table}`);
    }
  }
}

function assertDeepEqual(left: unknown, right: unknown, stage: string) {
  if (JSON.stringify(left) !== JSON.stringify(right)) {
    throw new AcceptanceFailure(stage);
  }
}

function dataItemCount(data: unknown) {
  if (!isRecord(data) || !Array.isArray(data.items)) return 0;
  return data.items.length;
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

async function connectClient(environment: AcceptanceEnvironment) {
  const stderr: string[] = [];
  const startCommand = mcpStartCommand();
  const transport = new StdioClientTransport({
    args: startCommand.args,
    command: startCommand.command,
    cwd: repoRoot,
    env: safeChildEnvironment(environment),
    stderr: "pipe",
  });
  transport.stderr?.on("data", (chunk: Buffer | string) => {
    stderr.push(String(chunk));
  });
  const client = new Client({
    name: "catwallet-local-acceptance",
    version: "0.1.0",
  });
  try {
    await client.connect(transport);
  } catch {
    await transport.close().catch(() => undefined);
    throw new AcceptanceFailure("mcp_stdio_connect");
  }
  return { client, stderr, transport };
}

async function callTool(
  client: Client,
  name: string,
  args: Record<string, unknown>,
  token: string,
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
  const serialized = JSON.stringify(result);
  if (serialized.includes(token)) {
    throw new AcceptanceFailure(`token_leak_${name}`);
  }
  return requireSuccess(result, name);
}

async function runAuthenticatedAcceptance(environment: AcceptanceEnvironment) {
  if (!environment.accessToken) {
    throw new AcceptanceFailure("missing_authenticated_token");
  }

  const auth = createLocalMcpAuthProvider({
    CATWALLET_MCP_ACCESS_TOKEN: environment.accessToken,
    NODE_ENV: "test",
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: environment.publishableKey,
    NEXT_PUBLIC_SUPABASE_URL: environment.supabaseUrl,
  });
  const context = await auth.getContext().catch(() => {
    throw new AcceptanceFailure("supabase_authenticated_context");
  });
  const supabase = context.supabase as SupabaseClient<Database>;
  const before = await snapshotDatabase(supabase);
  const { client, stderr, transport } = await connectClient(environment);

  try {
    const listedTools = await client.listTools();
    const toolNames = listedTools.tools.map((tool) => tool.name).sort();
    const expectedTools = [
      "get_dashboard_summary",
      "get_installment_summary",
      "get_monthly_report",
      "get_safe_to_spend",
      "list_cooling_items",
      "list_fixed_commitments",
      "list_installments",
      "list_sinking_funds",
      "list_transactions",
      "create_transaction",
    ];
    assertDeepEqual(toolNames, expectedTools, "tool_registry_contract");

    const dashboard = await callTool(
      client,
      "get_dashboard_summary",
      { month: acceptanceMonth },
      environment.accessToken,
    );
    const safeToSpend = await callTool(
      client,
      "get_safe_to_spend",
      { month: acceptanceMonth },
      environment.accessToken,
    );
    const transactionPage = await callTool(
      client,
      "list_transactions",
      { limit: 1, month: acceptanceMonth, type: "expense" },
      environment.accessToken,
    );
    let paginationVerified = false;
    const installments = await callTool(
      client,
      "list_installments",
      { status: "all" },
      environment.accessToken,
    );
    await callTool(
      client,
      "get_installment_summary",
      { month: acceptanceMonth },
      environment.accessToken,
    );
    await callTool(client, "list_sinking_funds", {}, environment.accessToken);
    await callTool(
      client,
      "list_fixed_commitments",
      { month: acceptanceMonth },
      environment.accessToken,
    );
    const monthlyReport = await callTool(
      client,
      "get_monthly_report",
      { month: acceptanceMonth },
      environment.accessToken,
    );
    await callTool(client, "list_cooling_items", {}, environment.accessToken);

    const page = isRecord(transactionPage) ? transactionPage : undefined;
    if (
      page &&
      page.nextCursor !== null &&
      typeof page.nextCursor === "string"
    ) {
      const nextPage = await callTool(
        client,
        "list_transactions",
        {
          cursor: page.nextCursor,
          limit: 1,
          month: acceptanceMonth,
          type: "expense",
        },
        environment.accessToken,
      );
      if (dataItemCount(nextPage) > 1) {
        throw new AcceptanceFailure("pagination_limit_contract");
      }
      paginationVerified = true;
    }

    const webDashboard = await defaultReadModels.getDashboard(
      acceptanceMonth,
      context,
    );
    const webFunMoney = await defaultReadModels.getFunMoney(
      acceptanceMonth,
      context,
    );
    const webSafeToSpend = {
      month: acceptanceMonth,
      ...webDashboard.safeToSpend,
    };
    const webReport = await defaultReadModels.getMonthlyReport(
      context.userId,
      acceptanceMonth,
      context,
    );
    assertDeepEqual(
      dashboard,
      { ...webDashboard, funMoney: webFunMoney },
      "dashboard_read_model_mismatch",
    );
    assertDeepEqual(
      safeToSpend,
      webSafeToSpend,
      "safe_to_spend_read_model_mismatch",
    );
    assertDeepEqual(
      monthlyReport,
      webReport,
      "monthly_report_read_model_mismatch",
    );

    const after = await snapshotDatabase(supabase);
    assertSameSnapshot(before, after);
    const tokenLeak = stderr.some((chunk) =>
      chunk.includes(environment.accessToken!),
    );
    if (tokenLeak) throw new AcceptanceFailure("token_leak_mcp_stderr");

    return {
      authenticated: true,
      databaseUnchanged: true,
      filtering: true,
      paginationVerified,
      monthlyReportMatchesWeb: true,
      safeToSpendMatchesWeb: true,
      dashboardMatchesWeb: true,
      toolCounts: {
        installments: dataItemCount(installments),
        transactions: dataItemCount(transactionPage),
      },
      tokenLeak: false,
    };
  } finally {
    await client.close().catch(() => undefined);
    await transport.close().catch(() => undefined);
  }
}

async function runUnauthenticatedAcceptance(
  environment: AcceptanceEnvironment,
  accessToken?: string,
) {
  const { client, transport } = await connectClient({
    ...environment,
    accessToken,
  });
  try {
    const result = (await client.callTool({
      name: "get_safe_to_spend",
      arguments: { month: acceptanceMonth },
    })) as CallToolResult;
    requireUnauthenticated(result);
    return true;
  } finally {
    await client.close().catch(() => undefined);
    await transport.close().catch(() => undefined);
  }
}

async function main() {
  const authenticatedEnvironment = await loadEnvironment(true);
  const result = await runAuthenticatedAcceptance(authenticatedEnvironment);
  const invalidToken = `invalid-${randomUUID()}`;
  const unauthenticatedEnvironment = await loadEnvironment(false);
  const invalidTokenRejected = await runUnauthenticatedAcceptance(
    unauthenticatedEnvironment,
    invalidToken,
  );
  const missingTokenRejected = await runUnauthenticatedAcceptance(
    unauthenticatedEnvironment,
  );

  console.log(`MCP authenticated acceptance passed for ${acceptanceMonth}`);
  console.log(
    `tools: 10 passed; transactions returned: ${result.toolCounts.transactions}; installments returned: ${result.toolCounts.installments}`,
  );
  console.log(
    `read-model consistency: dashboard=${result.dashboardMatchesWeb}, safe-to-spend=${result.safeToSpendMatchesWeb}, monthly-report=${result.monthlyReportMatchesWeb}`,
  );
  console.log(
    `filtering: ${result.filtering}; pagination-cursor: ${result.paginationVerified}`,
  );
  console.log(`database unchanged: ${result.databaseUnchanged}`);
  console.log(`token leakage: ${result.tokenLeak}`);
  console.log(
    `unauthenticated paths: invalid-token=${invalidTokenRejected}, missing-token=${missingTokenRejected}`,
  );
}

main().catch((error: unknown) => {
  if (error instanceof AcceptanceFailure) {
    console.error(`MCP local acceptance failed at ${error.stage}`);
  } else {
    console.error("MCP local acceptance failed before completion");
  }
  process.exitCode = 1;
});
